-- 0316 verification: run whole, inside one transaction that is rolled back.
-- Expect the last row: ALL CHECKS | true | 0 failed of 12.
begin;

-- ==== MIGRATION 0316 (verbatim) ====
create or replace function public.rotate_gift_card_link(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
  v_token text;
begin
  select g.store_id into v_store from public.gift_cards g where g.id = p_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  update public.gift_cards set token = v_token where id = p_id;
  return v_token;
end
$function$;

comment on function public.rotate_gift_card_link(uuid) is
  'Owner only: replace a gift card''s read-only link token; the old /gift/<token> stops resolving. Code and balance unchanged. 0316.';

revoke all on function public.rotate_gift_card_link(uuid) from public, anon, authenticated;
grant execute on function public.rotate_gift_card_link(uuid) to authenticated;
-- ==== END MIGRATION 0316 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_staff   uuid := gen_random_uuid();
  v_store_a uuid;
  v_store_b uuid;
  v_card    uuid;
  v_old     text;
  v_new     text;
  v_txt     text;
  v_bal     numeric;
  v_code    text;
  res       jsonb := '[]'::jsonb;
begin
  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_staff);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0316 Owner A'), (v_owner_b, '0316 Owner B'), (v_staff, '0316 Staff')
  on conflict (id) do nothing;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0316 Store A', 'active', 'pro') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0316 Store B', 'active', 'pro') returning id into v_store_b;
  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff, 'staff',
     '{"orders":true,"products":true,"bookings":true,"customers":true}'::jsonb);
  insert into public.gift_cards (store_id, code, currency, initial_amount, balance)
    values (v_store_a, '23456789ABCD', 'USD', 50, 30)
    returning id, token into v_card, v_old;

  res := res || jsonb_build_array(jsonb_build_object('check', 'SECURITY DEFINER with search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.rotate_gift_card_link(uuid)'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated may execute, anon and public may not',
    'ok', has_function_privilege('authenticated', 'public.rotate_gift_card_link(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.rotate_gift_card_link(uuid)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'fixture: the old link resolves before rotation',
    'ok', public.get_gift_card(v_old) is not null, 'got', 'checked'));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  begin
    perform public.rotate_gift_card_link(v_card);
    res := res || jsonb_build_array(jsonb_build_object('check', 'another store''s owner cannot rotate', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'another store''s owner cannot rotate', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  begin
    perform public.rotate_gift_card_link(v_card);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff (every permission) cannot rotate: owner only, like issue/void', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff (every permission) cannot rotate: owner only, like issue/void', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  begin
    perform public.rotate_gift_card_link(gen_random_uuid());
    res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown card id is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown card id is refused', 'ok', sqlstate = '42501', 'got', sqlstate));
  end;
  v_new := public.rotate_gift_card_link(v_card);

  execute 'reset role';
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner A gets a new token of the same shape',
    'ok', v_new is not null and v_new <> v_old and v_new ~ '^[A-Za-z0-9_-]{24,64}$', 'got', coalesce(length(v_new)::text, 'null')));
  select g.token, g.balance, g.code into v_txt, v_bal, v_code from public.gift_cards g where g.id = v_card;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the card row now holds the new token',
    'ok', v_txt = v_new, 'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'code and balance are untouched',
    'ok', v_code = '23456789ABCD' and v_bal = 30, 'got', v_code || ' / ' || v_bal::text));

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  res := res || jsonb_build_array(jsonb_build_object('check', 'ANON: the old link no longer resolves',
    'ok', public.get_gift_card(v_old) is null, 'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'ANON: the new link resolves',
    'ok', public.get_gift_card(v_new) is not null, 'got', 'checked'));
  begin
    perform public.rotate_gift_card_link(v_card);
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
