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
