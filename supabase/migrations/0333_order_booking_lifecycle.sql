-- 0333: order and booking lifecycle fixes from the merchant re-audit (2026-10-17).
--
-- Orders
--   1. Cancelling the COURIER wiped the order's delivery fee (update_delivery_status
--      rewrote delivery_fee = 0 and the total) — the twin of the rewrite 0231
--      removed from request_delivery. Removed: a courier cancel no longer changes
--      what the customer agreed to pay.
--   2. Cancelling/rejecting the ORDER left the courier booked and the tracking
--      link live. Open delivery requests are now cancelled with it.
--   3. A cancelled/rejected order could be reopened by the merchant, after the
--      gift card, loyalty points and stock had already been given back — reopen
--      and complete re-awarded loyalty and drove stock negative. Cancelled and
--      rejected are now final for merchants, like completed (admins keep the
--      escape hatch, as before).
--   4. Status notifications carried only {order_id, status}: the merchant push
--      opened /ar/merchant/orders (no store id -> the store list) and every text
--      was "an order changed". They now carry store, ref, customer and total, the
--      push text names the new status, it opens the order list / the order, and
--      staff with the orders permission hear about a customer's cancellation.
--   5. CRM "total spent" summed every status — a cancelled $300 order made a VIP.
--      Spend now counts completed orders only (the order count is unchanged).
--
-- Bookings
--   6. A weekly class "filled up" forever: enforce_class_capacity counted every
--      active booking of the class across all dates. It now counts that date.
--   7. Status notifications get the same treatment as orders (store, customer,
--      service, date/time; status-aware text; bookings-permission staff).
--   8. reschedule_booking: any staff could move bookings (now the bookings
--      permission), a past start was accepted, and the reminder / attendance
--      confirmation of the old time carried over. Fixed.
--   9. booking_attendance_confirmed had no push text (fell to "عندك تحديث جديد").

-- ── 1. Courier cancel keeps the delivery fee ────────────────────────────────
do $mig$
declare def text; newdef text;
begin
  select pg_get_functiondef('public.update_delivery_status(uuid,text)'::regprocedure) into def;
  newdef := regexp_replace(def,
    'if p_status = ''cancelled'' then\s+update public\.orders.*?end if;',
    '-- 0333: a courier cancel no longer rewrites the order''s fee or total.');
  if newdef = def then
    raise exception 'update_delivery_status: fee-wipe block not found';
  end if;
  execute newdef;
end
$mig$;

-- ── 2. Order cancelled/rejected -> courier request cancelled ────────────────
create or replace function public.cancel_delivery_with_order()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status in ('cancelled', 'rejected')
     and old.status is distinct from new.status then
    update public.delivery_requests
       set status = 'cancelled', cancelled_at = now()
     where order_id = new.id
       and status not in ('delivered', 'cancelled');
  end if;
  return new;
end
$function$;

drop trigger if exists orders_cancel_delivery on public.orders;
create trigger orders_cancel_delivery
  after update of status on public.orders
  for each row execute function public.cancel_delivery_with_order();

-- ── 3. Cancelled / rejected are final for merchants ─────────────────────────
do $mig$
declare def text; old_t text; new_t text;
begin
  select pg_get_functiondef('public.guard_order_status_transition()'::regprocedure) into def;
  old_t := $o$  if old.status = 'completed' then$o$;
  new_t := $n$  -- 0333: a closed order stays closed — reopening it after the gift card,
  -- loyalty and stock were given back re-awarded loyalty and drove stock
  -- negative. Place a new order instead.
  if old.status in ('cancelled', 'rejected') then
    raise exception 'order_closed_is_final'
      using errcode = '42501',
            hint = 'A cancelled or rejected order can no longer be changed.';
  end if;

  if old.status = 'completed' then$n$;
  if position(old_t in def) = 0 then
    raise exception 'guard_order_status_transition: completed check not found';
  end if;
  execute replace(def, old_t, new_t);
end
$mig$;

