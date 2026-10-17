-- 0323: close the INSERT-time integrity holes.
--
-- The platform-column guards (0217, 0060) and the money guard on orders fire on
-- UPDATE only, and the direct-INSERT policies that predate the checkout RPCs
-- were never dropped. Both holes were reproduced live on 2026-10-17 as an
-- ordinary signed-in customer, inside a transaction that was rolled back:
--
--   H1  POST /rest/v1/stores with plan='business', status='active',
--       is_verified, commercial_reg_verified, featured_until='2099-01-01',
--       rating 5.00 / 999 — every value persisted. A free, permanent paid plan,
--       no admin approval, fake trust badges and homepage placement.
--
--   H2  POST /rest/v1/orders and /rest/v1/bookings with status='completed' on a
--       store the user never bought from — both persisted, and
--       has_store_purchase() returned true, which is the gate for a "verified
--       purchase" review (reviews_insert_own, save_store_review,
--       set_review_verified_purchase). Review-bombing a competitor, or boosting
--       yourself, plus inflated sold/fulfilled counters.
--
-- Pattern (as in 0217): a SECURITY INVOKER guard that only acts when
-- current_user is a browser role, so SECURITY DEFINER RPCs, triggers, cron and
-- the service role pass through untouched.

-- ── H1. A browser can't create a store that is anything but a new store ─────
-- Named so it sorts BEFORE stores_grant_trial (BEFORE triggers fire in name
-- order): the trial trigger must see plan='free' and a null trial_ends_at to
-- grant the real 14-day trial.
create or replace function public.guard_store_insert_platform_columns()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- No browser writes the provenance of a status, not even an admin's.
  new.status_reason     := null;
  new.status_changed_at := null;
  new.status_changed_by := null;

  if public.is_super_admin() then
    return new;
  end if;

  -- Column defaults, i.e. what the create-store form gets by sending nothing.
  new.plan                    := 'free';
  new.status                  := 'pending';
  new.trial_ends_at           := null;   -- stores_grant_trial sets the real one
  new.is_verified             := false;
  new.commercial_reg_verified := false;
  new.featured_until          := null;
  new.rating_avg              := 0;
  new.rating_count            := 0;
  new.invoice_next_no         := 1;
  return new;
end
$function$;

drop trigger if exists stores_a_guard_insert_platform on public.stores;
create trigger stores_a_guard_insert_platform
  before insert on public.stores
  for each row execute function public.guard_store_insert_platform_columns();

-- ── H2a. Orders are created by the checkout RPCs only ───────────────────────
-- place_customer_order / place_guest_order (SECURITY DEFINER) are the only
-- writers; no client code and no SECURITY INVOKER function inserts here.
drop policy if exists orders_insert_customer on public.orders;
drop policy if exists order_items_insert on public.order_items;
revoke insert on public.orders, public.order_items from anon, authenticated;

-- ── H2b. A booking written from the browser starts life pending ─────────────
-- Four components still insert bookings directly (booking panel, timeslots,
-- classes, reservations); none of them sends a status. Whatever a browser
-- sends, the booking is a request until the merchant acts on it.
create or replace function public.guard_booking_insert_status()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_super_admin() then
    return new;
  end if;
  new.status                  := 'pending';
  new.attendance_confirmed_at := null;
  new.reminded_at             := null;
  return new;
end
$function$;

drop trigger if exists bookings_a_guard_insert_status on public.bookings;
create trigger bookings_a_guard_insert_status
  before insert on public.bookings
  for each row execute function public.guard_booking_insert_status();

-- ── H2c. You can't have "bought" from a shop you run ────────────────────────
-- An owner could book their own salon as a customer, then mark it completed
-- as the merchant (a legitimate status update), and post a verified review of
-- their own shop. Owners and staff never count as customers of that store.
create or replace function public.has_store_purchase(p_uid uuid, p_store uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select not exists (
           select 1 from public.stores s
           where s.id = p_store and s.owner_id = p_uid
         )
     and not exists (
           select 1 from public.store_staff st
           where st.store_id = p_store and st.user_id = p_uid
         )
     and (
           exists (
             select 1 from public.orders
             where customer_id = p_uid and store_id = p_store and status = 'completed'
           )
        or exists (
             select 1 from public.bookings
             where customer_id = p_uid and store_id = p_store and status = 'completed'
           )
         );
$function$;
