-- 0312 — Customer source attribution + the first-party analytics taxonomy.
--
-- ZERO RECURRING COST. Everything here lives in Matjar's own Postgres: no
-- Vercel Analytics custom events, no SaaS, no AI. REPORTING ONLY — Matjar
-- charges 0% commission, and nothing here computes, stores or implies a fee.
--
-- What it adds:
--
--   1. orders.source / orders.source_detail, bookings.source /
--      bookings.source_detail — which surface brought the customer. The
--      vocabulary mirrors ATTRIBUTION_SOURCES in src/lib/attribution.ts:
--        matjar_directory, matjar_search, matjar_map, sunday_market,
--        offers_page, direct_link, instagram, whatsapp, google, unknown
--      NULL means "never tagged" (placed before this migration, or the
--      customer's browser did not report back) and is shown as its own
--      bucket — it is never folded into a guess.
--
--   2. tag_order_source(...) / tag_booking_source(...) — the ONLY way the
--      columns are written. The checkout RPCs are not touched (their
--      signatures are a contract with the deployed app, and checkout belongs
--      to another change); the confirmation screen tags the row AFTER it
--      exists. Why this is safe enough is written above each function.
--
--   3. guard_attribution_columns — a SECURITY INVOKER trigger in the house
--      pattern (current_user in ('authenticated','anon') is a browser role; a
--      SECURITY DEFINER RPC runs as its owner and passes). A browser role can
--      never write the columns directly, on insert or on update, so a merchant
--      cannot re-label their own orders as "Matjar brought this" and a
--      customer cannot write into someone else's report.
--
--   4. store_attribution_report(store, 'YYYY-MM') — per source, for one
--      Beirut calendar month: orders, bookings, NEW customers (computed, never
--      stored), the value of those new customers' first orders. No customer
--      name, phone or id ever leaves the function — aggregates only.
--
--   5. product_events + log_event(...) / log_events(text) — the §34 analytics
--      taxonomy. Insert-only through a rate-limited SECURITY DEFINER RPC with
--      a whitelist of event names; only short slug-like tokens and ids are
--      accepted, so a phone, an email, a name or free text has nowhere to go.
--      Readable by platform admins only.
--
-- NEW vs RETURNING (item 4): an interaction (a non-cancelled, non-rejected
-- order or booking) is from a RETURNING customer when the same person has an
-- EARLIER non-cancelled, non-rejected order or booking at the same store —
-- "the same person" meaning the same customer_id, or the same normalised phone
-- (public.wa_phone_key from 0309, mirrored by phoneKey() in
-- src/lib/wa-templates.ts). An interaction with neither a customer_id nor a
-- usable phone cannot be matched and is counted as UNIDENTIFIED — never as new.
--
-- NO PLAN CHECK anywhere, on purpose: attribution is on every plan
-- (FEATURES.sourceAttribution in src/lib/feature-availability.ts).
--
-- SAFE BEFORE AND AFTER: the app calls every function here defensively and
-- ignores failures. Before this is applied the confirmation screen's tag call
-- and the event beacon fail silently, and the dashboard card and the summary
-- page say the report is not available yet. Nothing under src/ breaks when
-- these objects are missing.
--
-- Verification: supabase/tests/0312_attribution_events.test.sql (rolled back).


-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists source text
    constraint orders_source_check check (source is null or source in (
      'matjar_directory', 'matjar_search', 'matjar_map', 'sunday_market',
      'offers_page', 'direct_link', 'instagram', 'whatsapp', 'google', 'unknown'
    ));
alter table public.orders
  add column if not exists source_detail text
    constraint orders_source_detail_check
      check (source_detail is null or char_length(source_detail) <= 160);

alter table public.bookings
  add column if not exists source text
    constraint bookings_source_check check (source is null or source in (
      'matjar_directory', 'matjar_search', 'matjar_map', 'sunday_market',
      'offers_page', 'direct_link', 'instagram', 'whatsapp', 'google', 'unknown'
    ));
alter table public.bookings
  add column if not exists source_detail text
    constraint bookings_source_detail_check
      check (source_detail is null or char_length(source_detail) <= 160);

comment on column public.orders.source is
  'Where the customer came from (src/lib/attribution.ts). NULL = never tagged. Written only by tag_order_source(); a browser role cannot set it.';
comment on column public.orders.source_detail is
  'Short machine detail for source: utm_campaign / referrer host / first-touch source. Never a customer name, phone or free text; 160 chars max.';
comment on column public.bookings.source is
  'Where the customer came from (src/lib/attribution.ts). NULL = never tagged. Written only by tag_booking_source(); a browser role cannot set it.';
comment on column public.bookings.source_detail is
  'Short machine detail for source (see orders.source_detail).';


-- ---------------------------------------------------------------------------
-- 2. Only the tagging RPCs may write the columns
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: it only has to know WHO is writing. A browser
-- role (anon / authenticated) gets its value silently discarded — on insert
-- it becomes NULL, on update it stays what it was — so an existing screen that
-- updates an order or a booking keeps working exactly as before.
create or replace function public.guard_attribution_columns()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.source := null;
    new.source_detail := null;
  else
    new.source := old.source;
    new.source_detail := old.source_detail;
  end if;
  return new;
end
$function$;
revoke all on function public.guard_attribution_columns() from public, anon, authenticated;

drop trigger if exists orders_guard_attribution on public.orders;
create trigger orders_guard_attribution
  before insert or update on public.orders
  for each row execute function public.guard_attribution_columns();

drop trigger if exists bookings_guard_attribution on public.bookings;
create trigger bookings_guard_attribution
  before insert or update on public.bookings
  for each row execute function public.guard_attribution_columns();


-- ---------------------------------------------------------------------------
-- 3. Detail sanitiser (shared by both tagging RPCs)
-- ---------------------------------------------------------------------------
-- Keeps only characters a UTM value, a host name or a source token needs.
-- Anything else — Arabic, spaces beyond one, @, quotes — is dropped, which is
-- what makes "free text" and "an email address" impossible to smuggle in.
create or replace function public.attribution_detail(p_detail text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(left(regexp_replace(coalesce(p_detail, ''), '[^A-Za-z0-9_.:=;,/+-]', '', 'g'), 160), '');
$function$;
revoke all on function public.attribution_detail(text) from public, anon, authenticated;
grant execute on function public.attribution_detail(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. tag_order_source — called by the confirmation screen
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE ENOUGH TO GIVE TO anon:
--   * It can only WRITE a label, once. It sets source/source_detail on one
--     order whose source is still NULL; a second call (or anybody else's) is
--     a no-op. It never reads anything back except "did it take" (boolean).
--   * Only within 15 minutes of the order being created — the confirmation
--     screen calls it within seconds. An order older than that is frozen.
--   * Ownership: a signed-in caller may tag only an order whose customer_id is
--     them, or a guest order (customer_id NULL — the same person may have
--     checked out as a guest). An anonymous caller may tag only a guest order.
--     Nobody can tag another signed-in customer's order.
--   * The order id is a random UUID the placing browser received from the
--     checkout RPC. It is not enumerable; guessing one inside a 15-minute
--     window is not a realistic attack.
--   * p_store_id, when given, must be the order's store — the client sends the
--     store the touch was recorded for, so a touch from shop A can never label
--     an order at shop B.
--   * Worst case if all of the above were beaten: one order in one merchant's
--     report shows the wrong source. No money, status, stock, customer data or
--     permission moves. The label is reporting-only and says so everywhere.
--   * The value is whitelisted (the CHECK constraint says the same) and the
--     detail is sanitised and capped.
create or replace function public.tag_order_source(
  p_order_id uuid,
  p_source text,
  p_detail text default null,
  p_store_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if p_order_id is null or p_source is null or p_source not in (
    'matjar_directory', 'matjar_search', 'matjar_map', 'sunday_market',
    'offers_page', 'direct_link', 'instagram', 'whatsapp', 'google', 'unknown'
  ) then
    return false;
  end if;

  update public.orders o
     set source = p_source,
         source_detail = public.attribution_detail(p_detail)
   where o.id = p_order_id
     and o.source is null
     and o.created_at > now() - interval '15 minutes'
     and (p_store_id is null or o.store_id = p_store_id)
     and (
       o.customer_id is null
       or (v_uid is not null and o.customer_id = v_uid)
     )
  returning o.id into v_id;

  return v_id is not null;
end
$function$;

comment on function public.tag_order_source(uuid, text, text, uuid) is
  'Labels ONE order with where its customer came from. Only while source is null, only within 15 minutes of creation, only your own order (or a guest order). Reporting only.';

revoke all on function public.tag_order_source(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.tag_order_source(uuid, text, text, uuid) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. tag_booking_source — called by the booking confirmation
-- ---------------------------------------------------------------------------
-- A booking always has a signed-in customer (bookings.customer_id is NOT
-- NULL), so this needs no id at all: it labels the CALLER's own untagged
-- bookings at that store created in the last 15 minutes. That covers both the
-- place_booking path (which returns an id) and the legacy direct insert (which
-- does not) with one call and no change to either. Same safety argument as
-- above, tighter: anon cannot call it, and it only ever touches the caller's
-- own rows.
create or replace function public.tag_booking_source(
  p_store_id uuid,
  p_source text,
  p_detail text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_n integer;
begin
  if v_uid is null or p_store_id is null or p_source is null or p_source not in (
    'matjar_directory', 'matjar_search', 'matjar_map', 'sunday_market',
    'offers_page', 'direct_link', 'instagram', 'whatsapp', 'google', 'unknown'
  ) then
    return 0;
  end if;

  update public.bookings b
     set source = p_source,
         source_detail = public.attribution_detail(p_detail)
   where b.store_id = p_store_id
     and b.customer_id = v_uid
     and b.source is null
     and b.created_at > now() - interval '15 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

comment on function public.tag_booking_source(uuid, text, text) is
  'Labels the CALLER''s own untagged bookings at a store from the last 15 minutes with where they came from. Reporting only.';

revoke all on function public.tag_booking_source(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tag_booking_source(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. store_attribution_report — the merchant's month, by source
-- ---------------------------------------------------------------------------
-- p_month is a Beirut calendar month 'YYYY-MM'; the range is computed here in
-- Asia/Beirut so the server's UTC day can never move an order across months.
--
-- One row per source seen that month ('untagged' for NULL). Columns:
--   n_orders / n_bookings   interactions that month (not cancelled/rejected)
--   new_customers           interactions whose person had NO earlier
--                           non-cancelled order or booking at this store
--   returning_count         interactions whose person had one
--   unidentified_count      no customer_id and no usable phone: unknowable
--   new_value_usd / _lbp    total of the NEW customers' orders that month
--                           (each new person's first order), by currency
--   value_usd / value_lbp   total of every order that month, by currency
--
-- Staff need the `orders` permission (the owner always passes). Booking rows
-- are counted only for callers who also hold `bookings`; for others the
-- booking columns are NULL — though a booking still counts as history when
-- deciding whether a later ORDER is from a returning customer.
create or replace function public.store_attribution_report(p_store_id uuid, p_month text)
returns table (
  src text,
  n_orders integer,
  n_bookings integer,
  new_customers integer,
  returning_count integer,
  unidentified_count integer,
  new_value_usd numeric,
  new_value_lbp numeric,
  value_usd numeric,
  value_lbp numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_y integer;
  v_m integer;
  v_next date;
  v_from timestamptz;
  v_to timestamptz;
  v_bookings boolean;
begin
  if p_store_id is null or not public.staff_can(p_store_id, 'orders') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'bad month' using errcode = '22023';
  end if;

  v_y := substr(p_month, 1, 4)::integer;
  v_m := substr(p_month, 6, 2)::integer;
  v_next := (make_date(v_y, v_m, 1) + interval '1 month')::date;
  v_from := make_timestamptz(v_y, v_m, 1, 0, 0, 0, 'Asia/Beirut');
  v_to := make_timestamptz(
    extract(year from v_next)::integer, extract(month from v_next)::integer,
    1, 0, 0, 0, 'Asia/Beirut');
  v_bookings := public.staff_can(p_store_id, 'bookings');

  return query
  with hist as (
    select 'order'::text as kind, o.id, o.created_at, o.customer_id,
           public.wa_phone_key(o.phone) as pkey, o.source, o.total, o.currency
      from public.orders o
     where o.store_id = p_store_id
       and o.status not in ('cancelled', 'rejected')
       and o.created_at < v_to
    union all
    select 'booking'::text, b.id, b.created_at, b.customer_id,
           public.wa_phone_key(b.phone), b.source, null::numeric, null::text
      from public.bookings b
     where b.store_id = p_store_id
       and b.status not in ('cancelled', 'rejected')
       and b.created_at < v_to
  ),
  month_rows as (
    select h.kind, h.source, h.total, h.currency,
           (h.customer_id is null and h.pkey is null) as unidentified,
           exists (
             select 1 from hist e
              where e.id <> h.id
                and e.created_at < h.created_at
                and (
                  (h.customer_id is not null and e.customer_id = h.customer_id)
                  or (h.pkey is not null and e.pkey = h.pkey)
                )
           ) as seen_before
      from hist h
     where h.created_at >= v_from
       and (v_bookings or h.kind = 'order')
  )
  select
    coalesce(m.source, 'untagged'),
    (count(*) filter (where m.kind = 'order'))::integer,
    case when v_bookings then (count(*) filter (where m.kind = 'booking'))::integer end,
    (count(*) filter (where not m.unidentified and not m.seen_before))::integer,
    (count(*) filter (where not m.unidentified and m.seen_before))::integer,
    (count(*) filter (where m.unidentified))::integer,
    coalesce(sum(m.total) filter (
      where m.kind = 'order' and not m.unidentified and not m.seen_before and m.currency = 'USD'), 0),
    coalesce(sum(m.total) filter (
      where m.kind = 'order' and not m.unidentified and not m.seen_before and m.currency = 'LBP'), 0),
    coalesce(sum(m.total) filter (where m.kind = 'order' and m.currency = 'USD'), 0),
    coalesce(sum(m.total) filter (where m.kind = 'order' and m.currency = 'LBP'), 0)
  from month_rows m
  group by coalesce(m.source, 'untagged')
  order by 4 desc, 2 desc, 1;
end
$function$;

comment on function public.store_attribution_report(uuid, text) is
  'Per-source counts for one Beirut month: orders, bookings, new vs returning customers (same customer_id or wa_phone_key with an earlier non-cancelled order/booking = returning), value of new customers'' orders. Aggregates only, no PII. Staff need orders.';

revoke all on function public.store_attribution_report(uuid, text) from public, anon, authenticated;
grant execute on function public.store_attribution_report(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. product_events — the §34 taxonomy
-- ---------------------------------------------------------------------------
-- Every text column is a short slug-like token or NULL (CHECKs below). There
-- is no column that could hold a phone, an email, a name or a sentence.
-- session_id is a random UUID the browser generates per tab session; it is
-- not tied to the device id TrackVisit keeps, and not to the account.
create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  name text not null,
  store_id uuid references public.stores(id) on delete cascade,
  offering_id uuid,
  sector text,
  offering_type text,
  region text,
  source_surface text,
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_events_name_check check (name in (
    'search_started', 'search_submitted', 'search_result_clicked', 'zero_result',
    'business_viewed', 'offering_viewed', 'favorite_added', 'contact_clicked',
    'add_to_cart', 'booking_started', 'service_request_created',
    'checkout_started', 'transaction_completed', 'job_viewed', 'job_applied',
    'project_posted'
  )),
  constraint product_events_sector_check
    check (sector is null or sector ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$'),
  constraint product_events_offering_type_check
    check (offering_type is null or offering_type ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$'),
  constraint product_events_region_check
    check (region is null or region ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$'),
  constraint product_events_surface_check
    check (source_surface is null or source_surface ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$')
);

comment on table public.product_events is
  'First-party product analytics (§34). Insert-only via log_event/log_events; platform admins read. No PII columns: ids and slug tokens only.';

-- The funnel reads: by name over time, by store, and the rate limiter's
-- per-session count. Plus every FK indexed (0260).
create index if not exists product_events_name_time_idx
  on public.product_events (name, created_at desc);
create index if not exists product_events_store_idx
  on public.product_events (store_id, created_at desc);
create index if not exists product_events_session_idx
  on public.product_events (session_id, created_at desc);
create index if not exists product_events_user_idx
  on public.product_events (user_id);

alter table public.product_events enable row level security;

revoke all on table public.product_events from public, anon, authenticated;
grant select on table public.product_events to authenticated;

drop policy if exists product_events_admin_read on public.product_events;
create policy product_events_admin_read on public.product_events
  for select to authenticated
  using (public.is_platform_admin());
-- No insert/update/delete policy or grant: rows arrive only through the RPCs.


-- ---------------------------------------------------------------------------
-- 8. log_event — one event, rate-limited
-- ---------------------------------------------------------------------------
-- Returns false (never raises) for anything it will not keep, so a broken or
-- hostile client cannot turn the endpoint into an error generator:
--   * a name outside the whitelist, a missing session id;
--   * a store that is not an active store;
--   * the session already logged 120 events in the last minute.
-- Tokens that do not look like tokens are dropped to NULL, not rejected.
-- user_id is the caller's auth.uid() (NULL for anon and for the beacon path).
create or replace function public.log_event(
  p_name text,
  p_session_id uuid,
  p_store_id uuid default null,
  p_offering_id uuid default null,
  p_sector text default null,
  p_offering_type text default null,
  p_region text default null,
  p_source_surface text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_tok constant text := '^[a-z0-9][a-z0-9_.:-]{0,39}$';
begin
  if p_session_id is null or p_name is null or p_name not in (
    'search_started', 'search_submitted', 'search_result_clicked', 'zero_result',
    'business_viewed', 'offering_viewed', 'favorite_added', 'contact_clicked',
    'add_to_cart', 'booking_started', 'service_request_created',
    'checkout_started', 'transaction_completed', 'job_viewed', 'job_applied',
    'project_posted'
  ) then
    return false;
  end if;

  if p_store_id is not null and not exists (
    select 1 from public.stores s where s.id = p_store_id and s.status = 'active'
  ) then
    return false;
  end if;

  if (select count(*) from public.product_events e
       where e.session_id = p_session_id
         and e.created_at > now() - interval '1 minute') >= 120 then
    return false;
  end if;

  insert into public.product_events
    (name, store_id, offering_id, sector, offering_type, region,
     source_surface, session_id, user_id)
  values (
    p_name,
    p_store_id,
    p_offering_id,
    case when lower(p_sector) ~ v_tok then lower(p_sector) end,
    case when lower(p_offering_type) ~ v_tok then lower(p_offering_type) end,
    case when lower(p_region) ~ v_tok then lower(p_region) end,
    case when lower(p_source_surface) ~ v_tok then lower(p_source_surface) end,
    p_session_id,
    (select auth.uid())
  );
  return true;
end
$function$;

comment on function public.log_event(text, uuid, uuid, uuid, text, text, text, text) is
  'Logs one whitelisted product event. Rate-limited to 120/min per session; never raises; no PII accepted.';

revoke all on function public.log_event(text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_event(text, uuid, uuid, uuid, text, text, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. log_events(text) — the batched beacon endpoint
-- ---------------------------------------------------------------------------
-- ONE UNNAMED text parameter on purpose: PostgREST then accepts a raw
-- `Content-Type: text/plain` body at /rest/v1/rpc/log_events, which is what
-- navigator.sendBeacon sends — a CORS-safelisted request with no preflight,
-- which is what lets the last events of a page survive the page closing.
-- The body is a JSON array of at most 20 objects
--   {"n": name, "s": session, "st": store, "o": offering, "sec": sector,
--    "ot": offering_type, "r": region, "src": source_surface}
-- Anything that does not parse is ignored. Returns how many were kept.
create or replace function public.log_events(text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_arr jsonb;
  v_e jsonb;
  v_n integer := 0;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if $1 is null or char_length($1) > 16000 then
    return 0;
  end if;
  begin
    v_arr := $1::jsonb;
  exception when others then
    return 0;
  end;
  if jsonb_typeof(v_arr) <> 'array' then
    return 0;
  end if;

  for v_e in
    select t.x from jsonb_array_elements(v_arr) with ordinality as t(x, i) where t.i <= 20
  loop
    -- Nested IFs, not one AND chain: SQL does not promise to test the regex
    -- before the cast, and one malformed element must not fail the batch.
    if jsonb_typeof(v_e) = 'object' then
      if coalesce(v_e ->> 's', '') ~ v_uuid
         and coalesce(v_e ->> 'st', '00000000-0000-0000-0000-000000000000') ~ v_uuid
         and coalesce(v_e ->> 'o', '00000000-0000-0000-0000-000000000000') ~ v_uuid then
        if public.log_event(
             v_e ->> 'n',
             (v_e ->> 's')::uuid,
             (v_e ->> 'st')::uuid,
             (v_e ->> 'o')::uuid,
             v_e ->> 'sec',
             v_e ->> 'ot',
             v_e ->> 'r',
             v_e ->> 'src') then
          v_n := v_n + 1;
        end if;
      end if;
    end if;
  end loop;
  return v_n;
end
$function$;

comment on function public.log_events(text) is
  'Batched product events from navigator.sendBeacon (text/plain JSON array, max 20). Each goes through log_event. Returns the number kept.';

revoke all on function public.log_events(text) from public, anon, authenticated;
grant execute on function public.log_events(text) to anon, authenticated;
