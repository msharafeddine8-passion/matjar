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
