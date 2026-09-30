-- 0321 verification: run whole, inside one transaction that is rolled back.
-- Expect the last row: ALL CHECKS | true | 0 failed of 10.
begin;

-- ==== MIGRATION 0321 (verbatim) ====
-- 0321 — A service can have several prices (options).
--
-- Owner request, 2026-09-30: «اوقات الخدمة بكون الها كذا سعر». A haircut is
-- one price for short hair and another for long; a consultation is 30 or 60
-- minutes. The catalogue already had product_variants (0021: a label and its
-- own price), but the add-service form hid them and place_booking ignored
-- them — every booking was taken at the service's single base price and
-- duration.
--
-- A. product_variants.duration_minutes — an option may take longer than the
--    service's default (null = the service's duration). Same bounds as
--    products.duration_minutes in the forms (5..480).
-- B. bookings.variant_id + bookings.price — which option was booked, and the
--    price it was booked at (before any coupon; the discount stays in
--    bookings.discount). Until now a booking recorded no price at all.
-- C. place_booking gains an optional p_variant_id (LAST, default null). The
--    old 10-argument function is dropped rather than overloaded: PostgREST
--    resolves by argument names, and two candidates that both accept the
--    deployed app's call would be ambiguous. The deployed app never sends
--    p_variant_id, so it keeps booking exactly as before.
--    With an option: it must belong to the service and be available; its
--    price (else the service price) and its duration (else the service
--    duration) are used; service_name records "Service — Option".
--    Everything else is the live 0174 body unchanged (marked -- 0321).

-- ---------------------------------------------------------------------------
-- A.
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists duration_minutes integer;
alter table public.product_variants
  drop constraint if exists product_variants_duration_check;
alter table public.product_variants
  add constraint product_variants_duration_check
  check (duration_minutes is null or duration_minutes between 5 and 480);

comment on column public.product_variants.duration_minutes is
  'A service option''s own duration in minutes (null = the service''s duration). 0321.';

-- ---------------------------------------------------------------------------
-- B.
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists price numeric(12,2);

create index if not exists bookings_variant_id_idx on public.bookings (variant_id);

comment on column public.bookings.variant_id is
  'The service option booked (0321); null for a service without options or an older booking.';
comment on column public.bookings.price is
  'The price the service (or its option) was booked at, before any coupon (bookings.discount). Null on bookings made before 0321.';

-- ---------------------------------------------------------------------------
-- C.
-- ---------------------------------------------------------------------------
drop function if exists public.place_booking(uuid, uuid, date, text, uuid, boolean, text, text, text, text);

