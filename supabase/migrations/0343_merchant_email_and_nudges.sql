-- 0343 — Merchant e-mail alerts and reminder nudges.
--
-- 1. Every merchant-facing "something came in" notification (order, booking,
--    service request, enquiry, stay, rental, tickets, membership, enrolment)
--    is also e-mailed to the account it was addressed to — owner or permitted
--    staff — through /api/email/hook. Same pg_net + shared-secret pattern as
--    notify_push (0337); the app decides the wording and the provider.
-- 2. scan_merchant_nudges() runs daily and reminds owners of real (non-
--    directory) stores that are still empty, or that nobody has touched for a
--    week. At most three reminders of each kind per store, spaced apart, and an
--    owner can opt out of reminders (never of order alerts) from the e-mail.

-- ---------------------------------------------------------------- tables
create table if not exists public.merchant_nudges (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('empty', 'inactive')),
  sent_at timestamptz not null default now()
);
create index if not exists merchant_nudges_store_idx on public.merchant_nudges (store_id, sent_at desc);
alter table public.merchant_nudges enable row level security;
revoke all on public.merchant_nudges from public, anon, authenticated;

create table if not exists public.email_optouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.email_optouts enable row level security;
revoke all on public.email_optouts from public, anon, authenticated;

-- ---------------------------------------------------------------- the hook
create or replace function public.email_on_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_secret text; v_base text;
begin
  select value into v_secret from private.app_config where key = 'push_hook_secret';
  select value into v_base from private.app_config where key = 'site_url';
  if v_secret is null or v_base is null then
    raise warning 'email_on_notification: config missing — e-mail for % dropped', new.id;
    return new;
  end if;
  perform net.http_post(
    url := v_base || '/api/email/hook',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
end $function$;
revoke all on function public.email_on_notification() from public, anon, authenticated;

drop trigger if exists notifications_email on public.notifications;
create trigger notifications_email
  after insert on public.notifications
  for each row
  when (
    new.type in ('order_new', 'booking_new', 'service_request_new', 'lead_new',
                 'stay_new', 'rental_new', 'ticket_new', 'membership_new', 'enroll_new')
    or (new.type = 'automation' and new.data->>'kind' = 'merchant_nudge')
  )
  execute function public.email_on_notification();

-- What the hook needs to write one e-mail: the recipient address, the
-- notification itself, and whether that person opted out of reminders.
-- service_role only — it hands out an e-mail address for any id.
create or replace function public.email_payload(p_notification_id uuid)
returns table (email text, type text, data jsonb, opted_out boolean, user_id uuid)
language sql
stable
security definer
set search_path to ''
as $function$
  select u.email::text, n.type, n.data,
         exists (select 1 from public.email_optouts o where o.user_id = n.user_id),
         n.user_id
  from public.notifications n
  join auth.users u on u.id = n.user_id
  where n.id = p_notification_id;
$function$;
revoke all on function public.email_payload(uuid) from public, anon, authenticated;
grant execute on function public.email_payload(uuid) to service_role;

create or replace function public.email_optout(p_uid uuid)
returns void
language sql
security definer
set search_path to ''
as $function$
  insert into public.email_optouts (user_id) values (p_uid) on conflict do nothing;
$function$;
revoke all on function public.email_optout(uuid) from public, anon, authenticated;
grant execute on function public.email_optout(uuid) to service_role;

-- Called by the hook after its first successful send: reminders may start.
create or replace function public.email_mark_enabled()
returns void
language sql
security definer
set search_path to ''
as $function$
  insert into private.app_config (key, value) values ('email_enabled', '1')
  on conflict (key) do update set value = '1';
$function$;
revoke all on function public.email_mark_enabled() from public, anon, authenticated;
grant execute on function public.email_mark_enabled() to service_role;

-- ---------------------------------------------------------------- nudges
create or replace function public.scan_merchant_nudges()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_sent integer := 0;
  v_title text; v_body text; v_url text;
begin
  -- Reminders are capped at three per kind, so spending them while no e-mail
  -- provider is configured would waste them. The app flips this key on once a
  -- test e-mail has actually gone out (see /api/email/hook).
  if not exists (select 1 from private.app_config where key = 'email_enabled' and value = '1') then
    return 0;
  end if;
  for r in
    with base as (
      select s.id, s.name, s.owner_id, s.created_at,
             not exists (select 1 from public.products p where p.store_id = s.id and p.deleted_at is null)
               and not exists (select 1 from public.doctors d where d.store_id = s.id)
               and not exists (select 1 from public.rental_vehicles v where v.store_id = s.id) as is_empty,
             greatest(
               u.last_sign_in_at,
               s.updated_at,
               (select max(p.updated_at) from public.products p where p.store_id = s.id)
             ) as last_touch
      from public.stores s
      join auth.users u on u.id = s.owner_id
      where s.data_source is null
        and s.deleted_at is null
        and s.status in ('pending', 'active')
        and s.created_at < now() - interval '1 day'
        and not exists (select 1 from public.email_optouts o where o.user_id = s.owner_id)
    )
    select b.*,
           case when b.is_empty then 'empty'
                when b.last_touch < now() - interval '7 days' then 'inactive'
           end as kind
    from base b
  loop
    continue when r.kind is null;
    -- three of a kind at most, and never two reminders of any kind too close
    continue when (select count(*) from public.merchant_nudges n
                   where n.store_id = r.id and n.kind = r.kind) >= 3;
    continue when exists (select 1 from public.merchant_nudges n
                          where n.store_id = r.id
                            and n.sent_at > now() - case when r.kind = 'empty'
                                                         then interval '3 days'
                                                         else interval '14 days' end);

    v_url := '/ar/merchant/' || r.id;
    if r.kind = 'empty' then
      v_title := 'متجرك لسّا فاضي 🛍️';
      v_body := coalesce(r.name, 'متجرك') || ' جاهز، بس ما فيه ولا منتج. ضيف أول منتج أو خدمة بدقيقة، وخلّي الزباين يشوفوك.';
      v_url := v_url || '/products';
    else
      v_title := 'زباينك عم يدوّروا عليك 👀';
      v_body := 'صرلك فترة ما فتت على ' || coalesce(r.name, 'متجرك') || '. حدّث أسعارك وصورك، وشوف إذا وصلك شي جديد.';
    end if;

    insert into public.notifications (user_id, type, data)
    values (r.owner_id, 'automation', jsonb_build_object(
      'kind', 'merchant_nudge', 'nudge', r.kind,
      'store_id', r.id, 'store_name', r.name,
      'title', v_title, 'body', v_body, 'url', v_url));
    insert into public.merchant_nudges (store_id, kind) values (r.id, r.kind);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $function$;
revoke all on function public.scan_merchant_nudges() from public, anon, authenticated;

-- 10:00 Beirut (07:00 UTC in summer, 08:00 in winter — either is fine)
select cron.unschedule('matjar-merchant-nudges')
where exists (select 1 from cron.job where jobname = 'matjar-merchant-nudges');
select cron.schedule('matjar-merchant-nudges', '0 7 * * *', 'select public.scan_merchant_nudges();');
