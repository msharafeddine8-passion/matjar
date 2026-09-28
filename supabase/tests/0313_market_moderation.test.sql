-- ============================================================================
-- 0313_market_moderation.test.sql — rolled-back verification of migration 0313
-- ============================================================================
-- WHAT IT IS
--   The test migration 0313 must pass BEFORE it is applied to production. One
--   transaction:
--
--     begin;
--       <the full text of supabase/migrations/0313_market_moderation.sql, verbatim>
--       <fixtures: a seller, another user, a market moderator (admin_can
--        'market'), a jobs-only sub-admin, a suspended user, a store owner with
--        a store the seller does NOT run, a buyer with a completed and a
--        cancelled order, a buyer with no purchase>
--       <every assertion, acting as the seller, another user, the market
--        moderator, the jobs-only admin, the suspended user and anon>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives the rollback: not the migration, not the fixtures, not
--   the rows the checks write. It is written to be run against production by
--   the owner (Supabase MCP execute_sql, the SQL editor, or
--   supabase db execute). It has NOT been run yet; see
--   audit/prelaunch-v2/08_SUNDAY_MARKET.md.
--
--   The migration section is a verbatim copy of the migration file. If 0313 is
--   edited, paste the new text between the two MIGRATION markers so the test
--   exercises what will actually be applied. Every statement in 0313 is
--   idempotent, so after the apply this doubles as a regression test.
--
--   The moderator fixture is granted 'market' by borrowing an existing
--   super_admin's id in request.jwt.claims for ONE update (prevent_admin_perm_
--   change only lets a super admin change admin_permissions). If the project
--   has no super admin, check 0 reports it and the moderator checks fail
--   loudly rather than passing for the wrong reason.
--
-- HOW TO READ IT
--   One row per check: ok true/false and got, the value or error actually
--   observed. The last row, ALL CHECKS, says how many failed.
--
-- RULE THIS FOLLOWS (supabase-verify): seed first as postgres, then read AS the
-- role; every "sees 0" is paired with a positive control from an actor who must
-- see that same row; each expected refusal runs in its own exception block so
-- one refusal cannot poison the checks after it.
-- ============================================================================

begin;