create or replace function public.place_booking(
  p_store_id uuid,
  p_product_id uuid,
  p_date date,
  p_time text,
  p_doctor_id uuid default null,
  p_any boolean default false,
  p_customer_name text default null,
  p_phone text default null,
  p_notes text default null,
  p_coupon text default null,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_p record; v_mode text; v_slot int; v_dur int; v_buf int;
  v_start timestamptz; v_end timestamptz; v_doctor uuid := p_doctor_id;
  v_price numeric(12,2); v_discount numeric(12,2) := 0; v_coupon record;
  v_id uuid; v_cnt int; v_rules_exist boolean; v_ok_window boolean;
  v_var record; v_name text;                                    -- 0321
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'auth');
  end if;
  if p_date is null or p_time is null or length(trim(p_time)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_time');
  end if;

  select p.*, s.booking_slot_minutes as store_slot
    into v_p
  from public.products p join public.stores s on s.id = p.store_id
  where p.id = p_product_id and p.store_id = p_store_id
    and p.status = 'active' and p.deleted_at is null
    and s.status = 'active' and s.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'service_unavailable');
  end if;

  v_mode := v_p.booking_allocation_mode;
  v_slot := coalesce(v_p.store_slot, 30);
  v_dur  := coalesce(v_p.duration_minutes, v_slot);
  v_buf  := coalesce(v_p.buffer_minutes, 0);
  v_price := coalesce(v_p.discount_price, v_p.price);
  v_name := v_p.name;

  -- 0321: the chosen option sets the price, the duration and the label.
  if p_variant_id is not null then
    select v.id, v.label, v.price, v.duration_minutes
      into v_var
      from public.product_variants v
     where v.id = p_variant_id
       and v.product_id = p_product_id
       and v.is_available;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'option_unavailable');
    end if;
    v_dur := coalesce(v_var.duration_minutes, v_dur);
    v_price := coalesce(v_var.price, v_price);
    v_name := v_p.name || ' — ' || v_var.label;
  end if;

  v_start := (p_date + p_time::time) at time zone 'Asia/Beirut';
  v_end   := v_start + make_interval(mins => v_dur + v_buf);

  if v_mode = 'pooled_providers' and (p_any or v_doctor is null) then
    select d.id into v_doctor
    from public.doctors d
    where d.store_id = p_store_id
      and (not exists (select 1 from public.service_providers sp where sp.product_id = p_product_id)
           or exists (select 1 from public.service_providers sp
                      where sp.product_id = p_product_id and sp.doctor_id = d.id))
      and not exists (
        select 1 from public.bookings b
        where b.doctor_id = d.id
          and b.status in ('pending','accepted','scheduled')
          and b.starts_at is not null
          and tstzrange(b.starts_at, b.ends_at) && tstzrange(v_start, v_end)
      )
      and not exists (
        select 1 from public.provider_availability_exceptions x
        where x.doctor_id = d.id and x.on_date = p_date
          and (x.start_time is null
               or (v_start, v_end) overlaps
                  ((x.on_date + x.start_time) at time zone 'Asia/Beirut',
                   (x.on_date + x.end_time) at time zone 'Asia/Beirut'))
      )
      and (
        not exists (select 1 from public.provider_availability_rules r
                    where r.doctor_id = d.id and r.active)
        or exists (
          select 1 from public.provider_availability_rules r
          where r.doctor_id = d.id and r.active
            and r.weekday = extract(dow from p_date)::int
            and p_time::time >= r.start_time
            and (p_time::time + make_interval(mins => v_dur))::time <= r.end_time
        )
      )
    order by d.sort_order nulls last, d.id
    limit 1;
    if v_doctor is null then
      return jsonb_build_object('ok', false, 'code', 'no_provider_free');
    end if;
  end if;

  if v_doctor is not null then
    select exists (select 1 from public.provider_availability_rules r
                   where r.doctor_id = v_doctor and r.active) into v_rules_exist;
    if v_rules_exist then
      select exists (
        select 1 from public.provider_availability_rules r
        where r.doctor_id = v_doctor and r.active
          and r.weekday = extract(dow from p_date)::int
          and p_time::time >= r.start_time
          and (p_time::time + make_interval(mins => v_dur))::time <= r.end_time
      ) into v_ok_window;
      if not v_ok_window then
        return jsonb_build_object('ok', false, 'code', 'outside_hours');
      end if;
    end if;
    if exists (
      select 1 from public.provider_availability_exceptions x
      where x.doctor_id = v_doctor and x.on_date = p_date
        and (x.start_time is null
             or (v_start, v_end) overlaps
                ((x.on_date + x.start_time) at time zone 'Asia/Beirut',
                 (x.on_date + x.end_time) at time zone 'Asia/Beirut'))
    ) then
      return jsonb_build_object('ok', false, 'code', 'outside_hours');
    end if;
  end if;

  if v_mode = 'capacity_based' then
    perform pg_advisory_xact_lock(
      hashtext('booking_cap:' || p_product_id::text || ':' || v_start::text));
    select count(*) into v_cnt
    from public.bookings b
    where b.product_id = p_product_id
      and b.status in ('pending','accepted','scheduled')
      and b.starts_at is not null
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(v_start, v_end);
    if v_cnt >= coalesce(v_p.capacity_per_slot, 1) then
      return jsonb_build_object('ok', false, 'code', 'capacity_full');
    end if;
    v_doctor := null;
  end if;

  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    select * into v_coupon
    from public.validate_coupon(p_store_id, upper(trim(p_coupon)), coalesce(v_price, 0));
    if v_coupon.valid then v_discount := coalesce(v_coupon.discount, 0); end if;
  end if;

  begin
    insert into public.bookings (
      store_id, customer_id, product_id, service_name,
      requested_date, requested_time, customer_name, phone, notes,
      status, doctor_id, coupon_code, discount,
      starts_at, ends_at, allocation_mode,
      variant_id, price                                         -- 0321
    ) values (
      p_store_id, v_uid, p_product_id, v_name,
      p_date, trim(p_time), nullif(trim(coalesce(p_customer_name,'')),''),
      nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_notes,'')),''),
      'pending', v_doctor,
      case when v_discount > 0 then upper(trim(p_coupon)) end,
      coalesce(v_discount, 0),
      case when v_mode is null then null else v_start end,
      case when v_mode is null then null else v_end end,
      v_mode,
      p_variant_id, v_price
    ) returning id into v_id;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'code', 'slot_taken');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end
$function$;

comment on function public.place_booking(uuid, uuid, date, text, uuid, boolean, text, text, text, text, uuid) is
  'Book a service slot for the signed-in customer. p_variant_id (0321, optional) picks one of the service''s options: its price and duration apply.';

