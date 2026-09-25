-- 0310 — Loyalty stamp cards (+ phone-keyed points) and gift cards.
--
-- ZERO RECURRING COST. No loyalty or gift-card app, no SMS, no WhatsApp API,
-- no AI. A card is a server-rendered page behind an unguessable link the
-- merchant sends from their own WhatsApp (a wa.me link built in the app).
--
-- ===========================================================================
-- WHAT ALREADY EXISTED, AND HOW THIS MAPS ONTO IT
-- ===========================================================================
-- A per-(user, store) POINTS system: loyalty_ledger (0057/0089/0095), earned
-- 1 point per whole $1 of a COMPLETED order by award_loyalty_on_complete(),
-- spendable at checkout when the store opts in (stores.loyalty_redemption_
-- enabled + loyalty_points_per_unit, 0107/0110), refunded on cancel (0220).
-- It is keyed by the signed-in USER, so a walk-in POS customer or a guest
-- order never earned anything.
--
-- The brief proposed loyalty_programs / loyalty_accounts / loyalty_events /
-- gift_cards / gift_card_redemptions. Mapping:
--
--   loyalty_programs   NEW. One row per store: the program the merchant picked
--                      (stamps OR points), its rule and its reward wording.
--   loyalty_accounts   NEW. A customer of ONE store identified by PHONE
--                      (wa_phone_key from 0309), with the card-link token.
--   loyalty_events     NEW, append-only. Stamps and points for purchases that
--                      have NO account holder (POS sales, guest orders) plus
--                      manual adjustments and redeemed rewards.
--   loyalty_ledger     UNCHANGED table. Still the only ledger for a signed-in
--                      customer's online points. NOT a second points system:
--
-- ONE HOLDER PER PURCHASE — the rule that makes double counting impossible.
--   * stamps program: every completed order with a phone, and every POS sale
--     the cashier attaches a phone to, adds stamps to the PHONE account.
--     loyalty_ledger never holds stamps, so nothing is counted twice.
--   * points program: a completed order WITH an account (customer_id set)
--     earns in loyalty_ledger exactly as before — award_loyalty_on_complete is
--     restated below with ONE change, the earn rate (see §5). A completed
--     order WITHOUT an account (a guest) and a POS sale earn on the PHONE
--     account instead. An order is never credited to both: the phone path
--     skips any order that has a customer_id.
--   The consequence, stated honestly: a signed-in customer who ALSO buys in
--   the shop sees two balances — online points in /account (spendable at
--   checkout, 0110) and in-shop points on the card (redeemed by the merchant).
--   Merging them would need a verified phone on the profile, which the
--   platform does not have; guessing the link from a typed phone would let
--   anyone claim a stranger's points.
--
-- WHEN IS SOMETHING EARNED — never on a pending order that may be cancelled:
--   * online: when the order becomes 'completed' (the same moment 0057 awards
--     points; 0246 makes completed final, so no reversal path is needed);
--   * POS: when the cashier attaches a phone to a sale that was just recorded
--     (a POS sale is paid on the spot). Deleting the sale reverses it.
--   Earning pauses (existing balances stay, redemption keeps working) while
--   the store's effective plan is below Pro — see store_plan_is_pro().
--
-- GIFT CARDS
--   gift_cards / gift_card_redemptions NEW. A gift card is TENDER, not a
--   discount: redeeming it writes an order_payments row (method «بطاقة هدية»)
--   against the order, so orders.total — the amount of record every report
--   reads — is untouched and the merchant sees "paid $X, $Y left to collect".
--   Currency (orders, POS sales and payments are USD since forever; 0209 added
--   the rate snapshot):
--     * a USD card pays USD 1:1;
--     * an LBP card pays at the ORDER's (or POS sale's) own fx_rate snapshot —
--       the rate stamped when that order was placed — never today's rate and
--       never a rate the client sends. No snapshot, no redemption ('no_rate').
--       The LBP debited is whole pounds; a partial LBP payment credits the
--       order trunc(lbp / rate, 2) USD, rounding in the merchant's favour by
--       under one cent, never the customer's card.
--   Race safety: the order (or sale) row is locked FOR UPDATE, then the card
--   row is locked FOR UPDATE, then a single UPDATE ... WHERE balance >= x
--   debits it. Two checkouts spending the same card serialise on the card
--   lock; the second sees the reduced balance. Lock order is always
--   order/sale -> card, so the two redemption paths cannot deadlock.
--   Cancelling / rejecting the order, or deleting the POS sale, puts every
--   redeemed amount back on its card (and writes the matching order_payments
--   refund) exactly once (gift_card_redemptions.refund_of is unique).
--
-- PLAN (Pro + Business, FEATURES.loyaltyStamps / FEATURES.giftCards):
--   enforced HERE for configuring a program, adding members, adding stamps or
--   points by hand, and issuing a gift card — through store_plan_is_pro(),
--   which reads stores.plan / trial_ends_at from the table inside a separate
--   RPC. The 0308 trap ("claim plan in the same UPDATE") cannot arise: nothing
--   here is a trigger on `stores`, and a browser cannot write stores.plan
--   (guard_store_platform_columns). NOT enforced for redeeming a gift card or
--   a reward, taking stamps away, or voiding a card: a customer paid for that
--   card, and a downgrade must never confiscate it.
--
-- PERMISSIONS (staff_can(store, key); the owner always passes):
--   program settings, issuing / voiding / listing gift cards  -> OWNER only
--   loyalty members, card links, adjustments, rewards         -> 'customers'
--   POS: attach a phone to a sale, redeem a card at the till  -> 'orders' or
--        'pos' (the POS screen opens on 'orders'; pos_sales RLS uses 'pos')
--   anon: read ONE card / ONE gift card by its token, check a code's balance
--         for a store, redeem a code against a guest order it just placed.
--
-- SAFE BEFORE AND AFTER: the app reads every object here defensively; before
-- this is applied the screens show a "not set up yet" state, checkout and POS
-- behave exactly as today, and nothing under src/ throws.
--
-- Verification: supabase/tests/0310_loyalty_giftcards.test.sql (rolled back).


-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
-- The effective plan of src/lib/plan-tiers.ts effectivePlan(): pro/business,
-- or any store on an active trial. Read from the row, never from an argument.
create or replace function public.store_plan_is_pro(p_store_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1 from public.stores s
    where s.id = p_store_id
      and (s.plan::text in ('pro', 'business')
           or (s.trial_ends_at is not null and s.trial_ends_at > now()))
  );
$function$;

comment on function public.store_plan_is_pro(uuid) is
  'True when the store''s effective plan is Pro or Business (or an active trial). Mirrors effectivePlan() in src/lib/plan-tiers.ts. Internal: called from the 0310 definer functions only.';

