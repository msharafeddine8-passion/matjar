-- 0329: guest orders are capped per store, not only per phone.
--
-- guard_guest_order_rate (0053) allows 8 guest orders per phone number per hour.
-- The number is whatever the visitor types, so rotating fake numbers floods one
-- merchant with orders, pushes and stock reservations without limit. A store now
-- takes at most 40 guest orders an hour (no store has had a single guest order
-- yet, so this only stops floods); signed-in orders are untouched, and so are
-- guest bookings, which 0328 caps separately. The checkout already maps
-- 'rate_limited' to «tooManyOrders».

create index if not exists orders_guest_recent_idx
  on public.orders (store_id, created_at)
  where customer_id is null;

create or replace function public.guard_guest_order_rate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_norm text; v_count int;
begin
  if new.customer_id is null then
    if new.phone is not null then
      v_norm := regexp_replace(new.phone, '[^0-9]', '', 'g');
      select count(*) into v_count from public.orders
        where customer_id is null
          and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_norm
          and created_at > now() - interval '1 hour';
      if v_count >= 8 then
        raise exception 'rate_limited' using errcode = '53400';
      end if;
    end if;

    select count(*) into v_count from public.orders
      where customer_id is null
        and store_id = new.store_id
        and created_at > now() - interval '1 hour';
    if v_count >= 40 then
      raise exception 'rate_limited' using errcode = '53400';
    end if;
  end if;
  return new;
end $function$;
