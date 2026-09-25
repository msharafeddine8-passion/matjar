-- ============================================================================
-- 0309_whatsapp_actions.test.sql — rolled-back verification of migration 0309
-- ============================================================================
-- WHAT IT IS
--   The test migration 0309 must pass BEFORE it is applied to production. One
--   transaction:
--
--     begin;
--       <the full text of supabase/migrations/0309_whatsapp_actions.sql, verbatim>
--       <fixtures: two stores, two owners, two staff, a product, a ledger
--        customer, three orders, six checkout intents>
--       <every assertion, acting as owner A, a staff member WITH only the
--        orders permission, a staff member WITHOUT it (bookings + customers),
--        store B's owner, and anon>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives the rollback: not the migration, not the fixtures, not
--   the rows the checks write. It is written to be run against production by
--   the owner (Supabase MCP execute_sql, the SQL editor, or
--   supabase db execute). It has NOT been run yet; see
--   audit/zero-sub/F2-whatsapp.md.
--
--   The migration section is a verbatim copy of the migration file. If 0309 is
--   edited, paste the new text between the two MIGRATION markers so the test
--   exercises what will actually be applied. Every statement in 0309 is
--   idempotent, so after the apply this doubles as a regression test.
--
-- HOW TO READ IT
--   One row per check: ok true/false and got, the value or error actually
--   observed. The last row, ALL CHECKS, says how many failed.
--
-- RULE THIS FOLLOWS (supabase-verify): seed first as postgres, then read AS the
-- role; every "sees 0" is paired with a positive control from an actor who must
-- see that same row; each expected refusal runs in its own exception block so
-- one refusal cannot poison the checks after it.
-- ============================================================================

begin;

