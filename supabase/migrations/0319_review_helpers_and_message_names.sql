-- 0319 — Helpers so the app stops reading review authors; no email as a name.
--
-- Owner request, 2026-09-29 (P3-PRIV-05 and the messaging email fallback).
--
-- A. Review authors (the helpers; the column revoke itself is 0320)
--    anon already reads reviews / product_reviews through column grants that
--    leave out customer_id. authenticated still had table-level SELECT, so any
--    signed-in user could list every review's author account id and link one
--    person's reviews across the whole platform. The names are public by
--    design (customer_name); the account id is not.
--
--    The app used customer_id in exactly five places, all "is this row mine":
--      store page + order page   → my_store_review(store)
--      product page              → has_reviewed_product(product)
--      activity centre           → my_reviewed_store_ids()
--      review form (upsert)      → save_store_review(...)
--    All four are SECURITY DEFINER and only ever act for the caller
--    (auth.uid(), never a parameter). save_store_review restates the checks
--    the RLS insert/update policies made (see its own comment): the client's
--    upsert cannot survive the revoke, because ON CONFLICT needs SELECT on
--    customer_id.
--
--    Also not granted to authenticated: reviews.reply_by (which staff member
--    replied — the shop's answer is the shop's, as anon already sees it).
--
-- B. Messaging display names
--    conversation_peer and my_conversations fell back to the other person's
--    EMAIL when they had no name. A private Sunday Market seller (0317) or a
--    customer writing to a shop would have had their address shown to a
--    stranger. They now return NULL there; the screens say «محادثة».

-- DEPLOY ORDER: this file is additive and safe any time. Apply it BEFORE the
-- app build that calls these functions, and 0320 (the revoke) AFTER it.

-- ---------------------------------------------------------------------------
-- A. "Is this mine" helpers
-- ---------------------------------------------------------------------------
create or replace function public.my_store_review(p_store_id uuid)
returns table (id uuid, rating integer, comment text, deleted boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select r.id, r.rating::integer, r.comment, r.deleted_at is not null
    from public.reviews r
   where r.store_id = p_store_id
     and r.customer_id = (select auth.uid())
   limit 1;
$function$;

comment on function public.my_store_review(uuid) is
  'The caller''s own review of one store (or no row). Replaces client reads that filtered on reviews.customer_id. 0319.';

create or replace function public.has_reviewed_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.product_reviews pr
     where pr.product_id = p_product_id
       and pr.customer_id = (select auth.uid())
  );
$function$;

comment on function public.has_reviewed_product(uuid) is
  'Whether the caller has reviewed this product. 0319.';

create or replace function public.my_reviewed_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select r.store_id
    from public.reviews r
   where r.customer_id = (select auth.uid())
     and r.deleted_at is null
   limit 200;
$function$;

comment on function public.my_reviewed_store_ids() is
  'Stores the caller has a live review of (activity centre: which visits still need a review). 0319.';

-- SECURITY DEFINER because INSERT … ON CONFLICT (store_id, customer_id) needs
-- SELECT on the arbiter column, which authenticated no longer has (verified:
-- the invoker version fails with 42501). It therefore restates, in order, the
-- checks reviews_insert_own / reviews_update_own made: signed in, account
-- active, a completed order or booking at the store, fewer than 15 reviews in
-- the last hour, and only ever the caller's own row (customer_id = auth.uid(),
-- never a parameter). The triggers still run: block_self_review (definer)
-- refuses owners and staff, set_review_verified_purchase stamps the flag, the
-- rating and length constraints hold. On conflict only rating, comment and
-- customer_name change — as guard_review_columns allowed the author.
create or replace function public.save_store_review(
  p_store_id uuid,
  p_rating integer,
  p_comment text,
  p_customer_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.user_is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_store_id is null or not public.has_store_purchase(v_uid, p_store_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if public.rl_recent_reviews(v_uid) >= 15 then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.reviews (store_id, customer_id, customer_name, rating, comment)
  values (p_store_id, v_uid, p_customer_name, p_rating, p_comment)
  on conflict (store_id, customer_id) do update
     set rating = excluded.rating,
         comment = excluded.comment,
         customer_name = excluded.customer_name;
end
$function$;

comment on function public.save_store_review(uuid, integer, text, text) is
  'Write or edit the caller''s own review of a store: signed in, active, a completed purchase there, under the hourly cap (the old RLS checks, restated). 0319.';

revoke all on function public.my_store_review(uuid) from public, anon, authenticated;
revoke all on function public.has_reviewed_product(uuid) from public, anon, authenticated;
revoke all on function public.my_reviewed_store_ids() from public, anon, authenticated;
revoke all on function public.save_store_review(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.my_store_review(uuid) to authenticated;
grant execute on function public.has_reviewed_product(uuid) to authenticated;
grant execute on function public.my_reviewed_store_ids() to authenticated;
grant execute on function public.save_store_review(uuid, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B. No email as a display name
-- ---------------------------------------------------------------------------
create or replace function public.conversation_peer(p_conversation_id uuid)
returns table (display_name text, other_name text, store_name text)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    case
      when c.store_id is not null and s.owner_id <> auth.uid() then s.name
      else nullif(trim(op.full_name), '')
    end as display_name,
    op.full_name as other_name,
    s.name as store_name
  from public.conversations c
  left join public.stores s on s.id = c.store_id
  left join lateral (
    select p.full_name
    from public.conversation_participants cp2
    join public.profiles p on p.id = cp2.user_id
    where cp2.conversation_id = c.id and cp2.user_id <> auth.uid()
    limit 1
  ) op on true
  where c.id = p_conversation_id
    -- participant-gated: only a member of the conversation may resolve the peer
    and exists (
      select 1 from public.conversation_participants me
      where me.conversation_id = c.id and me.user_id = auth.uid()
    );
$function$;

create or replace function public.my_conversations()
returns table (
  conversation_id uuid, store_id uuid, store_name text,
  other_name text, display_name text, last_body text,
  last_at timestamptz, unread boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id, c.store_id, s.name as store_name,
    op.full_name as other_name,
    case
      when c.store_id is not null and s.owner_id <> mp.user_id then s.name
      else nullif(trim(op.full_name), '')
    end as display_name,
    lm.body as last_body, c.last_message_at as last_at,
    (mp.last_read_at is null or c.last_message_at > mp.last_read_at) as unread
  from public.conversation_participants mp
  join public.conversations c on c.id = mp.conversation_id
  left join public.stores s on s.id = c.store_id
  left join lateral (
    select p.full_name
    from public.conversation_participants cp2
    join public.profiles p on p.id = cp2.user_id
    where cp2.conversation_id = c.id and cp2.user_id <> mp.user_id
    limit 1
  ) op on true
  left join lateral (
    select body from public.messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where mp.user_id = auth.uid()
  order by c.last_message_at desc;
$function$;