-- Internal helper; every caller is a SECURITY DEFINER function owned by the
-- migration role, so browser roles need no EXECUTE on it.
revoke all on function public.store_plan_is_pro(uuid) from public, anon, authenticated;

-- A gift-card code as typed: spaces and dashes dropped, upper case.
create or replace function public.gift_code_normalize(p_code text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$function$;

revoke all on function public.gift_code_normalize(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1. loyalty_programs — the store's one program
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_programs (
  store_id uuid primary key references public.stores(id) on delete cascade,
  kind text not null,
  is_active boolean not null default true,
  -- stamps: "buy N, get 1 free"
  stamps_required integer not null default 10,
  stamp_scope text not null default 'order',
  scope_product_id uuid references public.products(id) on delete set null,
  scope_section_id uuid references public.store_sections(id) on delete set null,
  -- points: X points per whole $1, a reward every `redeem_threshold` points
  points_per_usd integer not null default 1,
  redeem_threshold integer not null default 100,
  reward_label text,
  reward_label_en text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint loyalty_programs_kind_check check (kind in ('stamps', 'points')),
  constraint loyalty_programs_stamps_check check (stamps_required between 2 and 50),
  -- 'order' = one stamp per completed purchase; 'product' / 'section' = one
  -- stamp per unit of that product / of any product in that section.
  constraint loyalty_programs_scope_check check (stamp_scope in ('order', 'product', 'section')),
  constraint loyalty_programs_rate_check check (points_per_usd between 1 and 100),
  constraint loyalty_programs_threshold_check check (redeem_threshold between 1 and 1000000),
  constraint loyalty_programs_reward_check check (
    (reward_label is null or char_length(reward_label) <= 120)
    and (reward_label_en is null or char_length(reward_label_en) <= 120))
);

comment on table public.loyalty_programs is
  'One loyalty program per store (stamps OR points). Written only by set_loyalty_program() (owner, Pro/Business). See 0310.';

create index if not exists loyalty_programs_product_idx on public.loyalty_programs (scope_product_id);
create index if not exists loyalty_programs_section_idx on public.loyalty_programs (scope_section_id);
create index if not exists loyalty_programs_updated_by_idx on public.loyalty_programs (updated_by);

alter table public.loyalty_programs enable row level security;
revoke all on table public.loyalty_programs from public, anon, authenticated;
grant select on table public.loyalty_programs to authenticated;

-- Every member of the store may read the rule (the POS needs it).
drop policy if exists loyalty_programs_read on public.loyalty_programs;
create policy loyalty_programs_read on public.loyalty_programs
  for select to authenticated
  using (public.can_manage_store(store_id));


-- ---------------------------------------------------------------------------
-- 2. loyalty_accounts — one customer of one store, by phone
-- ---------------------------------------------------------------------------
-- The phone is kept only as its matching key (wa_phone_key): enough to find
-- the account again and to build the merchant's wa.me link, never displayed
-- on the public card. The token IS the card's credential (144 random bits,
-- like 0307's statement tokens) and is minted only by the default.
create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  phone_key text not null,
  display_name text,
  token text not null unique
    default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint loyalty_accounts_phone_key_check check (phone_key ~ '^[0-9]{6,15}$'),
  constraint loyalty_accounts_name_check check (display_name is null or char_length(display_name) <= 80),
  constraint loyalty_accounts_token_shape check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  constraint loyalty_accounts_one_per_phone unique (store_id, phone_key)
);

comment on table public.loyalty_accounts is
  'A loyalty member of one store, identified by wa_phone_key(phone). token = the public card link /[lang]/loyalty/<token>. Written only by 0310 definer functions.';

alter table public.loyalty_accounts enable row level security;
revoke all on table public.loyalty_accounts from public, anon, authenticated;
grant select on table public.loyalty_accounts to authenticated;

drop policy if exists loyalty_accounts_read on public.loyalty_accounts;
create policy loyalty_accounts_read on public.loyalty_accounts
  for select to authenticated
  using (public.staff_can(store_id, 'customers'));


-- ---------------------------------------------------------------------------
-- 3. loyalty_events — append-only stamps / points movements
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.loyalty_accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null,
  delta integer not null,
  reason text not null,
  order_id uuid references public.orders(id) on delete set null,
  pos_sale_id uuid references public.pos_sales(id) on delete set null,
  note text,
  actor_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint loyalty_events_kind_check check (kind in ('stamps', 'points')),
  constraint loyalty_events_delta_check check (delta <> 0 and abs(delta) <= 1000000),
  constraint loyalty_events_reason_check
    check (reason in ('order', 'pos', 'adjust', 'reward', 'reversal')),
  constraint loyalty_events_note_check check (note is null or char_length(note) <= 200),
  -- A manual adjustment always says why.
  constraint loyalty_events_adjust_has_note
    check (reason <> 'adjust' or char_length(btrim(coalesce(note, ''))) >= 2)
);

comment on table public.loyalty_events is
  'Append-only stamps/points of phone-keyed loyalty accounts. Balance = sum(delta) per (account, kind). One earn row per order and per POS sale (partial unique indexes).';

create index if not exists loyalty_events_account_idx on public.loyalty_events (account_id, kind, created_at desc);
create index if not exists loyalty_events_store_idx on public.loyalty_events (store_id, created_at desc);
create index if not exists loyalty_events_order_idx on public.loyalty_events (order_id);
create index if not exists loyalty_events_pos_sale_idx on public.loyalty_events (pos_sale_id);
create index if not exists loyalty_events_actor_idx on public.loyalty_events (actor_id);
-- Idempotency: an order or a sale earns at most once per kind.
create unique index if not exists loyalty_events_one_per_order
  on public.loyalty_events (order_id, kind) where reason = 'order';
create unique index if not exists loyalty_events_one_per_sale
  on public.loyalty_events (pos_sale_id, kind) where reason = 'pos';

alter table public.loyalty_events enable row level security;
revoke all on table public.loyalty_events from public, anon, authenticated;
grant select on table public.loyalty_events to authenticated;

drop policy if exists loyalty_events_read on public.loyalty_events;
create policy loyalty_events_read on public.loyalty_events
  for select to authenticated
  using (public.staff_can(store_id, 'customers'));
-- No insert/update/delete grant or policy: only the functions below write.