-- ======================== MIGRATION 0309 (verbatim) =========================
-- 0309 — WhatsApp action buttons: merchant template overrides, a tap log, and
-- the abandoned-cart list.
--
-- ZERO RECURRING COST. Nothing here sends a message. Every WhatsApp action in
-- the app is a free click-to-chat link (https://wa.me/<number>?text=...): the
-- merchant taps, WhatsApp opens with the text filled in, and the MERCHANT
-- presses send from their own phone. No WhatsApp Business API, no SMS, no
-- provider, no webhook. The database only remembers two things:
--
--   1. store_wa_templates — the merchant's OWN wording for a message, when they
--      have changed it. Overrides only: the default Arabic and English text
--      lives in code (src/lib/wa-templates.ts), so a store that never opens the
--      editor has no rows here and a default can be improved without a
--      migration. Deleting a row IS "reset to default".
--
--   2. wa_action_log — "this person tapped this button for this order /
--      booking / cart / ledger customer at this time". It is what lets a
--      button say «آخر إرسال: من 3 أيام» so two staff members do not message
--      the same customer twice. It records a TAP, not a delivery: the app
--      cannot know whether the merchant then pressed send, and nothing here
--      pretends to.
--
--   3. store_abandoned_carts(p_store_id) — the merchant's list of checkout
--      intents (0120) that did not become an order.
--
-- PERMISSIONS (staff_can(store_id, key); the owner always passes):
--   target 'order' / 'cart'     -> 'orders'     (checkout_intents has been
--                                                 gated on 'orders' since 0291)
--   target 'booking'            -> 'bookings'
--   target 'ledger_customer'    -> 'customers'  (the ledger's key, 0307)
--   templates: every member of the store may READ them (each button needs the
--   wording), only the OWNER may change them — the editor lives under store
--   settings, which is owner-only in the app.
--
-- NO PLAN CHECK anywhere, on purpose: WhatsApp actions are on every plan
-- (FEATURES.whatsappActions in src/lib/feature-availability.ts).
--
-- SAFE BEFORE AND AFTER: the app reads both tables and calls the function
-- defensively — before this is applied, buttons use the default wording, the
-- tap is simply not logged, and the abandoned-cart screen computes the same
-- list from checkout_intents + orders under the caller's own RLS. Nothing
-- under src/ breaks when these objects are missing.
--
-- Verification: supabase/tests/0309_whatsapp_actions.test.sql (rolled back).


-- ---------------------------------------------------------------------------
-- 0. The template keys, in one place
-- ---------------------------------------------------------------------------
-- Mirrors WA_TEMPLATE_KEYS in src/lib/wa-templates.ts. A key the code does not
-- know could never be rendered, so the database refuses it.
--   order_confirmation, order_status, abandoned_cart, debt_reminder,
--   booking_confirmation, booking_reminder, review_request


-- ---------------------------------------------------------------------------
-- 1. store_wa_templates — merchant overrides
-- ---------------------------------------------------------------------------
create table if not exists public.store_wa_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  key text not null,
  locale text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint store_wa_templates_key_check check (key in (
    'order_confirmation', 'order_status', 'abandoned_cart', 'debt_reminder',
    'booking_confirmation', 'booking_reminder', 'review_request'
  )),
  constraint store_wa_templates_locale_check check (locale in ('ar', 'en')),
  -- 1,000 characters is already past what fits in a wa.me link once Arabic is
  -- percent-encoded (six characters per letter); the app trims to fit anyway.
  constraint store_wa_templates_body_check
    check (char_length(btrim(body)) between 1 and 1000),
  constraint store_wa_templates_one_per_key unique (store_id, key, locale)
);

comment on table public.store_wa_templates is
  'Merchant overrides of the WhatsApp click-to-chat message text. Defaults live in src/lib/wa-templates.ts; no row = default. Deleting a row resets that key/locale to the default.';

-- The unique constraint leads with store_id, so it already serves the
-- store_id foreign key. updated_by needs its own (0260: every FK is indexed).
create index if not exists store_wa_templates_updated_by_idx
  on public.store_wa_templates (updated_by);

alter table public.store_wa_templates enable row level security;

revoke all on table public.store_wa_templates from public, anon, authenticated;
grant select, insert, update, delete on table public.store_wa_templates to authenticated;

drop policy if exists store_wa_templates_read on public.store_wa_templates;
create policy store_wa_templates_read on public.store_wa_templates
  for select to authenticated
  using (public.can_manage_store(store_id));

drop policy if exists store_wa_templates_owner_insert on public.store_wa_templates;
create policy store_wa_templates_owner_insert on public.store_wa_templates
  for insert to authenticated
  with check (public.is_store_owner(store_id));

drop policy if exists store_wa_templates_owner_update on public.store_wa_templates;
create policy store_wa_templates_owner_update on public.store_wa_templates
  for update to authenticated
  using (public.is_store_owner(store_id))
  with check (public.is_store_owner(store_id));

drop policy if exists store_wa_templates_owner_delete on public.store_wa_templates;
create policy store_wa_templates_owner_delete on public.store_wa_templates
  for delete to authenticated
  using (public.is_store_owner(store_id));

-- Who changed it and when is stamped by the database, never trusted from the
-- client. SECURITY INVOKER: it only reads the caller's own JWT.
create or replace function public.stamp_store_wa_template()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  new.body := btrim(new.body);
  return new;
end
$function$;
revoke all on function public.stamp_store_wa_template() from public, anon, authenticated;

drop trigger if exists store_wa_templates_stamp on public.store_wa_templates;
create trigger store_wa_templates_stamp
  before insert or update on public.store_wa_templates
  for each row execute function public.stamp_store_wa_template();


-- ---------------------------------------------------------------------------
-- 2. wa_action_log — one row per tap, insert-only
-- ---------------------------------------------------------------------------
-- target_id is deliberately NOT a foreign key: it points at one of four tables
-- depending on target_type, and a checkout intent is DELETED the moment its
-- cart becomes an order (0120) — the log of having chased it should outlive
-- the cart. Integrity is enforced at insert time instead (the policy below
-- requires the target to exist in the caller's store).
create table if not exists public.wa_action_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  key text not null,
  target_type text not null,
  target_id uuid not null,
  actor_id uuid default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wa_action_log_key_check check (key in (
    'order_confirmation', 'order_status', 'abandoned_cart', 'debt_reminder',
    'booking_confirmation', 'booking_reminder', 'review_request'
  )),
  constraint wa_action_log_target_type_check
    check (target_type in ('order', 'booking', 'cart', 'ledger_customer')),
  -- A key belongs to one kind of target; a debt reminder "for an order" is a
  -- client bug, not a record worth keeping.
  constraint wa_action_log_key_matches_target check (
    (target_type = 'order' and key in ('order_confirmation', 'order_status', 'review_request'))
    or (target_type = 'booking' and key in ('booking_confirmation', 'booking_reminder', 'review_request'))
    or (target_type = 'cart' and key = 'abandoned_cart')
    or (target_type = 'ledger_customer' and key = 'debt_reminder')
  )
);

comment on table public.wa_action_log is
  'One row per tap on a WhatsApp action button (wa.me click-to-chat). Records that the link was OPENED by a staff member, not that a message was sent. Insert-only; drives «آخر إرسال».';

-- The read the app makes: latest tap per (target, key) for a page of targets.
create index if not exists wa_action_log_target_idx
  on public.wa_action_log (store_id, target_type, target_id, created_at desc);
create index if not exists wa_action_log_actor_idx
  on public.wa_action_log (actor_id);

alter table public.wa_action_log enable row level security;

revoke all on table public.wa_action_log from public, anon, authenticated;
grant select, insert on table public.wa_action_log to authenticated;

drop policy if exists wa_action_log_read on public.wa_action_log;
create policy wa_action_log_read on public.wa_action_log
  for select to authenticated
  using (
    public.staff_can(
      store_id,
      case target_type
        when 'order' then 'orders'
        when 'cart' then 'orders'
        when 'booking' then 'bookings'
        when 'ledger_customer' then 'customers'
      end
    )
  );

-- Insert: the caller holds the matching permission, logs as THEMSELVES, and
-- the target is a row of this same store that the caller can see. The EXISTS
-- subqueries run under the caller's own RLS on those tables, so a target in
-- another store is not even visible to the check.
drop policy if exists wa_action_log_insert on public.wa_action_log;
create policy wa_action_log_insert on public.wa_action_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and created_at > now() - interval '5 minutes'
    and created_at < now() + interval '5 minutes'
    and public.staff_can(
      store_id,
      case target_type
        when 'order' then 'orders'
        when 'cart' then 'orders'
        when 'booking' then 'bookings'
        when 'ledger_customer' then 'customers'
      end
    )
    and (
      (target_type = 'order' and exists (
        select 1 from public.orders o
        where o.id = wa_action_log.target_id and o.store_id = wa_action_log.store_id))
      or (target_type = 'booking' and exists (
        select 1 from public.bookings b
        where b.id = wa_action_log.target_id and b.store_id = wa_action_log.store_id))
      or (target_type = 'cart' and exists (
        select 1 from public.checkout_intents ci
        where ci.id = wa_action_log.target_id and ci.store_id = wa_action_log.store_id))
      or (target_type = 'ledger_customer' and exists (
        select 1 from public.store_customers c
        where c.id = wa_action_log.target_id and c.store_id = wa_action_log.store_id))
    )
  );
