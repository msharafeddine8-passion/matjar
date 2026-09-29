-- 0318 verification: run whole, inside one transaction that is rolled back.
-- Expect the last row: ALL CHECKS | true | 0 failed of 12.
begin;

-- ==== MIGRATION 0318 (verbatim) ====
-- 0318 — A loyalty card's link can be replaced (the gift-card twin of 0316).
--
-- loyalty_accounts.token (0310) is the only credential behind the public card
-- /[lang]/loyalty/<token>: the member's name, balance and last movements. It
-- was minted once by the column default and could not be changed, so a card
-- link sent to the wrong number stayed readable for good.
--
-- rotate_loyalty_card_link gives the member a fresh token (same shape and
-- entropy as the default: 18 random bytes, url-safe base64) and returns it;
-- get_loyalty_card then answers NULL for the old one and the page 404s.
--
-- Who: staff_can(store, 'customers') — exactly who can already list members
-- with their tokens (store_loyalty_members) and send the card. No plan check:
-- a downgraded store still manages the members it has. Balances live in
-- loyalty_events against the account id, so nothing but the link changes.

create or replace function public.rotate_loyalty_card_link(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
  v_token text;
begin
  select a.store_id into v_store from public.loyalty_accounts a where a.id = p_account_id;
  if v_store is null or not public.staff_can(v_store, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  update public.loyalty_accounts set token = v_token where id = p_account_id;
  return v_token;
end
$function$;

comment on function public.rotate_loyalty_card_link(uuid) is
  'Staff with customers: replace a loyalty member''s card-link token; the old /loyalty/<token> stops resolving. Balance unchanged. 0318.';

revoke all on function public.rotate_loyalty_card_link(uuid) from public, anon, authenticated;
grant execute on function public.rotate_loyalty_card_link(uuid) to authenticated;
-- ==== END MIGRATION 0318 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_staff_c uuid := gen_random_uuid();   -- staff of A WITH customers
  v_staff_x uuid := gen_random_uuid();   -- staff of A WITHOUT customers
  v_store_a uuid;
  v_store_b uuid;
  v_acc     uuid;
  v_old     text;
  v_new     text;
  v_new2    text;
  v_txt     text;
  v_n       int;
  res       jsonb := '[]'::jsonb;
begin
  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_staff_c), (v_staff_x);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0318 Owner A'), (v_owner_b, '0318 Owner B'), (v_staff_c, '0318 Staff C'), (v_staff_x, '0318 Staff X')
  on conflict (id) do nothing;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0318 Store A', 'active', 'pro') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0318 Store B', 'active', 'pro') returning id into v_store_b;
  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff_c, 'staff', '{"orders":false,"products":false,"bookings":false,"customers":true}'::jsonb),
    (v_store_a, v_staff_x, 'staff', '{"orders":true,"products":true,"bookings":true,"customers":false}'::jsonb);
  insert into public.loyalty_accounts (store_id, phone_key, display_name)
    values (v_store_a, '96170318318', '0318 Member') returning id, token into v_acc, v_old;
  insert into public.loyalty_events (account_id, store_id, kind, delta, reason, note)
    values (v_acc, v_store_a, 'stamps', 3, 'adjust', '0318 fixture');

  res := res || jsonb_build_array(jsonb_build_object('check', 'SECURITY DEFINER with search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.rotate_loyalty_card_link(uuid)'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated may execute, anon may not',
    'ok', has_function_privilege('authenticated', 'public.rotate_loyalty_card_link(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.rotate_loyalty_card_link(uuid)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'fixture: the old card link resolves before rotation',
    'ok', public.get_loyalty_card(v_old) is not null, 'got', 'checked'));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  begin
    perform public.rotate_loyalty_card_link(v_acc);
    res := res || jsonb_build_array(jsonb_build_object('check', 'another store''s owner cannot rotate', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'another store''s owner cannot rotate', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_x, 'role', 'authenticated')::text, true);
  begin
    perform public.rotate_loyalty_card_link(v_acc);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT customers cannot rotate', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT customers cannot rotate', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_c, 'role', 'authenticated')::text, true);
  v_new := public.rotate_loyalty_card_link(v_acc);
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITH customers rotates: new token, same shape',
    'ok', v_new is not null and v_new <> v_old and v_new ~ '^[A-Za-z0-9_-]{24,64}$', 'got', coalesce(length(v_new)::text, 'null')));

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  begin
    perform public.rotate_loyalty_card_link(gen_random_uuid());
    res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown member id is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown member id is refused', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  v_new2 := public.rotate_loyalty_card_link(v_acc);
  res := res || jsonb_build_array(jsonb_build_object('check', 'the owner rotates too, and each rotation is fresh',
    'ok', v_new2 is not null and v_new2 <> v_new, 'got', 'checked'));

  execute 'reset role';
  select a.token into v_txt from public.loyalty_accounts a where a.id = v_acc;
  select coalesce(sum(e.delta), 0)::int into v_n from public.loyalty_events e where e.account_id = v_acc;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the member row holds the latest token and the stamps are untouched',
    'ok', v_txt = v_new2 and v_n = 3, 'got', v_n::text || ' stamps'));

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  res := res || jsonb_build_array(jsonb_build_object('check', 'ANON: the first and second links no longer resolve',
    'ok', public.get_loyalty_card(v_old) is null and public.get_loyalty_card(v_new) is null, 'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'ANON: the current link resolves',
    'ok', public.get_loyalty_card(v_new2) is not null, 'got', 'checked'));
  begin
    perform public.rotate_loyalty_card_link(v_acc);
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot rotate', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot rotate', 'ok', sqlstate = '42501', 'got', sqlstate));
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
