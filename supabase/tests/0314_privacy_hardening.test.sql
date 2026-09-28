-- ============================================================================
-- 0314_privacy_hardening.test.sql — rolled-back verification of migration 0314
-- ============================================================================
-- WHAT IT IS
--   The test migration 0314 must pass BEFORE it is applied to production. One
--   transaction:
--
--     begin;
--       <the full text of supabase/migrations/0314_privacy_hardening.sql, verbatim>
--       <fixtures: store A (active, legal fields, a suspension note, a verified
--        licence, a private scan), store B, a customer order, staff with and
--        without 'orders', an admin holding 'stores' + 'verifications', job
--        postings open / closed / expired / deleted / closing today>
--       <every assertion, acting as anon, another signed-in user (store B's
--        owner), the ordering customer, owner A, staff of A with and without
--        'orders', and the admin>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives the rollback: not the migration, not the fixtures, not
--   the rows the checks write. It is written to be run against production by
--   the owner (Supabase MCP execute_sql, the SQL editor, or
--   supabase db execute). It has NOT been run yet; see
--   audit/prelaunch-v2/_work/privacy-fixes.md.
--
--   The migration section is a verbatim copy of the migration file (a vitest,
--   src/lib/__tests__/store-column-grants.test.ts, fails if they differ). If
--   0314 is edited, paste the new text between the two MIGRATION markers.
--   Every statement in 0314 is idempotent, so after the apply this doubles as
--   a regression test.
--
-- THE CHECK THAT GUARDS THE LIVE STOREFRONT
--   Check group "ANON reads every public column" runs, AS anon, one SELECT
--   naming all 51 columns the public site uses (the list in
--   src/lib/store-columns.ts STORE_ANON_COLUMNS, which a vitest keeps equal to
--   what src/ actually selects), plus the storefront's real query shapes
--   (store page, listing, search or(), Google feed, checkout, the
--   business_types join) and an anonymous PRODUCT read — whose RLS policy
--   reads stores.owner_id as the caller. A missing grant makes these fail
--   here, not on matjarlb.com.
--
-- HOW TO READ IT
--   One row per check: ok true/false and got, the value or error actually
--   observed. The last row, ALL CHECKS, says how many failed.
--
-- RULE THIS FOLLOWS (supabase-verify): seed first as postgres, then read AS the
-- role; every "sees 0" is paired with a positive control from an actor who must
-- see that same row; each expected refusal runs in its own exception block so
-- one refusal cannot poison the checks after it.
--
-- NOT COVERED HERE: DELETE on storage.objects. storage.protect_delete() blocks
-- every direct DELETE on that table (deletes go through the Storage API), so
-- the delete policy is checked through its predicate,
-- can_write_verification_doc(), instead.
-- ============================================================================

begin;

-- ==== MIGRATION 0314 (verbatim) ====
-- 0314 — Privacy hardening: what a visitor, a customer and a merchant can read.
--
-- Closes five findings of audit/prelaunch-v2/09_TRUST.md and 07_JOBS.md:
--
--   P1-PRIV-01  stores       — anon (and every signed-in account) could read all
--                               71 columns of every active store: tax_no,
--                               legal_name, legal_address, commercial_reg_no,
--                               the admin's status_reason / status_changed_by …
--   P1-PRIV-02  verification — document scans went to the PUBLIC store-assets
--               documents       bucket (a Lebanese commercial registration
--                               carries the owner's ID number and home address)
--   P2-PRIV-03  store_verifications — anon read the licence number, verify_url
--                               and which admin approved it (reviewed_by)
--   P2-PRIV-04  orders.store_note — the merchant's internal note was readable by
--                               the ordering customer through the API
--   P1-JOBS-08  job_applications — the insert policy never checked the job was
--                               still open, so closed/expired jobs took
--                               applications through the API
--
-- ORDER OF DEPLOYMENT: either. The app code shipped with this migration works
-- against the database before AND after it:
--   * it no longer selects any revoked column directly (a source scan in
--     src/lib/__tests__/store-column-grants.test.ts fails the test run if one
--     comes back), and reads the private ones through store_private_fields(),
--     falling back to the old direct select while that function is missing;
--   * verification scans are read via signed URLs, and old public URLs still
--     render;
--   * the order note is read from order_staff_notes with a fallback to the old
--     column, and a trigger here turns any write to the old column into a
--     write to the new table, so a browser still on the previous build works.
--
-- Verification: supabase/tests/0314_privacy_hardening.test.sql (rolled back).
-- Every statement is idempotent.


-- ===========================================================================
-- 1. stores: column-level SELECT instead of a table-level grant (P1-PRIV-01)
-- ===========================================================================
-- Row filtering stays with stores_select (active + not deleted, or owner, or
-- admin_can('stores')). What changes is WHICH COLUMNS a role may name.
--
-- anon gets exactly the columns the public site selects, filters or joins on
-- (src/lib/store-columns.ts STORE_ANON_COLUMNS, kept in step with this list by
-- a test). Three need a word:
--   owner_id         products_select, orders_select, bookings_select,
--                    order_items_select, store_staff_* and the invoker helpers
--                    can_manage_store / staff_can / is_store_owner all run
--                    `exists (select 1 from stores s where s.owner_id = …)` AS
--                    THE CALLER, and Postgres checks column privileges inside
--                    those subqueries. Revoking it from anon would make every
--                    anonymous product read fail with 42501. It is a uuid, and
--                    stays readable; moving ownership checks behind a definer
--                    helper is the follow-up that would allow revoking it.
--   business_type_id PostgREST joins business_types(...) through it.
--   trial_ends_at    the public Google feed (0308) derives the effective plan.
--
-- authenticated gets every column EXCEPT the private set below. The dashboard
-- reads its own store's operational columns (plan, trial, HR radius, books
-- lock …) under the user's session, and guard_locked_books /
-- attendance_late_minutes read two of them as the invoker.
--
-- The private set — revoked from BOTH roles — is served by
-- store_private_fields(uuid[]) (section 2):
--   legal_name, tax_no, legal_address, commercial_reg_no, invoice_prefix,
--   status_reason, status_changed_by,
--   invoice_next_no, credit_note_next_no (read only inside definer functions),
--   address (read by nothing).
--
-- A column ADDED to stores after this migration is readable by no client role
-- until a migration grants it. That is the point; see store-columns.ts.

