-- 0327: a new order or booking tells the merchant what it is and opens it.
--
-- Before: the push for a new order read «وصلك طلب جديد على متجرك» — no amount,
-- no customer, no reference — and opened /ar/merchant, the LIST OF STORES, three
-- taps away from the order. Six other request types (lead, stay, rental, ticket,
-- membership, enrolment) fell through to «عندك تحديث جديد» → /ar/notifications.
-- And only the store OWNER was ever notified: staff given the orders or bookings
-- permission never heard about anything.
--
-- Now:
--   * order_new carries total, customer name and a short reference; booking_new
--     carries customer name, date and time;
--   * both also go to every staff member holding the matching permission;
--   * every merchant-facing push deep-links into that store's page for it.

create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid; v_store_name text; v_data jsonb;
begin
  select owner_id, name into v_owner, v_store_name
    from public.stores where id = new.store_id;

  v_data := jsonb_build_object(
    'order_id', new.id,
    'store_id', new.store_id,
    'store_name', v_store_name,
    'total', new.total,
    'customer_name', nullif(btrim(coalesce(new.customer_name, '')), ''),
    'ref', upper(left(new.id::text, 6)));

  if v_owner is not null then
    insert into public.notifications (user_id, type, data)
    values (v_owner, 'order_new', v_data);
  end if;

  -- Staff who handle orders hear about them too (never the owner twice).
  insert into public.notifications (user_id, type, data)
  select st.user_id, 'order_new', v_data
  from public.store_staff st
  where st.store_id = new.store_id
    and st.user_id is distinct from v_owner
    and coalesce((st.permissions ->> 'orders')::boolean, false);

  if new.customer_id is not null and new.customer_id is distinct from v_owner then
    insert into public.notifications (user_id, type, data)
    values (new.customer_id, 'order_placed', jsonb_build_object('order_id', new.id));
  end if;
  return new;
end; $function$;

create or replace function public.notify_new_booking()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid; v_data jsonb;
begin
  select s.owner_id,
         jsonb_build_object(
           'booking_id', new.id,
           'store_id', s.id,
           'store_name', s.name,
           'service_name', new.service_name,
           'customer_name', nullif(btrim(coalesce(new.customer_name, '')), ''),
           'requested_date', new.requested_date,
           'requested_time', new.requested_time)
    into v_owner, v_data
  from public.stores s where s.id = new.store_id;

  if v_owner is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, data)
  values (v_owner, 'booking_new', v_data);

  insert into public.notifications (user_id, type, data)
  select st.user_id, 'booking_new', v_data
  from public.store_staff st
  where st.store_id = new.store_id
    and st.user_id is distinct from v_owner
    and coalesce((st.permissions ->> 'bookings')::boolean, false);

  return new;
end; $function$;

create or replace function public.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_title text; v_body text; v_url text; v_lid text; v_reason text;
  v_store text := new.data->>'store_id';
  v_m text;      -- this store's dashboard, or the store list when unknown
  v_who text := coalesce(nullif(btrim(coalesce(new.data->>'customer_name', '')), ''), 'زبون');
  v_amount text;
