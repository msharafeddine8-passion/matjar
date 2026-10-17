-- 0324: publish without waiting for an admin.
--
-- Owner decision, 2026-10-17: anyone who opens a store, posts on Sunday Market or
-- joins as a craftsperson goes live immediately; the owner follows up afterwards
-- and removes what is not appropriate (suspend a store, reject a listing). Admin
-- powers are unchanged — only the default moved from "wait" to "live".
--
-- Business leaders stay curated on purpose: they are real, named people, and
-- auto-publishing a profile of someone else invites impersonation.
--
-- The same sweep found two more INSERT/UPDATE-time trust holes of the 0323 kind
-- (a browser writing its own rating/verified marks); closed here as well.

-- ── Stores: live on creation ────────────────────────────────────────────────
-- 0323's insert guard forced 'pending'; it now forces 'active'. Every other
-- platform column keeps its reset (plan, badges, featuring, rating).
create or replace function public.guard_store_insert_platform_columns()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  new.status_reason     := null;
  new.status_changed_at := null;
  new.status_changed_by := null;

  if public.is_super_admin() then
    return new;
  end if;

  new.plan                    := 'free';
  new.status                  := 'active';   -- 0324: no approval queue
  new.trial_ends_at           := null;       -- stores_grant_trial sets the real one
  new.is_verified             := false;
  new.commercial_reg_verified := false;
  new.featured_until          := null;
  new.rating_avg              := 0;
  new.rating_count            := 0;
  new.invoice_next_no         := 1;
  return new;
end
$function$;

-- The owner still hears about every new store, so "I follow up afterwards"
-- has something to follow. It used to notify only for 'pending'.
create or replace function public.on_new_store()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.profiles
    set role = 'merchant'
    where id = new.owner_id and role = 'customer';

  insert into public.notifications (user_id, type, data)
  select p.id, 'store_new',
         jsonb_build_object('store_id', new.id, 'store_name', new.name, 'status', new.status)
  from public.profiles p
  where p.role = 'super_admin';

  return new;
end $function$;

-- ── Sunday Market: live on posting ──────────────────────────────────────────
-- A seller's listing goes straight to 'active'; editing it no longer sends it
-- back to review. A listing a moderator REJECTED cannot be revived by the seller.
create or replace function public.guard_listing_write()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
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
      new.status := 'active';   -- 0324: was 'pending'
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

  new.seller_id := old.seller_id;
  new.is_featured := old.is_featured;
  new.views := old.views;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.moderation_note := old.moderation_note;

  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  elsif new.deleted_at is not null then
    new.deleted_at := now();
  end if;

  if new.created_at is distinct from old.created_at then
    -- 0317: renew (the only way a seller moves created_at) once every 7 days.
    if old.created_at > now() - interval '7 days' then
      new.created_at := old.created_at;
    else
      new.created_at := now();
    end if;
  end if;

  if new.store_id is distinct from old.store_id
     and new.store_id is not null
     and not public.staff_can(new.store_id, 'products') then
    raise exception 'a listing can only name a store you run'
      using errcode = '42501';
  end if;

  -- 0324: an edit no longer sends a live listing back to review.

  if new.status is distinct from old.status then
    if new.status in ('draft', 'pending') then
      null;
    elsif new.status = 'sold' and old.status = 'active' then
      null;
    elsif new.status = 'active' and old.status in ('sold', 'expired', 'draft', 'pending') then
      null;
    else
      -- 'rejected' (a moderator removed it) and any move into 'rejected'
      -- stay moderator-only.
      raise exception 'listing status % -> % needs a moderator', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$function$;

-- ── Craftspeople: live on joining, and no self-awarded trust ────────────────
-- The insert policy only checks user_id, and there was no insert guard: a
-- craftsperson could create a profile already verified with a 5.0 rating.
alter table public.craft_providers alter column status set default 'active';

create or replace function public.guard_craft_provider_insert()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_super_admin() then
    return new;
  end if;
  new.status          := 'active';
  new.verified        := false;
  new.verified_at     := null;
  new.rating_avg      := 0;
  new.rating_count    := 0;
  new.completed_count := 0;
  return new;
end
$function$;

drop trigger if exists craft_providers_a_guard_insert on public.craft_providers;
create trigger craft_providers_a_guard_insert
  before insert on public.craft_providers
  for each row execute function public.guard_craft_provider_insert();

-- ── Freelance gigs: ratings and completed counts are earned, not typed ──────
-- No guard existed on insert or update, so a freelancer could write their own
-- rating_avg / rating_count / completed_count.
create or replace function public.guard_gig_counters()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.admin_can('freelance') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.rating_avg      := 0;
    new.rating_count    := 0;
    new.completed_count := 0;
  else
    new.rating_avg      := old.rating_avg;
    new.rating_count    := old.rating_count;
    new.completed_count := old.completed_count;
  end if;
  return new;
end
$function$;

drop trigger if exists gigs_a_guard_counters on public.gigs;
create trigger gigs_a_guard_counters
  before insert or update on public.gigs
  for each row execute function public.guard_gig_counters();

-- ── Business leaders: still curated, and a submission can't feature itself ──
create or replace function public.guard_leader_submission()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.admin_can('leaders') then
    return new;
  end if;
  new.featured := false;
  return new;
end
$function$;

drop trigger if exists business_leaders_a_guard_submission on public.business_leaders;
create trigger business_leaders_a_guard_submission
  before insert on public.business_leaders
  for each row execute function public.guard_leader_submission();

-- ── Publish what was waiting ────────────────────────────────────────────────
-- Runs as the migration owner, so the guards above pass it through. The
-- listing-status trigger tells each seller their listing is live.
update public.stores set status = 'active'
 where status = 'pending' and deleted_at is null;
update public.listings set status = 'active'
 where status = 'pending' and deleted_at is null;
update public.craft_providers set status = 'active'
 where status = 'pending';