-- ======================== MIGRATION 0313 (verbatim) =========================
-- 0313 — Sunday Market trust & moderation, and what a review may claim.
--
-- WHAT WAS WRONG (verified against production, read-only, 2026-09-25)
--
--   1. A seller could publish around the moderation queue. listings_update_own
--      lets the seller write ANY column of their own row, so a PATCH of
--      {status:'active'} on a pending or rejected listing made it public with
--      no moderator ever seeing it; {is_featured:true} bought the top slot for
--      free; {views: 99999} and a created_at in 2099 (top of "newest", never
--      expires) were one request each. The form only ever sends draft/pending —
--      the database never enforced it.
--   2. A listing could claim any store. store_id was never checked against the
--      seller, and the listing page shows a store listing with a check badge
--      and THAT store's WhatsApp and phone. (0 rows do it today.)
--   3. A market sub-admin could not moderate. /admin/market is gated on
--      admin_can('market') (0292) and the rows are readable on it (0294), but
--      listings_update_own still said is_super_admin(): approve/reject/feature
--      by a market sub-admin updated 0 rows, returned no error, and the admin
--      log recorded an "approved" that never happened.
--   4. Deleting a reported listing destroyed the reports. listing_reports
--      cascades on the listing, and the seller may hard-delete their own row —
--      so the fastest way to clear a fraud report was to delete the listing.
--   5. A suspended user's live listings stayed public (user_is_active() only
--      gated new inserts), and a suspended user could still edit and relist.
--   6. product_reviews.verified was true for ANY order containing the product —
--      pending, cancelled or rejected included — and nothing stopped a store's
--      owner or staff reviewing their own store or products (one live row: an
--      owner's 5-star review of their own, now suspended, store).
--
-- WHAT THIS DOES — flag and gate for a human, never auto-delete
--
--   A. listings: reviewed_by / reviewed_at / moderation_note (the moderator's
--      reason, readable by the seller on their own row).
--   B. guard_listing_write (BEFORE INSERT/UPDATE, SECURITY INVOKER — the
--      established pattern: it only acts when current_user is 'authenticated'
--      or 'anon', so definer RPCs, the expiry cron and admin_soft_delete pass
--      straight through). For anyone who is not a market moderator:
--        - a new listing is 'draft' or 'pending', never live; is_featured,
--          views, deleted_at and the review stamps are the system's;
--        - store_id must be a store the seller runs (staff_can 'products');
--        - editing the content of a listing that was live/sold/expired/rejected
--          sends it back to 'pending' (what the edit form already does);
--        - status moves a seller may make: → draft / pending (withdraw,
--          resubmit), active → sold, sold|expired → active (relist content a
--          moderator already approved). Anything else — pending→active,
--          rejected→active, →rejected, →expired — raises 42501;
--        - created_at may only be reset to now() (renew), never set;
--        - a suspended account cannot write at all;
--        - a seller may remove their own listing (deleted_at → now()) but not
--          restore one a moderator removed.
--      A moderator's approve/reject is stamped with reviewed_by/reviewed_at.
--   C. Seller DELETE becomes a soft delete (BEFORE DELETE → set deleted_at,
--      skip the row delete) so reports and history survive. Moderators still
--      remove through admin_soft_delete (0294).
--   D. RLS: update/delete for admin_can('market'); public read also requires
--      the seller's account to be active (public.user_id_is_active).
--   E. market_seller_facts(uuid[]) — moderator-only seller history for the
--      queue: member since, suspended?, listings total/live/rejected/removed,
--      reports open/total. Duplicate, price-outlier and category signals are
--      computed in the app (src/lib/market-moderation.ts) from rows the
--      moderator can already read.
--   F. Reviews: product_reviews.verified means a COMPLETED order that
--      contained the product; reviews.verified_purchase (new) records whether
--      the author had a completed order or booking at the store; owners and
--      staff cannot review their own store or its products (new rows only —
--      the existing row is left for a human).
--
-- NOT DONE, on purpose: phone verification. There is no SMS gateway and no
-- existing OTP mechanism (zero-cost constraint); `profiles.phone` is typed by
-- the user and never verified. Nothing here pretends otherwise.
--
-- SAFE BEFORE AND AFTER: every app read of the new objects tolerates their
-- absence (the queue page shows seller history as unavailable; the seller's
-- screen simply shows no reason). Idempotent: every statement can re-run.
--
-- Verification: supabase/tests/0313_market_moderation.test.sql (rolled back).

-- ---------------------------------------------------------------------------
-- A. Moderation metadata
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists moderation_note text;

alter table public.listings drop constraint if exists listings_moderation_note_len;
alter table public.listings add constraint listings_moderation_note_len
  check (moderation_note is null or char_length(moderation_note) <= 500);

create index if not exists listings_reviewed_by_idx on public.listings (reviewed_by);

comment on column public.listings.moderation_note is
  'The moderator''s reason (usually for a rejection). Written only by admin_can(''market''); the seller reads it on their own row.';

-- ---------------------------------------------------------------------------
-- B. The write guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_listing_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
begin
  -- Definer RPCs (admin_soft_delete, expire_stale_listings,
  -- increment_listing_view), the cron and migrations run as the function
  -- owner: they are the system, not a caller.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.admin_can('market') then
    if tg_op = 'INSERT' then
      if new.status in ('active', 'rejected') then
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      end if;
    elsif new.status is distinct from old.status
          and new.status in ('active', 'rejected') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;

  if not public.user_is_active() then
    raise exception 'suspended accounts cannot change listings'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      new.status := 'pending';
    end if;
    new.is_featured := false;
    new.views := 0;
    new.deleted_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.moderation_note := null;
    new.created_at := now();
    if new.store_id is not null and not public.staff_can(new.store_id, 'products') then
      raise exception 'a listing can only name a store you run'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE by the seller (RLS already limited the row to seller_id = auth.uid()).
  new.seller_id := old.seller_id;
  new.is_featured := old.is_featured;
  new.views := old.views;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.moderation_note := old.moderation_note;

  -- Self-removal is allowed and permanent from the seller's side.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  elsif new.deleted_at is not null then
    new.deleted_at := now();
  end if;

  if new.created_at is distinct from old.created_at then
    new.created_at := now();
  end if;

  if new.store_id is distinct from old.store_id
     and new.store_id is not null
     and not public.staff_can(new.store_id, 'products') then
    raise exception 'a listing can only name a store you run'
      using errcode = '42501';
  end if;

  v_content_changed :=
    (new.title, new.description, new.price, new.images, new.category_id, new.store_id)
    is distinct from
    (old.title, old.description, old.price, old.images, old.category_id, old.store_id);

  -- New words or a new price are a new listing as far as review goes.
  if v_content_changed and new.status <> 'draft' then
    new.status := 'pending';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('draft', 'pending') then
      null;                                   -- withdraw / (re)submit
    elsif new.status = 'sold' and old.status = 'active' then
      null;                                   -- sold it
    elsif new.status = 'active' and old.status in ('sold', 'expired') then
      null;                                   -- relist approved, unchanged content
    else
      raise exception 'listing status % -> % needs a moderator', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

comment on function public.guard_listing_write() is
  'Sunday Market write guard (0313). Invoker trigger: acts only for authenticated/anon callers who are not admin_can(''market'').';

drop trigger if exists listings_guard_write on public.listings;
create trigger listings_guard_write
  before insert or update on public.listings
  for each row execute function public.guard_listing_write();

-- ---------------------------------------------------------------------------
-- C. A seller's delete keeps the evidence
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_own_listing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.admin_can('market') then
    return old;                               -- system / moderator: real delete
  end if;
  -- Same row, same caller, through the update policy and the guard above.
  update public.listings
     set deleted_at = now(), updated_at = now()
   where id = old.id and deleted_at is null;
  return null;                                -- skip the physical delete
end
$$;

drop trigger if exists listings_soft_delete_own on public.listings;
create trigger listings_soft_delete_own
  before delete on public.listings
  for each row execute function public.soft_delete_own_listing();

-- ---------------------------------------------------------------------------
-- D. Policies
-- ---------------------------------------------------------------------------
create or replace function public.user_id_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_active from public.profiles p where p.id = p_user), true);
$$;
revoke all on function public.user_id_is_active(uuid) from public, anon, authenticated;
grant execute on function public.user_id_is_active(uuid) to anon, authenticated;