-- ---------------------------------------------------------------------------
-- 4. gift_cards / gift_card_redemptions
-- ---------------------------------------------------------------------------
-- code: 12 characters from a 32-letter alphabet with no 0/O/1/I
-- (23456789ABCDEFGHJKLMNPQRSTUVWXYZ) = 60 random bits, shown as XXXX-XXXX-XXXX.
-- It is the SPENDING credential. token is a separate VIEWING credential for
-- /[lang]/gift/<token>, so a shared balance link never lets anyone spend.
create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null unique,
  token text not null unique
    default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
  currency text not null,
  initial_amount numeric(14, 2) not null,
  balance numeric(14, 2) not null,
  recipient_name text,
  note text,
  expires_on date,
  status text not null default 'active',
  issued_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  constraint gift_cards_code_shape check (code ~ '^[2-9A-HJ-NP-Z]{12}$'),
  constraint gift_cards_token_shape check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  constraint gift_cards_currency_check check (currency in ('USD', 'LBP')),
  constraint gift_cards_amount_check check (
    initial_amount > 0
    and ((currency = 'USD' and initial_amount <= 10000)
      or (currency = 'LBP' and initial_amount <= 1000000000 and initial_amount = round(initial_amount)))),
  constraint gift_cards_balance_check check (balance >= 0 and balance <= initial_amount),
  constraint gift_cards_status_check check (status in ('active', 'void')),
  constraint gift_cards_recipient_check check (recipient_name is null or char_length(recipient_name) <= 80),
  constraint gift_cards_note_check check (note is null or char_length(note) <= 200)
);

comment on table public.gift_cards is
  'Store gift cards. code = spending credential (12 chars, 60 bits); token = read-only link /[lang]/gift/<token>. Balance moves only through 0310 definer functions.';

create index if not exists gift_cards_store_idx on public.gift_cards (store_id, created_at desc);
create index if not exists gift_cards_issued_by_idx on public.gift_cards (issued_by);
create index if not exists gift_cards_voided_by_idx on public.gift_cards (voided_by);

alter table public.gift_cards enable row level security;
revoke all on table public.gift_cards from public, anon, authenticated;
grant select on table public.gift_cards to authenticated;

-- The list carries every code, so it is the OWNER's; staff spend a card at
-- the till by typing its code into redeem_gift_card_pos().
drop policy if exists gift_cards_owner_read on public.gift_cards;
create policy gift_cards_owner_read on public.gift_cards
  for select to authenticated
  using (public.is_store_owner(store_id));

create table if not exists public.gift_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null,
  -- In the CARD's currency. Always positive; kind says which way it moved.
  amount numeric(14, 2) not null,
  currency text not null,
  -- What it paid (or took back) on the order / sale, in USD.
  amount_usd numeric(14, 2) not null,
  -- The order's / sale's own snapshot used for an LBP card; null for USD.
  fx_rate numeric(14, 4),
  order_id uuid references public.orders(id) on delete set null,
  pos_sale_id uuid references public.pos_sales(id) on delete set null,
  order_payment_id uuid references public.order_payments(id) on delete set null,
  refund_of uuid unique references public.gift_card_redemptions(id) on delete cascade,
  actor_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint gift_card_redemptions_kind_check check (kind in ('redeem', 'refund')),
  constraint gift_card_redemptions_amount_check check (amount > 0 and amount_usd >= 0),
  constraint gift_card_redemptions_currency_check check (currency in ('USD', 'LBP')),
  constraint gift_card_redemptions_refund_link check ((kind = 'refund') = (refund_of is not null))
);

comment on table public.gift_card_redemptions is
  'Append-only gift card movements: redeem (against an order or POS sale) and refund (order cancelled/rejected, sale deleted). amount in the card currency, amount_usd what it paid on the USD order.';

create index if not exists gift_card_redemptions_card_idx on public.gift_card_redemptions (gift_card_id, created_at desc);
create index if not exists gift_card_redemptions_store_idx on public.gift_card_redemptions (store_id, created_at desc);
create index if not exists gift_card_redemptions_order_idx on public.gift_card_redemptions (order_id);
create index if not exists gift_card_redemptions_sale_idx on public.gift_card_redemptions (pos_sale_id);
create index if not exists gift_card_redemptions_payment_idx on public.gift_card_redemptions (order_payment_id);
create index if not exists gift_card_redemptions_actor_idx on public.gift_card_redemptions (actor_id);

alter table public.gift_card_redemptions enable row level security;
revoke all on table public.gift_card_redemptions from public, anon, authenticated;
grant select on table public.gift_card_redemptions to authenticated;

drop policy if exists gift_card_redemptions_owner_read on public.gift_card_redemptions;
create policy gift_card_redemptions_owner_read on public.gift_card_redemptions
  for select to authenticated
  using (public.is_store_owner(store_id));


-- ---------------------------------------------------------------------------
-- 5. The existing points: one earn rate per store
-- ---------------------------------------------------------------------------
-- 1 unless the store runs an ACTIVE points program on a Pro/Business plan,
-- in which case it is that program's points_per_usd. Every store without a
-- program — every store today — keeps exactly 1 point per whole $1.
create or replace function public.loyalty_points_rate(p_store_id uuid)
returns integer
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    (select p.points_per_usd
       from public.loyalty_programs p
      where p.store_id = p_store_id
        and p.kind = 'points'
        and p.is_active
        and public.store_plan_is_pro(p_store_id)),
    1);
$function$;

revoke all on function public.loyalty_points_rate(uuid) from public, anon, authenticated;

-- award_loyalty_on_complete, restated from the LIVE definition (pg_get_
-- functiondef, 2026-09-25 — identical to 0095). The ONLY change is the line
-- marked 0310: the order points are multiplied by the store's rate, so the
-- merchant's "X points per $1" applies to account holders too. Referral
-- bonuses, idempotency and everything else are byte-for-byte what runs today.
create or replace function public.award_loyalty_on_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_pts int; v_ref record; v_bonus int := 200;
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed')
     and new.customer_id is not null then

    if not exists (
      select 1 from public.loyalty_ledger where order_id = new.id and reason = 'order'
    ) then
      v_pts := (floor(new.total) * public.loyalty_points_rate(new.store_id))::int; -- 0310
      if v_pts > 0 then
        insert into public.loyalty_ledger (user_id, delta, reason, order_id, store_id)
        values (new.customer_id, v_pts, 'order', new.id, new.store_id);
      end if;
    end if;

    select * into v_ref from public.referrals
      where referred_id = new.customer_id and status = 'pending';
    if found then
      update public.referrals set status = 'rewarded', rewarded_at = now()
        where id = v_ref.id;
      insert into public.loyalty_ledger (user_id, delta, reason, order_id, store_id) values
        (v_ref.referred_id, v_bonus, 'referral_referred', new.id, new.store_id),
        (v_ref.referrer_id, v_bonus, 'referral_referrer', new.id, new.store_id);
    end if;
  end if;
  return new;
end; $function$;