begin
  v_m := case when v_store is not null then '/ar/merchant/' || v_store else '/ar/merchant' end;
  v_lid := new.data->>'listing_id';
  v_reason := nullif(btrim(coalesce(new.data->>'reason', '')), '');
  if char_length(coalesce(v_reason, '')) > 120 then
    v_reason := left(v_reason, 119) || '…';
  end if;
  if new.data ? 'total' then
    v_amount := '$' || regexp_replace(to_char((new.data->>'total')::numeric, 'FM999999990.00'), '\.00$', '');
  end if;

  case new.type
    -- ── merchant: new things to act on ─────────────────────────────────────
    when 'order_new' then
      v_title := 'طلب جديد 🛒' || coalesce(' · ' || v_amount, '');
      v_body  := v_who || ' طلب من ' || coalesce(new.data->>'store_name', 'متجرك')
                 || coalesce(' — #' || (new.data->>'ref'), '');
      v_url   := v_m || '/orders';
    when 'booking_new' then
      v_title := 'حجز جديد 📅';
      v_body  := v_who || ' حجز ' || coalesce(new.data->>'service_name', 'موعد')
                 || coalesce(' — ' || (new.data->>'requested_date')
                    || coalesce(' ' || left(new.data->>'requested_time', 5), ''), '');
      v_url   := v_m || '/bookings';
    when 'lead_new' then v_title := 'استفسار جديد 💬'; v_body := 'حدا مهتم وعم يستفسر — ردّ عليه بسرعة'; v_url := v_m || '/leads';
    when 'stay_new' then v_title := 'حجز إقامة جديد 🏨'; v_body := 'وصلك طلب حجز إقامة'; v_url := v_m || '/stays';
    when 'rental_new' then v_title := 'حجز سيارة جديد 🚗'; v_body := 'وصلك طلب استئجار'; v_url := v_m || '/rentals';
    when 'ticket_new' then v_title := 'تذاكر مبيعة 🎟️'; v_body := 'حدا اشترى تذاكر لفعاليّتك'; v_url := v_m || '/tickets';
    when 'membership_new' then v_title := 'اشتراك جديد 💪'; v_body := 'حدا اشترك بخطّة عندك'; v_url := v_m || '/members';
    when 'enroll_new' then v_title := 'تسجيل جديد 🎓'; v_body := 'حدا سجّل بدورة عندك'; v_url := v_m || '/courses';
    when 'service_request_new' then v_title := 'طلب خدمة جديد 🧰'; v_body := v_who || ' طالب خدمة — ابعتلو عرض سعر'; v_url := v_m || '/requests';
    when 'service_countered' then v_title := 'عرض مضاد من زبون'; v_body := 'الزبون ردّ على عرضك'; v_url := v_m || '/requests';
    when 'service_accepted' then v_title := 'الزبون قبل عرضك ✅'; v_body := 'اتّفقتو — تواصل معو للتنفيذ'; v_url := v_m || '/requests';
    when 'order_status_merchant' then v_title := 'تحديث طلب 🛒'; v_body := 'تغيّرت حالة طلب على متجرك'; v_url := v_m || '/orders';
    when 'booking_status_merchant' then v_title := 'تحديث حجز 📅'; v_body := 'تغيّرت حالة حجز على متجرك'; v_url := v_m || '/bookings';
    when 'booking_rescheduled_merchant' then v_title := 'تغيّر موعد حجز 📅'; v_body := 'زبون غيّر موعد حجزه'; v_url := v_m || '/bookings';
    when 'trial_ending' then v_title := 'تجربتك المجّانيّة قربت تخلص ⏳'; v_body := 'رقّي باقتك لتضلّ كل الميزات شغّالة'; v_url := v_m || '/subscription';
    when 'trial_ended' then v_title := 'انتهت تجربتك المجّانيّة'; v_body := 'شوف شو تغيّر وكيف ترجّع كل شي'; v_url := v_m || '/subscription';
    when 'store_approved' then v_title := 'متجرك صار منشور 🎉'; v_body := coalesce(new.data->>'store_name','متجرك') || ' ظاهر للزبائن — ضيف منتجاتك'; v_url := v_m;
    when 'store_rejected' then v_title := 'بخصوص متجرك'; v_body := 'ما قدرنا ننشر ' || coalesce(new.data->>'store_name','متجرك') || ' — تواصل معنا لنساعدك'; v_url := v_m;
    when 'store_suspended' then v_title := 'تم إيقاف متجرك مؤقتاً'; v_body := coalesce(new.data->>'store_name','متجرك') || ' موقوف مؤقتاً' || coalesce(': ' || v_reason, '') || ' — تواصل معنا'; v_url := v_m;
    when 'store_transferred' then v_title := 'صار عندك متجر جديد'; v_body := 'انتقلت إليك ملكيّة ' || coalesce(new.data->>'store_name','متجر'); v_url := v_m;

    -- ── customer ───────────────────────────────────────────────────────────
    when 'order_placed' then v_title := 'تمّ استلام طلبك ✅'; v_body := 'طلبك قيد المعالجة عند التاجر'; v_url := '/ar/orders';
    when 'order_status' then v_title := 'تحديث طلبك'; v_body := 'تغيّرت حالة طلبك'; v_url := '/ar/orders';
    when 'booking_placed' then v_title := 'تمّ استلام حجزك ✅'; v_body := 'حجزك قيد تأكيد التاجر'; v_url := '/ar/bookings';
    when 'booking_status' then v_title := 'تحديث حجزك'; v_body := 'تغيّرت حالة حجزك'; v_url := '/ar/bookings';
    when 'booking_reminder' then v_title := 'تذكير بموعدك ⏰'; v_body := 'عندك موعد قريب'; v_url := '/ar/bookings';
    when 'booking_rescheduled' then v_title := 'تغيّر موعدك 📅'; v_body := 'التاجر غيّر موعد حجزك'; v_url := '/ar/bookings';
    when 'service_quote' then v_title := 'وصلك عرض سعر 💬'; v_body := coalesce(new.data->>'store_name','المتجر') || ' بعتلك عرض'; v_url := case when v_store is not null then '/ar/store/' || v_store else '/ar/notifications' end;
    when 'service_declined' then v_title := 'بخصوص طلبك'; v_body := coalesce(new.data->>'store_name','المتجر') || ' ما قدر يقبل طلبك'; v_url := case when v_store is not null then '/ar/store/' || v_store else '/ar/notifications' end;
    when 'service_completed' then v_title := 'خلصت الخدمة ✅'; v_body := 'شو رأيك؟ قيّم تجربتك'; v_url := case when v_store is not null then '/ar/store/' || v_store else '/ar/notifications' end;
    when 'store_product' then v_title := 'منتج جديد'; v_body := 'متجر بتتابعه نزّل منتج جديد'; v_url := '/ar';
    when 'price_drop' then v_title := 'انخفض السعر 🔻'; v_body := coalesce(new.data->>'product_name','منتج بقائمة رغباتك') || ' صار بسعر ' || coalesce(new.data->>'new_price','أقل'); v_url := coalesce('/ar/product/'||(new.data->>'product_id'), '/ar/wishlist');
    when 'listing_approved' then v_title := 'إعلانك منشور ✅'; v_body := 'إعلانك ظاهر بسوق الأحد'; v_url := coalesce('/ar/market/'||v_lid,'/ar/account');
    when 'listing_rejected' then v_title := 'إعلانك'; v_body := 'انشال إعلانك من سوق الأحد'; v_url := '/ar/account';
    when 'listing_match' then v_title := 'إعلان جديد 🔔'; v_body := 'إعلان جديد يطابق بحثك المحفوظ'; v_url := coalesce('/ar/market/'||v_lid,'/ar/market');
    when 'message' then v_title := 'رسالة جديدة 💬'; v_body := 'وصلتك رسالة جديدة'; v_url := '/ar/messages';
    when 'job_application' then v_title := 'طلب توظيف جديد 📄'; v_body := 'حدا قدّم على وظيفتك'; v_url := '/ar/jobs/mine';

    -- ── platform admin ─────────────────────────────────────────────────────
    when 'store_new' then v_title := 'متجر جديد انضمّ 🏪'; v_body := coalesce(new.data->>'store_name','متجر جديد') || ' — صار منشور، تابِعه'; v_url := '/ar/admin/stores';
    when 'pro_request' then v_title := 'طلب ترقية 💎'; v_body := coalesce(new.data->>'store_name','متجر') || ' بدّو يرقّي باقته'; v_url := '/ar/admin/stores';
    when 'leader_submission' then v_title := 'اقتراح رجل أعمال'; v_body := 'وصل اقتراح جديد للمراجعة'; v_url := '/ar/admin/leaders';

    -- ── authored messages ──────────────────────────────────────────────────
    when 'automation' then v_title := coalesce(new.data->>'title','متجر'); v_body := coalesce(new.data->>'body',''); v_url := coalesce(new.data->>'url','/ar/notifications');
    when 'store_campaign' then v_title := coalesce(new.data->>'title','متجر'); v_body := coalesce(new.data->>'body',''); v_url := coalesce(new.data->>'url','/ar/notifications');
    when 'admin_broadcast' then v_title := coalesce(new.data->>'title','متجر 📢'); v_body := coalesce(new.data->>'body',''); v_url := coalesce(new.data->>'url','/ar/notifications');
    else v_title := 'متجر'; v_body := 'عندك تحديث جديد'; v_url := '/ar/notifications';
  end case;
  perform public.notify_push(new.user_id, v_title, v_body, v_url);
  return new;
end
$function$;
