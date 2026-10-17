-- 0328: book an appointment without an account.
--
-- Orders have had a guest path since 0053; bookings still demanded sign-in, so a
-- salon/clinic visitor met a login wall at the last step. place_booking() now
-- takes a guest: no auth.uid(), but a name and a phone number the merchant can
-- call back. Everything else (slot rules, providers, capacity, coupons, the
-- exclusion constraints) is the same single code path.
--
-- Safe for guest rows (customer_id null), checked before writing this:
-- notify_booking_status and scan_booking_reminders already skip a null customer,
-- notify_new_booking only notifies the store, crm_capture_contact left-joins the
-- profile and keeps the typed name/phone, RLS "customer sees own" never matches
-- null, and guard_booking_insert_status forces 'pending' for browser inserts.
--
-- Abuse limits (guest only): 5 bookings per phone per hour, 30 guest bookings per
-- store per hour.

alter table public.bookings alter column customer_id drop not null;

create index if not exists bookings_guest_recent_idx
  on public.bookings (store_id, created_at)
  where customer_id is null;

do $mig$
declare def text; old_block text; new_block text;
begin
  select pg_get_functiondef('public.place_booking(uuid,uuid,date,text,uuid,boolean,text,text,text,text,uuid)'::regprocedure)
    into def;

  old_block := $o$  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'auth');
  end if;$o$;

  new_block := $n$  if v_uid is null then
    -- 0328: guest booking — a name and a reachable phone stand in for the account.
    if length(btrim(coalesce(p_customer_name, ''))) < 2 then
      return jsonb_build_object('ok', false, 'code', 'guest_name');
    end if;
    if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 7 then
      return jsonb_build_object('ok', false, 'code', 'guest_phone');
    end if;
    if (select count(*) from public.bookings b
        where b.customer_id is null
          and regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g')
              = regexp_replace(p_phone, '[^0-9]', '', 'g')
          and b.created_at > now() - interval '1 hour') >= 5
       or (select count(*) from public.bookings b
           where b.customer_id is null and b.store_id = p_store_id
             and b.created_at > now() - interval '1 hour') >= 30 then
      return jsonb_build_object('ok', false, 'code', 'rate_limited');
    end if;
  end if;$n$;

  if position(old_block in def) = 0 then
    raise exception 'place_booking: auth check not found — definition changed';
  end if;
  execute replace(def, old_block, new_block);
end
$mig$;

grant execute on function public.place_booking(uuid,uuid,date,text,uuid,boolean,text,text,text,text,uuid) to anon;
