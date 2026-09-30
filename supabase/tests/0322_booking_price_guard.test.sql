-- 0322 verification: run whole, inside one transaction that is rolled back.
-- Expect the last row: ALL CHECKS | true | 0 failed of 6.
begin;

-- ==== MIGRATION 0322 (verbatim) ====
-- 0322 — A booking's price is the database's to state, never the browser's.
--
-- 0321 added bookings.price (and variant_id). place_booking fills them on the
-- server. But services without the booking engine still insert straight from
-- the browser (the legacy path in booking-panel.tsx), and authenticated holds
-- INSERT and UPDATE on those columns, so a customer could send any price, or
-- another service's cheaper option, and the shop would read it as fact.
--
-- bookings_price_guard (BEFORE INSERT OR UPDATE, SECURITY INVOKER — the
-- established pattern: it acts only when current_user is 'authenticated' or
-- 'anon', so place_booking, which is SECURITY DEFINER, passes straight
-- through with the price it computed):
--   INSERT: variant_id is kept only if it is an available option of the
--           booked service; price is recomputed as that option's price, else
--           the service's (discount price first), whatever was sent.
--   UPDATE: price and variant_id cannot change from a browser (the shop
--           accepting or cancelling a booking never needs to).

create or replace function public.bookings_price_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_opt_price numeric(12,2);
  v_opt_found boolean := false;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.price := old.price;
    new.variant_id := old.variant_id;
    return new;
  end if;

  if new.variant_id is not null then
    select v.price, true into v_opt_price, v_opt_found
      from public.product_variants v
     where v.id = new.variant_id
       and v.product_id = new.product_id
       and v.is_available;
    if not coalesce(v_opt_found, false) then
      new.variant_id := null;
      v_opt_price := null;
    end if;
  end if;

  if new.product_id is null then
    new.price := null;
  else
    select coalesce(v_opt_price, p.discount_price, p.price)
      into new.price
      from public.products p
     where p.id = new.product_id;
  end if;
  return new;
end
$function$;

comment on function public.bookings_price_guard() is
  'Browser writes cannot state a booking''s price or swap its option: recomputed on insert, frozen on update. place_booking (definer) passes through. 0322.';

revoke all on function public.bookings_price_guard() from public, anon, authenticated;

drop trigger if exists bookings_price_guard on public.bookings;
create trigger bookings_price_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_price_guard();
-- ==== END MIGRATION 0322 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner uuid := gen_random_uuid();
  v_cust  uuid := gen_random_uuid();
  v_store uuid;
  v_svc   uuid;   -- legacy service (no engine): $20, discount $18
  v_eng   uuid;   -- engine service: $30
  v_other uuid;   -- another service: $50
  v_long  uuid;   -- option of v_svc: $40
  v_cheap uuid;   -- option of v_other: $1
  v_engop uuid;   -- option of v_eng: $45
  v_day   date := (now() at time zone 'Asia/Beirut')::date + 4;
  v_id    uuid;
  v_res   jsonb;
  v_b     record;
  res     jsonb := '[]'::jsonb;
begin
  insert into auth.users (id) values (v_owner), (v_cust);
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner, '0322 Salon', 'active', 'free') returning id into v_store;
  insert into public.products (store_id, name, price, discount_price, is_available, item_kind)
    values (v_store, '0322 Cut', 20, 18, true, 'service') returning id into v_svc;
  insert into public.products (store_id, name, price, is_available, item_kind,
                               booking_allocation_mode, duration_minutes, capacity_per_slot)
    values (v_store, '0322 Engine', 30, true, 'service', 'capacity_based', 30, 5) returning id into v_eng;
  insert into public.products (store_id, name, price, is_available, item_kind)
    values (v_store, '0322 Colour', 50, true, 'service') returning id into v_other;
  insert into public.product_variants (product_id, label, price) values (v_svc, 'Long', 40) returning id into v_long;
  insert into public.product_variants (product_id, label, price) values (v_other, 'Cheap', 1) returning id into v_cheap;
  insert into public.product_variants (product_id, label, price) values (v_eng, 'Plus', 45) returning id into v_engop;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  insert into public.bookings (store_id, customer_id, product_id, service_name, requested_date, requested_time, price)
    values (v_store, v_cust, v_svc, '0322 Cut', v_day, '10:00', 1) returning id into v_id;
  execute 'reset role';
  select b.* into v_b from public.bookings b where b.id = v_id;
  res := res || jsonb_build_array(jsonb_build_object('check', 'BROWSER insert stating $1: the price becomes the service''s ($18 discount price)',
    'ok', v_b.price = 18 and v_b.variant_id is null, 'got', coalesce(v_b.price::text, 'null')));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  insert into public.bookings (store_id, customer_id, product_id, service_name, requested_date, requested_time, variant_id, price)
    values (v_store, v_cust, v_svc, '0322 Cut — Long', v_day, '11:00', v_long, 1) returning id into v_id;
  execute 'reset role';
  select b.* into v_b from public.bookings b where b.id = v_id;
  res := res || jsonb_build_array(jsonb_build_object('check', 'BROWSER insert with a real option: the option''s $40, whatever was sent',
    'ok', v_b.price = 40 and v_b.variant_id = v_long, 'got', coalesce(v_b.price::text, 'null')));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  insert into public.bookings (store_id, customer_id, product_id, service_name, requested_date, requested_time, variant_id)
    values (v_store, v_cust, v_svc, '0322 Cut', v_day, '12:00', v_cheap) returning id into v_id;
  execute 'reset role';
  select b.* into v_b from public.bookings b where b.id = v_id;
  res := res || jsonb_build_array(jsonb_build_object('check', 'BROWSER insert borrowing ANOTHER service''s $1 option: option dropped, service price kept',
    'ok', v_b.price = 18 and v_b.variant_id is null, 'got', coalesce(v_b.price::text, 'null') || ' / ' || coalesce(v_b.variant_id::text, 'null')));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  update public.bookings set price = 0, variant_id = v_long, status = 'accepted' where id = v_id;
  execute 'reset role';
  select b.* into v_b from public.bookings b where b.id = v_id;
  res := res || jsonb_build_array(jsonb_build_object('check', 'SHOP update: status changes, price and option stay frozen',
    'ok', v_b.status = 'accepted' and v_b.price = 18 and v_b.variant_id is null,
    'got', v_b.status || ' / ' || coalesce(v_b.price::text, 'null')));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_eng, p_date => v_day,
                                p_time => '15:00', p_variant_id => v_engop);
  execute 'reset role';
  select b.* into v_b from public.bookings b where b.id = (v_res ->> 'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('check', 'ENGINE path (place_booking, definer) is untouched: option $45 recorded',
    'ok', (v_res ->> 'ok')::boolean and v_b.price = 45 and v_b.variant_id = v_engop,
    'got', coalesce(v_res::text, 'null')));

  res := res || jsonb_build_array(jsonb_build_object('check', 'the guard is SECURITY INVOKER (acts on browser roles only)',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.bookings_price_guard()'::regprocedure and not p.prosecdef),
    'got', 'checked'));

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
