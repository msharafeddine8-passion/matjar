-- 0317 verification: run whole, inside one transaction that is rolled back.
-- Expect the last row: ALL CHECKS | true | 0 failed of 16.
begin;

-- ==== MIGRATION 0317 (verbatim) ====
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
-- ==== END MIGRATION 0317 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_seller  uuid := gen_random_uuid();   -- a person selling privately
  v_buyer   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- owns a store that also lists
  v_gone    uuid := gen_random_uuid();   -- a suspended seller
  v_store   uuid;
  v_l_old   uuid;   -- active, 10 days old
  v_l_new   uuid;   -- active, 2 days old
  v_l_pend  uuid;   -- pending review
  v_l_del   uuid;   -- removed
  v_l_exp   uuid;   -- expired, 70 days old
  v_l_sold  uuid;   -- sold, 3 days old
  v_l_store uuid;   -- a store's listing
  v_l_susp  uuid;   -- active, seller suspended
  v_conv    uuid;
  v_conv2   uuid;
  v_ts      timestamptz;
  v_ts2     timestamptz;
  v_txt     text;
  v_n       int;
  res       jsonb := '[]'::jsonb;
begin
  insert into auth.users (id) values (v_seller), (v_buyer), (v_owner), (v_gone);
  insert into public.profiles (id, full_name) values
    (v_seller, '0317 Seller'), (v_buyer, '0317 Buyer'), (v_owner, '0317 Owner'), (v_gone, '0317 Gone')
  on conflict (id) do nothing;
  update public.profiles set is_active = false where id = v_gone;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner, '0317 Store', 'active', 'free') returning id into v_store;

  -- Written as the table owner, so guard_listing_write lets the dates through.
  insert into public.listings (seller_id, title, status, created_at)
    values (v_seller, '0317 old', 'active', now() - interval '10 days') returning id into v_l_old;
  insert into public.listings (seller_id, title, status, created_at)
    values (v_seller, '0317 new', 'active', now() - interval '2 days') returning id into v_l_new;
  insert into public.listings (seller_id, title, status)
    values (v_seller, '0317 pending', 'pending') returning id into v_l_pend;
  insert into public.listings (seller_id, title, status, deleted_at)
    values (v_seller, '0317 removed', 'active', now()) returning id into v_l_del;
  insert into public.listings (seller_id, title, status, created_at)
    values (v_seller, '0317 expired', 'expired', now() - interval '70 days') returning id into v_l_exp;
  insert into public.listings (seller_id, title, status, created_at)
    values (v_seller, '0317 sold', 'sold', now() - interval '3 days') returning id into v_l_sold;
  insert into public.listings (seller_id, store_id, title, status)
    values (v_owner, v_store, '0317 store item', 'active') returning id into v_l_store;
  insert into public.listings (seller_id, title, status)
    values (v_gone, '0317 suspended seller', 'active') returning id into v_l_susp;

  res := res || jsonb_build_array(jsonb_build_object('check', 'start_listing_conversation is SECURITY DEFINER, search_path empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.start_listing_conversation(uuid)'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated may execute it, anon may not',
    'ok', has_function_privilege('authenticated', 'public.start_listing_conversation(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.start_listing_conversation(uuid)', 'execute'),
    'got', 'checked'));

  -- ---------------- the buyer
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);

  v_conv := public.start_listing_conversation(v_l_old);
  select count(*) into v_n from public.conversation_participants cp
   where cp.conversation_id = v_conv and cp.user_id in (v_buyer, v_seller);
  select coalesce(c.store_id::text, 'null') into v_txt from public.conversations c where c.id = v_conv;
  res := res || jsonb_build_array(jsonb_build_object('check', 'BUYER opens a conversation with the private seller (no store context)',
    'ok', v_conv is not null and v_n = 2 and v_txt = 'null', 'got', v_n::text || ' participants / store ' || v_txt));

  v_conv2 := public.start_listing_conversation(v_l_new);
  res := res || jsonb_build_array(jsonb_build_object('check', 'a second listing by the same seller reuses the same conversation',
    'ok', v_conv2 = v_conv, 'got', 'checked'));

  begin
    perform public.start_listing_conversation(v_l_pend);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a listing still in review cannot be messaged about', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a listing still in review cannot be messaged about', 'ok', sqlstate = 'P0002', 'got', sqlstate));
  end;
  begin
    perform public.start_listing_conversation(v_l_del);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a removed listing cannot be messaged about', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a removed listing cannot be messaged about', 'ok', sqlstate = 'P0002', 'got', sqlstate));
  end;
  begin
    perform public.start_listing_conversation(v_l_susp);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended seller cannot be reached through a listing', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a suspended seller cannot be reached through a listing', 'ok', sqlstate = 'P0002', 'got', sqlstate));
  end;
  begin
    perform public.start_listing_conversation(gen_random_uuid());
    res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown listing id is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown listing id is refused', 'ok', sqlstate = 'P0002', 'got', sqlstate));
  end;

  v_conv2 := public.start_listing_conversation(v_l_store);
  select coalesce(c.store_id::text, 'null') into v_txt from public.conversations c where c.id = v_conv2;
  select count(*) into v_n from public.conversation_participants cp
   where cp.conversation_id = v_conv2 and cp.user_id = v_owner;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a store''s listing opens the conversation in that store''s context',
    'ok', v_txt = v_store::text and v_n = 1, 'got', v_txt));

  -- ---------------- the seller
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  begin
    perform public.start_listing_conversation(v_l_old);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a seller cannot message themselves', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a seller cannot message themselves', 'ok', sqlstate = '23514', 'got', sqlstate));
  end;

  select l.created_at into v_ts from public.listings l where l.id = v_l_new;
  update public.listings set created_at = now() where id = v_l_new;
  select l.created_at into v_ts2 from public.listings l where l.id = v_l_new;
  res := res || jsonb_build_array(jsonb_build_object('check', 'RENEW within 7 days keeps the old date (no bump to the top)',
    'ok', v_ts2 = v_ts, 'got', 'checked'));

  update public.listings set created_at = now() where id = v_l_old;
  select l.created_at into v_ts2 from public.listings l where l.id = v_l_old;
  res := res || jsonb_build_array(jsonb_build_object('check', 'RENEW after 7 days moves it to now',
    'ok', v_ts2 > now() - interval '1 minute', 'got', 'checked'));

  update public.listings set created_at = now() where id = v_l_old;
  select l.created_at into v_ts from public.listings l where l.id = v_l_old;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a second renew right after is a no-op',
    'ok', v_ts = v_ts2, 'got', 'checked'));

  update public.listings set created_at = '2099-01-01' where id = v_l_exp;
  update public.listings set status = 'active', created_at = now() where id = v_l_exp;
  select l.status, l.created_at into v_txt, v_ts from public.listings l where l.id = v_l_exp;
  res := res || jsonb_build_array(jsonb_build_object('check', 'an EXPIRED listing (70 days) relists and moves to now, never to a chosen date',
    'ok', v_txt = 'active' and v_ts <= now() and v_ts > now() - interval '1 minute', 'got', v_txt));

  select l.created_at into v_ts from public.listings l where l.id = v_l_sold;
  update public.listings set status = 'active', created_at = now() where id = v_l_sold;
  select l.status, l.created_at into v_txt, v_ts2 from public.listings l where l.id = v_l_sold;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a SOLD item relisted the same week is live again but keeps its date',
    'ok', v_txt = 'active' and v_ts2 = v_ts, 'got', v_txt));

  -- ---------------- anon
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.start_listing_conversation(v_l_old);
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot start a conversation', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot start a conversation', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

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