drop policy if exists listings_select_public on public.listings;
create policy listings_select_public on public.listings
  for select using (
    public.admin_can('market')
    or seller_id = (select auth.uid())
    or (status = any (array['active'::text, 'sold'::text, 'expired'::text])
        and deleted_at is null
        and public.user_id_is_active(seller_id))
  );

drop policy if exists listings_update_own on public.listings;
create policy listings_update_own on public.listings
  for update to authenticated
  using (seller_id = (select auth.uid()) or public.admin_can('market'))
  with check (seller_id = (select auth.uid()) or public.admin_can('market'));

drop policy if exists listings_delete_own on public.listings;
create policy listings_delete_own on public.listings
  for delete to authenticated
  using (seller_id = (select auth.uid()) or public.admin_can('market'));

-- ---------------------------------------------------------------------------
-- E. Seller history for the moderation queue
-- ---------------------------------------------------------------------------
create or replace function public.market_seller_facts(p_seller_ids uuid[])
returns table (
  seller_id uuid,
  member_since timestamptz,
  is_active boolean,
  listings_total integer,
  listings_live integer,
  listings_rejected integer,
  listings_removed integer,
  reports_open integer,
  reports_total integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.admin_can('market') then
    raise exception 'market moderators only' using errcode = '42501';
  end if;
  return query
  select
    u.id,
    p.created_at,
    coalesce(p.is_active, true),
    (select count(*)::int from public.listings l where l.seller_id = u.id),
    (select count(*)::int from public.listings l
      where l.seller_id = u.id and l.status = 'active' and l.deleted_at is null),
    (select count(*)::int from public.listings l
      where l.seller_id = u.id and l.status = 'rejected'),
    (select count(*)::int from public.listings l
      where l.seller_id = u.id and l.deleted_at is not null),
    (select count(*)::int from public.listing_reports r
       join public.listings l on l.id = r.listing_id
      where l.seller_id = u.id and r.status = 'open')
    + (select count(*)::int from public.content_reports c
         join public.listings l on l.id = c.entity_id
        where c.entity_type = 'listing' and l.seller_id = u.id
          and c.status in ('pending', 'reviewing')),
    (select count(*)::int from public.listing_reports r
       join public.listings l on l.id = r.listing_id
      where l.seller_id = u.id)
    + (select count(*)::int from public.content_reports c
         join public.listings l on l.id = c.entity_id
        where c.entity_type = 'listing' and l.seller_id = u.id)
  from (select distinct x as id from unnest(p_seller_ids[1:500]) as x where x is not null) u
  left join public.profiles p on p.id = u.id;
end
$$;
revoke all on function public.market_seller_facts(uuid[]) from public, anon, authenticated;
grant execute on function public.market_seller_facts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- F. Reviews: what "verified" means
-- ---------------------------------------------------------------------------

-- F1. product_reviews.verified = a COMPLETED order that contained the product.
create or replace function public.set_product_review_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.verified := exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = new.product_id
      and o.customer_id = new.customer_id
      and o.status = 'completed'
  );
  return new;