revoke select on table public.stores from anon, authenticated;

grant select (
  id, owner_id, business_type_id, name, slug, description,
  logo_url, cover_url, cover_position, phone, whatsapp, region,
  area, service_area, status, plan, trial_ends_at, is_verified,
  commercial_reg_verified, featured_until, created_at, updated_at,
  deleted_at, hours, booking_slot_minutes, booking_cancel_hours,
  instagram, facebook, website, accepts_delivery, accepts_pickup,
  min_order, prep_time, payment_note, specialties, insurance, lat,
  lng, short_code, rating_avg, rating_count,
  loyalty_redemption_enabled, loyalty_points_per_unit, accent_color,
  storefront_layout, announcement, storefront_theme, return_policy,
  shipping_policy, google_feed_enabled, request_intake
) on table public.stores to anon;

grant select (
  id, owner_id, business_type_id, name, slug, description,
  logo_url, cover_url, phone, whatsapp, region, area,
  status, plan, is_verified, created_at, updated_at, deleted_at,
  opening_hours, instagram, facebook, website, accepts_delivery,
  accepts_pickup, min_order, prep_time, payment_note, specialties,
  insurance, lat, lng, short_code, featured_until,
  commercial_reg_verified, hours,
  booking_slot_minutes, service_area, rating_avg, rating_count,
  loyalty_redemption_enabled, loyalty_points_per_unit, trial_ends_at,
  accent_color, storefront_layout, announcement, storefront_theme,
  booking_cancel_hours, vat_rate,
  vat_inclusive, cover_position,
  books_locked_until, clock_radius_m,
  late_grace_minutes, auto_close_hours,
  status_changed_at, request_intake,
  branch_stock_separate, return_policy, shipping_policy,
  google_feed_enabled, google_feed_enabled_at
) on table public.stores to authenticated;

-- INSERT / UPDATE privileges are untouched: the owner still writes the legal
-- fields from the settings form; RLS (stores_update) and the platform-column
-- guard (0217) still decide what that write may change.


-- ===========================================================================
-- 2. store_private_fields(uuid[]) — the private columns, per row, per caller
-- ===========================================================================
--   legal identity (legal_name, tax_no, legal_address, commercial_reg_no,
--   invoice_prefix) → the owner, any staff member of that store (they print
--                      invoices), and admin_can('stores')
--   status_reason      → the owner and admin_can('stores')
--   status_changed_by  → admin_can('stores') only (it names the admin)
-- A store the caller has no relation to is simply not returned.
create or replace function public.store_private_fields(p_store_ids uuid[])
returns table (
  id uuid,
  legal_name text,
  tax_no text,
  legal_address text,
  commercial_reg_no text,
  invoice_prefix text,
  status_reason text,
  status_changed_by uuid
)
language sql
stable
security definer
set search_path = ''
as $function$
  with me as (
    select (select auth.uid()) as uid, public.admin_can('stores') as is_admin
  )
  select
    s.id,
    s.legal_name,
    s.tax_no,
    s.legal_address,
    s.commercial_reg_no,
    s.invoice_prefix,
    case when s.owner_id = me.uid or me.is_admin then s.status_reason end,
    case when me.is_admin then s.status_changed_by end
  from public.stores s
  cross join me
  where me.uid is not null
    and s.id = any (coalesce(p_store_ids, '{}'::uuid[]))
    and (
      s.owner_id = me.uid
      or me.is_admin
      or exists (
        select 1 from public.store_staff st
        where st.store_id = s.id and st.user_id = me.uid
      )
    );
$function$;

comment on function public.store_private_fields(uuid[]) is
  'Private stores columns (legal identity, suspension reason/actor) for stores the caller owns, staffs or administers (admin_can(''stores'')). 0314: these columns are not client-readable otherwise.';

revoke all on function public.store_private_fields(uuid[]) from public, anon, authenticated;
grant execute on function public.store_private_fields(uuid[]) to authenticated;


-- ===========================================================================
-- 3. store_verifications: column grants (P2-PRIV-03)
-- ===========================================================================
-- anon: what the storefront's certificates section renders — kind, title,
-- issuer, dates, and whether an admin verified it. Not the licence number,
-- not verify_url, not which admin approved it or why one was rejected.
-- authenticated: everything the merchant and admin review screens read,
-- except reviewed_by. (Row policies are unchanged: the public read is still
-- verified + unexpired only; owners and admin_can('verifications') see all.)
revoke select on table public.store_verifications from anon, authenticated;

grant select (
  id, store_id, kind, title, issuer, issued_on, expires_on, status, created_at
) on table public.store_verifications to anon;

grant select (
  id, store_id, kind, title, issuer, issued_on, expires_on, status, created_at,
  number, verify_url, updated_at, reviewed_at, rejection_reason
) on table public.store_verifications to authenticated;


-- ===========================================================================
-- 4. Private bucket for verification document scans (P1-PRIV-02)
-- ===========================================================================
-- Same shape as ledger-attachments (0307): private, objects under
-- "<store_id>/<file>". Images only. The app compresses a phone photo to about
-- 1 MB; 5 MB is headroom.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-docs',
  'verification-docs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The path test lives in functions, not inline in the policy, for the reason
-- 0283/0307 give: a policy that casts split_part(name,'/',1)::uuid can be
-- evaluated against objects of OTHER buckets whose first segment is not a
-- uuid, and raise. These check the shape before they cast.

-- Read: the store's owner and staff, and admins holding 'verifications'.
create or replace function public.can_read_verification_doc(p_name text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  seg1 text := split_part(p_name, '/', 1);
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  if seg1 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if split_part(p_name, '/', 2) = '' or position('..' in p_name) > 0 then
    return false;
  end if;
  return public.can_manage_store(seg1::uuid) or public.admin_can('verifications');
end
$function$;

-- Write (upload / delete): the owner only — the same people who may write
-- store_verification_docs rows (store_verification_docs_manage).
create or replace function public.can_write_verification_doc(p_name text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  seg1 text := split_part(p_name, '/', 1);
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  if seg1 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if split_part(p_name, '/', 2) = '' or position('..' in p_name) > 0 then
    return false;
  end if;
  return public.is_store_owner(seg1::uuid);
end
$function$;

revoke all on function public.can_read_verification_doc(text) from public, anon, authenticated;
grant execute on function public.can_read_verification_doc(text) to authenticated;
revoke all on function public.can_write_verification_doc(text) from public, anon, authenticated;
grant execute on function public.can_write_verification_doc(text) to authenticated;

drop policy if exists verification_docs_read on storage.objects;
create policy verification_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'verification-docs'
    and public.can_read_verification_doc(name)
  );

drop policy if exists verification_docs_insert on storage.objects;
create policy verification_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-docs'
    and public.can_write_verification_doc(name)
  );

