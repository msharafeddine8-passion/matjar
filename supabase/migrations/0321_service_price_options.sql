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