revoke all on function public.place_booking(uuid, uuid, date, text, uuid, boolean, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.place_booking(uuid, uuid, date, text, uuid, boolean, text, text, text, text, uuid) to authenticated;
-- ==== END MIGRATION 0321 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner uuid := gen_random_uuid();
  v_cust  uuid := gen_random_uuid();
  v_store uuid;
  v_svc   uuid;   -- a service: $20, 30 minutes
  v_other uuid;   -- another service of the same store
  v_short uuid;   -- option: $25, the service's duration
  v_long  uuid;   -- option: $40, 60 minutes
  v_off   uuid;   -- option switched off
  v_alien uuid;   -- an option of the OTHER service
  v_day   date := (now() at time zone 'Asia/Beirut')::date + 3;
  v_res   jsonb;
  v_b     record;
  res     jsonb := '[]'::jsonb;
begin
  insert into auth.users (id) values (v_owner), (v_cust);
  insert into public.stores (owner_id, name, status, plan, booking_slot_minutes)
    values (v_owner, '0321 Salon', 'active', 'free', 30) returning id into v_store;
  insert into public.products (store_id, name, price, is_available, item_kind,
                               booking_allocation_mode, duration_minutes, capacity_per_slot)
    values (v_store, '0321 Haircut', 20, true, 'service', 'capacity_based', 30, 5)
    returning id into v_svc;
  insert into public.products (store_id, name, price, is_available, item_kind)
    values (v_store, '0321 Colour', 50, true, 'service') returning id into v_other;
  insert into public.product_variants (product_id, label, price, sort_order)
    values (v_svc, 'Short', 25, 0) returning id into v_short;
  insert into public.product_variants (product_id, label, price, duration_minutes, sort_order)
    values (v_svc, 'Long', 40, 60, 1) returning id into v_long;
  insert into public.product_variants (product_id, label, price, is_available, sort_order)
    values (v_svc, 'Off', 99, false, 2) returning id into v_off;
  insert into public.product_variants (product_id, label, price)
    values (v_other, 'Alien', 1) returning id into v_alien;

  res := res || jsonb_build_array(jsonb_build_object('check', 'place_booking now has 11 arguments; the 10-argument one is gone',
    'ok', to_regprocedure('public.place_booking(uuid,uuid,date,text,uuid,boolean,text,text,text,text,uuid)') is not null
      and to_regprocedure('public.place_booking(uuid,uuid,date,text,uuid,boolean,text,text,text,text)') is null
      and (select count(*) from pg_proc p where p.proname = 'place_booking' and p.pronamespace = 'public'::regnamespace) = 1,
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'authenticated may book, anon may not',
    'ok', has_function_privilege('authenticated', 'public.place_booking(uuid,uuid,date,text,uuid,boolean,text,text,text,text,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.place_booking(uuid,uuid,date,text,uuid,boolean,text,text,text,text,uuid)', 'execute'),
    'got', 'checked'));
  begin
    insert into public.product_variants (product_id, label, duration_minutes) values (v_svc, 'Bad', 2);
    res := res || jsonb_build_array(jsonb_build_object('check', 'an option duration outside 5..480 is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'an option duration outside 5..480 is refused', 'ok', sqlstate = '23514', 'got', sqlstate));
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- The deployed app's call: named arguments, no p_variant_id.
  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day,
                                p_time => '10:00', p_customer_name => 'C', p_phone => '70000000');
  select b.* into v_b from public.bookings b where b.id = (v_res ->> 'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OLD CALL (no option): base price $20, 30 minutes, plain name',
    'ok', (v_res ->> 'ok')::boolean and v_b.price = 20 and v_b.variant_id is null
      and v_b.ends_at - v_b.starts_at = interval '30 minutes' and v_b.service_name = '0321 Haircut',
    'got', coalesce(v_res::text, 'null')));

  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day,
                                p_time => '11:00', p_variant_id => v_short);
  select b.* into v_b from public.bookings b where b.id = (v_res ->> 'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OPTION without its own duration: its price, the service''s 30 minutes',
    'ok', (v_res ->> 'ok')::boolean and v_b.price = 25 and v_b.variant_id = v_short
      and v_b.ends_at - v_b.starts_at = interval '30 minutes' and v_b.service_name = '0321 Haircut — Short',
    'got', coalesce(v_b.price::text, 'null') || ' / ' || coalesce(v_b.service_name, 'null')));

  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day,
                                p_time => '12:00', p_variant_id => v_long);
  select b.* into v_b from public.bookings b where b.id = (v_res ->> 'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('check', 'OPTION with its own duration: $40 and a 60-minute slot',
    'ok', (v_res ->> 'ok')::boolean and v_b.price = 40
      and v_b.ends_at - v_b.starts_at = interval '60 minutes',
    'got', coalesce(v_b.price::text, 'null') || ' / ' || coalesce((v_b.ends_at - v_b.starts_at)::text, 'null')));

  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day,
                                p_time => '13:00', p_variant_id => v_off);
  res := res || jsonb_build_array(jsonb_build_object('check', 'a switched-off option is refused',
    'ok', v_res ->> 'code' = 'option_unavailable', 'got', v_res::text));

  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day,
                                p_time => '13:00', p_variant_id => v_alien);
  res := res || jsonb_build_array(jsonb_build_object('check', 'another service''s option is refused (no cheap price borrowed)',
    'ok', v_res ->> 'code' = 'option_unavailable', 'got', v_res::text));

  v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day,
                                p_time => '13:00', p_variant_id => gen_random_uuid());
  res := res || jsonb_build_array(jsonb_build_object('check', 'an unknown option id is refused',
    'ok', v_res ->> 'code' = 'option_unavailable', 'got', v_res::text));

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    v_res := public.place_booking(p_store_id => v_store, p_product_id => v_svc, p_date => v_day, p_time => '14:00');
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot book', 'ok', false, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'ANON cannot book', 'ok', sqlstate = '42501', 'got', sqlstate));
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
