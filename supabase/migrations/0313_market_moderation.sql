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