-- ── 4. Order status notifications that say something ────────────────────────
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid; v_actor uuid; v_data jsonb;
begin
  if new.status is distinct from old.status then
    v_actor := auth.uid();
    select s.owner_id,
           jsonb_build_object(
             'order_id', new.id, 'status', new.status,
             'store_id', s.id, 'store_name', s.name,
             'ref', upper(left(new.id::text, 6)),
             'customer_name', nullif(btrim(coalesce(new.customer_name, '')), ''),
             'total', new.total)
      into v_owner, v_data
      from public.stores s where s.id = new.store_id;

    if new.customer_id is not null and new.customer_id is distinct from v_actor then
      insert into public.notifications (user_id, type, data)
      values (new.customer_id, 'order_status', v_data);
    end if;

    if v_owner is not null and v_owner is distinct from v_actor then
      insert into public.notifications (user_id, type, data)
      values (v_owner, 'order_status_merchant', v_data);
    end if;
    -- Staff who handle orders hear what the customer did (e.g. cancelled);
    -- never the person who made the change, never the owner twice.
    insert into public.notifications (user_id, type, data)
    select st.user_id, 'order_status_merchant', v_data
      from public.store_staff st
     where st.store_id = new.store_id
       and st.user_id is distinct from v_owner
       and st.user_id is distinct from v_actor
       and coalesce((st.permissions ->> 'orders')::boolean, false);
  end if;
  return new;
end;
$function$;

-- ── 5. CRM spend = completed orders ─────────────────────────────────────────
do $mig$
declare def text; old_t text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'store_customer_order_totals';
  old_t := 'coalesce(sum(o.total), 0)';
  if position(old_t in def) = 0 then
    raise exception 'store_customer_order_totals: sum(o.total) not found';
  end if;
  execute replace(def, old_t, $n$coalesce(sum(o.total) filter (where o.status = 'completed'), 0)$n$);
end
$mig$;

-- ── 6. Class capacity per date ──────────────────────────────────────────────
do $mig$
declare def text; old_t text;
begin
  select pg_get_functiondef('public.enforce_class_capacity()'::regprocedure) into def;
  old_t := $o$    and id is distinct from new.id;$o$;
  if position(old_t in def) = 0 then
    raise exception 'enforce_class_capacity: count filter not found';
  end if;
  execute replace(def, old_t, $n$    and id is distinct from new.id
    -- 0333: a weekly class fills up per session, not for ever.
    and requested_date is not distinct from new.requested_date;$n$);
end
$mig$;

-- ── 7. Booking status notifications ─────────────────────────────────────────
create or replace function public.notify_booking_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid; v_actor uuid; v_data jsonb;
begin
  if new.status is distinct from old.status then
    v_actor := auth.uid();
    select s.owner_id,
           jsonb_build_object(
             'booking_id', new.id, 'status', new.status,
             'store_id', s.id, 'store_name', s.name,
             'customer_name', nullif(btrim(coalesce(new.customer_name, '')), ''),
             'service_name', new.service_name,
             'requested_date', new.requested_date,
             'requested_time', new.requested_time)
      into v_owner, v_data
      from public.stores s where s.id = new.store_id;

    if new.customer_id is not null and new.customer_id is distinct from v_actor then
      insert into public.notifications (user_id, type, data)
      values (new.customer_id, 'booking_status', v_data);
    end if;

    if v_owner is not null and v_owner is distinct from v_actor then
      insert into public.notifications (user_id, type, data)
      values (v_owner, 'booking_status_merchant', v_data);
    end if;
    insert into public.notifications (user_id, type, data)
    select st.user_id, 'booking_status_merchant', v_data
      from public.store_staff st
     where st.store_id = new.store_id
       and st.user_id is distinct from v_owner
       and st.user_id is distinct from v_actor
       and coalesce((st.permissions ->> 'bookings')::boolean, false);
  end if;
  return new;
end;
$function$;

-- ── 8. reschedule_booking ───────────────────────────────────────────────────
do $mig$
declare def text; t1 text; t2 text; t3 text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'reschedule_booking';
  t1 := 'v_is_manager := public.can_manage_store(v_b.store_id);';
  t2 := $o$  v_end   := v_start + make_interval(mins => v_dur + v_buf);$o$;
  t3 := $o$      requested_time = trim(p_time),$o$;
  if position(t1 in def) = 0 or position(t2 in def) = 0 or position(t3 in def) = 0 then
    raise exception 'reschedule_booking: expected anchors not found';
  end if;
  def := replace(def, t1, $n$v_is_manager := public.staff_can(v_b.store_id, 'bookings');  -- 0333$n$);
  def := replace(def, t2, t2 || $n$

  -- 0333: never move a booking into the past.
  if v_start < now() then
    return jsonb_build_object('ok', false, 'code', 'past');
  end if;$n$);
  def := replace(def, t3, t3 || $n$
      -- 0333: the reminder and the attendance confirmation were for the old time.
      reminded_at = null,
      attendance_confirmed_at = null,$n$);
  execute def;
end
$mig$;