-- No update or delete policy, and no update/delete grant: a log that can be
-- rewritten is not a log.


-- ---------------------------------------------------------------------------
-- 3. Phone matching key
-- ---------------------------------------------------------------------------
-- The same number is typed many ways: 03 123 456, 3123456, +961 3 123 456,
-- 00961 3123456. Mirrors phoneKey() in src/lib/wa-templates.ts (which builds on
-- waNumber in src/lib/phone.ts): digits only, drop a 00 international prefix,
-- drop 961 when what remains is a Lebanese national number, drop trunk zeros.
-- A foreign number keeps its digits so it still matches itself.
create or replace function public.wa_phone_key(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if left(d, 2) = '00' then
    d := substr(d, 3);
  end if;
  if left(d, 3) = '961' and char_length(d) between 10 and 12 then
    d := substr(d, 4);
  end if;
  d := regexp_replace(d, '^0+', '');
  if d = '' then
    return null;
  end if;
  return d;
end
$function$;

comment on function public.wa_phone_key(text) is
  'Normalised phone for matching (not for display): digits, no 00 / 961 prefix, no trunk zero. Mirrors phoneKey() in src/lib/wa-templates.ts.';

revoke all on function public.wa_phone_key(text) from public, anon, authenticated;
grant execute on function public.wa_phone_key(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. store_abandoned_carts(p_store_id)
-- ---------------------------------------------------------------------------
-- A checkout intent (0120/0278) is written when a customer taps «تأكيد الطلب»
-- and is deleted by trigger when the order row lands. What is left is a cart
-- the customer tried to send and that never became an order.
--
-- Returned when ALL of:
--   * last touched MORE than 1 hour ago — younger than that the customer may
--     still be finishing, and a nudge would land mid-checkout;
--   * last touched LESS than 14 days ago — older than that the message would
--     read as spam about a cart they have forgotten;
--   * NO order from the same phone (compared with wa_phone_key, so format
--     differences cannot hide a conversion) at this store since the cart was
--     last touched. "Last touched" (updated_at) rather than "first created":
--     a cart re-armed today after an order three weeks ago is a new abandoned
--     cart, and an order placed after the latest attempt is a recovery. A
--     recovered cart therefore drops off the list by itself.
--
-- Totals are an ESTIMATE from CURRENT catalogue prices (the intent stores
-- product ids and quantities, not prices), counted only over products that
-- still exist in this store. Lines whose product is gone are returned with a
-- null unit_price and counted in unpriced_items, never guessed.
--
-- SECURITY DEFINER because it joins orders by phone and the log across the
-- store in one pass; it re-checks staff_can(p_store_id, 'orders') itself — the
-- same key checkout_intents is readable under (0291) — and refuses otherwise.
create or replace function public.store_abandoned_carts(p_store_id uuid)
returns table (
  id uuid,
  phone text,
  customer_name text,
  customer_id uuid,
  items jsonb,
  item_count integer,
  total_estimate numeric,
  unpriced_items integer,
  created_at timestamptz,
  updated_at timestamptz,
  last_wa_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
begin
  if p_store_id is null or not public.staff_can(p_store_id, 'orders') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  with intents as (
    select ci.*
    from public.checkout_intents ci
    where ci.store_id = p_store_id
      and ci.updated_at < now() - interval '1 hour'
      and ci.updated_at > now() - interval '14 days'
      and not exists (
        select 1
        from public.orders o
        where o.store_id = ci.store_id
          and o.created_at >= ci.updated_at
          and public.wa_phone_key(o.phone) = public.wa_phone_key(ci.phone)
      )
    order by ci.updated_at desc
    limit 200
  ),
  lines as (
    select
      i.id as intent_id,
      e.ord,
      pr.id as product_id,
      coalesce(pr.name, nullif(btrim(e.item ->> 'name'), ''), '—') as name,
      pr.name_en,
      case
        when (e.item ->> 'quantity') ~ '^[0-9]{1,4}$'
          then greatest(1, least(999, (e.item ->> 'quantity')::int))
        else 1
      end as quantity,
      case
        when pr.id is null then null
        when pr.discount_price is not null
             and pr.discount_price > 0
             and pr.discount_price < pr.price then pr.discount_price
        else pr.price
      end as unit_price,
      (pr.id is not null and coalesce(pr.is_available, false)) as available
    from intents i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.items) = 'array' then i.items else '[]'::jsonb end
    ) with ordinality as e(item, ord)
    -- CASE, not AND: Postgres does not promise to test the regex before the
    -- cast, and one malformed id in one customer's cart must not fail the
    -- whole list.
    left join public.products pr
      on pr.id = case
                   when (e.item ->> 'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then (e.item ->> 'product_id')::uuid
                 end
     and pr.store_id = p_store_id
     and pr.deleted_at is null
  ),
  agg as (
    select
      l.intent_id,
      jsonb_agg(
        jsonb_build_object(
          'product_id', l.product_id,
          'name', l.name,
          'name_en', l.name_en,
          'quantity', l.quantity,
          'unit_price', l.unit_price,
          'available', l.available
        )
        order by l.ord
      ) as items,
      sum(l.quantity)::int as item_count,
      coalesce(sum(l.unit_price * l.quantity), 0) as total_estimate,
      count(*) filter (where l.unit_price is null)::int as unpriced_items
    from lines l
    group by l.intent_id
  )
  select
    i.id,
    i.phone,
    i.customer_name,
    i.customer_id,
    coalesce(a.items, '[]'::jsonb),
    coalesce(a.item_count, 0),
    coalesce(a.total_estimate, 0),
    coalesce(a.unpriced_items, 0),
    i.created_at,
    i.updated_at,
    (select max(w.created_at)
       from public.wa_action_log w
      where w.store_id = p_store_id
        and w.target_type = 'cart'
        and w.target_id = i.id)
  from intents i
  left join agg a on a.intent_id = i.id
  order by i.updated_at desc;
end
$function$;

comment on function public.store_abandoned_carts(uuid) is
  'Checkout intents 1h–14d old whose phone placed no order at the store since the cart was last touched. Items priced from the CURRENT catalogue (estimate). Staff need the orders permission; the owner always may.';

revoke all on function public.store_abandoned_carts(uuid) from public, anon, authenticated;
grant execute on function public.store_abandoned_carts(uuid) to authenticated;
-- ====================== END MIGRATION 0309 (verbatim) =======================

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a      uuid := gen_random_uuid();
  v_owner_b      uuid := gen_random_uuid();
  v_staff_orders uuid := gen_random_uuid();   -- store A staff: orders = true only
  v_staff_other  uuid := gen_random_uuid();   -- store A staff: bookings + customers, NOT orders
  v_store_a      uuid;
  v_store_b      uuid;
  v_prod         uuid;
  v_gone         uuid := gen_random_uuid();   -- a product id that does not exist
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_i5 uuid; v_ib uuid;
  v_order_a      uuid;
  v_order_b      uuid;
  v_cust_a       uuid;
  v_n            int;
  v_num          numeric;
  v_txt          text;
  v_uid          uuid;
  v_ts           timestamptz;
  v_ids          uuid[];
  res            jsonb := '[]'::jsonb;
begin
  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS)
  -- ==========================================================================
  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_staff_orders), (v_staff_other);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0309 Owner A'), (v_owner_b, '0309 Owner B'),
    (v_staff_orders, '0309 Staff orders'), (v_staff_other, '0309 Staff other')
  on conflict (id) do nothing;

  -- plan 'free' on purpose: WhatsApp actions have no plan gate in the database.
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0309 WA Store A', 'active', 'free') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0309 WA Store B', 'active', 'free') returning id into v_store_b;

  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff_orders, 'staff',
     '{"orders":true,"products":false,"bookings":false,"customers":false}'::jsonb),
    (v_store_a, v_staff_other, 'staff',
     '{"orders":false,"products":true,"bookings":true,"customers":true}'::jsonb);

  insert into public.products (store_id, name, price, discount_price, is_available)
    values (v_store_a, '0309 Widget', 10, 8, true) returning id into v_prod;

  insert into public.store_customers (store_id, name, phone)
    values (v_store_a, '0309 Ledger Customer', '03123456') returning id into v_cust_a;

  -- Orders first (the order-insert trigger clears intents with the SAME
  -- trimmed phone; these phones are typed differently on purpose).
  insert into public.orders (store_id, status, total, phone, created_at)
    values (v_store_a, 'pending', 30, '+961 76 333 444', now() - interval '4 hours')
    returning id into v_order_a;
  insert into public.orders (store_id, status, total, phone, created_at)
    values (v_store_a, 'completed', 12, '78 444 555', now() - interval '10 days');
  insert into public.orders (store_id, status, total, phone)
    values (v_store_b, 'pending', 9, '03999888') returning id into v_order_b;

  -- i1: 3h old, one live product (2 x discounted 8), one gone product, and one
  --     line with a malformed id and quantity -> LISTED, estimate 16, 2 unpriced
  insert into public.checkout_intents (store_id, phone, customer_name, items, created_at, updated_at)
    values (v_store_a, '03 123 456', 'Rana',
            jsonb_build_array(
              jsonb_build_object('product_id', v_prod, 'name', 'Widget', 'quantity', 2),
              jsonb_build_object('product_id', v_gone, 'name', 'Old thing', 'quantity', 1),
              jsonb_build_object('product_id', 'not-a-uuid', 'name', 'Bad id', 'quantity', 'lots')),
            now() - interval '3 hours', now() - interval '3 hours')
    returning id into v_i1;
  -- i2: 20 minutes old -> too fresh, NOT listed
  insert into public.checkout_intents (store_id, phone, items, created_at, updated_at)
    values (v_store_a, '70111222', '[]', now() - interval '20 minutes', now() - interval '20 minutes')
    returning id into v_i2;
  -- i3: 20 days old -> too old, NOT listed
  insert into public.checkout_intents (store_id, phone, items, created_at, updated_at)
    values (v_store_a, '71222333', '[]', now() - interval '20 days', now() - interval '20 days')
    returning id into v_i3;
  -- i4: 5h old, the same phone ordered 4h ago typed as +961 76 333 444 -> recovered, NOT listed
  insert into public.checkout_intents (store_id, phone, items, created_at, updated_at)
    values (v_store_a, '76333444', '[]', now() - interval '5 hours', now() - interval '5 hours')
    returning id into v_i4;
  -- i5: 6h old, the same phone ordered 10 DAYS ago (before this attempt) -> LISTED
  insert into public.checkout_intents (store_id, phone, items, created_at, updated_at)
    values (v_store_a, '78444555', '{"not":"an array"}'::jsonb, now() - interval '6 hours', now() - interval '6 hours')
    returning id into v_i5;
  -- store B's cart
  insert into public.checkout_intents (store_id, phone, items, created_at, updated_at)
    values (v_store_b, '03888777', '[]', now() - interval '3 hours', now() - interval '3 hours')
    returning id into v_ib;

  -- ==========================================================================
  -- CATALOG
  -- ==========================================================================
  res := res || jsonb_build_array(jsonb_build_object('check', 'store_abandoned_carts is SECURITY DEFINER with search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.store_abandoned_carts(uuid)'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon may NOT execute store_abandoned_carts; authenticated may',
    'ok', not has_function_privilege('anon', 'public.store_abandoned_carts(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.store_abandoned_carts(uuid)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'wa_action_log: authenticated has SELECT+INSERT only, anon nothing',
    'ok', has_table_privilege('authenticated', 'public.wa_action_log', 'insert')
      and has_table_privilege('authenticated', 'public.wa_action_log', 'select')
      and not has_table_privilege('authenticated', 'public.wa_action_log', 'update')
      and not has_table_privilege('authenticated', 'public.wa_action_log', 'delete')
      and not has_table_privilege('anon', 'public.wa_action_log', 'select')
      and not has_table_privilege('anon', 'public.wa_action_log', 'insert'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'store_wa_templates: anon has no privileges',
    'ok', not has_table_privilege('anon', 'public.store_wa_templates', 'select')
      and not has_table_privilege('anon', 'public.store_wa_templates', 'insert'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'wa_phone_key: every spelling of one number is one key (and Keserwan 09 is not a country code)',
    'ok', public.wa_phone_key('03 123 456') = '3123456'
      and public.wa_phone_key('+961 3 123 456') = '3123456'
      and public.wa_phone_key('00961 3123456') = '3123456'
      and public.wa_phone_key('+961 03 123 456') = '3123456'
      and public.wa_phone_key('09612345') = '9612345'
      and public.wa_phone_key('+33 6 12 34 56 78') = '33612345678'
      and public.wa_phone_key('') is null,
    'got', coalesce(public.wa_phone_key('+961 03 123 456'), 'null')));

  -- ==========================================================================
  -- OWNER A
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select array_agg(c.id order by c.updated_at desc) into v_ids from public.store_abandoned_carts(v_store_a) c;
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A: exactly i1 and i5 are abandoned (fresh, stale, recovered excluded)',
      'ok', v_ids = array[v_i1, v_i5], 'got', coalesce(array_to_string(v_ids, ','), 'none')));
    res := res || jsonb_build_array(jsonb_build_object('check', 'i4 is recovered by an order typed +961 76 333 444',
      'ok', not (v_i4 = any(coalesce(v_ids, '{}'))), 'got', 'checked'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A lists abandoned carts', 'ok', false, 'got', sqlerrm));
  end;
  begin
    select c.total_estimate, c.unpriced_items into v_num, v_n from public.store_abandoned_carts(v_store_a) c where c.id = v_i1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'i1 estimate = 2 x 8 (discount wins) = 16; the gone product and the malformed line are unpriced, not guessed',
      'ok', v_num = 16 and v_n = 2, 'got', coalesce(v_num::text, 'null') || ' / unpriced ' || coalesce(v_n::text, 'null')));
    select c.item_count into v_n from public.store_abandoned_carts(v_store_a) c where c.id = v_i1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'i1 item_count = 2 + 1 + 1 (a malformed quantity counts as 1)',
      'ok', v_n = 4, 'got', coalesce(v_n::text, 'null')));
    select c.item_count into v_n from public.store_abandoned_carts(v_store_a) c where c.id = v_i5;
    res := res || jsonb_build_array(jsonb_build_object('check', 'a malformed items value is an empty cart, not an error',
      'ok', v_n = 0, 'got', coalesce(v_n::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'i1 estimate', 'ok', false, 'got', sqlerrm));
  end;
  begin
    perform * from public.store_abandoned_carts(v_store_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot list store B carts', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot list store B carts', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- The log.
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values
      (v_store_a, 'order_confirmation', 'order', v_order_a),
      (v_store_a, 'abandoned_cart', 'cart', v_i1),
      (v_store_a, 'debt_reminder', 'ledger_customer', v_cust_a);
    select w.actor_id into v_uid from public.wa_action_log w where w.target_id = v_order_a limit 1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A logs order, cart and ledger taps; actor defaults to the caller',
      'ok', v_uid = v_owner_a, 'got', coalesce(v_uid::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A logs order, cart and ledger taps', 'ok', false, 'got', sqlerrm));
  end;
  select c.last_wa_at into v_ts from public.store_abandoned_carts(v_store_a) c where c.id = v_i1;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the cart now reports its last WhatsApp tap',
    'ok', v_ts is not null, 'got', coalesce(v_ts::text, 'null')));
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id)
      values (v_store_a, 'debt_reminder', 'order', v_order_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'a key that does not belong to the target type is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a key that does not belong to the target type is refused', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id)
      values (v_store_a, 'order_status', 'order', v_order_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot log store B''s order under store A', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot log store B''s order under store A', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id)
      values (v_store_b, 'order_status', 'order', v_order_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot log into store B', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot log into store B', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id, actor_id)
      values (v_store_a, 'order_status', 'order', v_order_a, v_staff_orders);
    res := res || jsonb_build_array(jsonb_build_object('check', 'nobody logs a tap in someone else''s name', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'nobody logs a tap in someone else''s name', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id, created_at)
      values (v_store_a, 'order_status', 'order', v_order_a, now() - interval '1 day');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a backdated tap is refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'a backdated tap is refused', 'ok', true, 'got', sqlerrm));
  end;
  begin
    update public.wa_action_log set key = 'order_status' where target_id = v_order_a;
    res := res || jsonb_build_array(jsonb_build_object('check', 'the log cannot be rewritten', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'the log cannot be rewritten', 'ok', true, 'got', sqlerrm));
  end;
  begin
    delete from public.wa_action_log where target_id = v_order_a;
    res := res || jsonb_build_array(jsonb_build_object('check', 'the log cannot be deleted', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'the log cannot be deleted', 'ok', true, 'got', sqlerrm));
  end;

  -- Templates.
  begin
    insert into public.store_wa_templates (store_id, key, locale, body)
      values (v_store_a, 'order_status', 'ar', '  طلبك {order_number} صار {status}  ')
      on conflict (store_id, key, locale) do update set body = excluded.body;
    select t.updated_by, t.body into v_uid, v_txt from public.store_wa_templates t where t.store_id = v_store_a and t.key = 'order_status';
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A saves a template; updated_by stamped, body trimmed',
      'ok', v_uid = v_owner_a and v_txt = 'طلبك {order_number} صار {status}', 'got', coalesce(v_uid::text, 'null') || ' / ' || coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A saves a template', 'ok', false, 'got', sqlerrm));
  end;
  begin
    insert into public.store_wa_templates (store_id, key, locale, body)
      values (v_store_a, 'order_status', 'ar', 'second row')
      on conflict (store_id, key, locale) do update set body = excluded.body;
    select count(*) into v_n from public.store_wa_templates t where t.store_id = v_store_a and t.key = 'order_status' and t.locale = 'ar';
    res := res || jsonb_build_array(jsonb_build_object('check', 'one row per (store, key, locale): a second save updates', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'one row per (store, key, locale)', 'ok', false, 'got', sqlerrm));
  end;
  begin
    insert into public.store_wa_templates (store_id, key, locale, body) values (v_store_a, 'not_a_key', 'ar', 'x');
    res := res || jsonb_build_array(jsonb_build_object('check', 'unknown template key refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'unknown template key refused', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.store_wa_templates (store_id, key, locale, body) values (v_store_a, 'order_status', 'fr', 'x');
    res := res || jsonb_build_array(jsonb_build_object('check', 'unknown locale refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'unknown locale refused', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.store_wa_templates (store_id, key, locale, body) values (v_store_a, 'order_status', 'en', '   ');
    res := res || jsonb_build_array(jsonb_build_object('check', 'blank body refused', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'blank body refused', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.store_wa_templates (store_id, key, locale, body) values (v_store_b, 'order_status', 'en', 'hijack');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot write store B templates', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A cannot write store B templates', 'ok', true, 'got', sqlerrm));
  end;
  -- A template for "reset" below.
  insert into public.store_wa_templates (store_id, key, locale, body) values (v_store_a, 'review_request', 'en', 'Rate us {link}');

  -- ==========================================================================
  -- STAFF of A WITH orders (only)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_orders, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select count(*) into v_n from public.store_abandoned_carts(v_store_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders lists the same 2 carts', 'ok', v_n = 2, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders lists the same 2 carts', 'ok', false, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values (v_store_a, 'order_status', 'order', v_order_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders logs an order tap', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders logs an order tap', 'ok', false, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values (v_store_a, 'debt_reminder', 'ledger_customer', v_cust_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT customers cannot log a ledger reminder', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT customers cannot log a ledger reminder', 'ok', true, 'got', sqlerrm));
  end;
  select count(*) filter (where w.target_type in ('order', 'cart')), count(*) filter (where w.target_type = 'ledger_customer')
    into v_n, v_num from public.wa_action_log w where w.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff with orders reads order/cart taps (3) but not ledger taps (0)',
    'ok', v_n = 3 and v_num = 0, 'got', v_n::text || ' / ' || v_num::text));
  select count(*) into v_n from public.store_wa_templates t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff reads the store''s templates (their buttons need the wording)', 'ok', v_n = 2, 'got', v_n::text));
  begin
    insert into public.store_wa_templates (store_id, key, locale, body) values (v_store_a, 'order_confirmation', 'ar', 'staff text');
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff cannot write templates (owner only)', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff cannot write templates (owner only)', 'ok', true, 'got', sqlerrm));
  end;
  update public.store_wa_templates set body = 'staff edit' where store_id = v_store_a;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff update of templates touches 0 rows', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- STAFF of A WITHOUT orders (bookings + customers)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_other, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform * from public.store_abandoned_carts(v_store_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders cannot list abandoned carts', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders cannot list abandoned carts', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values (v_store_a, 'order_status', 'order', v_order_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders cannot log an order tap', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders cannot log an order tap', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values (v_store_a, 'debt_reminder', 'ledger_customer', v_cust_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with customers logs a ledger reminder', 'ok', true, 'got', 'inserted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff with customers logs a ledger reminder', 'ok', false, 'got', sqlerrm));
  end;
  select count(*) into v_n from public.wa_action_log w where w.store_id = v_store_a and w.target_type in ('order', 'cart');
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT orders reads 0 order/cart taps', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- OWNER B (another store)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform * from public.store_abandoned_carts(v_store_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot list store A carts', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot list store A carts', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;
  select count(*) into v_n from public.wa_action_log w where w.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads 0 of store A''s taps', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.store_wa_templates t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads 0 of store A''s templates', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values (v_store_a, 'order_status', 'order', v_order_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot log into store A', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot log into store A', 'ok', true, 'got', sqlerrm));
  end;
  delete from public.store_wa_templates where store_id = v_store_a;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B deletes 0 of store A''s templates', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- ANON
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform * from public.store_abandoned_carts(v_store_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call store_abandoned_carts', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call store_abandoned_carts', 'ok', true, 'got', sqlerrm));
  end;
  begin
    select count(*) into v_n from public.wa_action_log;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot read the log', 'ok', false, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot read the log', 'ok', true, 'got', sqlerrm));
  end;
  begin
    select count(*) into v_n from public.store_wa_templates;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot read templates', 'ok', false, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot read templates', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.wa_action_log (store_id, key, target_type, target_id) values (v_store_a, 'order_status', 'order', v_order_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot log', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot log', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- OWNER A resets a template (delete = back to the default in code)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.store_wa_templates where store_id = v_store_a and key = 'review_request' and locale = 'en';
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner A resets (deletes) an override', 'ok', v_n = 1, 'got', v_n::text));

  -- ==========================================================================
  execute 'reset role';
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