drop policy if exists verification_docs_delete on storage.objects;
create policy verification_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'verification-docs'
    and public.can_write_verification_doc(name)
  );

-- A new doc row must point INTO the private bucket, under its own store:
-- "<store_id>/<file>", no scheme, no "..". NOT VALID, so a pre-0314 row that
-- still holds a public URL is left alone (0 such rows when this was written)
-- while every new or edited row is held to it.
alter table public.store_verification_docs
  drop constraint if exists store_verification_docs_private_path;
alter table public.store_verification_docs
  add constraint store_verification_docs_private_path check (
    split_part(doc_url, '/', 1) = store_id::text
    and split_part(doc_url, '/', 2) <> ''
    and position('..' in doc_url) = 0
    and doc_url !~ '^[A-Za-z][A-Za-z0-9+.-]*:'
  ) not valid;


-- ===========================================================================
-- 5. order_staff_notes — the merchant's internal note, staff-only (P2-PRIV-04)
-- ===========================================================================
-- Column privileges are per role, and merchant and customer are both
-- `authenticated`, so orders.store_note could not be hidden from the customer
-- on the orders row itself. The note moves to its own table; the old column
-- stays (always NULL from here on) so no deployed select breaks.
create table if not exists public.order_staff_notes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  note text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint order_staff_notes_note_check
    check (char_length(btrim(note)) between 1 and 2000)
);

comment on table public.order_staff_notes is
  'Internal, staff-only note on an order (was orders.store_note, which the ordering customer could read). staff_can(store_id, ''orders'') only. 0314.';

create index if not exists order_staff_notes_store_id_idx
  on public.order_staff_notes (store_id);
create index if not exists order_staff_notes_updated_by_idx
  on public.order_staff_notes (updated_by);

alter table public.order_staff_notes enable row level security;

revoke all on table public.order_staff_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.order_staff_notes to authenticated;

drop policy if exists order_staff_notes_read on public.order_staff_notes;
create policy order_staff_notes_read on public.order_staff_notes
  for select to authenticated
  using (public.staff_can(store_id, 'orders'));

-- The note's store must be the order's store, so a member of store A cannot
-- hang a note (visible to A) on store B's order id.
drop policy if exists order_staff_notes_insert on public.order_staff_notes;
create policy order_staff_notes_insert on public.order_staff_notes
  for insert to authenticated
  with check (
    public.staff_can(store_id, 'orders')
    and exists (
      select 1 from public.orders o
      where o.id = order_staff_notes.order_id
        and o.store_id = order_staff_notes.store_id
    )
  );

drop policy if exists order_staff_notes_update on public.order_staff_notes;
create policy order_staff_notes_update on public.order_staff_notes
  for update to authenticated
  using (public.staff_can(store_id, 'orders'))
  with check (
    public.staff_can(store_id, 'orders')
    and exists (
      select 1 from public.orders o
      where o.id = order_staff_notes.order_id
        and o.store_id = order_staff_notes.store_id
    )
  );

drop policy if exists order_staff_notes_delete on public.order_staff_notes;
create policy order_staff_notes_delete on public.order_staff_notes
  for delete to authenticated
  using (public.staff_can(store_id, 'orders'));

-- Who wrote it and when: stamped, never taken from the client.
create or replace function public.order_staff_notes_stamp()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.note := btrim(new.note);
  new.updated_at := now();
  if current_user in ('authenticated', 'anon') then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end
$function$;

drop trigger if exists order_staff_notes_stamp on public.order_staff_notes;
create trigger order_staff_notes_stamp
  before insert or update on public.order_staff_notes
  for each row execute function public.order_staff_notes_stamp();

-- Move what exists (0 notes when this was written) BEFORE the redirect
-- trigger below exists — otherwise blanking the column would delete the note
-- it had just copied.
insert into public.order_staff_notes (order_id, store_id, note)
select o.id, o.store_id, left(btrim(o.store_note), 2000)
from public.orders o
where o.store_note is not null
  and btrim(o.store_note) <> ''
on conflict (order_id) do nothing;

update public.orders
set store_note = null
where store_note is not null;

-- Compatibility for the old column. Invoker, so the caller's own RLS on
-- order_staff_notes decides (the same staff_can(…,'orders') that orders_update
-- already required to touch the order at all).
--   INSERT with a store_note (a customer inserting their own order row could
--     set it): dropped. A customer does not author staff notes.
--   UPDATE naming store_note: the value is written to order_staff_notes (an
--     empty/NULL value deletes the note), and the column is blanked.
create or replace function public.orders_store_note_redirect()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_note text := nullif(btrim(coalesce(new.store_note, '')), '');
begin
  if tg_op = 'UPDATE' then
    if v_note is null then
      delete from public.order_staff_notes where order_id = new.id;
    else
      insert into public.order_staff_notes (order_id, store_id, note)
      values (new.id, new.store_id, left(v_note, 2000))
      on conflict (order_id) do update set note = excluded.note;
    end if;
  end if;
  new.store_note := null;
  return new;
end
$function$;

drop trigger if exists orders_store_note_redirect on public.orders;
create trigger orders_store_note_redirect
  before insert or update of store_note on public.orders
  for each row execute function public.orders_store_note_redirect();


-- ===========================================================================
-- 6. job_applications: only an open job takes applications (P1-JOBS-08)
-- ===========================================================================
-- Open = active, not deleted, and the deadline (a DATE the poster picked in
-- Lebanon) not before today in Asia/Beirut. The same rule the job page uses
-- (isJobOpen / beirutToday in src/lib/pro-market.ts).
drop policy if exists job_applications_insert on public.job_applications;
create policy job_applications_insert on public.job_applications
  for insert to authenticated
  with check (
    applicant_id = (select auth.uid())
    and exists (
      select 1 from public.job_postings j
      where j.id = job_applications.job_id
        and j.status = 'active'
        and j.deleted_at is null
        and (
          j.apply_deadline is null
          or j.apply_deadline >= (now() at time zone 'Asia/Beirut')::date
        )
    )
  );
