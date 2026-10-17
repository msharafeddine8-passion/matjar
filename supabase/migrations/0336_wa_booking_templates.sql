-- 0336: the two new booking WhatsApp messages (declined, rescheduled) can be
-- customised and logged like the others.
--
-- The booking dashboard (2026-10-17) offers «booking_declined» and
-- «booking_rescheduled» one-taps, mainly for guests who get no in-app
-- notification. The 0309 CHECKs listed only the original seven keys, so these
-- two used default wording only and their taps were never logged ("last sent"
-- didn't stick). Widen both checks and the key/target pairing.

alter table public.store_wa_templates drop constraint store_wa_templates_key_check;
alter table public.store_wa_templates add constraint store_wa_templates_key_check
  check (key = any (array['order_confirmation','order_status','abandoned_cart','debt_reminder',
                          'booking_confirmation','booking_reminder','review_request',
                          'booking_declined','booking_rescheduled']));

alter table public.wa_action_log drop constraint wa_action_log_key_check;
alter table public.wa_action_log add constraint wa_action_log_key_check
  check (key = any (array['order_confirmation','order_status','abandoned_cart','debt_reminder',
                          'booking_confirmation','booking_reminder','review_request',
                          'booking_declined','booking_rescheduled']));

alter table public.wa_action_log drop constraint wa_action_log_key_matches_target;
alter table public.wa_action_log add constraint wa_action_log_key_matches_target
  check (
    (target_type = 'order' and key = any (array['order_confirmation','order_status','review_request']))
    or (target_type = 'booking' and key = any (array['booking_confirmation','booking_reminder','review_request',
                                                     'booking_declined','booking_rescheduled']))
    or (target_type = 'cart' and key = 'abandoned_cart')
    or (target_type = 'ledger_customer' and key = 'debt_reminder'));
