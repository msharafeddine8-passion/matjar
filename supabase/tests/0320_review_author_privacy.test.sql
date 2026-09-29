-- 0319 + 0320 verification: run whole, inside one transaction that is rolled back.
-- Expect the last row: ALL CHECKS | true | 0 failed of 22.
begin;

-- ==== MIGRATION 0319 (verbatim) ====
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
-- ==== END MIGRATION 0319 (verbatim) ====

-- ==== MIGRATION 0320 (verbatim) ====
-- 0320 — Signed-in users can no longer read who wrote a review.
--
-- The column revoke that 0319 prepares for (read 0319's header for the why).
-- authenticated keeps every review column the app shows; it loses
-- reviews.customer_id, reviews.reply_by and product_reviews.customer_id —
-- the same three anon already could not read.
--
-- DEPLOY ORDER: only AFTER the app build that uses 0319's helpers is live.
-- The previous build filtered on customer_id directly ("have I reviewed this")
-- and upserted reviews with ON CONFLICT, both of which need the column.
--
-- Verification: supabase/tests/0320_review_author_privacy.test.sql runs 0319
-- and 0320 together, rolled back.

-- ---------------------------------------------------------------------------
-- A. Column grants
-- ---------------------------------------------------------------------------
revoke select on table public.reviews from authenticated;
grant select (
  id, store_id, customer_name, rating, comment, created_at, updated_at,
  reply, reply_at, verified_purchase, deleted_at
) on table public.reviews to authenticated;

revoke select on table public.product_reviews from authenticated;
grant select (
  id, product_id, rating, comment, photos, customer_name, verified, created_at
) on table public.product_reviews to authenticated;
-- ==== END MIGRATION 0320 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner  uuid := gen_random_uuid();   -- owns store S
  v_cust   uuid := gen_random_uuid();   -- bought at S and reviewed it
  v_new    uuid := gen_random_uuid();   -- bought at S, no review yet
  v_none   uuid := gen_random_uuid();   -- never bought at S
  v_other  uuid := gen_random_uuid();   -- any signed-in user
  v_noname uuid := gen_random_uuid();   -- a customer with no name, only an email
  v_store  uuid;
  v_prod   uuid;
  v_rev    uuid;
  v_conv   uuid;
  v_n      int;
  v_txt    text;
  v_bool   boolean;
  c        text;
  v_bad    text[];
  res      jsonb := '[]'::jsonb;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner0319@example.test'), (v_cust, 'cust0319@example.test'),
    (v_new, 'new0319@example.test'), (v_none, 'none0319@example.test'),
    (v_other, 'other0319@example.test'), (v_noname, 'noname0319@example.test');
  insert into public.profiles (id, full_name) values
    (v_owner, '0319 Owner'), (v_cust, '0319 Customer'), (v_new, '0319 New'),
    (v_none, '0319 None'), (v_other, '0319 Other'), (v_noname, null)
  on conflict (id) do nothing;
  -- A signup trigger may already have created the profiles (on conflict above
  -- then does nothing), so set the names explicitly.
  update public.profiles p set full_name = v.n
    from (values (v_owner, '0319 Owner'), (v_cust, '0319 Customer'), (v_new, '0319 New'),
                 (v_none, '0319 None'), (v_other, '0319 Other'), (v_noname, null::text)) v(id, n)
   where p.id = v.id;

  insert into public.stores (owner_id, name, status, plan)
    values (v_owner, '0319 Store', 'active', 'free') returning id into v_store;
  insert into public.products (store_id, name, price, is_available)
    values (v_store, '0319 Item', 10, true) returning id into v_prod;
  insert into public.orders (store_id, customer_id, status, total, phone) values
    (v_store, v_cust, 'completed', 10, '03 319 001'),
    (v_store, v_new, 'completed', 10, '03 319 002');
  insert into public.reviews (store_id, customer_id, customer_name, rating, comment)
    values (v_store, v_cust, '0319 Customer', 4, 'good') returning id into v_rev;
  insert into public.product_reviews (product_id, customer_id, customer_name, rating, comment)
    values (v_prod, v_cust, '0319 Customer', 5, 'great');

  -- ---------------- grants
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated: no table-level SELECT on reviews or product_reviews',
    'ok', not has_table_privilege('authenticated', 'public.reviews', 'select')
      and not has_table_privilege('authenticated', 'public.product_reviews', 'select'), 'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated: customer_id (both tables) and reply_by are not readable',
    'ok', not has_column_privilege('authenticated', 'public.reviews', 'customer_id', 'select')
      and not has_column_privilege('authenticated', 'public.product_reviews', 'customer_id', 'select')
      and not has_column_privilege('authenticated', 'public.reviews', 'reply_by', 'select'), 'got', 'checked'));
  v_bad := '{}';
  foreach c in array array['id','store_id','customer_name','rating','comment','created_at','updated_at','reply','reply_at','verified_purchase','deleted_at'] loop
    if not has_column_privilege('authenticated', 'public.reviews', c, 'select') then v_bad := v_bad || c; end if;
  end loop;
  foreach c in array array['id','product_id','rating','comment','photos','customer_name','verified','created_at'] loop
    if not has_column_privilege('authenticated', 'public.product_reviews', c, 'select') then v_bad := v_bad || ('pr.' || c); end if;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated keeps every column the app shows',
    'ok', cardinality(v_bad) = 0, 'got', coalesce(nullif(array_to_string(v_bad, ','), ''), 'all granted')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'the four helpers: authenticated may execute, anon may not',
    'ok', has_function_privilege('authenticated', 'public.my_store_review(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.has_reviewed_product(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.my_reviewed_store_ids()', 'execute')
      and has_function_privilege('authenticated', 'public.save_store_review(uuid, integer, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.my_store_review(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.save_store_review(uuid, integer, text, text)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'save_store_review is SECURITY DEFINER with search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.save_store_review(uuid, integer, text, text)'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));

  -- ---------------- any signed-in user
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    execute format('select customer_id::text from public.reviews where id = %L', v_rev) into v_txt;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot read a review''s author id', 'ok', false, 'got', 'read'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot read a review''s author id', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  begin
    execute format('select count(*) from public.product_reviews where product_id = %L and customer_id = %L', v_prod, v_cust) into v_n;
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot filter product reviews by author', 'ok', false, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER cannot filter product reviews by author', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  select count(*) into v_n from (
    select id, customer_name, rating, comment, created_at, reply, reply_at, verified_purchase
      from public.reviews where store_id = v_store and deleted_at is null) x;
  select count(*) + v_n into v_n from (
    select id, rating, comment, photos, customer_name, verified, created_at
      from public.product_reviews where product_id = v_prod) x;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER still reads the public review columns (store + product)',
    'ok', v_n = 2, 'got', v_n::text));
  select count(*) into v_n from public.my_store_review(v_store);
  select public.has_reviewed_product(v_prod) into v_bool;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OTHER USER: the helpers answer only about themselves (nothing here)',
    'ok', v_n = 0 and not v_bool and not exists (select 1 from public.my_reviewed_store_ids() s where s = v_store), 'got', 'checked'));

  -- ---------------- the author
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  select m.rating::text || '|' || m.comment || '|' || m.deleted::text into v_txt from public.my_store_review(v_store) m;
  res := res || jsonb_build_array(jsonb_build_object('check', 'AUTHOR: my_store_review returns their review',
    'ok', v_txt = '4|good|false', 'got', coalesce(v_txt, 'none')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'AUTHOR: has_reviewed_product and my_reviewed_store_ids see their rows',
    'ok', public.has_reviewed_product(v_prod) and exists (select 1 from public.my_reviewed_store_ids() s where s = v_store), 'got', 'checked'));
  perform public.save_store_review(v_store, 2, 'changed my mind', '0319 Customer');
  select m.rating::text || '|' || m.comment into v_txt from public.my_store_review(v_store) m;
  execute 'reset role';
  select count(*) into v_n from public.reviews where store_id = v_store and customer_id = v_cust;
  res := res || jsonb_build_array(jsonb_build_object('check', 'AUTHOR: save_store_review edits in place (one row, new rating)',
    'ok', v_txt = '2|changed my mind' and v_n = 1, 'got', coalesce(v_txt, 'none') || ' / rows ' || v_n::text));

  -- ---------------- a buyer writing a first review
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_new, 'role', 'authenticated')::text, true);
  perform public.save_store_review(v_store, 5, 'first', '0319 New');
  execute 'reset role';
  select count(*) into v_n from public.reviews where store_id = v_store and customer_id = v_new and rating = 5;
  res := res || jsonb_build_array(jsonb_build_object('check', 'BUYER: save_store_review inserts a first review (RLS insert path)',
    'ok', v_n = 1, 'got', v_n::text));

  -- ---------------- someone who never bought
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  begin
    perform public.save_store_review(v_store, 1, 'never bought', '0319 None');
    res := res || jsonb_build_array(jsonb_build_object('check', 'NO PURCHASE: refused (the old RLS rule, restated)', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'NO PURCHASE: refused (the old RLS rule, restated)', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  -- ---------------- a suspended buyer
  execute 'reset role';
  update public.profiles set is_active = false where id = v_new;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_new, 'role', 'authenticated')::text, true);
  begin
    perform public.save_store_review(v_store, 1, 'suspended', '0319 New');
    res := res || jsonb_build_array(jsonb_build_object('check', 'SUSPENDED account: refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'SUSPENDED account: refused', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  -- ---------------- the store owner
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  update public.reviews set reply = 'thank you' where id = v_rev;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER: replying by review id still works',
    'ok', v_n = 1, 'got', v_n::text));
  begin
    perform public.save_store_review(v_store, 5, 'my own shop', '0319 Owner');
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER cannot review their own store through the function', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER cannot review their own store through the function', 'ok', true, 'got', sqlstate));
  end;

  -- ---------------- messaging: no email as a name
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_noname, 'role', 'authenticated')::text, true);
  v_conv := public.start_store_conversation(v_store);
  select p.display_name into v_txt from public.conversation_peer(v_conv) p;
  res := res || jsonb_build_array(jsonb_build_object('check', 'CUSTOMER sees the store''s name for a store conversation',
    'ok', v_txt = '0319 Store', 'got', coalesce(v_txt, 'null')));

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select p.display_name into v_txt from public.conversation_peer(v_conv) p;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER never sees a nameless customer''s email (conversation_peer)',
    'ok', v_txt is null, 'got', coalesce(v_txt, 'null')));
  select m.display_name into v_txt from public.my_conversations() m where m.conversation_id = v_conv;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OWNER never sees it in the inbox either (my_conversations)',
    'ok', v_txt is null, 'got', coalesce(v_txt, 'null')));

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  v_conv := public.start_conversation(v_cust, null);
  select p.display_name into v_txt from public.conversation_peer(v_conv) p;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a person with a name is still shown by name',
    'ok', v_txt = '0319 Customer', 'got', coalesce(v_txt, 'null')));

  -- ---------------- anon
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.save_store_review(v_store, 5, 'anon', 'anon');
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot call save_store_review', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot call save_store_review', 'ok', sqlstate = '42501', 'got', sqlstate));
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