-- Restated as 0281 left it: a trigger function nobody may call directly.
revoke all on function public.award_loyalty_on_complete() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Earning on a phone account (internal)
-- ---------------------------------------------------------------------------
-- Find or create the member for (store, phone). Internal: called only from the
-- definer functions below.
create or replace function public.loyalty_account_upsert(
  p_store_id uuid,
  p_phone text,
  p_name text
)
returns public.loyalty_accounts
language plpgsql
set search_path = ''
as $function$
declare
  v_key text := public.wa_phone_key(p_phone);
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  v_row public.loyalty_accounts;
begin
  if v_key is null or v_key !~ '^[0-9]{6,15}$' then
    return null;
  end if;
  insert into public.loyalty_accounts as a (store_id, phone_key, display_name)
  values (p_store_id, v_key, v_name)
  on conflict (store_id, phone_key) do update
    set display_name = coalesce(a.display_name, excluded.display_name),
        last_activity_at = now()
  returning * into v_row;
  return v_row;
end
$function$;

revoke all on function public.loyalty_account_upsert(uuid, text, text) from public, anon, authenticated;

-- Credit ONE purchase (p_source 'order' | 'pos') to the phone account under
-- the store's program. Returns null when nothing is earned (no program, plan
-- below Pro, no usable phone, nothing qualifying, or a signed-in order under a
-- points program — that one earns in loyalty_ledger instead). Idempotent: a
-- second call for the same purchase inserts nothing and returns null.
create or replace function public.loyalty_earn(
  p_source text,
  p_source_id uuid,
  p_phone text,
  p_name text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_store_id uuid;
  v_total numeric;
  v_customer uuid;
  v_prog public.loyalty_programs;
  v_acc public.loyalty_accounts;
  v_delta integer := 0;
  v_id uuid;
begin
  if p_source = 'order' then
    select o.store_id, o.total, o.customer_id into v_store_id, v_total, v_customer
      from public.orders o where o.id = p_source_id;
  elsif p_source = 'pos' then
    select s.store_id, s.total into v_store_id, v_total
      from public.pos_sales s where s.id = p_source_id;
  else
    return null;
  end if;
  if v_store_id is null then
    return null;
  end if;

  select * into v_prog from public.loyalty_programs p
   where p.store_id = v_store_id and p.is_active;
  if not found or not public.store_plan_is_pro(v_store_id) then
    return null;
  end if;

  if v_prog.kind = 'points' then
    if p_source = 'order' and v_customer is not null then
      return null;  -- the account holder earns in loyalty_ledger (§5)
    end if;
    v_delta := least(floor(greatest(coalesce(v_total, 0), 0)) * v_prog.points_per_usd, 1000000)::int;
  elsif v_prog.stamp_scope = 'order' then
    v_delta := case when coalesce(v_total, 0) > 0 then 1 else 0 end;
  elsif p_source = 'order' then
    select coalesce(sum(oi.quantity), 0)::int into v_delta
      from public.order_items oi
      left join public.products pr on pr.id = oi.product_id
     where oi.order_id = p_source_id
       and ((v_prog.stamp_scope = 'product' and oi.product_id = v_prog.scope_product_id)
         or (v_prog.stamp_scope = 'section' and pr.section_id = v_prog.scope_section_id));
  else
    select coalesce(sum(si.qty), 0)::int into v_delta
      from public.pos_sale_items si
      left join public.products pr on pr.id = si.product_id
     where si.sale_id = p_source_id
       and ((v_prog.stamp_scope = 'product' and si.product_id = v_prog.scope_product_id)
         or (v_prog.stamp_scope = 'section' and pr.section_id = v_prog.scope_section_id));
  end if;

  -- A single purchase can fill at most five cards' worth of stamps; a typo of
  -- 999 units should not hand out 99 free coffees.
  if v_prog.kind = 'stamps' then
    v_delta := least(v_delta, v_prog.stamps_required * 5);
  else
    v_delta := least(v_delta, 1000000);  -- loyalty_events_delta_check
  end if;
  if v_delta <= 0 then
    return null;
  end if;

  v_acc := public.loyalty_account_upsert(v_store_id, p_phone, p_name);
  if v_acc.id is null then
    return null;
  end if;

  if p_source = 'order' then
    insert into public.loyalty_events (account_id, store_id, kind, delta, reason, order_id)
    values (v_acc.id, v_store_id, v_prog.kind, v_delta, 'order', p_source_id)
    on conflict (order_id, kind) where reason = 'order' do nothing
    returning id into v_id;
  else
    insert into public.loyalty_events (account_id, store_id, kind, delta, reason, pos_sale_id)
    values (v_acc.id, v_store_id, v_prog.kind, v_delta, 'pos', p_source_id)
    on conflict (pos_sale_id, kind) where reason = 'pos' do nothing
    returning id into v_id;
  end if;
  if v_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'account_id', v_acc.id,
    'token', v_acc.token,
    'kind', v_prog.kind,
    'delta', v_delta,
    'balance', (select coalesce(sum(e.delta), 0)::int from public.loyalty_events e
                 where e.account_id = v_acc.id and e.kind = v_prog.kind)
  );
end
$function$;