-- ── 4/7/9. Push text and links ──────────────────────────────────────────────
do $mig$
declare def text; r record;
begin
  select pg_get_functiondef('public.push_on_notification()'::regprocedure) into def;
  for r in select * from (values
    ($o$    when 'order_status_merchant' then v_title := 'تحديث طلب 🛒'; v_body := 'تغيّرت حالة طلب على متجرك'; v_url := v_m || '/orders';$o$,
     $n$    when 'order_status_merchant' then
      v_title := case new.data->>'status' when 'cancelled' then 'الزبون لغى طلب ❌' else 'تحديث طلب 🛒' end;
      v_body := coalesce(new.data->>'customer_name', 'زبون') || ' — طلب #' || coalesce(new.data->>'ref', '')
                || case new.data->>'status'
                     when 'cancelled' then ' انلغى'
                     when 'completed' then ' تمّ'
                     else ' صار: ' || coalesce(new.data->>'status', '') end;
      v_url := v_m || '/orders';$n$),
    ($o$    when 'booking_status_merchant' then v_title := 'تحديث حجز 📅'; v_body := 'تغيّرت حالة حجز على متجرك'; v_url := v_m || '/bookings';$o$,
     $n$    when 'booking_status_merchant' then
      v_title := case new.data->>'status' when 'cancelled' then 'انلغى موعد ❌' else 'تحديث حجز 📅' end;
      v_body := coalesce(new.data->>'customer_name', 'زبون')
                || case new.data->>'status' when 'cancelled' then ' لغى موعد ' else ' — موعد ' end
                || coalesce(new.data->>'service_name', '')
                || coalesce(' · ' || (new.data->>'requested_date') || ' ' || (new.data->>'requested_time'), '');
      v_url := v_m || '/bookings';$n$),
    ($o$    when 'order_status' then v_title := 'تحديث طلبك'; v_body := 'تغيّرت حالة طلبك'; v_url := '/ar/orders';$o$,
     $n$    when 'order_status' then
      v_title := coalesce(new.data->>'store_name', 'تحديث طلبك');
      v_body := case new.data->>'status'
                  when 'accepted' then 'قبلوا طلبك ✅'
                  when 'preparing' then 'عم يحضّرولك طلبك 👨‍🍳'
                  when 'ready' then 'طلبك جاهز 📦'
                  when 'out_for_delivery' then 'طلبك عالطريق 🛵'
                  when 'completed' then 'وصل طلبك — شو رأيك؟ ⭐'
                  when 'cancelled' then 'انلغى طلبك'
                  when 'rejected' then 'ما قدروا يقبلوا طلبك هالمرّة'
                  else 'تغيّرت حالة طلبك' end;
      v_url := case when new.data ? 'order_id' then '/ar/orders/' || (new.data->>'order_id') else '/ar/orders' end;$n$),
    ($o$    when 'booking_status' then v_title := 'تحديث حجزك'; v_body := 'تغيّرت حالة حجزك'; v_url := '/ar/bookings';$o$,
     $n$    when 'booking_status' then
      v_title := coalesce(new.data->>'store_name', 'تحديث حجزك');
      v_body := case new.data->>'status'
                  when 'accepted' then 'تأكّد موعدك ✅'
                  when 'scheduled' then 'تأكّد موعدك ✅'
                  when 'rejected' then 'ما قدروا يقبلوا موعدك — جرّب وقت تاني'
                  when 'cancelled' then 'انلغى موعدك'
                  when 'completed' then 'شكراً لزيارتك — قيّم تجربتك ⭐'
                  when 'no_show' then 'انسجّل إنك ما حضرت موعدك'
                  else 'تغيّرت حالة حجزك' end
                || coalesce(' · ' || (new.data->>'service_name'), '');
      v_url := '/ar/bookings';$n$)
  ) v(old_t, new_t) loop
    if position(r.old_t in def) = 0 then
      raise exception 'push_on_notification: branch not found: %', left(r.old_t, 60);
    end if;
    def := replace(def, r.old_t, r.new_t);
  end loop;

  -- 9. attendance confirmed (new branch, placed before the rescheduled one)
  def := replace(def,
    $o$    when 'booking_rescheduled_merchant' then$o$,
    $n$    when 'booking_attendance_confirmed' then
      v_title := 'أكّد حضوره ✅';
      v_body := coalesce(new.data->>'customer_name', 'زبون') || ' أكّد إنه جايي'
                || coalesce(' · ' || (new.data->>'service_name'), '');
      v_url := v_m || '/bookings';
    when 'booking_rescheduled_merchant' then$n$);
  execute def;
end
$mig$;
