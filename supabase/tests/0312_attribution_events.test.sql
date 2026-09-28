-- ============================================================================
-- 0312_attribution_events.test.sql — rolled-back verification of migration 0312
-- ============================================================================
-- WHAT IT IS
--   The test migration 0312 must pass BEFORE it is applied to production. One
--   transaction:
--
--     begin;
--       <the full text of supabase/migrations/0312_attribution_events.sql, verbatim>
--       <fixtures: three stores (A, B active; C pending), two owners, two staff,
--        two customers, a platform admin, a month of orders and bookings at
--        store A with known sources, and fresh orders for the tagging checks>
--       <every assertion, acting as owner A, a staff member WITH only the
--        orders permission, a staff member WITHOUT it (bookings + customers),
--        store B's owner, the two customers, the admin, and anon>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives the rollback: not the migration, not the fixtures, not
--   the rows the checks write. It is written to be run against production by
--   the owner (Supabase MCP execute_sql, the SQL editor, or
--   supabase db execute). It has NOT been run yet; see
--   audit/zero-sub/F5-attribution-analytics.md.
--
--   The migration section is a verbatim copy of the migration file. If 0312 is
--   edited, paste the new text between the two MIGRATION markers so the test
--   exercises what will actually be applied. Every statement in 0312 is
--   idempotent, so after the apply this doubles as a regression test.
--
--   Month fixtures are placed a few minutes after the start of the current
--   Beirut month, so they are "this month" whatever day the test runs.
--
-- HOW TO READ IT
--   One row per check: ok true/false and got, the value or error actually
--   observed. The last row, ALL CHECKS, says how many failed.
--
-- RULE THIS FOLLOWS (supabase-verify): seed first as postgres, then act AS the
-- role; every "sees 0" is paired with a positive control from an actor who must
-- see that same row; each expected refusal runs in its own exception block so
-- one refusal cannot poison the checks after it.
-- ============================================================================

begin;