-- ==== END MIGRATION 0314 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a  uuid := gen_random_uuid();   -- owns store A
  v_owner_b  uuid := gen_random_uuid();   -- owns store B: "another signed-in user"
  v_cust     uuid := gen_random_uuid();   -- ordered at store A
  v_staff_o  uuid := gen_random_uuid();   -- staff of A WITH 'orders'
  v_staff_x  uuid := gen_random_uuid();   -- staff of A WITHOUT 'orders'
  v_admin    uuid := gen_random_uuid();   -- admin_permissions ["stores","verifications"]
  v_sa       uuid;                        -- an existing super_admin (read-only borrow)
  v_bt       uuid;
  v_store_a  uuid;
  v_store_b  uuid;
  v_prod     uuid;
  v_order    uuid;                        -- the customer's order (fixture note on insert)
  v_order2   uuid;                        -- a second order at A
  v_order_b  uuid;                        -- an order at B
  v_verif    uuid;                        -- verified licence of A (with a scan)
  v_verif2   uuid;                        -- submitted, no scan yet
  v_job_open uuid;
  v_job_today uuid;
  v_job_closed uuid;
  v_job_expired uuid;
  v_job_deleted uuid;
  v_today    date := (now() at time zone 'Asia/Beirut')::date;
  v_doc      text;
  v_n        int;
  v_txt      text;
  v_uuid     uuid;
  v_bool     boolean;
  v_bad      text[];
  c          text;
  res        jsonb := '[]'::jsonb;
  -- src/lib/store-columns.ts STORE_ANON_COLUMNS (51)
  v_anon_cols text[] := array[
    'id', 'owner_id', 'business_type_id', 'name', 'slug', 'description',
    'logo_url', 'cover_url', 'cover_position', 'phone', 'whatsapp', 'region',
    'area', 'service_area', 'status', 'plan', 'trial_ends_at', 'is_verified',
    'commercial_reg_verified', 'featured_until', 'created_at', 'updated_at',
    'deleted_at', 'hours', 'booking_slot_minutes', 'booking_cancel_hours',
    'instagram', 'facebook', 'website', 'accepts_delivery', 'accepts_pickup',
    'min_order', 'prep_time', 'payment_note', 'specialties', 'insurance', 'lat',
    'lng', 'short_code', 'rating_avg', 'rating_count',
    'loyalty_redemption_enabled', 'loyalty_points_per_unit', 'accent_color',
    'storefront_layout', 'announcement', 'storefront_theme', 'return_policy',
    'shipping_policy', 'google_feed_enabled', 'request_intake'];
  -- STORE_PRIVATE_COLUMNS (10): refused to every client role
  v_private text[] := array[
    'legal_name', 'tax_no', 'legal_address', 'commercial_reg_no',
    'invoice_prefix', 'invoice_next_no', 'credit_note_next_no', 'status_reason',
    'status_changed_by', 'address'];
  v_all_cols  text[];
  v_auth_cols text[];                     -- all − private (61)
  v_anon_hidden text[];                   -- all − anon (20)
