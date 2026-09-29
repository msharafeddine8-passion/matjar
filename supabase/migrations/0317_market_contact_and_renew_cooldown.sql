-- 0317 — Sunday Market: a way to reach a private seller, and a renew cooldown.
--
-- Owner decisions, 2026-09-29 (P2-MARKET-09, P3-MARKET-12).
--
-- A. start_listing_conversation(p_listing_id)
--    A listing posted by a person (no store) had no contact path at all: the
--    WhatsApp/phone buttons only exist for a store's listing, and a private
--    seller's number is not public (and is never verified). The platform
--    already has 1:1 messaging (0061) with notifications, so the buyer opens a
--    conversation with the seller — no number changes hands.
--    Resolves the seller from the listing on the server: the listing must be
--    live (active, not removed) and its seller's account active; a seller
--    cannot message themselves. A store's listing opens the conversation in
--    that store's context, exactly like start_store_conversation.
--
-- B. Renew once a week
--    Renew resets created_at, which is what "newest" sorts by. 0313 already
--    stops a seller from SETTING a date (only now() is accepted); nothing
--    stopped pressing renew every minute to stay first. guard_listing_write
--    now only moves created_at if the listing is at least 7 days old; a sooner
--    attempt keeps the old date and the rest of the update goes through (a
--    sold item relisted the same week is live again, just not bumped). The
--    screen disables the button and says when it opens (src/lib/market-renew.ts
--    holds the same 7). Listings expire after 60 days, so an expired listing
--    can always be renewed.
--    The function body is the live 0313 definition with only the created_at
--    block changed (marked -- 0317).

-- ---------------------------------------------------------------------------
-- A.
-- ---------------------------------------------------------------------------
create or replace function public.start_listing_conversation(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_me uuid := (select auth.uid());
  v_seller uuid;
  v_store uuid;
begin
  if v_me is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select l.seller_id, l.store_id into v_seller, v_store
    from public.listings l
   where l.id = p_listing_id
     and l.status = 'active'
     and l.deleted_at is null
     and public.user_id_is_active(l.seller_id);
  if v_seller is null then
    raise exception 'listing_unavailable' using errcode = 'P0002';
  end if;
  if v_seller = v_me then
    raise exception 'own_listing' using errcode = 'check_violation';
  end if;
  return public.start_conversation(v_seller, v_store);
end
$function$;

comment on function public.start_listing_conversation(uuid) is
  'Signed-in buyer: open (or reuse) a 1:1 conversation with the seller of a live listing. The seller''s phone is never exposed. 0317.';

revoke all on function public.start_listing_conversation(uuid) from public, anon, authenticated;
grant execute on function public.start_listing_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- B.
-- ---------------------------------------------------------------------------
create or replace function public.guard_listing_write()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_content_changed boolean;
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

  v_content_changed :=
    (new.title, new.description, new.price, new.images, new.category_id, new.store_id)
    is distinct from
    (old.title, old.description, old.price, old.images, old.category_id, old.store_id);

  if v_content_changed and new.status <> 'draft' then
    new.status := 'pending';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('draft', 'pending') then
      null;
    elsif new.status = 'sold' and old.status = 'active' then
      null;
    elsif new.status = 'active' and old.status in ('sold', 'expired') then
      null;
    else
      raise exception 'listing status % -> % needs a moderator', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$function$;