revoke all on function public.loyalty_earn(text, uuid, text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Online orders: earn on completion
-- ---------------------------------------------------------------------------
-- AFTER UPDATE, only on the transition to 'completed' (the WHEN clause keeps it
-- off every other update). It can never fail the order: completing an order
-- is the merchant's job and a loyalty problem must not block it.
create or replace function public.loyalty_card_on_order_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    perform public.loyalty_earn('order', new.id, new.phone, new.customer_name);
  exception when others then
    raise warning 'loyalty_card_on_order_complete(%): %', new.id, sqlerrm;
  end;
  return new;
end
$function$;

revoke all on function public.loyalty_card_on_order_complete() from public, anon, authenticated;

drop trigger if exists orders_loyalty_card_award on public.orders;
create trigger orders_loyalty_card_award
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.loyalty_card_on_order_complete();


-- ---------------------------------------------------------------------------
-- 8. Merchant RPCs — loyalty
-- ---------------------------------------------------------------------------
create or replace function public.set_loyalty_program(
  p_store_id uuid,
  p_kind text,
  p_is_active boolean,
  p_stamps_required integer,
  p_stamp_scope text,
  p_scope_product_id uuid,
  p_scope_section_id uuid,
  p_points_per_usd integer,
  p_redeem_threshold integer,
  p_reward_label text,
  p_reward_label_en text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope text := coalesce(p_stamp_scope, 'order');
begin
  if p_store_id is null or not public.is_store_owner(p_store_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.store_plan_is_pro(p_store_id) then
    raise exception 'plan_required' using errcode = 'check_violation',
      hint = 'Loyalty cards are included in Pro and Business.';
  end if;
  if p_kind not in ('stamps', 'points') then
    raise exception 'bad_kind' using errcode = 'check_violation';
  end if;
  if v_scope = 'product' and not exists (
    select 1 from public.products pr
     where pr.id = p_scope_product_id and pr.store_id = p_store_id and pr.deleted_at is null) then
    raise exception 'bad_product' using errcode = 'check_violation';
  end if;
  if v_scope = 'section' and not exists (
    select 1 from public.store_sections ss
     where ss.id = p_scope_section_id and ss.store_id = p_store_id) then
    raise exception 'bad_section' using errcode = 'check_violation';
  end if;

  insert into public.loyalty_programs as p (
    store_id, kind, is_active, stamps_required, stamp_scope, scope_product_id,
    scope_section_id, points_per_usd, redeem_threshold, reward_label,
    reward_label_en, updated_at, updated_by)
  values (
    p_store_id, p_kind, coalesce(p_is_active, true), coalesce(p_stamps_required, 10), v_scope,
    case when v_scope = 'product' then p_scope_product_id end,
    case when v_scope = 'section' then p_scope_section_id end,
    coalesce(p_points_per_usd, 1), coalesce(p_redeem_threshold, 100),
    nullif(btrim(coalesce(p_reward_label, '')), ''),
    nullif(btrim(coalesce(p_reward_label_en, '')), ''),
    now(), (select auth.uid()))
  on conflict (store_id) do update set
    kind = excluded.kind,
    is_active = excluded.is_active,
    stamps_required = excluded.stamps_required,
    stamp_scope = excluded.stamp_scope,
    scope_product_id = excluded.scope_product_id,
    scope_section_id = excluded.scope_section_id,
    points_per_usd = excluded.points_per_usd,
    redeem_threshold = excluded.redeem_threshold,
    reward_label = excluded.reward_label,
    reward_label_en = excluded.reward_label_en,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end
$function$;

comment on function public.set_loyalty_program(uuid, text, boolean, integer, text, uuid, uuid, integer, integer, text, text) is
  'Owner only, Pro/Business only: create or change the store''s loyalty program.';

revoke all on function public.set_loyalty_program(uuid, text, boolean, integer, text, uuid, uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.set_loyalty_program(uuid, text, boolean, integer, text, uuid, uuid, integer, integer, text, text) to authenticated;

-- Add a member by phone (or find the existing one). Returns id + card token.
create or replace function public.loyalty_add_member(
  p_store_id uuid,
  p_phone text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_acc public.loyalty_accounts;
begin
  if p_store_id is null or not public.staff_can(p_store_id, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.store_plan_is_pro(p_store_id) then
    raise exception 'plan_required' using errcode = 'check_violation';
  end if;
  v_acc := public.loyalty_account_upsert(p_store_id, p_phone, p_name);
  if v_acc.id is null then
    raise exception 'bad_phone' using errcode = 'check_violation';
  end if;
  return jsonb_build_object('id', v_acc.id, 'token', v_acc.token);
end
$function$;

revoke all on function public.loyalty_add_member(uuid, text, text) from public, anon, authenticated;
grant execute on function public.loyalty_add_member(uuid, text, text) to authenticated;

-- Manual adjustment with a reason. Adding needs the plan; taking away does
-- not (a merchant correcting a mistake after a downgrade must still be able
-- to). The balance can never go below zero.
create or replace function public.loyalty_adjust(
  p_account_id uuid,
  p_kind text,
  p_delta integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_acc public.loyalty_accounts;
  v_balance integer;
begin
  select * into v_acc from public.loyalty_accounts a where a.id = p_account_id for update;
  if v_acc.id is null or not public.staff_can(v_acc.store_id, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('stamps', 'points') or p_delta is null or p_delta = 0
     or abs(p_delta) > 10000 then
    raise exception 'bad_amount' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 2 then
    raise exception 'reason_required' using errcode = 'check_violation';
  end if;
  if p_delta > 0 and not public.store_plan_is_pro(v_acc.store_id) then
    raise exception 'plan_required' using errcode = 'check_violation';
  end if;

  select coalesce(sum(e.delta), 0)::int into v_balance
    from public.loyalty_events e where e.account_id = v_acc.id and e.kind = p_kind;
  if v_balance + p_delta < 0 then
    raise exception 'insufficient_balance' using errcode = 'check_violation';
  end if;

  insert into public.loyalty_events (account_id, store_id, kind, delta, reason, note)
  values (v_acc.id, v_acc.store_id, p_kind, p_delta, 'adjust', left(btrim(p_note), 200));
  update public.loyalty_accounts set last_activity_at = now() where id = v_acc.id;
  return v_balance + p_delta;
end
$function$;

revoke all on function public.loyalty_adjust(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.loyalty_adjust(uuid, text, integer, text) to authenticated;

-- Give the reward: takes one card's worth (N stamps, or the points threshold)
-- off the member, under a row lock so two taps cannot give two rewards. No
-- plan check: an earned reward is honoured after a downgrade.
create or replace function public.loyalty_redeem_reward(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_acc public.loyalty_accounts;
  v_prog public.loyalty_programs;
  v_cost integer;
  v_balance integer;
begin
  select * into v_acc from public.loyalty_accounts a where a.id = p_account_id for update;
  if v_acc.id is null or not public.staff_can(v_acc.store_id, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_prog from public.loyalty_programs p where p.store_id = v_acc.store_id;
  if not found then
    raise exception 'no_program' using errcode = 'check_violation';
  end if;
  v_cost := case v_prog.kind when 'stamps' then v_prog.stamps_required else v_prog.redeem_threshold end;

  select coalesce(sum(e.delta), 0)::int into v_balance
    from public.loyalty_events e where e.account_id = v_acc.id and e.kind = v_prog.kind;
  if v_balance < v_cost then
    raise exception 'not_enough' using errcode = 'check_violation';
  end if;

  insert into public.loyalty_events (account_id, store_id, kind, delta, reason, note)
  values (v_acc.id, v_acc.store_id, v_prog.kind, -v_cost, 'reward',
          left(coalesce(v_prog.reward_label, v_prog.reward_label_en), 200));
  update public.loyalty_accounts set last_activity_at = now() where id = v_acc.id;
  return jsonb_build_object('kind', v_prog.kind, 'spent', v_cost, 'balance', v_balance - v_cost);
end
$function$;

revoke all on function public.loyalty_redeem_reward(uuid) from public, anon, authenticated;
grant execute on function public.loyalty_redeem_reward(uuid) to authenticated;

-- POS: attach a customer's phone to a sale the cashier JUST recorded. The sale
-- must be this store's, less than 24 hours old, and not already credited.
create or replace function public.loyalty_credit_pos_sale(
  p_sale_id uuid,
  p_phone text,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sale public.pos_sales;
begin
  select * into v_sale from public.pos_sales s where s.id = p_sale_id;
  if v_sale.id is null
     or not (public.staff_can(v_sale.store_id, 'orders') or public.staff_can(v_sale.store_id, 'pos')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_sale.created_at < now() - interval '24 hours' then
    raise exception 'sale_too_old' using errcode = 'check_violation';
  end if;
  if public.wa_phone_key(p_phone) is null then
    raise exception 'bad_phone' using errcode = 'check_violation';
  end if;
  return public.loyalty_earn('pos', v_sale.id, p_phone, p_name);
end
$function$;

revoke all on function public.loyalty_credit_pos_sale(uuid, text, text) from public, anon, authenticated;
grant execute on function public.loyalty_credit_pos_sale(uuid, text, text) to authenticated;

-- The members list with balances, newest activity first.
create or replace function public.store_loyalty_members(p_store_id uuid)
returns table (
  id uuid,
  phone_key text,
  display_name text,
  token text,
  stamps integer,
  points integer,
  created_at timestamptz,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
begin
  if p_store_id is null or not public.staff_can(p_store_id, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select a.id, a.phone_key, a.display_name, a.token,
         coalesce(sum(e.delta) filter (where e.kind = 'stamps'), 0)::int,
         coalesce(sum(e.delta) filter (where e.kind = 'points'), 0)::int,
         a.created_at, a.last_activity_at
    from public.loyalty_accounts a
    left join public.loyalty_events e on e.account_id = a.id
   where a.store_id = p_store_id
   group by a.id
   order by a.last_activity_at desc
   limit 1000;
end
$function$;

revoke all on function public.store_loyalty_members(uuid) from public, anon, authenticated;
grant execute on function public.store_loyalty_members(uuid) to authenticated;

-- The public card. Store name + logo, the program, the member's NAME (never
-- the phone), balances and the last 20 movements (no staff identity, no
-- ids). NULL for an unknown token or a deleted store -> the page 404s.
create or replace function public.get_loyalty_card(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_acc public.loyalty_accounts;
  v_store record;
  v_prog public.loyalty_programs;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24,64}$' then
    return null;
  end if;
  select * into v_acc from public.loyalty_accounts a where a.token = p_token;
  if v_acc.id is null then
    return null;
  end if;
  select s.name, s.logo_url into v_store
    from public.stores s where s.id = v_acc.store_id and s.deleted_at is null;
  if not found then
    return null;
  end if;
  select * into v_prog from public.loyalty_programs p where p.store_id = v_acc.store_id;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'logo_url', v_store.logo_url),
    'member', jsonb_build_object('name', v_acc.display_name),
    'program', case when v_prog.store_id is null then null else jsonb_build_object(
      'kind', v_prog.kind,
      'is_active', v_prog.is_active,
      'stamps_required', v_prog.stamps_required,
      'points_per_usd', v_prog.points_per_usd,
      'redeem_threshold', v_prog.redeem_threshold,
      'reward_label', v_prog.reward_label,
      'reward_label_en', v_prog.reward_label_en) end,
    'stamps', (select coalesce(sum(e.delta), 0)::int from public.loyalty_events e
                where e.account_id = v_acc.id and e.kind = 'stamps'),
    'points', (select coalesce(sum(e.delta), 0)::int from public.loyalty_events e
                where e.account_id = v_acc.id and e.kind = 'points'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.created_at, 'kind', x.kind,
                                          'delta', x.delta, 'reason', x.reason)
                       order by x.created_at desc)
        from (select e.created_at, e.kind, e.delta, e.reason
                from public.loyalty_events e
               where e.account_id = v_acc.id
               order by e.created_at desc
               limit 20) x), '[]'::jsonb),
    'generated_at', now()
  );
end
$function$;

comment on function public.get_loyalty_card(text) is
  'Anonymous, read-only loyalty card for one token: store name/logo, program, member name (never the phone), balances, last 20 movements. NULL when unknown.';

revoke all on function public.get_loyalty_card(text) from public, anon, authenticated;
grant execute on function public.get_loyalty_card(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. Gift cards — issue, void, check, read
-- ---------------------------------------------------------------------------
create or replace function public.issue_gift_card(
  p_store_id uuid,
  p_currency text,
  p_amount numeric,
  p_expires_on date,
  p_recipient_name text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_alpha constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_currency text := upper(coalesce(p_currency, ''));
  v_today date := (now() at time zone 'Asia/Beirut')::date;
  v_bytes bytea;
  v_code text;
  v_row public.gift_cards;
  v_try integer := 0;
begin
  if p_store_id is null or not public.is_store_owner(p_store_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.store_plan_is_pro(p_store_id) then
    raise exception 'plan_required' using errcode = 'check_violation',
      hint = 'Gift cards are included in Pro and Business.';
  end if;
  if v_currency not in ('USD', 'LBP') then
    raise exception 'bad_currency' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0
     or (v_currency = 'USD' and (p_amount > 10000 or p_amount <> round(p_amount, 2)))
     or (v_currency = 'LBP' and (p_amount > 1000000000 or p_amount <> round(p_amount))) then
    raise exception 'bad_amount' using errcode = 'check_violation';
  end if;
  if p_expires_on is not null and (p_expires_on < v_today or p_expires_on > v_today + 1830) then
    raise exception 'bad_expiry' using errcode = 'check_violation';
  end if;

  loop
    v_try := v_try + 1;
    v_bytes := extensions.gen_random_bytes(12);
    v_code := '';
    for i in 0..11 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) & 31) + 1, 1);
    end loop;
    begin
      insert into public.gift_cards (store_id, code, currency, initial_amount, balance,
                                     recipient_name, note, expires_on)
      values (p_store_id, v_code, v_currency, p_amount, p_amount,
              nullif(left(btrim(coalesce(p_recipient_name, '')), 80), ''),
              nullif(left(btrim(coalesce(p_note, '')), 200), ''),
              p_expires_on)
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'token', v_row.token);
end
$function$;

revoke all on function public.issue_gift_card(uuid, text, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.issue_gift_card(uuid, text, numeric, date, text, text) to authenticated;

-- Voiding stops future spending; it does not move money. No plan check.
create or replace function public.void_gift_card(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
begin
  select g.store_id into v_store from public.gift_cards g where g.id = p_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.gift_cards
     set status = 'void', voided_at = now(), voided_by = (select auth.uid())
   where id = p_id and status = 'active';
  return found;
end
$function$;

revoke all on function public.void_gift_card(uuid) from public, anon, authenticated;
grant execute on function public.void_gift_card(uuid) to authenticated;

-- Does this store take gift cards at checkout? (Any spendable card exists.)
-- Public: the checkout shows the field only when the answer is yes.
create or replace function public.store_accepts_gift_cards(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.gift_cards g
     where g.store_id = p_store_id and g.status = 'active' and g.balance > 0
       and (g.expires_on is null or g.expires_on >= (now() at time zone 'Asia/Beirut')::date)
  );
$function$;

revoke all on function public.store_accepts_gift_cards(uuid) from public, anon, authenticated;
grant execute on function public.store_accepts_gift_cards(uuid) to anon, authenticated;

-- Check a code at a store before spending it. Never says whether a code
-- exists at ANOTHER store: wrong store and unknown are the same answer.
create or replace function public.gift_card_check(p_store_id uuid, p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_code text := public.gift_code_normalize(p_code);
  v_card public.gift_cards;
begin
  if v_code !~ '^[2-9A-HJ-NP-Z]{12}$' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_card from public.gift_cards g where g.code = v_code and g.store_id = p_store_id;
  if v_card.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_card.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'void');
  end if;
  if v_card.expires_on is not null and v_card.expires_on < (now() at time zone 'Asia/Beirut')::date then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_card.balance <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  return jsonb_build_object('ok', true, 'currency', v_card.currency,
                            'balance', v_card.balance, 'expires_on', v_card.expires_on);
end
$function$;

revoke all on function public.gift_card_check(uuid, text) from public, anon, authenticated;
grant execute on function public.gift_card_check(uuid, text) to anon, authenticated;

-- The public gift-card page: balance, never the code.
create or replace function public.get_gift_card(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_card public.gift_cards;
  v_store record;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24,64}$' then
    return null;
  end if;
  select * into v_card from public.gift_cards g where g.token = p_token;
  if v_card.id is null then
    return null;
  end if;
  select s.name, s.logo_url into v_store
    from public.stores s where s.id = v_card.store_id and s.deleted_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'logo_url', v_store.logo_url),
    'currency', v_card.currency,
    'initial_amount', v_card.initial_amount,
    'balance', v_card.balance,
    'expires_on', v_card.expires_on,
    'status', case
                when v_card.status = 'void' then 'void'
                when v_card.expires_on is not null
                     and v_card.expires_on < (now() at time zone 'Asia/Beirut')::date then 'expired'
                else 'active' end,
    'recipient_name', v_card.recipient_name,
    'issued_on', v_card.created_at,
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.created_at, 'kind', x.kind, 'amount', x.amount)
                       order by x.created_at desc)
        from (select r.created_at, r.kind, r.amount
                from public.gift_card_redemptions r
               where r.gift_card_id = v_card.id
               order by r.created_at desc
               limit 20) x), '[]'::jsonb),
    'generated_at', now()
  );
end
$function$;

comment on function public.get_gift_card(text) is
  'Anonymous, read-only gift card for one token: store, currency, initial amount, balance, expiry, status, recipient name, last 20 movements. Never the code. NULL when unknown.';

revoke all on function public.get_gift_card(text) from public, anon, authenticated;
grant execute on function public.get_gift_card(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. Gift cards — spending (the race-safe core)
-- ---------------------------------------------------------------------------
-- Debit a LOCKED card against a USD amount due, at a given snapshot rate.
-- Internal. Returns (card amount debited, USD credited) or raises.
create or replace function public.gift_card_debit(
  p_card public.gift_cards,
  p_due_usd numeric,
  p_rate numeric
)
returns table (card_amount numeric, usd_amount numeric)
language plpgsql
set search_path = ''
as $function$
declare
  v_card numeric(14, 2);
  v_usd numeric(14, 2);
  v_due_lbp numeric;
begin
  if p_card.status <> 'active' then
    raise exception 'card_void' using errcode = 'check_violation';
  end if;
  if p_card.expires_on is not null and p_card.expires_on < (now() at time zone 'Asia/Beirut')::date then
    raise exception 'card_expired' using errcode = 'check_violation';
  end if;
  if p_card.balance <= 0 then
    raise exception 'card_empty' using errcode = 'check_violation';
  end if;
  if p_due_usd is null or p_due_usd <= 0 then
    raise exception 'nothing_due' using errcode = 'check_violation';
  end if;

  if p_card.currency = 'USD' then
    v_card := least(p_card.balance, round(p_due_usd, 2));
    v_usd := v_card;
  else
    if p_rate is null or p_rate <= 0 then
      raise exception 'no_rate' using errcode = 'check_violation';
    end if;
    v_due_lbp := round(p_due_usd * p_rate);
    v_card := least(p_card.balance, v_due_lbp);
    v_usd := case when v_card >= v_due_lbp then round(p_due_usd, 2)
                  else trunc(v_card / p_rate, 2) end;
  end if;
  if v_card <= 0 or v_usd <= 0 then
    raise exception 'nothing_due' using errcode = 'check_violation';
  end if;

  -- The balance check lives in the UPDATE itself as well as in the lock the
  -- caller holds: belt and braces for a card spent twice at once.
  update public.gift_cards set balance = balance - v_card
   where id = p_card.id and balance >= v_card and status = 'active';
  if not found then
    raise exception 'card_empty' using errcode = 'check_violation';
  end if;

  card_amount := v_card;
  usd_amount := v_usd;
  return next;
end
$function$;

revoke all on function public.gift_card_debit(public.gift_cards, numeric, numeric) from public, anon, authenticated;

-- Online: spend a code on an order the caller just placed.
--   * the order is pending and at most 30 minutes old;
--   * a signed-in customer's order may be paid only by that customer; a
--     guest order by whoever holds its id (returned only to the browser that
--     placed it) — and the card code is the spending credential anyway;
--   * the card belongs to the order's store.
-- Writes one order_payments row (USD) and one redemption row.
create or replace function public.redeem_gift_card_order(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders;
  v_card public.gift_cards;
  v_code text := public.gift_code_normalize(p_code);
  v_net_paid numeric;
  v_card_amount numeric;
  v_usd numeric;
  v_payment uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = 'check_violation';
  end if;
  if v_order.customer_id is not null and v_order.customer_id is distinct from (select auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_order.status <> 'pending' or v_order.created_at < now() - interval '30 minutes' then
    raise exception 'order_not_open' using errcode = 'check_violation';
  end if;

  select * into v_card from public.gift_cards g
   where g.code = v_code and g.store_id = v_order.store_id
   for update;
  if v_card.id is null then
    raise exception 'card_not_found' using errcode = 'check_violation';
  end if;

  select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0)
    into v_net_paid
    from public.order_payments p where p.order_id = v_order.id;

  select d.card_amount, d.usd_amount into v_card_amount, v_usd
    from public.gift_card_debit(v_card, v_order.total - v_net_paid, v_order.fx_rate) d;

  insert into public.order_payments (order_id, store_id, kind, amount, method, note, actor_id, currency, fx_rate)
  values (v_order.id, v_order.store_id, 'payment', v_usd, 'بطاقة هدية · Gift card',
          '…' || right(v_card.code, 4), (select auth.uid()), 'USD', v_order.fx_rate)
  returning id into v_payment;

  insert into public.gift_card_redemptions (gift_card_id, store_id, kind, amount, currency,
                                            amount_usd, fx_rate, order_id, order_payment_id)
  values (v_card.id, v_order.store_id, 'redeem', v_card_amount, v_card.currency, v_usd,
          case when v_card.currency = 'LBP' then v_order.fx_rate end, v_order.id, v_payment);

  return jsonb_build_object(
    'applied_usd', v_usd,
    'applied_amount', v_card_amount,
    'currency', v_card.currency,
    'card_balance', v_card.balance - v_card_amount,
    'due_usd', greatest(v_order.total - v_net_paid - v_usd, 0)
  );
end
$function$;

revoke all on function public.redeem_gift_card_order(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_gift_card_order(uuid, text) to anon, authenticated;

-- POS: spend a code on a sale the cashier just recorded (24h window).
create or replace function public.redeem_gift_card_pos(p_sale_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sale public.pos_sales;
  v_card public.gift_cards;
  v_code text := public.gift_code_normalize(p_code);
  v_covered numeric;
  v_card_amount numeric;
  v_usd numeric;
begin
  select * into v_sale from public.pos_sales s where s.id = p_sale_id for update;
  if v_sale.id is null
     or not (public.staff_can(v_sale.store_id, 'orders') or public.staff_can(v_sale.store_id, 'pos')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_sale.created_at < now() - interval '24 hours' then
    raise exception 'sale_too_old' using errcode = 'check_violation';
  end if;

  select * into v_card from public.gift_cards g
   where g.code = v_code and g.store_id = v_sale.store_id
   for update;
  if v_card.id is null then
    raise exception 'card_not_found' using errcode = 'check_violation';
  end if;

  select coalesce(sum(case when r.kind = 'redeem' then r.amount_usd else -r.amount_usd end), 0)
    into v_covered
    from public.gift_card_redemptions r where r.pos_sale_id = v_sale.id;

  select d.card_amount, d.usd_amount into v_card_amount, v_usd
    from public.gift_card_debit(v_card, v_sale.total - v_covered, v_sale.fx_rate) d;

  insert into public.gift_card_redemptions (gift_card_id, store_id, kind, amount, currency,
                                            amount_usd, fx_rate, pos_sale_id)
  values (v_card.id, v_sale.store_id, 'redeem', v_card_amount, v_card.currency, v_usd,
          case when v_card.currency = 'LBP' then v_sale.fx_rate end, v_sale.id);

  return jsonb_build_object(
    'applied_usd', v_usd,
    'applied_amount', v_card_amount,
    'currency', v_card.currency,
    'card_balance', v_card.balance - v_card_amount,
    'due_usd', greatest(v_sale.total - v_covered - v_usd, 0)
  );
end
$function$;

revoke all on function public.redeem_gift_card_pos(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_gift_card_pos(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. Putting money back: cancelled / rejected orders, deleted POS sales
-- ---------------------------------------------------------------------------
-- Every unrefunded redemption of the order goes back on its card (capped at
-- the card's initial amount by the table check), with the matching
-- order_payments refund. Exactly once per redemption (refund_of is unique).
-- Not swallowed: if money cannot be put back, the cancellation fails loudly
-- rather than losing a customer's balance.
create or replace function public.gift_card_refund_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_r public.gift_card_redemptions;
  v_payment uuid;
begin
  for v_r in
    select r.* from public.gift_card_redemptions r
     where r.order_id = new.id and r.kind = 'redeem'
       and not exists (select 1 from public.gift_card_redemptions x where x.refund_of = r.id)
     order by r.created_at
  loop
    perform 1 from public.gift_cards g where g.id = v_r.gift_card_id for update;
    update public.gift_cards set balance = least(initial_amount, balance + v_r.amount)
     where id = v_r.gift_card_id;
    insert into public.order_payments (order_id, store_id, kind, amount, method, note, actor_id, currency, fx_rate)
    values (new.id, new.store_id, 'refund', v_r.amount_usd, 'بطاقة هدية · Gift card',
            'order ' || new.status::text, (select auth.uid()), 'USD', new.fx_rate)
    returning id into v_payment;
    insert into public.gift_card_redemptions (gift_card_id, store_id, kind, amount, currency,
                                              amount_usd, fx_rate, order_id, order_payment_id, refund_of)
    values (v_r.gift_card_id, v_r.store_id, 'refund', v_r.amount, v_r.currency, v_r.amount_usd,
            v_r.fx_rate, new.id, v_payment, v_r.id);
  end loop;
  return new;
end
$function$;

revoke all on function public.gift_card_refund_on_cancel() from public, anon, authenticated;

drop trigger if exists orders_gift_card_refund on public.orders;
create trigger orders_gift_card_refund
  after update of status on public.orders
  for each row
  when (new.status in ('cancelled', 'rejected') and old.status not in ('cancelled', 'rejected'))
  execute function public.gift_card_refund_on_cancel();

-- A deleted POS sale (the merchant voiding a till entry): its gift-card
-- spending goes back on the cards and its stamps/points come off the member
-- (never below zero — a reward already given is not clawed back).
create or replace function public.pos_sale_reverse_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_r public.gift_card_redemptions;
  v_e public.loyalty_events;
  v_balance integer;
  v_take integer;
begin
  for v_r in
    select r.* from public.gift_card_redemptions r
     where r.pos_sale_id = old.id and r.kind = 'redeem'
       and not exists (select 1 from public.gift_card_redemptions x where x.refund_of = r.id)
  loop
    perform 1 from public.gift_cards g where g.id = v_r.gift_card_id for update;
    update public.gift_cards set balance = least(initial_amount, balance + v_r.amount)
     where id = v_r.gift_card_id;
    insert into public.gift_card_redemptions (gift_card_id, store_id, kind, amount, currency,
                                              amount_usd, fx_rate, pos_sale_id, refund_of)
    values (v_r.gift_card_id, v_r.store_id, 'refund', v_r.amount, v_r.currency, v_r.amount_usd,
            v_r.fx_rate, old.id, v_r.id);
  end loop;

  for v_e in
    select e.* from public.loyalty_events e where e.pos_sale_id = old.id and e.reason = 'pos'
  loop
    perform 1 from public.loyalty_accounts a where a.id = v_e.account_id for update;
    select coalesce(sum(x.delta), 0)::int into v_balance
      from public.loyalty_events x where x.account_id = v_e.account_id and x.kind = v_e.kind;
    v_take := least(v_e.delta, greatest(v_balance, 0));
    if v_take > 0 then
      insert into public.loyalty_events (account_id, store_id, kind, delta, reason, note)
      values (v_e.account_id, v_e.store_id, v_e.kind, -v_take, 'reversal', 'POS sale deleted');
    end if;
  end loop;
  return old;
end
$function$;

revoke all on function public.pos_sale_reverse_extras() from public, anon, authenticated;

drop trigger if exists pos_sales_reverse_extras on public.pos_sales;
create trigger pos_sales_reverse_extras
  before delete on public.pos_sales
  for each row execute function public.pos_sale_reverse_extras();