begin
  select array_agg(a.attname::text order by a.attnum) into v_all_cols
  from pg_attribute a
  where a.attrelid = 'public.stores'::regclass and a.attnum > 0 and not a.attisdropped;
  select array_agg(x) into v_auth_cols from unnest(v_all_cols) x where not (x = any (v_private));
  select array_agg(x) into v_anon_hidden from unnest(v_all_cols) x where not (x = any (v_anon_cols));

  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS and every invoker guard)
  -- ==========================================================================
  insert into auth.users (id) values
    (v_owner_a), (v_owner_b), (v_cust), (v_staff_o), (v_staff_x), (v_admin);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0314 Owner A'), (v_owner_b, '0314 Owner B'), (v_cust, '0314 Customer'),
    (v_staff_o, '0314 Staff orders'), (v_staff_x, '0314 Staff other'), (v_admin, '0314 Admin')
  on conflict (id) do nothing;

  select p.id into v_sa from public.profiles p where p.role = 'super_admin' limit 1;
  res := res || jsonb_build_array(jsonb_build_object('check', 'fixture: a super_admin exists to grant the admin fixture its sections',
    'ok', v_sa is not null, 'got', coalesce(v_sa::text, 'none')));
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  update public.profiles set admin_permissions = '["stores","verifications"]'::jsonb where id = v_admin;
  perform set_config('request.jwt.claims', '', true);

  select id into v_bt from public.business_types order by id limit 1;

  insert into public.stores (owner_id, name, status, plan, business_type_id, area, region,
                             description, legal_name, tax_no, legal_address, commercial_reg_no,
                             invoice_prefix, address, status_reason, status_changed_by)
    values (v_owner_a, '0314 Store A', 'active', 'free', v_bt, '0314 area', 'beirut',
            '0314 privacy store', 'LEGAL A SARL', 'TAX-0314', '1 Home Street, 3rd floor', 'CR-0314',
            'A', 'the owner''s flat', 'approved after a phone call', coalesce(v_sa, v_admin))
    returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan, tax_no)
    values (v_owner_b, '0314 Store B', 'active', 'free', 'TAX-B')
    returning id into v_store_b;

  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff_o, 'staff',
     '{"orders":true,"products":false,"bookings":false,"customers":false}'::jsonb),
    (v_store_a, v_staff_x, 'staff',
     '{"orders":false,"products":true,"bookings":true,"customers":true}'::jsonb);

  insert into public.products (store_id, name, price, is_available)
    values (v_store_a, '0314 Widget', 10, true) returning id into v_prod;

  -- store_note on INSERT: the redirect trigger must drop it.
  insert into public.orders (store_id, customer_id, status, total, phone, store_note)
    values (v_store_a, v_cust, 'pending', 20, '03 314 314', 'planted on insert')
    returning id into v_order;
  insert into public.orders (store_id, status, total, phone)
    values (v_store_a, 'pending', 12, '03 314 315') returning id into v_order2;
  insert into public.orders (store_id, status, total, phone)
    values (v_store_b, 'pending', 9, '03 314 316') returning id into v_order_b;

  insert into public.store_verifications (store_id, kind, title, issuer, number, verify_url,
                                          status, reviewed_by, reviewed_at)
    values (v_store_a, 'license', '0314 Licence', 'Ministry', 'LIC-0314', 'https://example.org/verify/0314',
            'verified', v_admin, now())
    returning id into v_verif;
  insert into public.store_verifications (store_id, kind, title)
    values (v_store_a, 'certificate', '0314 Pending cert') returning id into v_verif2;

  v_doc := v_store_a::text || '/0314-scan.jpg';
  insert into storage.objects (bucket_id, name, owner)
    values ('verification-docs', v_doc, v_owner_a);
  insert into public.store_verification_docs (verification_id, store_id, doc_url)
    values (v_verif, v_store_a, v_doc);

  insert into public.job_postings (poster_id, store_id, title, company_name, description, status, apply_deadline)
    values (v_owner_a, v_store_a, '0314 open', 'A', 'open, no deadline', 'active', null) returning id into v_job_open;
  insert into public.job_postings (poster_id, store_id, title, company_name, description, status, apply_deadline)
    values (v_owner_a, v_store_a, '0314 today', 'A', 'closes today (Beirut)', 'active', v_today) returning id into v_job_today;
  insert into public.job_postings (poster_id, store_id, title, company_name, description, status, apply_deadline)
    values (v_owner_a, v_store_a, '0314 closed', 'A', 'closed by poster', 'closed', null) returning id into v_job_closed;
  insert into public.job_postings (poster_id, store_id, title, company_name, description, status, apply_deadline)
    values (v_owner_a, v_store_a, '0314 expired', 'A', 'deadline yesterday', 'active', v_today - 1) returning id into v_job_expired;
  insert into public.job_postings (poster_id, store_id, title, company_name, description, status, apply_deadline, deleted_at)
    values (v_owner_a, v_store_a, '0314 deleted', 'A', 'soft-deleted', 'active', null, now()) returning id into v_job_deleted;

  -- ==========================================================================
  -- CATALOG (as postgres)
  -- ==========================================================================
  res := res || jsonb_build_array(jsonb_build_object('check', 'stores has 71 columns (the lists below assume it)',
    'ok', cardinality(v_all_cols) = 71 and cardinality(v_auth_cols) = 61 and cardinality(v_anon_hidden) = 20,
    'got', cardinality(v_all_cols)::text || ' / auth ' || cardinality(v_auth_cols)::text || ' / anon-hidden ' || cardinality(v_anon_hidden)::text));
  res := res || jsonb_build_array(jsonb_build_object('check', 'no TABLE-level SELECT on stores for anon or authenticated',
    'ok', not has_table_privilege('anon', 'public.stores', 'select')
      and not has_table_privilege('authenticated', 'public.stores', 'select'),
    'got', 'checked'));

  v_bad := '{}';
  foreach c in array v_anon_cols loop
    if not has_column_privilege('anon', 'public.stores', c, 'select') then v_bad := v_bad || c; end if;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon holds SELECT on all 51 public columns',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'all granted')));
  v_bad := '{}';
  foreach c in array v_anon_hidden loop
    if has_column_privilege('anon', 'public.stores', c, 'select') then v_bad := v_bad || c; end if;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon holds SELECT on none of the other 20 (tax_no, legal_*, CR no., status_reason …)',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'none granted')));
  v_bad := '{}';
  foreach c in array v_auth_cols loop
    if not has_column_privilege('authenticated', 'public.stores', c, 'select') then v_bad := v_bad || c; end if;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated holds SELECT on all 61 non-private columns',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'all granted')));
  v_bad := '{}';
  foreach c in array v_private loop
    if has_column_privilege('authenticated', 'public.stores', c, 'select') then v_bad := v_bad || c; end if;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated holds SELECT on none of the 10 private columns',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'none granted')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'INSERT/UPDATE on stores untouched (the owner still saves the legal fields)',
    'ok', has_table_privilege('authenticated', 'public.stores', 'update')
      and has_column_privilege('authenticated', 'public.stores', 'tax_no', 'update'),
    'got', 'checked'));

  res := res || jsonb_build_array(jsonb_build_object('check', 'store_private_fields is SECURITY DEFINER, search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.store_private_fields(uuid[])'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'store_private_fields: authenticated may execute, anon may not',
    'ok', has_function_privilege('authenticated', 'public.store_private_fields(uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.store_private_fields(uuid[])', 'execute'),
    'got', 'checked'));

  res := res || jsonb_build_array(jsonb_build_object('check', 'store_verifications: no table-level SELECT; reviewed_by readable by nobody; number/verify_url not by anon',
    'ok', not has_table_privilege('anon', 'public.store_verifications', 'select')
      and not has_table_privilege('authenticated', 'public.store_verifications', 'select')
      and not has_column_privilege('anon', 'public.store_verifications', 'reviewed_by', 'select')
      and not has_column_privilege('authenticated', 'public.store_verifications', 'reviewed_by', 'select')
      and not has_column_privilege('anon', 'public.store_verifications', 'number', 'select')
      and not has_column_privilege('anon', 'public.store_verifications', 'verify_url', 'select')
      and has_column_privilege('authenticated', 'public.store_verifications', 'number', 'select'),
    'got', 'checked'));

  select b.public into v_bool from storage.buckets b where b.id = 'verification-docs';
  res := res || jsonb_build_array(jsonb_build_object('check', 'bucket verification-docs exists and is private',
    'ok', v_bool is false, 'got', coalesce(v_bool::text, 'missing')));

  res := res || jsonb_build_array(jsonb_build_object('check', 'order_staff_notes: RLS on, no anon privilege',
    'ok', (select c2.relrowsecurity from pg_class c2 where c2.oid = 'public.order_staff_notes'::regclass)
      and not has_table_privilege('anon', 'public.order_staff_notes', 'select'),
    'got', 'checked'));

  select o.store_note into v_txt from public.orders o where o.id = v_order;
  select count(*) into v_n from public.order_staff_notes n where n.order_id = v_order;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a store_note set on INSERT is dropped (no customer-authored staff note)',
    'ok', v_txt is null and v_n = 0, 'got', coalesce(v_txt, 'null') || ' / notes ' || v_n::text));

  -- ==========================================================================
  -- ANON
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- THE storefront guard: every public column the code uses, in one SELECT.
  begin
    execute format('select count(*) from (select %s from public.stores where id = %L) x',
                   array_to_string(v_anon_cols, ', '), v_store_a) into v_n;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON reads every public column the code uses (51, one SELECT)',
      'ok', v_n = 1, 'got', v_n::text || ' row'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON reads every public column the code uses (51, one SELECT)',
      'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- The storefront's real query shapes (src/lib/data/*.ts, feeds, checkout).
  begin
    select count(*) into v_n from (
      select name, slug, description, announcement, storefront_theme, area, status, plan, logo_url,
             cover_url, cover_position, phone, whatsapp, hours, booking_slot_minutes, booking_cancel_hours,
             instagram, facebook, website, accepts_delivery, accepts_pickup, min_order, prep_time,
             payment_note, return_policy, specialties, insurance, commercial_reg_verified,
             loyalty_redemption_enabled, loyalty_points_per_unit, accent_color, storefront_layout, lat, lng
      from public.stores where id = v_store_a and deleted_at is null) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON store page select (store-view.ts)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON store page select (store-view.ts)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    -- LISTING_SELECT columns + the search or() columns + the featured or().
    select count(*) into v_n from (
      select s.id, s.name, s.area, s.region, s.plan, s.is_verified, s.commercial_reg_verified,
             s.featured_until, s.logo_url, s.cover_url, s.cover_position, s.lat, s.lng, s.hours,
             s.rating_avg, s.rating_count, s.description, s.phone, s.whatsapp, s.service_area,
             s.accepts_delivery, s.accepts_pickup, s.min_order, s.prep_time, s.insurance,
             s.specialties, s.created_at, bt.slug
      from public.stores s
      left join public.business_types bt on bt.id = s.business_type_id
      where s.status = 'active' and s.deleted_at is null
        and s.id = v_store_a
        and (s.name ilike '%0314%' or s.description ilike '%0314%'
             or s.area ilike '%0314%' or s.specialties ilike '%0314%')
        and (s.plan in ('pro', 'business') or s.featured_until > now() or s.region = 'beirut')
      order by s.created_at desc, s.id) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON listing/search shape with the business_types join (stores.ts)', 'ok', v_n >= 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON listing/search shape with the business_types join (stores.ts)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    select count(*) into v_n from (
      select id, name, slug, status, deleted_at, plan, trial_ends_at, return_policy, shipping_policy, google_feed_enabled
      from public.stores where id = v_store_a and deleted_at is null) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON Google feed select (feeds/[slug]/google.xml)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON Google feed select (feeds/[slug]/google.xml)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    select count(*) into v_n from (
      select name, whatsapp, accepts_delivery, accepts_pickup, min_order, prep_time, payment_note,
             loyalty_redemption_enabled, loyalty_points_per_unit, request_intake, short_code, updated_at
      from public.stores where id = v_store_a and deleted_at is null) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON checkout / request form / short link / sitemap columns', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON checkout / request form / short link / sitemap columns', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  -- products_select runs `exists (select 1 from stores s where s.owner_id = auth.uid())`
  -- as the caller: this is the read that dies if owner_id is not granted.
  begin
    select count(*) into v_n from public.products p where p.id = v_prod;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON reads a product (RLS subquery reads stores.owner_id as anon)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON reads a product (RLS subquery reads stores.owner_id as anon)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    select count(*) into v_n from public.products p join public.stores s on s.id = p.store_id
      where p.id = v_prod and s.status = 'active' and s.business_type_id = v_bt;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON product → stores embed filter (related.ts: stores.status, stores.business_type_id)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON product → stores embed filter (related.ts: stores.status, stores.business_type_id)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  v_bad := '{}';
  foreach c in array v_anon_hidden loop
    begin
      execute format('select %I from public.stores where id = %L', c, v_store_a) into v_txt;
      v_bad := v_bad || (c || ' READ');
    exception when others then
      if sqlstate <> '42501' then v_bad := v_bad || (c || ' ' || sqlstate); end if;
    end;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'ANON is refused (42501) each of the 20 non-public columns',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'all 20 refused')));

  begin
    perform * from public.store_private_fields(array[v_store_a]);
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot call store_private_fields', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot call store_private_fields', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    select count(*) into v_n from (
      select id, kind, title, issuer, issued_on, expires_on, status
      from public.store_verifications
      where store_id = v_store_a and status <> 'rejected' order by created_at desc) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON reads the storefront certificate columns (verified row only)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON reads the storefront certificate columns (verified row only)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  v_bad := '{}';
  foreach c in array array['number', 'verify_url', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'updated_at'] loop
    begin
      execute format('select %I from public.store_verifications where id = %L', c, v_verif) into v_txt;
      v_bad := v_bad || (c || ' READ');
    exception when others then
      if sqlstate <> '42501' then v_bad := v_bad || (c || ' ' || sqlstate); end if;
    end;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'ANON is refused licence number, verify_url, reviewed_by, reviewed_at, rejection_reason, updated_at',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'all refused')));

  begin
    select count(*) into v_n from public.order_staff_notes;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot read order_staff_notes', 'ok', false, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot read order_staff_notes', 'ok', true, 'got', sqlstate));
  end;
  begin
    select count(*) into v_n from storage.objects o where o.bucket_id = 'verification-docs';
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON sees 0 verification scans', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON sees 0 verification scans', 'ok', true, 'got', sqlstate));
  end;
  begin
    insert into public.job_applications (job_id, applicant_id) values (v_job_open, v_cust);
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot apply to a job', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot apply to a job', 'ok', true, 'got', sqlstate));
  end;

  -- ==========================================================================
  -- ANOTHER SIGNED-IN USER (store B's owner)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    execute format('select count(*) from (select %s from public.stores where id = %L) x',
                   array_to_string(v_auth_cols, ', '), v_store_a) into v_n;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER reads all 61 non-private columns of store A (dashboard columns)',
      'ok', v_n = 1, 'got', v_n::text || ' row'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER reads all 61 non-private columns of store A (dashboard columns)',
      'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  v_bad := '{}';
  foreach c in array v_private loop
    begin
      execute format('select %I from public.stores where id = %L', c, v_store_a) into v_txt;
      v_bad := v_bad || (c || ' READ');
    exception when others then
      if sqlstate <> '42501' then v_bad := v_bad || (c || ' ' || sqlstate); end if;
    end;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER is refused (42501) each of the 10 private columns of store A',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'all 10 refused')));

  select count(*) into v_n from public.store_private_fields(array[v_store_a, v_store_b]) f where f.id = v_store_a;
  select f.tax_no into v_txt from public.store_private_fields(array[v_store_a, v_store_b]) f where f.id = v_store_b;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER: store_private_fields returns their own store B, never store A',
    'ok', v_n = 0 and v_txt = 'TAX-B', 'got', 'A rows ' || v_n::text || ' / B tax ' || coalesce(v_txt, 'null')));

  begin
    select count(*) into v_n from (select number, verify_url from public.store_verifications where id = v_verif) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER reads number/verify_url of a verified row (signed-in residual, documented)',
      'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER reads number/verify_url of a verified row (signed-in residual, documented)',
      'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    select reviewed_by into v_uuid from public.store_verifications where id = v_verif;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER is refused reviewed_by', 'ok', false, 'got', 'read'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER is refused reviewed_by', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  select count(*) into v_n from public.store_verification_docs d where d.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER reads 0 of store A''s doc rows', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v_doc;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER sees 0 of store A''s scans in the bucket', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into storage.objects (bucket_id, name, owner) values ('verification-docs', v_store_a::text || '/intruder.jpg', v_owner_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot upload under store A''s prefix', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot upload under store A''s prefix', 'ok', true, 'got', sqlstate));
  end;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER may not delete store A''s scan (delete-policy predicate)',
    'ok', not public.can_write_verification_doc(v_doc), 'got', 'checked'));

  select count(*) into v_n from public.order_staff_notes n where n.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER reads 0 of store A''s staff notes', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into public.order_staff_notes (order_id, store_id, note) values (v_order2, v_store_a, 'not mine');
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot write a note on store A''s order', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot write a note on store A''s order', 'ok', true, 'got', sqlstate));
  end;
  begin
    -- B's owner passes staff_can(B), but the order belongs to A.
    insert into public.order_staff_notes (order_id, store_id, note) values (v_order2, v_store_b, 'mislabelled');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a note cannot claim another store''s order (store_id must match the order)', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a note cannot claim another store''s order (store_id must match the order)', 'ok', true, 'got', sqlstate));
  end;
  begin
    insert into public.order_staff_notes (order_id, store_id, note) values (v_order_b, v_store_b, 'B note');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B writes a note on B''s own order (positive control)', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B writes a note on B''s own order (positive control)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- Jobs: B's owner applies as a job seeker.
  begin
    insert into public.job_applications (job_id, applicant_id, cover_note) values (v_job_open, v_owner_b, 'open');
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: applying to an open job (no deadline) is accepted', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: applying to an open job (no deadline) is accepted', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    insert into public.job_applications (job_id, applicant_id) values (v_job_today, v_owner_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: the deadline day itself (Beirut) is still open', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: the deadline day itself (Beirut) is still open', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    insert into public.job_applications (job_id, applicant_id) values (v_job_closed, v_owner_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: a closed job refuses applications', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: a closed job refuses applications', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  begin
    insert into public.job_applications (job_id, applicant_id) values (v_job_expired, v_owner_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: a job past its deadline (Beirut yesterday) refuses applications', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: a job past its deadline (Beirut yesterday) refuses applications', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  begin
    insert into public.job_applications (job_id, applicant_id) values (v_job_deleted, v_owner_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: a deleted job refuses applications', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: a deleted job refuses applications', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  begin
    insert into public.job_applications (job_id, applicant_id) values (v_job_today, v_cust);
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: nobody can apply in someone else''s name', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'JOBS: nobody can apply in someone else''s name', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  -- ==========================================================================
  -- OWNER A
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.store_private_fields(array[v_store_a, v_store_b]);
  select f.tax_no || '|' || f.legal_name || '|' || f.legal_address || '|' || f.commercial_reg_no || '|' || f.invoice_prefix
         || '|' || coalesce(f.status_reason, 'NULL') || '|' || coalesce(f.status_changed_by::text, 'NULL')
    into v_txt from public.store_private_fields(array[v_store_a]) f;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A: getter returns A only, with legal identity and the suspension note, not the admin id',
    'ok', v_n = 1 and v_txt = 'TAX-0314|LEGAL A SARL|1 Home Street, 3rd floor|CR-0314|A|approved after a phone call|NULL',
    'got', v_n::text || ' row / ' || coalesce(v_txt, 'null')));
  begin
    select tax_no into v_txt from public.stores where id = v_store_a;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A reads tax_no only through the getter (direct select refused)', 'ok', false, 'got', 'read'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A reads tax_no only through the getter (direct select refused)', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  begin
    update public.stores set tax_no = 'TAX-0314-NEW', legal_name = 'LEGAL A SAL' where id = v_store_a;
    get diagnostics v_n = row_count;
    select f.tax_no into v_txt from public.store_private_fields(array[v_store_a]) f;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A still saves the legal fields from settings (UPDATE intact)',
      'ok', v_n = 1 and v_txt = 'TAX-0314-NEW', 'got', v_n::text || ' / ' || coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A still saves the legal fields from settings (UPDATE intact)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  select count(*) into v_n from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v_doc;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A sees their own scan in the private bucket (positive control)', 'ok', v_n = 1, 'got', v_n::text));
  begin
    insert into storage.objects (bucket_id, name, owner) values ('verification-docs', v_store_a::text || '/0314-second.jpg', v_owner_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A uploads under "<store A>/"', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A uploads under "<store A>/"', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('verification-docs', v_store_b::text || '/0314-x.jpg', v_owner_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A cannot upload under store B''s prefix', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A cannot upload under store B''s prefix', 'ok', true, 'got', sqlstate));
  end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('verification-docs', 'verifications/' || v_store_a::text || '/old-style.jpg', v_owner_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'the old "verifications/<id>/" path shape is refused in the private bucket', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'the old "verifications/<id>/" path shape is refused in the private bucket', 'ok', true, 'got', sqlstate));
  end;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A may delete their own scan (delete-policy predicate)',
    'ok', public.can_write_verification_doc(v_doc), 'got', 'checked'));

  begin
    insert into public.store_verification_docs (verification_id, store_id, doc_url)
      values (v_verif2, v_store_a, 'https://x.supabase.co/storage/v1/object/public/store-assets/verifications/a.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a NEW doc row may not hold a public URL', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a NEW doc row may not hold a public URL', 'ok', sqlstate = '23514', 'got', sqlstate));
  end;
  begin
    insert into public.store_verification_docs (verification_id, store_id, doc_url)
      values (v_verif2, v_store_a, v_store_b::text || '/0314-x.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a doc row may not point into another store''s prefix', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a doc row may not point into another store''s prefix', 'ok', sqlstate = '23514', 'got', sqlstate));
  end;
  begin
    insert into public.store_verification_docs (verification_id, store_id, doc_url)
      values (v_verif2, v_store_a, v_store_a::text || '/0314-second.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A records a private-path doc (positive control)', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A records a private-path doc (positive control)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    select count(*) into v_n from (select id, number, verify_url, status, rejection_reason from public.store_verifications where store_id = v_store_a) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A reads number/verify_url on the merchant screen', 'ok', v_n = 2, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A reads number/verify_url on the merchant screen', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    insert into public.order_staff_notes (order_id, store_id, note) values (v_order2, v_store_a, '  gift wrap  ');
    select n.note into v_txt from public.order_staff_notes n where n.order_id = v_order2;
    select n.updated_by into v_uuid from public.order_staff_notes n where n.order_id = v_order2;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A writes a staff note (trimmed, stamped with who wrote it)',
      'ok', v_txt = 'gift wrap' and v_uuid = v_owner_a, 'got', coalesce(v_txt, 'null') || ' / ' || coalesce(v_uuid::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER A writes a staff note (trimmed, stamped with who wrote it)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- STAFF of A WITH 'orders'
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_o, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select coalesce(f.tax_no, 'NULL') || '|' || coalesce(f.status_reason, 'NULL') || '|' || coalesce(f.status_changed_by::text, 'NULL')
    into v_txt from public.store_private_fields(array[v_store_a]) f;
  res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF: getter gives the legal identity (invoices) but not the suspension note or admin id',
    'ok', v_txt = 'TAX-0314-NEW|NULL|NULL', 'got', coalesce(v_txt, 'no row')));

  -- The previous build still writes orders.store_note: it must land in the new table.
  update public.orders set store_note = 'call before delivery' where id = v_order;
  get diagnostics v_n = row_count;
  select n.note into v_txt from public.order_staff_notes n where n.order_id = v_order;
  select o.store_note is null into v_bool from public.orders o where o.id = v_order;
  res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF: an old-build write to orders.store_note lands in order_staff_notes and the column stays NULL',
    'ok', v_n = 1 and v_txt = 'call before delivery' and v_bool, 'got', v_n::text || ' / ' || coalesce(v_txt, 'null') || ' / column null ' || coalesce(v_bool::text, '?')));
  update public.orders set store_note = '' where id = v_order;
  select count(*) into v_n from public.order_staff_notes n where n.order_id = v_order;
  res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF: clearing orders.store_note deletes the staff note', 'ok', v_n = 0, 'got', v_n::text));
  update public.orders set store_note = 'call first' where id = v_order;
  select count(*) into v_n from public.order_staff_notes n where n.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF with orders reads store A''s notes (positive control)', 'ok', v_n = 2, 'got', v_n::text));

  select count(*) into v_n from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v_doc;
  res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF can read the store''s scan (signed URL on the merchant screen)', 'ok', v_n = 1, 'got', v_n::text));
  begin
    insert into storage.objects (bucket_id, name, owner) values ('verification-docs', v_store_a::text || '/0314-staff.jpg', v_staff_o);
    res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF cannot upload scans (owner only)', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF cannot upload scans (owner only)', 'ok', true, 'got', sqlstate));
  end;

  -- ==========================================================================
  -- STAFF of A WITHOUT 'orders'
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.order_staff_notes n where n.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF WITHOUT orders reads 0 staff notes', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into public.order_staff_notes (order_id, store_id, note) values (v_order, v_store_a, 'nope');
    res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF WITHOUT orders cannot write a staff note', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'STAFF WITHOUT orders cannot write a staff note', 'ok', true, 'got', sqlstate));
  end;

  -- ==========================================================================
  -- THE CUSTOMER who placed the order
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*), bool_and(o.store_note is null) into v_n, v_bool from public.orders o where o.id = v_order;
  res := res || jsonb_build_array(jsonb_build_object('check', 'CUSTOMER reads their order (positive control) and its store_note is NULL',
    'ok', v_n = 1 and v_bool, 'got', v_n::text || ' / null ' || coalesce(v_bool::text, '?')));
  select count(*) into v_n from public.order_staff_notes;
  res := res || jsonb_build_array(jsonb_build_object('check', 'CUSTOMER reads 0 staff notes (the note on their own order included)', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.store_private_fields(array[v_store_a]);
  res := res || jsonb_build_array(jsonb_build_object('check', 'CUSTOMER gets nothing from store_private_fields', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- ADMIN holding 'stores' + 'verifications' (a sub-admin, not super admin)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select coalesce(f.status_reason, 'NULL') || '|' || coalesce(f.status_changed_by::text, 'NULL') || '|' || coalesce(f.commercial_reg_no, 'NULL')
    into v_txt from public.store_private_fields(array[v_store_a]) f;
  res := res || jsonb_build_array(jsonb_build_object('check', 'ADMIN: getter gives reason, acting admin and CR no. (admin stores screen)',
    'ok', v_txt = 'approved after a phone call|' || coalesce(v_sa, v_admin)::text || '|CR-0314', 'got', coalesce(v_txt, 'no row')));
  select count(*) into v_n from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v_doc;
  res := res || jsonb_build_array(jsonb_build_object('check', 'ADMIN (verifications) can read the scan to review it', 'ok', v_n = 1, 'got', v_n::text));
  begin
    select count(*) into v_n from (select id, number, verify_url, created_at from public.store_verifications where status = 'submitted') x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'ADMIN review queue select (admin/verifications)', 'ok', v_n >= 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ADMIN review queue select (admin/verifications)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  execute 'reset role';
  insert into r (n, check_name, ok, got)
  select x.i::int, x.e ->> 'check', coalesce((x.e ->> 'ok')::boolean, false), x.e ->> 'got'
  from jsonb_array_elements(res) with ordinality as x(e, i);
  insert into r (n, check_name, ok, got)
  select 999, 'ALL CHECKS', bool_and(ok), count(*) filter (where not ok)::text || ' failed of ' || count(*)::text
  from r;
end
$test$;

select n, check_name, ok, got from r order by n;

rollback;