end
$$;
revoke all on function public.set_product_review_verified() from public, anon, authenticated;

-- Recompute the existing rows under the new meaning (the BEFORE UPDATE
-- trigger does the work; no other column changes).
update public.product_reviews set verified = verified;

-- F2. reviews.verified_purchase — the store-level equivalent.
alter table public.reviews
  add column if not exists verified_purchase boolean not null default false;
comment on column public.reviews.verified_purchase is
  'True when the author had a completed order or completed booking at this store (has_store_purchase). Set by trigger; not writable by clients. The only basis on which a store review may be labelled a verified purchase.';

create or replace function public.set_review_verified_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.verified_purchase := public.has_store_purchase(new.customer_id, new.store_id);
  return new;
end
$$;
revoke all on function public.set_review_verified_purchase() from public, anon, authenticated;

drop trigger if exists reviews_verified_purchase on public.reviews;
create trigger reviews_verified_purchase
  before insert or update on public.reviews
  for each row execute function public.set_review_verified_purchase();

-- Backfill without touching updated_at (it is what "edited" means on a review)
-- and without re-running the store-rating sync (no rating changes here).
alter table public.reviews disable trigger reviews_set_updated_at;
alter table public.reviews disable trigger reviews_sync_store_rating;
update public.reviews set verified_purchase = verified_purchase;
alter table public.reviews enable trigger reviews_sync_store_rating;
alter table public.reviews enable trigger reviews_set_updated_at;

-- anon reads reviews through column grants (0287); the new column joins them.
grant select (verified_purchase) on public.reviews to anon;

-- F3. Nobody reviews their own shop.
create or replace function public.block_self_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
begin
  if tg_table_name = 'product_reviews' then
    select p.store_id into v_store from public.products p where p.id = new.product_id;
  else
    v_store := new.store_id;
  end if;
  if v_store is not null and (
       exists (select 1 from public.stores s
                where s.id = v_store and s.owner_id = new.customer_id)
    or exists (select 1 from public.store_staff st
                where st.store_id = v_store and st.user_id = new.customer_id)
  ) then
    raise exception 'owners and staff cannot review their own store'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function public.block_self_review() from public, anon, authenticated;

drop trigger if exists reviews_block_self on public.reviews;
create trigger reviews_block_self
  before insert on public.reviews
  for each row execute function public.block_self_review();

drop trigger if exists product_reviews_block_self on public.product_reviews;
create trigger product_reviews_block_self
  before insert on public.product_reviews
  for each row execute function public.block_self_review();

-- ====================== END MIGRATION 0313 (verbatim) =======================

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_seller  uuid := gen_random_uuid();   -- lists things
  v_other   uuid := gen_random_uuid();   -- another signed-in user
  v_mod     uuid := gen_random_uuid();   -- admin_permissions ["market"]
  v_jobs    uuid := gen_random_uuid();   -- admin_permissions ["jobs"] only
  v_susp    uuid := gen_random_uuid();   -- profiles.is_active = false
  v_owner   uuid := gen_random_uuid();   -- owns store A (the seller does not)
  v_buyer   uuid := gen_random_uuid();   -- completed order at store A
  v_nobuy   uuid := gen_random_uuid();   -- only a cancelled order at store A
  v_sa      uuid;                        -- an existing super_admin (read-only borrow)
  v_store_a uuid;
  v_store_s uuid;
  v_prod    uuid;
  v_order   uuid;
  v_cat     uuid;
  v_l1      uuid;
  v_l3      uuid;
  v_l_rep   uuid;
  v_l_susp  uuid;
  v_n       int;
  v_n2      int;
  v_n3      int;
  v_txt     text;
  v_bool    boolean;
  v_uid     uuid;
  v_ts      timestamptz;
  res       jsonb := '[]'::jsonb;
