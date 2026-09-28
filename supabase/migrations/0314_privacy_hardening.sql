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