-- ==== MIGRATION 0312 (verbatim) ====
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
-- ==== END MIGRATION 0312 (verbatim) ====

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a      uuid := gen_random_uuid();
  v_owner_b      uuid := gen_random_uuid();
  v_staff_orders uuid := gen_random_uuid();   -- store A staff: orders = true only
  v_staff_other  uuid := gen_random_uuid();   -- store A staff: bookings + customers, NOT orders
  v_cust_1       uuid := gen_random_uuid();
  v_cust_2       uuid := gen_random_uuid();
  v_admin        uuid := gen_random_uuid();
  v_store_a      uuid;
  v_store_b      uuid;
  v_store_c      uuid;                        -- pending, not active
  v_store_d      uuid;                        -- owner A, holds the tagging fixtures
  v_month        text := to_char(now() at time zone 'Asia/Beirut', 'YYYY-MM');
  v_from         timestamptz := date_trunc('month', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut';
  v_o5           uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid;
  v_sid          uuid := gen_random_uuid();
  v_sid_flood    uuid := gen_random_uuid();
  v_ok           boolean;
  v_n            int;
  v_m            int;
  v_num          numeric;
  v_num2         numeric;
  v_txt          text;
  v_body         text;
  rep            record;
  res            jsonb := '[]'::jsonb;
begin
  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS and the attribution guard)
  -- ==========================================================================
  insert into auth.users (id) values
    (v_owner_a), (v_owner_b), (v_staff_orders), (v_staff_other), (v_cust_1), (v_cust_2), (v_admin);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0312 Owner A'), (v_owner_b, '0312 Owner B'),
    (v_staff_orders, '0312 Staff orders'), (v_staff_other, '0312 Staff other'),
    (v_cust_1, '0312 Customer 1'), (v_cust_2, '0312 Customer 2'), (v_admin, '0312 Admin')
  on conflict (id) do nothing;
  perform set_config('app.allow_role_change', '1', true);
  update public.profiles set role = 'super_admin' where id = v_admin;
  perform set_config('app.allow_role_change', '', true);

  -- plan 'free' on purpose: attribution has no plan gate in the database.
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0312 Store A', 'active', 'free') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0312 Store B', 'active', 'free') returning id into v_store_b;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0312 Store C', 'pending', 'free') returning id into v_store_c;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0312 Store D', 'active', 'free') returning id into v_store_d;

  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff_orders, 'staff',
     '{"orders":true,"products":false,"bookings":false,"customers":false}'::jsonb),
    (v_store_a, v_staff_other, 'staff',
     '{"orders":false,"products":true,"bookings":true,"customers":true}'::jsonb);

  -- History: one order LAST month from 03 123 456.
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'completed', 40, '03 123 456', 'instagram', v_from - interval '20 days');

  -- This month at store A (sources set directly, as postgres):
  --   O1 same person as the history order, typed differently -> RETURNING
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'pending', 20, '+961 3 123 456', 'matjar_search', v_from + interval '1 minute');
  --   O2 a new guest -> NEW, 15
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'pending', 15, '70 111 222', 'matjar_search', v_from + interval '2 minutes');
  --   O3 the same guest again -> RETURNING
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'pending', 30, '70111222', 'matjar_map', v_from + interval '3 minutes');
  --   O4 a signed-in customer with no phone -> NEW (by customer_id), 12.5
  insert into public.orders (store_id, customer_id, status, total, phone, source, created_at)
    values (v_store_a, v_cust_1, 'pending', 12.5, null, 'sunday_market', v_from + interval '4 minutes');
  --   O5 new, but Instagram -> not Matjar
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'pending', 50, '71 999 000', 'instagram', v_from + interval '5 minutes')
    returning id into v_o5;
  --   O6 no phone, no account -> UNIDENTIFIED
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'pending', 5, null, 'offers_page', v_from + interval '6 minutes');
  --   O7 cancelled -> not counted at all
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'cancelled', 99, '76 555 444', 'matjar_directory', v_from + interval '7 minutes');
  --   O8 never tagged -> 'untagged', new
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_a, 'pending', 8, '78 000 111', null, v_from + interval '8 minutes');
  --   O9 a lira order, new, from the directory
  insert into public.orders (store_id, status, total, phone, source, currency, created_at)
    values (v_store_a, 'pending', 900000, '79 222 333', 'matjar_directory', 'LBP', v_from + interval '9 minutes');
  --   B1 customer 1 books after ordering -> RETURNING (direct link)
  insert into public.bookings (store_id, customer_id, service_name, status, source, created_at)
    values (v_store_a, v_cust_1, '0312 Service', 'pending', 'direct_link', v_from + interval '10 minutes');
  --   B2 customer 2's first ever interaction, from the map -> NEW booking customer
  insert into public.bookings (store_id, customer_id, service_name, status, source, created_at)
    values (v_store_a, v_cust_2, '0312 Service', 'pending', 'matjar_map', v_from + interval '11 minutes');
  --   Store B's order must never show in store A's report
  insert into public.orders (store_id, status, total, phone, source, created_at)
    values (v_store_b, 'pending', 77, '03 777 888', 'matjar_search', v_from + interval '1 minute');

  -- Fresh orders for the tagging checks — at store D, so they cannot disturb
  -- store A's month above.
  insert into public.orders (store_id, status, total, phone)
    values (v_store_d, 'pending', 10, '81 100 200') returning id into v_t1;           -- guest, now
  insert into public.orders (store_id, status, total, phone, created_at)
    values (v_store_d, 'pending', 10, '81 100 201', now() - interval '20 minutes')
    returning id into v_t2;                                                            -- guest, too old
  insert into public.orders (store_id, customer_id, status, total, phone)
    values (v_store_d, v_cust_1, 'pending', 10, null) returning id into v_t3;         -- customer 1's
  insert into public.orders (store_id, status, total, phone)
    values (v_store_d, 'pending', 10, '81 100 203') returning id into v_t4;           -- guest, now

  -- ==========================================================================
  -- CATALOG
  -- ==========================================================================
  res := res || jsonb_build_array(jsonb_build_object('check', 'every 0312 definer function is SECURITY DEFINER with search_path pinned to empty',
    'ok', (select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path='''''))
             from pg_proc p
            where p.oid in ('public.tag_order_source(uuid,text,text,uuid)'::regprocedure,
                            'public.tag_booking_source(uuid,text,text)'::regprocedure,
                            'public.store_attribution_report(uuid,text)'::regprocedure,
                            'public.log_event(text,uuid,uuid,uuid,text,text,text,text)'::regprocedure,
                            'public.log_events(text)'::regprocedure)),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'guard_attribution_columns is SECURITY INVOKER (it must see the browser role)',
    'ok', not (select p.prosecdef from pg_proc p where p.oid = 'public.guard_attribution_columns()'::regprocedure),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'audiences: anon may tag an order and log events; only authenticated may tag a booking or read the report',
    'ok', has_function_privilege('anon', 'public.tag_order_source(uuid,text,text,uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.tag_order_source(uuid,text,text,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.tag_booking_source(uuid,text,text)', 'execute')
      and has_function_privilege('authenticated', 'public.tag_booking_source(uuid,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.store_attribution_report(uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'public.store_attribution_report(uuid,text)', 'execute')
      and has_function_privilege('anon', 'public.log_event(text,uuid,uuid,uuid,text,text,text,text)', 'execute')
      and has_function_privilege('anon', 'public.log_events(text)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'product_events: authenticated may SELECT only (RLS: admins), anon nothing, nobody writes directly',
    'ok', has_table_privilege('authenticated', 'public.product_events', 'select')
      and not has_table_privilege('authenticated', 'public.product_events', 'insert')
      and not has_table_privilege('authenticated', 'public.product_events', 'update')
      and not has_table_privilege('authenticated', 'public.product_events', 'delete')
      and not has_table_privilege('anon', 'public.product_events', 'select')
      and not has_table_privilege('anon', 'public.product_events', 'insert'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'attribution_detail keeps utm tokens and strips Arabic, spaces and @',
    'ok', public.attribution_detail('utm=ig;c=eid') = 'utm=ig;c=eid'
      and public.attribution_detail('c=حملة العيد;rana@x.com') = 'c=;ranax.com'
      and public.attribution_detail('   ') is null
      and char_length(public.attribution_detail(repeat('a', 400))) = 160,
    'got', coalesce(public.attribution_detail('c=حملة العيد;rana@x.com'), 'null')));
  begin
    insert into public.orders (store_id, status, total, source) values (v_store_a, 'pending', 1, 'facebook');
    res := res || jsonb_build_array(jsonb_build_object('check', 'the CHECK refuses a source outside the vocabulary', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'the CHECK refuses a source outside the vocabulary', 'ok', sqlstate = '23514', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- OWNER A — the report
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'matjar_search';
    res := res || jsonb_build_array(jsonb_build_object('check', 'search: 2 orders, 1 new (70 111 222), 1 returning (03 123 456 = +961 3 123 456), new value 15, all value 35',
      'ok', rep.n_orders = 2 and rep.new_customers = 1 and rep.returning_count = 1
        and rep.new_value_usd = 15 and rep.value_usd = 35,
      'got', format('%s/%s/%s/%s/%s', rep.n_orders, rep.new_customers, rep.returning_count, rep.new_value_usd, rep.value_usd)));

    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'matjar_map';
    res := res || jsonb_build_array(jsonb_build_object('check', 'map: the repeat guest''s order is returning; customer 2''s first booking is new',
      'ok', rep.n_orders = 1 and rep.n_bookings = 1 and rep.new_customers = 1 and rep.returning_count = 1 and rep.new_value_usd = 0,
      'got', format('%s/%s/%s/%s/%s', rep.n_orders, rep.n_bookings, rep.new_customers, rep.returning_count, rep.new_value_usd)));

    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'sunday_market';
    res := res || jsonb_build_array(jsonb_build_object('check', 'Sunday Market: a signed-in customer with no phone is matched by account -> new, 12.5',
      'ok', rep.new_customers = 1 and rep.new_value_usd = 12.5, 'got', format('%s/%s', rep.new_customers, rep.new_value_usd)));

    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'direct_link';
    res := res || jsonb_build_array(jsonb_build_object('check', 'a booking after the same account''s order is returning',
      'ok', rep.n_bookings = 1 and rep.returning_count = 1 and rep.new_customers = 0,
      'got', format('%s/%s/%s', rep.n_bookings, rep.returning_count, rep.new_customers)));

    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'offers_page';
    res := res || jsonb_build_array(jsonb_build_object('check', 'no phone and no account is unidentified, never new',
      'ok', rep.unidentified_count = 1 and rep.new_customers = 0, 'got', format('%s/%s', rep.unidentified_count, rep.new_customers)));

    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'matjar_directory';
    res := res || jsonb_build_array(jsonb_build_object('check', 'directory: the cancelled order is ignored; the lira order is new and valued in LBP, not USD',
      'ok', rep.n_orders = 1 and rep.new_customers = 1 and rep.new_value_lbp = 900000 and rep.new_value_usd = 0,
      'got', format('%s/%s/%s/%s', rep.n_orders, rep.new_customers, rep.new_value_lbp, rep.new_value_usd)));

    select count(*) into v_n from public.store_attribution_report(v_store_a, v_month) x where x.src = 'untagged' and x.new_customers = 1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'a never-tagged order is its own ''untagged'' bucket, not a guess', 'ok', v_n = 1, 'got', v_n::text));

    select coalesce(sum(x.n_orders), 0) into v_n from public.store_attribution_report(v_store_a, v_month) x;
    res := res || jsonb_build_array(jsonb_build_object('check', 'store A''s month counts 8 orders: the cancelled one and store B''s are excluded',
      'ok', v_n = 8, 'got', v_n::text));

    select coalesce(sum(x.new_customers), 0) into v_n
      from public.store_attribution_report(v_store_a, v_month) x
     where x.src in ('matjar_directory', 'matjar_search', 'matjar_map', 'sunday_market', 'offers_page');
    res := res || jsonb_build_array(jsonb_build_object('check', 'Matjar brought store A exactly 4 new customers this month (search, map, market, directory)',
      'ok', v_n = 4, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A reads the report', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    perform * from public.store_attribution_report(v_store_a, '2026-13');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a malformed month is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a malformed month is refused', 'ok', sqlstate = '22023', 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    perform * from public.store_attribution_report(v_store_b, v_month);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot read store B''s report', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot read store B''s report', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- The guard: a merchant cannot re-label their own order.
  begin
    update public.orders set source = 'matjar_search', source_detail = 'fake' where id = v_o5;
    get diagnostics v_n = row_count;
    select o.source into v_txt from public.orders o where o.id = v_o5;
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A''s UPDATE of orders.source is silently discarded (Instagram stays Instagram)',
      'ok', v_txt = 'instagram', 'got', v_n::text || ' row(s) touched, source=' || coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A''s UPDATE of orders.source is discarded', 'ok', true, 'got', 'refused: ' || sqlerrm));
  end;
  begin
    perform public.tag_order_source(v_t4, 'matjar_search', null, null);
    select o.source into v_txt from public.orders o where o.id = v_t4;
    res := res || jsonb_build_array(jsonb_build_object('check', 'any caller may tag a fresh untagged GUEST order (by design: a guest order has no owner to check; the id is unguessable, the window 15 min, first label wins)',
      'ok', v_txt = 'matjar_search', 'got', coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner tags a fresh guest order', 'ok', false, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- STAFF of A WITH orders (only)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_orders, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select * into rep from public.store_attribution_report(v_store_a, v_month) x where x.src = 'matjar_map';
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders but not bookings: booking columns are NULL and booking rows are not counted',
      'ok', rep.n_bookings is null and rep.n_orders = 1 and rep.new_customers = 0,
      'got', format('%s/%s/%s', coalesce(rep.n_bookings::text, 'null'), rep.n_orders, rep.new_customers)));
    select count(*) into v_n from public.store_attribution_report(v_store_a, v_month) x where x.src = 'direct_link';
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff without bookings does not see the booking-only source row', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders reads the report', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- STAFF of A WITHOUT orders
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_other, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform * from public.store_attribution_report(v_store_a, v_month);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders cannot read the report', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders cannot read the report', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    select count(*) into v_n from public.product_events;
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff reads 0 product events (admins only)', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff reads 0 product events', 'ok', true, 'got', 'refused: ' || sqlerrm));
  end;

  -- ==========================================================================
  -- OWNER B (another store)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform * from public.store_attribution_report(v_store_a, v_month);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot read store A''s report', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot read store A''s report', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    select count(*) into v_n from public.store_attribution_report(v_store_b, v_month) x where x.src = 'matjar_search' and x.new_customers = 1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads their own report (positive control)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads their own report', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  select public.tag_order_source(v_t1, 'matjar_search', null, v_store_b) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a touch recorded for store B cannot label an order at store A', 'ok', v_ok = false, 'got', v_ok::text));

  -- ==========================================================================
  -- CUSTOMERS
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_2, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select public.tag_order_source(v_t3, 'matjar_search', null, v_store_d) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer 2 cannot tag customer 1''s order', 'ok', v_ok = false, 'got', v_ok::text));
  begin
    perform * from public.store_attribution_report(v_store_a, v_month);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a customer cannot read a store''s report', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a customer cannot read a store''s report', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;
  select public.tag_booking_source(v_store_a, 'matjar_search', null) into v_n;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer 2''s month-old, already-tagged booking is not re-tagged', 'ok', v_n = 0, 'got', v_n::text));

  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_1, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select public.tag_order_source(v_t3, 'matjar_map', 'utm=x', v_store_d) into v_ok;
  select o.source, o.source_detail into v_txt, v_body from public.orders o where o.id = v_t3;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer 1 tags their own fresh order',
    'ok', v_ok and v_txt = 'matjar_map' and v_body = 'utm=x', 'got', coalesce(v_txt, 'null') || ' / ' || coalesce(v_body, 'null')));

  -- The legacy direct insert: a browser role's source is discarded, then tagged.
  begin
    insert into public.bookings (store_id, customer_id, service_name, status, source, source_detail)
      values (v_store_a, v_cust_1, '0312 Legacy', 'pending', 'matjar_search', 'forged');
    select b.source into v_txt from public.bookings b
     where b.store_id = v_store_a and b.customer_id = v_cust_1 and b.service_name = '0312 Legacy';
    res := res || jsonb_build_array(jsonb_build_object('check', 'a customer''s direct booking insert cannot set source (it lands NULL)',
      'ok', v_txt is null, 'got', coalesce(v_txt, 'null')));
    select public.tag_booking_source(v_store_a, 'google', 'ref=google.com') into v_n;
    select b.source into v_txt from public.bookings b
     where b.store_id = v_store_a and b.customer_id = v_cust_1 and b.service_name = '0312 Legacy';
    res := res || jsonb_build_array(jsonb_build_object('check', 'tag_booking_source labels exactly the caller''s fresh untagged booking',
      'ok', v_n = 1 and v_txt = 'google', 'got', v_n::text || ' / ' || coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer 1 books directly and tags it', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    insert into public.product_events (name, session_id) values ('business_viewed', v_sid);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a signed-in user cannot write product_events directly', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a signed-in user cannot write product_events directly', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- ANON — tagging a guest order, and the event endpoint
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select public.tag_order_source(v_t1, 'matjar_search', 'utm=ig;c=حملة', v_store_d) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon tags a fresh guest order (the confirmation screen path)', 'ok', v_ok, 'got', v_ok::text));
  select public.tag_order_source(v_t1, 'instagram', null, v_store_d) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a second tag is a no-op (first label wins)', 'ok', v_ok = false, 'got', v_ok::text));
  select public.tag_order_source(v_t2, 'matjar_search', null, v_store_d) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'an order older than 15 minutes cannot be tagged', 'ok', v_ok = false, 'got', v_ok::text));
  select public.tag_order_source(v_t3, 'matjar_search', null, v_store_d) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot tag a signed-in customer''s order', 'ok', v_ok = false, 'got', v_ok::text));
  select public.tag_order_source(v_t2, 'facebook', null, null) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a source outside the vocabulary is refused (false, no error)', 'ok', v_ok = false, 'got', v_ok::text));
  begin
    perform public.tag_booking_source(v_store_a, 'matjar_search', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call tag_booking_source', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call tag_booking_source', 'ok', true, 'got', sqlerrm));
  end;
  begin
    perform * from public.store_attribution_report(v_store_a, v_month);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call store_attribution_report', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call store_attribution_report', 'ok', true, 'got', sqlerrm));
  end;

  select public.log_event('business_viewed', v_sid, v_store_a, null, 'Restaurant', null, 'Rana Haddad', 'store') into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon logs business_viewed', 'ok', v_ok, 'got', v_ok::text));
  select public.log_event('page_view', v_sid) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a name outside the whitelist is dropped', 'ok', v_ok = false, 'got', v_ok::text));
  select public.log_event('business_viewed', null, v_store_a) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'no session id, no event', 'ok', v_ok = false, 'got', v_ok::text));
  select public.log_event('business_viewed', v_sid, v_store_c) into v_ok;
  res := res || jsonb_build_array(jsonb_build_object('check', 'an event for a store that is not active is dropped', 'ok', v_ok = false, 'got', v_ok::text));
  select public.log_events(format(
    '[{"n":"offering_viewed","s":"%s","st":"%s","o":"not-a-uuid"}, "junk", 42, {"n":"zero_result","s":"%s","sec":"food"}, {"n":"nope","s":"%s"}]',
    v_sid, v_store_a, v_sid, v_sid)) into v_n;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a batch with malformed elements keeps only the valid one', 'ok', v_n = 1, 'got', v_n::text));
  select public.log_events('this is not json') into v_n;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a body that is not JSON is ignored (0, no error)', 'ok', v_n = 0, 'got', v_n::text));
  select public.log_events((select jsonb_agg(jsonb_build_object('n', 'contact_clicked', 's', v_sid, 'st', v_store_a))::text
                              from generate_series(1, 25))) into v_n;
  res := res || jsonb_build_array(jsonb_build_object('check', 'a batch is capped at 20 events', 'ok', v_n = 20, 'got', v_n::text));
  v_m := 0;
  for v_n in 1..130 loop
    if public.log_event('search_started', v_sid_flood) then v_m := v_m + 1; end if;
  end loop;
  res := res || jsonb_build_array(jsonb_build_object('check', 'one session is rate-limited to 120 events per minute', 'ok', v_m = 120, 'got', v_m::text));
  begin
    select count(*) into v_n from public.product_events;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot read product_events', 'ok', false, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot read product_events', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.product_events (name, session_id) values ('business_viewed', v_sid);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot write product_events directly', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot write product_events directly', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- PLATFORM ADMIN — the only reader of product_events
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.product_events e where e.session_id = v_sid;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the admin reads the session''s 22 events (1 + 1 + 20)', 'ok', v_n = 22, 'got', v_n::text));
  select e.sector, e.region into v_txt, v_body from public.product_events e
   where e.session_id = v_sid and e.name = 'business_viewed' limit 1;
  res := res || jsonb_build_array(jsonb_build_object('check', 'tokens are lower-cased; a name typed into a token field is dropped to NULL',
    'ok', v_txt = 'restaurant' and v_body is null, 'got', coalesce(v_txt, 'null') || ' / ' || coalesce(v_body, 'null')));
  select count(*) into v_n from public.product_events e where e.session_id = v_sid and e.user_id is not null;
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon events carry no user id', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- Back as postgres: what the tags actually wrote
  -- ==========================================================================
  execute 'reset role';
  select o.source, o.source_detail into v_txt, v_body from public.orders o where o.id = v_t1;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the guest order holds the FIRST label and a sanitised detail',
    'ok', v_txt = 'matjar_search' and v_body = 'utm=ig;c=', 'got', coalesce(v_txt, 'null') || ' / ' || coalesce(v_body, 'null')));
  select o.source into v_txt from public.orders o where o.id = v_t2;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the old order is still untagged', 'ok', v_txt is null, 'got', coalesce(v_txt, 'null')));

  -- ==========================================================================
  insert into r (n, check_name, ok, got)
  select x.i::int, x.e ->> 'check', coalesce((x.e ->> 'ok')::boolean, false), x.e ->> 'got'
  from jsonb_array_elements(res) with ordinality as x(e, i);
  insert into r (n, check_name, ok, got)
  select 999, 'ALL CHECKS', bool_and(ok), count(*) filter (where not ok)::text || ' failed of ' || count(*)::text
  from r;
end
$test$;

select n, check_name, ok, got from r order by n;

rollback;