begin
  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS and every invoker guard)
  -- ==========================================================================
  insert into auth.users (id) values
    (v_seller), (v_other), (v_mod), (v_jobs), (v_susp), (v_owner), (v_buyer), (v_nobuy);
  insert into public.profiles (id, full_name) values
    (v_seller, '0313 Seller'), (v_other, '0313 Other'), (v_mod, '0313 Moderator'),
    (v_jobs, '0313 Jobs admin'), (v_susp, '0313 Suspended'), (v_owner, '0313 Owner'),
    (v_buyer, '0313 Buyer'), (v_nobuy, '0313 No-buy')
  on conflict (id) do nothing;
  update public.profiles set is_active = false where id = v_susp;

  select p.id into v_sa from public.profiles p where p.role = 'super_admin' limit 1;
  res := res || jsonb_build_array(jsonb_build_object('check', 'fixture: a super_admin exists to grant the moderator fixture its section',
    'ok', v_sa is not null, 'got', coalesce(v_sa::text, 'none')));
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  update public.profiles set admin_permissions = '["market"]'::jsonb where id = v_mod;
  update public.profiles set admin_permissions = '["jobs"]'::jsonb where id = v_jobs;
  perform set_config('request.jwt.claims', '', true);
  res := res || jsonb_build_array(jsonb_build_object('check', 'fixture: moderator holds market, jobs admin does not',
    'ok', exists (select 1 from public.profiles where id = v_mod and admin_permissions ? 'market')
      and not exists (select 1 from public.profiles where id = v_jobs and admin_permissions ? 'market'),
    'got', 'checked'));

  insert into public.stores (owner_id, name, status, plan)
    values (v_owner, '0313 Store A', 'active', 'free') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_seller, '0313 Seller Store', 'active', 'free') returning id into v_store_s;
  insert into public.products (store_id, name, price, is_available)
    values (v_store_a, '0313 Widget', 10, true) returning id into v_prod;
  insert into public.market_categories (slug, name_ar, name_en, sort_order)
    values ('t0313-' || substr(v_seller::text, 1, 8), 'فئة 0313', '0313 cat', 999) returning id into v_cat;

  insert into public.listings (seller_id, category_id, title, price, status)
    values (v_seller, v_cat, '0313 reported bike', 120, 'active') returning id into v_l_rep;
  insert into public.listings (seller_id, category_id, title, price, status)
    values (v_susp, v_cat, '0313 suspended seller phone', 200, 'active') returning id into v_l_susp;

  -- ==========================================================================
  -- CATALOG
  -- ==========================================================================
  res := res || jsonb_build_array(jsonb_build_object('check', 'market_seller_facts is SECURITY DEFINER with search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.market_seller_facts(uuid[])'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon may NOT execute market_seller_facts; authenticated may (the body checks the section)',
    'ok', not has_function_privilege('anon', 'public.market_seller_facts(uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.market_seller_facts(uuid[])', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'user_id_is_active is executable by anon and authenticated (the public read policy calls it)',
    'ok', has_function_privilege('anon', 'public.user_id_is_active(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.user_id_is_active(uuid)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'guard_listing_write is an INVOKER function (the established guard pattern)',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.guard_listing_write()'::regprocedure and not p.prosecdef),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon can read reviews.verified_purchase (joins the 0287 column grants)',
    'ok', has_column_privilege('anon', 'public.reviews', 'verified_purchase', 'select'),
    'got', 'checked'));

  -- ==========================================================================
  -- SELLER
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    insert into public.listings (seller_id, category_id, title, price, status, is_featured, views, created_at)
      values (v_seller, v_cat, '0313 phone', 300, 'active', true, 500, '2099-01-01')
      returning id into v_l1;
    select l.status, l.is_featured, l.views, l.created_at into v_txt, v_bool, v_n, v_ts
      from public.listings l where l.id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller insert "active, featured, 500 views, 2099" lands as pending, unfeatured, 0 views, now',
      'ok', v_txt = 'pending' and not v_bool and v_n = 0 and v_ts <= now() + interval '1 minute',
      'got', v_txt || ' / featured ' || v_bool::text || ' / views ' || v_n::text || ' / ' || v_ts::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller inserts a listing', 'ok', false, 'got', sqlerrm));
  end;

  begin
    insert into public.listings (seller_id, store_id, title, status)
      values (v_seller, v_store_a, '0313 impersonation', 'pending');
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot list under a store they do not run', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot list under a store they do not run',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    insert into public.listings (seller_id, store_id, category_id, title, price, status)
      values (v_seller, v_store_s, v_cat, '0313 from my shop', 50, 'pending')
      returning id into v_l3;
    select l.store_id into v_uid from public.listings l where l.id = v_l3;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller CAN list under their own store (positive control)',
      'ok', v_uid = v_store_s, 'got', coalesce(v_uid::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller CAN list under their own store (positive control)', 'ok', false, 'got', sqlerrm));
  end;

  begin
    update public.listings set status = 'active' where id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot self-approve pending -> active', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot self-approve pending -> active',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    update public.listings
       set is_featured = true, views = 999, reviewed_by = v_seller, moderation_note = 'approved by me'
     where id = v_l1;
    select l.is_featured, l.views, l.reviewed_by, l.moderation_note into v_bool, v_n, v_uid, v_txt
      from public.listings l where l.id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot set featured / views / review stamp / moderator note',
      'ok', not v_bool and v_n = 0 and v_uid is null and v_txt is null,
      'got', 'featured ' || v_bool::text || ' / views ' || v_n::text || ' / by ' || coalesce(v_uid::text, 'null') || ' / note ' || coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller system-column writes', 'ok', false, 'got', sqlerrm));
  end;

  begin
    update public.listings set created_at = '2099-01-01' where id = v_l1;
    select l.created_at into v_ts from public.listings l where l.id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot future-date created_at (a renew means now)',
      'ok', v_ts <= now() + interval '1 minute', 'got', v_ts::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller renew', 'ok', false, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- MARKET MODERATOR approves (a sub-admin, not a super admin)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_mod, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    update public.listings set status = 'active' where id = v_l1;
    get diagnostics v_n = row_count;
    select l.reviewed_by, l.reviewed_at into v_uid, v_ts from public.listings l where l.id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'market sub-admin approves: 1 row, stamped reviewed_by/reviewed_at (was 0 rows before 0313)',
      'ok', v_n = 1 and v_uid = v_mod and v_ts is not null,
      'got', v_n::text || ' row / by ' || coalesce(v_uid::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'market sub-admin approves', 'ok', false, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- SELLER edits the live listing, sells it, relists it
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    update public.listings set title = '0313 phone (price drop!)', price = 1 where id = v_l1;
    select l.status into v_txt from public.listings l where l.id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'editing a live listing''s content sends it back to pending',
      'ok', v_txt = 'pending', 'got', v_txt));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller edits live listing', 'ok', false, 'got', sqlerrm));
  end;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_mod, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    update public.listings set status = 'active' where id = v_l1;
    update public.listings set status = 'rejected', moderation_note = 'الصور لا تطابق الوصف' where id = v_l3;
    get diagnostics v_n = row_count;
    res := res || jsonb_build_array(jsonb_build_object('check', 'moderator re-approves one and rejects another with a reason',
      'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'moderator re-approves / rejects', 'ok', false, 'got', sqlerrm));
  end;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    update public.listings set status = 'sold' where id = v_l1;
    update public.listings set status = 'active', created_at = now() where id = v_l1;
    select l.status into v_txt from public.listings l where l.id = v_l1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller marks sold, then relists unchanged content (sold -> active allowed)',
      'ok', v_txt = 'active', 'got', v_txt));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller sold / relist', 'ok', false, 'got', sqlerrm));
  end;

  begin
    update public.listings set status = 'active' where id = v_l3;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot flip rejected -> active', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller cannot flip rejected -> active',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    update public.listings set status = 'pending', moderation_note = null where id = v_l3;
    select l.status, l.moderation_note is not null into v_txt, v_bool from public.listings l where l.id = v_l3;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller may resubmit a rejected listing, and cannot erase the moderator''s reason',
      'ok', v_txt = 'pending' and v_bool, 'got', v_txt || ' / note kept ' || v_bool::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller resubmits', 'ok', false, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- ANOTHER USER
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  update public.listings set title = 'hijacked' where id = v_l1;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'another user updates 0 of the seller''s listings', 'ok', v_n = 0, 'got', v_n::text));
  delete from public.listings where id = v_l1;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'another user deletes 0 of the seller''s listings', 'ok', v_n = 0, 'got', v_n::text));

  begin
    insert into public.listing_reports (listing_id, reporter_id, reason) values (v_l_rep, v_other, 'fraud');
    res := res || jsonb_build_array(jsonb_build_object('check', 'another user reports a listing', 'ok', true, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'another user reports a listing', 'ok', false, 'got', sqlerrm));
  end;
  select count(*) into v_n from public.listing_reports where listing_id = v_l_rep;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a reporter cannot read the report queue', 'ok', v_n = 0, 'got', v_n::text));

  begin
    perform * from public.market_seller_facts(array[v_seller]);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a non-moderator cannot read seller history', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a non-moderator cannot read seller history',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  select count(*) into v_n from public.listings where id = v_l_rep;
  res := res || jsonb_build_array(jsonb_build_object('check', 'positive control: another user sees an active listing of an active seller', 'ok', v_n = 1, 'got', v_n::text));
  select count(*) into v_n from public.listings where id = v_l_susp;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended seller''s active listing is not public', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- SELLER deletes the reported listing — the evidence survives
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    delete from public.listings where id = v_l_rep;
    update public.listings set deleted_at = null where id = v_l_rep;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller delete + attempted restore run without error', 'ok', true, 'got', 'ok'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller delete + attempted restore run without error', 'ok', false, 'got', sqlerrm));
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*), bool_and(deleted_at is not null) into v_n, v_bool from public.listings where id = v_l_rep;
  res := res || jsonb_build_array(jsonb_build_object('check', 'seller delete is a soft delete, and the seller cannot un-delete',
    'ok', v_n = 1 and v_bool, 'got', v_n::text || ' row / deleted ' || coalesce(v_bool::text, 'null')));
  select count(*) into v_n from public.listing_reports where listing_id = v_l_rep;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the report on the deleted listing survives', 'ok', v_n = 1, 'got', v_n::text));

  -- ==========================================================================
  -- MARKET MODERATOR: history + queue visibility
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_mod, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select f.listings_total, f.listings_removed, f.reports_open into v_n, v_n2, v_n3
      from public.market_seller_facts(array[v_seller, v_susp]) f where f.seller_id = v_seller;
    res := res || jsonb_build_array(jsonb_build_object('check', 'moderator reads seller history: 3 listings, 1 removed, 1 open report',
      'ok', v_n = 3 and v_n2 = 1 and v_n3 = 1,
      'got', coalesce(v_n::text, 'null') || ' / removed ' || coalesce(v_n2::text, 'null') || ' / open ' || coalesce(v_n3::text, 'null')));
    select f.is_active into v_bool from public.market_seller_facts(array[v_seller, v_susp]) f where f.seller_id = v_susp;
    res := res || jsonb_build_array(jsonb_build_object('check', 'seller history shows the suspended account as inactive',
      'ok', v_bool = false, 'got', coalesce(v_bool::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'moderator reads seller history', 'ok', false, 'got', sqlerrm));
  end;
  select count(*) into v_n from public.listings where id = v_l_susp;
  res := res || jsonb_build_array(jsonb_build_object('check', 'moderator still sees the suspended seller''s listing', 'ok', v_n = 1, 'got', v_n::text));
  select count(*) into v_n from public.listing_reports where listing_id = v_l_rep;
  res := res || jsonb_build_array(jsonb_build_object('check', 'moderator reads the report queue', 'ok', v_n = 1, 'got', v_n::text));

  -- ==========================================================================
  -- A SUB-ADMIN FOR ANOTHER SECTION (jobs)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_jobs, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  update public.listings set status = 'rejected' where id = v_l1;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a jobs-only admin moderates 0 listings', 'ok', v_n = 0, 'got', v_n::text));
  begin
    perform * from public.market_seller_facts(array[v_seller]);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a jobs-only admin cannot read seller history', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a jobs-only admin cannot read seller history',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- THE SUSPENDED USER
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_susp, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    insert into public.listings (seller_id, title, status) values (v_susp, '0313 new from suspended', 'pending');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended user cannot post', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended user cannot post', 'ok', true, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    update public.listings set title = '0313 edited while suspended' where id = v_l_susp;
    res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended user cannot edit or relist', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended user cannot edit or relist',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- ANON
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.listings where id = v_l1;
  res := res || jsonb_build_array(jsonb_build_object('check', 'positive control: anon sees the approved, relisted listing', 'ok', v_n = 1, 'got', v_n::text));
  select count(*) into v_n from public.listings where id in (v_l_susp, v_l_rep, v_l3);
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon sees neither the suspended seller''s, the removed, nor the pending listing', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into public.listings (seller_id, title, status) values (v_seller, '0313 anon', 'pending');
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot post', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot post', 'ok', true, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    perform * from public.market_seller_facts(array[v_seller]);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call market_seller_facts', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call market_seller_facts', 'ok', true, 'got', sqlerrm));
  end;
  begin
    select count(*) into v_n from public.listing_reports;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads no reports', 'ok', v_n = 0, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads no reports', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- REVIEWS — what "verified" may mean
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  begin
    insert into public.orders (store_id, customer_id, status, total) values (v_store_a, v_buyer, 'completed', 10)
      returning id into v_order;
    insert into public.order_items (order_id, product_id, name, quantity, unit_price) values (v_order, v_prod, '0313 Widget', 1, 10);
    insert into public.orders (store_id, customer_id, status, total) values (v_store_a, v_nobuy, 'cancelled', 10)
      returning id into v_order;
    insert into public.order_items (order_id, product_id, name, quantity, unit_price) values (v_order, v_prod, '0313 Widget', 1, 10);

    insert into public.product_reviews (product_id, customer_id, rating, comment) values (v_prod, v_buyer, 5, '0313 good');
    insert into public.product_reviews (product_id, customer_id, rating, comment) values (v_prod, v_nobuy, 1, '0313 never got it');
    select verified into v_bool from public.product_reviews where product_id = v_prod and customer_id = v_buyer;
    res := res || jsonb_build_array(jsonb_build_object('check', 'product review after a COMPLETED order is verified', 'ok', v_bool, 'got', v_bool::text));
    select verified into v_bool from public.product_reviews where product_id = v_prod and customer_id = v_nobuy;
    res := res || jsonb_build_array(jsonb_build_object('check', 'product review after only a CANCELLED order is NOT verified (was true before 0313)', 'ok', not v_bool, 'got', v_bool::text));

    insert into public.reviews (store_id, customer_id, rating, comment) values (v_store_a, v_buyer, 5, '0313 store good');
    insert into public.reviews (store_id, customer_id, rating, comment, verified_purchase) values (v_store_a, v_nobuy, 1, '0313 store bad', true);
    select verified_purchase into v_bool from public.reviews where store_id = v_store_a and customer_id = v_buyer;
    res := res || jsonb_build_array(jsonb_build_object('check', 'store review by a completed buyer: verified_purchase true', 'ok', v_bool, 'got', v_bool::text));
    select verified_purchase into v_bool from public.reviews where store_id = v_store_a and customer_id = v_nobuy;
    res := res || jsonb_build_array(jsonb_build_object('check', 'store review without a completed purchase: false, even when the insert says true', 'ok', not v_bool, 'got', v_bool::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'review fixtures', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    insert into public.reviews (store_id, customer_id, rating, comment) values (v_store_a, v_owner, 5, '0313 my own shop');
    res := res || jsonb_build_array(jsonb_build_object('check', 'an owner cannot review their own store', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'an owner cannot review their own store',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    insert into public.product_reviews (product_id, customer_id, rating, comment) values (v_prod, v_owner, 5, '0313 my own product');
    res := res || jsonb_build_array(jsonb_build_object('check', 'an owner cannot review their own product', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'an owner cannot review their own product',
      'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- The author cannot promote their own review.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_nobuy, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    update public.reviews set verified_purchase = true, comment = '0313 edited' where store_id = v_store_a and customer_id = v_nobuy;
    get diagnostics v_n = row_count;
    select verified_purchase into v_bool from public.reviews where store_id = v_store_a and customer_id = v_nobuy;
    res := res || jsonb_build_array(jsonb_build_object('check', 'the author edits their review but cannot set verified_purchase',
      'ok', v_n = 1 and not v_bool, 'got', v_n::text || ' row / ' || coalesce(v_bool::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'author edits own review', 'ok', false, 'got', sqlerrm));
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.reviews rv
   where rv.verified_purchase is distinct from public.has_store_purchase(rv.customer_id, rv.store_id);
  res := res || jsonb_build_array(jsonb_build_object('check', 'every store review''s verified_purchase matches has_store_purchase (backfill)', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.product_reviews pr
   where pr.verified is distinct from exists (
     select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.product_id = pr.product_id and o.customer_id = pr.customer_id and o.status = 'completed');
  res := res || jsonb_build_array(jsonb_build_object('check', 'every product review''s verified matches a completed order (backfill)', 'ok', v_n = 0, 'got', v_n::text));

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
