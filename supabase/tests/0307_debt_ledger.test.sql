-- ============================================================================
-- 0307_debt_ledger.test.sql — rolled-back verification of migration 0307
-- ============================================================================
-- WHAT IT IS
--   The exact test the ledger migration was meant to pass BEFORE it is applied
--   to production. It is one transaction:
--
--     begin;
--       <the full text of supabase/migrations/0307_debt_ledger.sql, verbatim>
--       <fixtures: two stores, two owners, two staff, three customers>
--       <every assertion, acting as owner A, a staff member WITH the
--        `customers` permission, a staff member WITHOUT it, store B's owner,
--        and anon>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives: the migration, the fixtures and the rows written by the
--   checks all disappear at the `rollback`. Safe to run against production
--   (Supabase MCP execute_sql, the SQL editor, or `supabase db execute`).
--
--   The migration section is a verbatim copy of the migration file, spliced in
--   when this file was generated; if 0307 is edited,
--   regenerate this file (or paste the new migration between the two MIGRATION
--   markers) so the test exercises what will actually be applied.
--
--   Works whether or not 0307 is already applied: every statement in 0307 is
--   idempotent (if not exists / create or replace / drop ... if exists / on
--   conflict), so after the apply it doubles as a regression test.
--
-- HOW TO READ IT
--   The final select returns one row per check: `ok` true/false and `got`, the
--   value or error actually observed. The last row, `ALL CHECKS`, says how
--   many failed. Any `ok = false` row is a red run.
--
-- RULE THIS FOLLOWS (supabase-verify): seed first, then read AS the role. RLS
-- filters silently, so every "sees 0" is paired with a positive control from an
-- actor who must see that same row.
-- ============================================================================

begin;

-- ======================== MIGRATION 0307 (verbatim) =========================
-- 0307 — دفتر الدين: the customer ledger from 0211, made usable.
--
-- 0211 built the table (customer_transactions) and three functions, and nothing
-- in the app ever used them. This migration is what the merchant screen at
-- merchant/[storeId]/ledger and the public statement page at /statement/[token]
-- need, and it fixes the one defect that made 0211 unsafe to put in front of a
-- merchant:
--
--   customer_balance() and store_customer_balances() SUMMED ACROSS CURRENCIES.
--   A customer who owed $70 and 500,000 LBP had a "balance" of 500,070 — a
--   number that is neither dollars nor lira. Lebanese shops keep two columns in
--   the paper notebook precisely because the two are not interchangeable at a
--   fixed rate, and a debt recorded in lira is repaid in lira. So the balance is
--   now per currency, always, and nothing converts one into the other.
--
-- MAPPING (the product brief called these ledger_customers / ledger_entries):
--   ledger customer = public.store_customers   (the merchant's customer book)
--   ledger entry    = public.customer_transactions
--   «أعطيت» (I gave: goods on credit) = kind 'charge'
--   «استلمت» (I received: a repayment)  = kind 'payment'
--   'adjustment' is kept from 0211 and counts like a charge (amount >= 0).
--   `label` is the free-text note on an entry; no separate note column.
--
-- PERMISSION: the existing staff permission key `customers`, not a new one.
--   * staff_can() returns true for the store owner unconditionally, so the
--     owner always has the ledger — on every plan, including free.
--   * store_customers and customer_transactions have been gated on
--     staff_can(store_id, 'customers') since 0211; a staff member holding that
--     key could already read and write these exact rows through the API. A new
--     `ledger` key would have meant either widening store_customers' policy to
--     a second key (a surprise grant of every customer's phone number) or a
--     ledger screen that a `customers` holder could not open while the database
--     still let them write to it. Reusing the key grants nobody anything new.
--   * The PLAN gate on the `customers` module (PRO_MODULES in src/lib/plan.ts)
--     is an app-side gate on the CRM screen only. It is not in the database and
--     does not apply to the ledger, which is free on every plan.
--
-- SAFE AGAINST THE DEPLOYED CODE: nothing under src/ calls any of the functions
-- dropped or replaced here (checked with grep and against pg_proc.prosrc), and
-- customer_transactions holds zero rows in production, so the new CHECK
-- constraints validate against nothing.
--
-- 0294 note: customer_transactions is the merchant's business record and is
-- RETAINED when a customer deletes their account (it hangs off store_customers,
-- not off the auth user). Nothing here changes that.


-- ---------------------------------------------------------------------------
-- 1. customer_transactions: attachment, currency, shape checks
-- ---------------------------------------------------------------------------

-- A photo of the paper receipt / the handwritten page. A STORAGE PATH in the
-- private ledger-attachments bucket (section 6), never a public URL: the app
-- turns it into a short-lived signed URL for whoever may read the row.
alter table public.customer_transactions
  add column if not exists attachment_path text;

comment on column public.customer_transactions.attachment_path is
  'Object path inside the private ledger-attachments bucket, always "<store_id>/...". Never a URL; never shown on the public statement.';

-- Only the two currencies Lebanese shops actually keep a notebook in. The
-- column has defaulted to USD since 0211; this makes it a closed set.
alter table public.customer_transactions
  drop constraint if exists customer_transactions_currency_check;
alter table public.customer_transactions
  add constraint customer_transactions_currency_check
  check (currency in ('USD', 'LBP'));

-- An attachment must live under the row's own store prefix — the storage
-- policy (section 6) is what enforces who may READ that prefix, so a row
-- pointing into another store's folder would be a way to reference, and later
-- sign, somebody else's photo.
alter table public.customer_transactions
  drop constraint if exists customer_transactions_attachment_path_check;
alter table public.customer_transactions
  add constraint customer_transactions_attachment_path_check
  check (
    attachment_path is null
    or (
      left(attachment_path, 37) = store_id::text || '/'
      and char_length(attachment_path) between 38 and 300
      and position('..' in attachment_path) = 0
    )
  );

alter table public.customer_transactions
  drop constraint if exists customer_transactions_label_length_check;
alter table public.customer_transactions
  add constraint customer_transactions_label_length_check
  check (label is null or char_length(label) <= 500);

comment on table public.customer_transactions is
  'Customer credit ledger (دفتر الدين). charge = the customer now owes more («أعطيت»), payment = they paid some down («استلمت»), adjustment = a correction that adds to what is owed. Balance is the running sum PER CURRENCY, never a stored column, and USD and LBP are never added together.';

-- The policy from 0211, with one hole closed: its WITH CHECK only asked
-- whether the caller could write to store_id, not whether customer_id belongs
-- to that store. A staff member of store A could insert a row with store_id = A
-- and store B's customer_id, and that row would then appear on B's customer's
-- public statement. The customer must be a customer of the row's own store,
-- read through store_customers' own RLS (so another store's customer is not
-- even visible to the check).
drop policy if exists customer_transactions_manage on public.customer_transactions;
create policy customer_transactions_manage on public.customer_transactions
  for all to authenticated
  using (public.staff_can(store_id, 'customers'))
  with check (
    public.staff_can(store_id, 'customers')
    and exists (
      select 1 from public.store_customers c
      where c.id = customer_transactions.customer_id
        and c.store_id = customer_transactions.store_id
    )
  );

-- anon has no business on this table at all; RLS already returned nothing to
-- it, this takes the table-level privileges away as well.
revoke all on table public.customer_transactions from anon;

-- Who wrote a line is stamped by the database, not trusted from the client.
-- SECURITY INVOKER: it only reads the caller's own JWT.
create or replace function public.stamp_customer_tx_actor()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end
$function$;
revoke all on function public.stamp_customer_tx_actor() from public, anon, authenticated;

drop trigger if exists customer_tx_stamp_actor on public.customer_transactions;
create trigger customer_tx_stamp_actor
  before insert on public.customer_transactions
  for each row execute function public.stamp_customer_tx_actor();


-- ---------------------------------------------------------------------------
-- 2. Balances, per currency
-- ---------------------------------------------------------------------------
-- The two 0211 readers summed USD and LBP together. Their return shape has no
-- currency column, so they cannot be fixed in place (CREATE OR REPLACE cannot
-- change a return type); they are dropped and replaced by functions that
-- return one row per (customer, currency). Nothing calls the old ones.
drop function if exists public.customer_balance(uuid);
drop function if exists public.store_customer_balances(uuid);

-- SECURITY INVOKER on purpose: both tables are already RLS-gated on
-- staff_can(store_id, 'customers'), so running as the caller gives exactly the
-- right answer with no privilege to reason about. The explicit staff_can()
-- below is belt and braces — it makes "not allowed" an empty result even if a
-- policy is later loosened.
--
-- oldest_unpaid_charge_on is the date of the oldest charge that payments have
-- not yet covered, settling FIFO (a payment pays off the oldest debt first,
-- which is how a shopkeeper crosses lines out of the notebook). It drives the
-- "overdue more than N days" filter. NULL when nothing is owed.
create or replace function public.ledger_balances(p_store_id uuid)
returns table (
  customer_id uuid,
  name text,
  phone text,
  currency text,
  balance numeric,
  last_activity date,
  oldest_unpaid_charge_on date
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with tx as (
    select t.id, t.customer_id, t.currency, t.kind, t.amount, t.happened_on, t.created_at
    from public.customer_transactions t
    where t.store_id = p_store_id
      and public.staff_can(p_store_id, 'customers')
  ),
  paid as (
    select tx.customer_id, tx.currency, sum(tx.amount) as paid
    from tx
    where tx.kind = 'payment'
    group by tx.customer_id, tx.currency
  ),
  charges as (
    select tx.customer_id, tx.currency, tx.happened_on,
           sum(tx.amount) over (
             partition by tx.customer_id, tx.currency
             order by tx.happened_on, tx.created_at, tx.id
           ) as running
    from tx
    where tx.kind <> 'payment'
  ),
  oldest as (
    select ch.customer_id, ch.currency, min(ch.happened_on) as oldest_unpaid
    from charges ch
    left join paid p
      on p.customer_id = ch.customer_id and p.currency = ch.currency
    where ch.running > coalesce(p.paid, 0)
    group by ch.customer_id, ch.currency
  ),
  bal as (
    select tx.customer_id, tx.currency,
           sum(case tx.kind when 'payment' then -tx.amount else tx.amount end) as balance,
           max(tx.happened_on) as last_activity
    from tx
    group by tx.customer_id, tx.currency
  )
  select b.customer_id,
         c.name,
         c.phone,
         b.currency,
         b.balance,
         b.last_activity,
         case when b.balance > 0 then o.oldest_unpaid end
  from bal b
  join public.store_customers c
    on c.id = b.customer_id and c.store_id = p_store_id
  left join oldest o
    on o.customer_id = b.customer_id and o.currency = b.currency
  order by b.balance desc, c.name;
$function$;

comment on function public.ledger_balances(uuid) is
  'One row per (customer, currency) with any ledger activity in the store. balance > 0 = the customer owes the store. USD and LBP are separate rows and are never added together. oldest_unpaid_charge_on settles payments FIFO.';

revoke all on function public.ledger_balances(uuid) from public, anon, authenticated;
grant execute on function public.ledger_balances(uuid) to authenticated;

create or replace function public.ledger_customer_balances(p_customer_id uuid)
returns table (
  currency text,
  balance numeric,
  last_activity date,
  oldest_unpaid_charge_on date
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select b.currency, b.balance, b.last_activity, b.oldest_unpaid_charge_on
  from public.store_customers c
  cross join lateral public.ledger_balances(c.store_id) b
  where c.id = p_customer_id
    and b.customer_id = p_customer_id
  order by b.currency desc;
$function$;

comment on function public.ledger_customer_balances(uuid) is
  'Per-currency balance of one customer. Replaces 0211''s customer_balance(), which summed USD and LBP into one number.';

revoke all on function public.ledger_customer_balances(uuid) from public, anon, authenticated;
grant execute on function public.ledger_customer_balances(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. The writer, extended
-- ---------------------------------------------------------------------------
-- New optional arguments at the END (currency, attachment path), so every
-- existing call shape — positional or named, three to six arguments — resolves
-- exactly as before. The old six-argument signature is dropped first: leaving
-- it beside an eight-argument one whose extra parameters have defaults makes
-- every six-argument call ambiguous ("function is not unique").
drop function if exists public.record_customer_transaction(uuid, text, numeric, text, uuid, date);

create or replace function public.record_customer_transaction(
  p_customer_id uuid,
  p_kind text,
  p_amount numeric,
  p_label text default null,
  p_order_id uuid default null,
  p_happened_on date default null,
  p_currency text default 'USD',
  p_attachment_path text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
  v_id uuid;
  v_currency text := upper(coalesce(nullif(btrim(p_currency), ''), 'USD'));
  v_label text := nullif(btrim(p_label), '');
  v_path text := nullif(btrim(p_attachment_path), '');
begin
  select c.store_id into v_store
  from public.store_customers c
  where c.id = p_customer_id;
  if v_store is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if not public.staff_can(v_store, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('charge', 'payment', 'adjustment') then
    raise exception 'kind must be charge, payment or adjustment' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be zero or more' using errcode = '22023';
  end if;
  if v_currency not in ('USD', 'LBP') then
    raise exception 'currency must be USD or LBP' using errcode = '22023';
  end if;
  -- +1: the shop is in Beirut (UTC+2/+3) and current_date is UTC, so just after
  -- midnight in Beirut "today" is UTC tomorrow.
  if p_happened_on is not null and p_happened_on > current_date + 1 then
    raise exception 'date is in the future' using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
  if v_path is not null and (
       left(v_path, 37) <> v_store::text || '/'
       or position('..' in v_path) > 0
       or char_length(v_path) > 300
     ) then
    raise exception 'attachment must be stored under this store' using errcode = '22023';
  end if;
  -- 0211 accepted any order id. As a definer function that let a caller link
  -- another store's order to their own customer's line.
  if p_order_id is not null and not exists (
       select 1 from public.orders o
       where o.id = p_order_id and o.store_id = v_store
     ) then
    raise exception 'order not found in this store' using errcode = 'P0002';
  end if;

  insert into public.customer_transactions
    (store_id, customer_id, order_id, kind, label, amount, currency,
     attachment_path, happened_on, created_by)
  values
    (v_store, p_customer_id, p_order_id, p_kind, v_label, p_amount, v_currency,
     v_path, coalesce(p_happened_on, current_date), (select auth.uid()))
  returning id into v_id;

  return v_id;
end
$function$;

comment on function public.record_customer_transaction(uuid, text, numeric, text, uuid, date, text, text) is
  'Adds one line to a customer''s ledger. charge = «أعطيت», payment = «استلمت». Currency USD or LBP; the fx_rate snapshot is stamped by trigger (0211). Staff need the customers permission; the owner always may.';

revoke all on function public.record_customer_transaction(uuid, text, numeric, text, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.record_customer_transaction(uuid, text, numeric, text, uuid, date, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Statement links
-- ---------------------------------------------------------------------------
-- A customer gets a read-only link to their own statement over WhatsApp. The
-- token IS the credential, so:
--   * 144 bits from gen_random_bytes (18 bytes, base64url, 24 characters) —
--     not a uuid, not derived from anything, never guessable;
--   * it is minted only inside create_ledger_statement_token (below): the
--     table grants authenticated SELECT and nothing else, so nobody can insert
--     a token they chose or rewrite one they can see;
--   * revoking is a timestamp, not a delete, so the merchant's screen can say
--     "this link was switched off", and at most one live link per customer.
create table if not exists public.ledger_statement_tokens (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.store_customers(id) on delete cascade,
  token text not null unique
    default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint ledger_statement_tokens_token_shape
    check (token ~ '^[A-Za-z0-9_-]{24,64}$')
);

comment on table public.ledger_statement_tokens is
  'Revocable read-only links to one customer''s ledger statement (/statement/<token>). Minted only by create_ledger_statement_token(); read anonymously only through get_ledger_statement().';

create unique index if not exists ledger_statement_tokens_one_live
  on public.ledger_statement_tokens (customer_id) where revoked_at is null;
create index if not exists ledger_statement_tokens_store_idx
  on public.ledger_statement_tokens (store_id);
-- The partial unique index above does not cover the foreign key for revoked
-- rows (0260's convention: every FK column gets a plain index).
create index if not exists ledger_statement_tokens_customer_idx
  on public.ledger_statement_tokens (customer_id);
create index if not exists ledger_statement_tokens_created_by_idx
  on public.ledger_statement_tokens (created_by);

alter table public.ledger_statement_tokens enable row level security;

revoke all on table public.ledger_statement_tokens from public, anon, authenticated;
grant select on table public.ledger_statement_tokens to authenticated;

drop policy if exists ledger_statement_tokens_staff_read on public.ledger_statement_tokens;
create policy ledger_statement_tokens_staff_read on public.ledger_statement_tokens
  for select to authenticated
  using (public.staff_can(store_id, 'customers'));

-- Get-or-create: the customer's live link if there is one, otherwise a new
-- one. "Regenerate" in the UI is revoke + this.
create or replace function public.create_ledger_statement_token(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
  v_row public.ledger_statement_tokens;
begin
  select c.store_id into v_store
  from public.store_customers c
  where c.id = p_customer_id;
  if v_store is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if not public.staff_can(v_store, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row
  from public.ledger_statement_tokens t
  where t.customer_id = p_customer_id and t.revoked_at is null
  limit 1;

  if v_row.id is null then
    insert into public.ledger_statement_tokens (store_id, customer_id, created_by)
    values (v_store, p_customer_id, (select auth.uid()))
    on conflict (customer_id) where revoked_at is null do nothing
    returning * into v_row;

    -- Lost a race with a second tab: the other insert won, read what it made.
    if v_row.id is null then
      select * into v_row
      from public.ledger_statement_tokens t
      where t.customer_id = p_customer_id and t.revoked_at is null
      limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'token', v_row.token,
    'created_at', v_row.created_at
  );
end
$function$;

revoke all on function public.create_ledger_statement_token(uuid) from public, anon, authenticated;
grant execute on function public.create_ledger_statement_token(uuid) to authenticated;

create or replace function public.revoke_ledger_statement_token(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
begin
  select t.store_id into v_store
  from public.ledger_statement_tokens t
  where t.id = p_id;
  if v_store is null then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if not public.staff_can(v_store, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.ledger_statement_tokens t
  set revoked_at = now()
  where t.id = p_id and t.revoked_at is null;

  return found;
end
$function$;

revoke all on function public.revoke_ledger_statement_token(uuid) from public, anon, authenticated;
grant execute on function public.revoke_ledger_statement_token(uuid) to authenticated;

-- The one anonymous read. Returns ONLY what a customer should see on their own
-- statement: the shop's name and logo, the customer's name (not their phone),
-- each line's date / kind / amount / currency / note, and the per-currency
-- balance. No attachment path, no staff identity, no fx rate, no ids. NULL for
-- an unknown, malformed or revoked token, or a deleted store — the page turns
-- NULL into a 404.
create or replace function public.get_ledger_statement(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tok public.ledger_statement_tokens;
  v_store_name text;
  v_store_logo text;
  v_customer_name text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24,64}$' then
    return null;
  end if;

  select * into v_tok
  from public.ledger_statement_tokens t
  where t.token = p_token and t.revoked_at is null;
  if v_tok.id is null then
    return null;
  end if;

  select s.name, s.logo_url into v_store_name, v_store_logo
  from public.stores s
  where s.id = v_tok.store_id and s.deleted_at is null;
  if v_store_name is null then
    return null;
  end if;

  select c.name into v_customer_name
  from public.store_customers c
  where c.id = v_tok.customer_id and c.store_id = v_tok.store_id;
  if v_customer_name is null then
    return null;
  end if;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store_name, 'logo_url', v_store_logo),
    'customer', jsonb_build_object('name', v_customer_name),
    -- The most recent 1000 lines, oldest first. A customer's notebook page is
    -- far shorter than that; the cap only stops a pathological row count from
    -- turning a public URL into an expensive query.
    'entries', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'date', e.happened_on,
                 'kind', e.kind,
                 'amount', e.amount,
                 'currency', e.currency,
                 'label', e.label
               )
               order by e.happened_on, e.created_at, e.id
             )
      from (
        select t.id, t.happened_on, t.created_at, t.kind, t.amount, t.currency, t.label
        from public.customer_transactions t
        where t.customer_id = v_tok.customer_id and t.store_id = v_tok.store_id
        order by t.happened_on desc, t.created_at desc, t.id desc
        limit 1000
      ) e
    ), '[]'::jsonb),
    -- Balances over EVERY line, not just the 1000 shown.
    'balances', coalesce((
      select jsonb_agg(
               jsonb_build_object('currency', b.currency, 'balance', b.balance)
               order by b.currency desc
             )
      from (
        select t.currency,
               sum(case t.kind when 'payment' then -t.amount else t.amount end) as balance
        from public.customer_transactions t
        where t.customer_id = v_tok.customer_id and t.store_id = v_tok.store_id
        group by t.currency
      ) b
    ), '[]'::jsonb),
    'generated_at', now()
  );
end
$function$;

comment on function public.get_ledger_statement(text) is
  'Anonymous, read-only statement for one statement token. Store name + logo, customer name (never the phone), entries without attachments or staff identity, and per-currency balances. NULL when the token is unknown or revoked.';

revoke all on function public.get_ledger_statement(text) from public, anon, authenticated;
grant execute on function public.get_ledger_statement(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. (intentionally empty — plan gating)
-- ---------------------------------------------------------------------------
-- No plan check anywhere in this file, on purpose. The ledger is free on every
-- plan; see the PERMISSION note at the top.


-- ---------------------------------------------------------------------------
-- 6. Private bucket for receipt photos
-- ---------------------------------------------------------------------------
-- Same shape as digital-goods (0234): private, objects under "<store_id>/...".
-- Images only, and small — the app compresses a phone photo to well under a
-- megabyte before upload; 3 MB is headroom, not a target.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ledger-attachments',
  'ledger-attachments',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The prefix test lives in a function rather than inline in the policy for the
-- reason can_write_store_asset (0283) gives: a policy that casts
-- split_part(name, '/', 1)::uuid can be evaluated against objects in OTHER
-- buckets whose first segment is not a uuid ("gigs/...") and raise. This
-- checks the shape before it casts.
create or replace function public.can_access_ledger_attachment(p_name text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  seg1 text := split_part(p_name, '/', 1);
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  if seg1 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if split_part(p_name, '/', 2) = '' or position('..' in p_name) > 0 then
    return false;
  end if;
  return public.staff_can(seg1::uuid, 'customers');
end
$function$;

revoke all on function public.can_access_ledger_attachment(text) from public, anon, authenticated;
grant execute on function public.can_access_ledger_attachment(text) to authenticated;

drop policy if exists ledger_attachments_staff on storage.objects;
create policy ledger_attachments_staff on storage.objects
  for all to authenticated
  using (
    bucket_id = 'ledger-attachments'
    and public.can_access_ledger_attachment(name)
  )
  with check (
    bucket_id = 'ledger-attachments'
    and public.can_access_ledger_attachment(name)
  );
-- ====================== END MIGRATION 0307 (verbatim) =======================

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a      uuid := gen_random_uuid();
  v_owner_b      uuid := gen_random_uuid();
  v_staff_cust   uuid := gen_random_uuid();   -- store A staff, customers = true
  v_staff_orders uuid := gen_random_uuid();   -- store A staff, customers = false
  v_store_a      uuid;
  v_store_b      uuid;
  v_cust_a       uuid;   -- store A, phone 03123456, the statement customer
  v_cust_a2      uuid;   -- store A, FIFO / overdue case
  v_cust_b       uuid;   -- store B
  v_tok          jsonb;
  v_tok2         jsonb;
  v_tok3         jsonb;
  v_stmt         jsonb;
  v_n            int;
  v_num          numeric;
  v_date         date;
  v_txt          text;
  v_bool         boolean;
  v_uid          uuid;
  res            jsonb := '[]'::jsonb;
begin
  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS)
  -- ==========================================================================
  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_staff_cust), (v_staff_orders);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0307 Owner A'), (v_owner_b, '0307 Owner B'),
    (v_staff_cust, '0307 Staff customers'), (v_staff_orders, '0307 Staff orders')
  on conflict (id) do nothing;

  -- plan 'free' on purpose: the ledger has no plan gate in the database.
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0307 Ledger Store A', 'active', 'free') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0307 Ledger Store B', 'active', 'free') returning id into v_store_b;

  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff_cust, 'staff',
     '{"orders":false,"products":false,"bookings":false,"customers":true}'::jsonb),
    (v_store_a, v_staff_orders, 'staff',
     '{"orders":true,"products":true,"bookings":true,"customers":false}'::jsonb);

  insert into public.store_customers (store_id, name, phone)
    values (v_store_a, 'Ledger Test Customer', '03123456') returning id into v_cust_a;
  insert into public.store_customers (store_id, name, phone)
    values (v_store_a, 'Ledger FIFO Customer', '81999888') returning id into v_cust_a2;
  insert into public.store_customers (store_id, name, phone)
    values (v_store_b, 'Ledger Store B Customer', '71555444') returning id into v_cust_b;

  -- ==========================================================================
  -- CATALOG: what 0307 removed, what it grants
  -- ==========================================================================
  res := res || jsonb_build_array(jsonb_build_object('check', 'old customer_balance(uuid) is gone',
    'ok', to_regprocedure('public.customer_balance(uuid)') is null, 'got', coalesce(to_regprocedure('public.customer_balance(uuid)')::text, 'absent')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'old store_customer_balances(uuid) is gone',
    'ok', to_regprocedure('public.store_customer_balances(uuid)') is null, 'got', coalesce(to_regprocedure('public.store_customer_balances(uuid)')::text, 'absent')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'old 6-arg record_customer_transaction signature is gone (no ambiguous overload)',
    'ok', to_regprocedure('public.record_customer_transaction(uuid,text,numeric,text,uuid,date)') is null, 'got', coalesce(to_regprocedure('public.record_customer_transaction(uuid,text,numeric,text,uuid,date)')::text, 'absent')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon may execute get_ledger_statement',
    'ok', has_function_privilege('anon', 'public.get_ledger_statement(text)', 'execute'), 'got', has_function_privilege('anon', 'public.get_ledger_statement(text)', 'execute')::text));
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon may NOT execute record_customer_transaction / ledger_balances / create / revoke token',
    'ok', not has_function_privilege('anon', 'public.record_customer_transaction(uuid,text,numeric,text,uuid,date,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.ledger_balances(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.ledger_customer_balances(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.create_ledger_statement_token(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.revoke_ledger_statement_token(uuid)', 'execute'),
    'got', 'privileges checked'));
  select count(*) into v_n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('record_customer_transaction', 'create_ledger_statement_token',
                      'revoke_ledger_statement_token', 'get_ledger_statement')
    and p.prosecdef
    and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''');
  res := res || jsonb_build_array(jsonb_build_object('check', 'the 4 definer functions pin search_path to empty',
    'ok', v_n = 4, 'got', v_n::text));
  select public into v_bool from storage.buckets where id = 'ledger-attachments';
  res := res || jsonb_build_array(jsonb_build_object('check', 'ledger-attachments bucket exists and is private',
    'ok', v_bool is false, 'got', coalesce(v_bool::text, 'missing')));

  -- ==========================================================================
  -- OWNER A
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform public.record_customer_transaction(v_cust_a, 'charge', 100, 'bread', null, current_date - 40, 'USD', null);
    perform public.record_customer_transaction(v_cust_a, 'payment', 30, null, null, current_date - 5, 'USD', null);
    perform public.record_customer_transaction(v_cust_a, 'charge', 500000, 'LBP line', null, current_date - 2, 'LBP', null);
    perform public.record_customer_transaction(v_cust_a, 'charge', 10, 'with photo', null, null, 'usd', v_store_a::text || '/receipt.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A records USD, LBP and a line with an attachment', 'ok', true, 'got', '4 lines'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A records USD, LBP and a line with an attachment', 'ok', false, 'got', sqlerrm));
  end;

  -- Backward compatibility: 0211's six named arguments, no currency, no path.
  begin
    perform public.record_customer_transaction(
      p_customer_id => v_cust_a, p_kind => 'adjustment', p_amount => 0,
      p_label => 'compat', p_order_id => null, p_happened_on => current_date);
    select t.currency into v_txt from public.customer_transactions t where t.customer_id = v_cust_a and t.label = 'compat';
    res := res || jsonb_build_array(jsonb_build_object('check', '0211 six-argument call still resolves and defaults to USD', 'ok', v_txt = 'USD', 'got', coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', '0211 six-argument call still resolves and defaults to USD', 'ok', false, 'got', sqlerrm));
  end;

  select t.created_by into v_uid from public.customer_transactions t where t.customer_id = v_cust_a and t.label = 'bread';
  res := res || jsonb_build_array(jsonb_build_object('check', 'created_by is stamped with the caller', 'ok', v_uid = v_owner_a, 'got', coalesce(v_uid::text, 'null')));

  begin
    perform public.record_customer_transaction(v_cust_a2, 'charge', 100, null, null, current_date - 40, 'USD', null);
    perform public.record_customer_transaction(v_cust_a2, 'charge', 50, null, null, current_date - 10, 'USD', null);
    perform public.record_customer_transaction(v_cust_a2, 'payment', 120, null, null, current_date - 1, 'USD', null);
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'FIFO fixture lines', 'ok', false, 'got', sqlerrm));
  end;

  -- Per-currency balances: never summed together.
  select count(*) into v_n from public.ledger_balances(v_store_a) b where b.customer_id = v_cust_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'ledger_balances: customer with USD + LBP gets TWO rows', 'ok', v_n = 2, 'got', v_n::text));
  select b.balance into v_num from public.ledger_balances(v_store_a) b where b.customer_id = v_cust_a and b.currency = 'USD';
  res := res || jsonb_build_array(jsonb_build_object('check', 'USD balance = 100 - 30 + 0 + 10 = 80', 'ok', v_num = 80, 'got', coalesce(v_num::text, 'null')));
  select b.balance into v_num from public.ledger_balances(v_store_a) b where b.customer_id = v_cust_a and b.currency = 'LBP';
  res := res || jsonb_build_array(jsonb_build_object('check', 'LBP balance = 500000, not 500080', 'ok', v_num = 500000, 'got', coalesce(v_num::text, 'null')));
  select count(*) into v_n from public.ledger_customer_balances(v_cust_a);
  res := res || jsonb_build_array(jsonb_build_object('check', 'ledger_customer_balances: two currency rows', 'ok', v_n = 2, 'got', v_n::text));

  -- FIFO overdue date.
  select b.oldest_unpaid_charge_on into v_date from public.ledger_balances(v_store_a) b where b.customer_id = v_cust_a and b.currency = 'USD';
  res := res || jsonb_build_array(jsonb_build_object('check', 'oldest unpaid USD charge (100 at d-40, 30 paid) = d-40', 'ok', v_date = current_date - 40, 'got', coalesce(v_date::text, 'null')));
  select b.oldest_unpaid_charge_on, b.balance into v_date, v_num from public.ledger_balances(v_store_a) b where b.customer_id = v_cust_a2 and b.currency = 'USD';
  res := res || jsonb_build_array(jsonb_build_object('check', 'FIFO: 100@d-40 + 50@d-10 - 120 paid -> 30 owed, oldest unpaid d-10', 'ok', v_date = current_date - 10 and v_num = 30, 'got', coalesce(v_date::text, 'null') || ' / ' || coalesce(v_num::text, 'null')));

  -- Rejections.
  begin
    perform public.record_customer_transaction(v_cust_a, 'charge', 5, null, null, null, 'EUR', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'RPC refuses currency EUR', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'RPC refuses currency EUR', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.customer_transactions (store_id, customer_id, kind, amount, currency)
      values (v_store_a, v_cust_a, 'charge', 5, 'EUR');
    res := res || jsonb_build_array(jsonb_build_object('check', 'direct insert refuses currency EUR (check constraint)', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'direct insert refuses currency EUR (check constraint)', 'ok', true, 'got', sqlerrm));
  end;
  begin
    perform public.record_customer_transaction(v_cust_a, 'charge', 5, null, null, null, 'USD', v_store_b::text || '/x.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'RPC refuses an attachment path under another store', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'RPC refuses an attachment path under another store', 'ok', true, 'got', sqlerrm));
  end;
  begin
    perform public.record_customer_transaction(v_cust_a, 'charge', 5, null, null, current_date + 30, 'USD', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'RPC refuses a date a month in the future', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'RPC refuses a date a month in the future', 'ok', true, 'got', sqlerrm));
  end;

  -- Statement token: get-or-create is stable.
  begin
    v_tok := public.create_ledger_statement_token(v_cust_a);
    v_tok2 := public.create_ledger_statement_token(v_cust_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'create token twice returns the same live token',
      'ok', (v_tok ->> 'token') = (v_tok2 ->> 'token'), 'got', (v_tok ->> 'token') || ' / ' || (v_tok2 ->> 'token')));
    res := res || jsonb_build_array(jsonb_build_object('check', 'token is 24 url-safe characters (144 random bits)',
      'ok', (v_tok ->> 'token') ~ '^[A-Za-z0-9_-]{24}$', 'got', length(v_tok ->> 'token')::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'create token', 'ok', false, 'got', sqlerrm));
  end;
  begin
    insert into public.ledger_statement_tokens (store_id, customer_id, token)
      values (v_store_a, v_cust_a, 'AAAAAAAAAAAAAAAAAAAAAAAA');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner cannot insert a token of their choosing', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner cannot insert a token of their choosing', 'ok', true, 'got', sqlerrm));
  end;
  begin
    update public.ledger_statement_tokens set token = 'BBBBBBBBBBBBBBBBBBBBBBBB' where id = (v_tok ->> 'id')::uuid;
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner cannot rewrite a token', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner cannot rewrite a token', 'ok', true, 'got', sqlerrm));
  end;
  select count(*) into v_n from public.ledger_statement_tokens t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner A reads their store token (positive control)', 'ok', v_n = 1, 'got', v_n::text));

  -- Storage: own prefix yes.
  begin
    insert into storage.objects (bucket_id, name) values ('ledger-attachments', v_store_a::text || '/receipt.jpg');
    select count(*) into v_n from storage.objects o where o.bucket_id = 'ledger-attachments' and o.name = v_store_a::text || '/receipt.jpg';
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A writes and reads under <storeA>/ in ledger-attachments', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A writes and reads under <storeA>/ in ledger-attachments', 'ok', false, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- STAFF of A WITH the customers permission
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_cust, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.ledger_balances(v_store_a);
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) sees store A balances (3 rows)', 'ok', v_n = 3, 'got', v_n::text));
  begin
    perform public.record_customer_transaction(v_cust_a, 'payment', 10, 'staff paid', null, null, 'USD', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) records a payment', 'ok', true, 'got', 'ok'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) records a payment', 'ok', false, 'got', sqlerrm));
  end;
  select count(*) into v_n from public.ledger_statement_tokens t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) reads the statement token', 'ok', v_n = 1, 'got', v_n::text));
  select count(*) into v_n from storage.objects o where o.bucket_id = 'ledger-attachments' and o.name like v_store_a::text || '/%';
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) sees the store A attachment', 'ok', v_n = 1, 'got', v_n::text));
  -- The hole 0307 closes: a store A row pointing at store B's customer.
  begin
    insert into public.customer_transactions (store_id, customer_id, kind, amount, currency)
      values (v_store_a, v_cust_b, 'charge', 5, 'USD');
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) cannot attach a store A line to store B''s customer', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(customers) cannot attach a store A line to store B''s customer', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- STAFF of A WITHOUT the customers permission (orders/products/bookings on)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_orders, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.ledger_balances(v_store_a);
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) gets no balances', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.customer_transactions t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) reads no ledger lines', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.ledger_statement_tokens t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) reads no statement tokens', 'ok', v_n = 0, 'got', v_n::text));
  begin
    perform public.record_customer_transaction(v_cust_a, 'charge', 1, null, null, null, 'USD', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot record', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot record', 'ok', sqlerrm = 'not allowed', 'got', sqlerrm));
  end;
  begin
    v_tok3 := public.create_ledger_statement_token(v_cust_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot create a statement link', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot create a statement link', 'ok', sqlerrm = 'not allowed', 'got', sqlerrm));
  end;
  begin
    v_bool := public.revoke_ledger_statement_token((v_tok ->> 'id')::uuid);
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot revoke the link', 'ok', false, 'got', coalesce(v_bool::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot revoke the link', 'ok', sqlerrm = 'not allowed', 'got', sqlerrm));
  end;
  select count(*) into v_n from storage.objects o where o.bucket_id = 'ledger-attachments';
  res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) sees no attachments', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into storage.objects (bucket_id, name) values ('ledger-attachments', v_store_a::text || '/sneaky.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot upload an attachment', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff(no customers) cannot upload an attachment', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- OWNER B (another store)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_n from public.ledger_balances(v_store_a);
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B gets none of store A balances', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.customer_transactions t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads none of store A lines', 'ok', v_n = 0, 'got', v_n::text));
  select count(*) into v_n from public.ledger_statement_tokens t where t.store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads none of store A tokens', 'ok', v_n = 0, 'got', v_n::text));
  begin
    perform public.record_customer_transaction(v_cust_a, 'payment', 999, null, null, null, 'USD', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot record on store A customer', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot record on store A customer', 'ok', true, 'got', sqlerrm));
  end;
  begin
    insert into public.customer_transactions (store_id, customer_id, kind, amount, currency)
      values (v_store_b, v_cust_a, 'payment', 999, 'USD');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot insert a B row on store A''s customer', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot insert a B row on store A''s customer', 'ok', true, 'got', sqlerrm));
  end;
  begin
    v_bool := public.revoke_ledger_statement_token((v_tok ->> 'id')::uuid);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot revoke store A link', 'ok', false, 'got', coalesce(v_bool::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot revoke store A link', 'ok', true, 'got', sqlerrm));
  end;
  select count(*) into v_n from storage.objects o where o.bucket_id = 'ledger-attachments' and o.name like v_store_a::text || '/%';
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B sees no store A attachment', 'ok', v_n = 0, 'got', v_n::text));
  begin
    insert into storage.objects (bucket_id, name) values ('ledger-attachments', v_store_a::text || '/b.jpg');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot upload under store A prefix', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot upload under store A prefix', 'ok', true, 'got', sqlerrm));
  end;
  -- Positive control: B works on B.
  begin
    perform public.record_customer_transaction(v_cust_b, 'charge', 7, null, null, null, 'LBP', null);
    select count(*) into v_n from public.ledger_balances(v_store_b);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B records and reads own ledger (positive control)', 'ok', v_n = 1, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B records and reads own ledger (positive control)', 'ok', false, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- ANON
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select count(*) into v_n from public.customer_transactions;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads no ledger lines', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads no ledger lines', 'ok', true, 'got', sqlerrm));
  end;
  begin
    select count(*) into v_n from public.ledger_statement_tokens;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot list statement tokens', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot list statement tokens', 'ok', true, 'got', sqlerrm));
  end;
  begin
    select count(*) into v_n from public.ledger_balances(v_store_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call ledger_balances', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call ledger_balances', 'ok', true, 'got', sqlerrm));
  end;
  begin
    select count(*) into v_n from storage.objects o where o.bucket_id = 'ledger-attachments';
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon sees no attachments', 'ok', v_n = 0, 'got', v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon sees no attachments', 'ok', true, 'got', sqlerrm));
  end;

  begin
    v_stmt := public.get_ledger_statement(v_tok ->> 'token');
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads the statement by token',
      'ok', v_stmt is not null and v_stmt #>> '{customer,name}' = 'Ledger Test Customer' and v_stmt #>> '{store,name}' = '0307 Ledger Store A',
      'got', coalesce(v_stmt #>> '{customer,name}', 'null')));
    res := res || jsonb_build_array(jsonb_build_object('check', 'statement carries no phone, no attachment, no staff id',
      'ok', position('03123456' in v_stmt::text) = 0
        and position('phone' in v_stmt::text) = 0
        and position('attachment' in v_stmt::text) = 0
        and position('receipt.jpg' in v_stmt::text) = 0
        and position(v_owner_a::text in v_stmt::text) = 0
        and position(v_staff_cust::text in v_stmt::text) = 0
        and position(v_cust_a::text in v_stmt::text) = 0,
      'got', left(v_stmt::text, 200)));
    res := res || jsonb_build_array(jsonb_build_object('check', 'statement lists all 6 lines of the customer (4 owner + compat + staff)',
      'ok', jsonb_array_length(v_stmt -> 'entries') = 6, 'got', jsonb_array_length(v_stmt -> 'entries')::text));
    select (b ->> 'balance')::numeric into v_num from jsonb_array_elements(v_stmt -> 'balances') b where b ->> 'currency' = 'USD';
    res := res || jsonb_build_array(jsonb_build_object('check', 'statement USD balance = 80 - 10 = 70', 'ok', v_num = 70, 'got', coalesce(v_num::text, 'null')));
    select (b ->> 'balance')::numeric into v_num from jsonb_array_elements(v_stmt -> 'balances') b where b ->> 'currency' = 'LBP';
    res := res || jsonb_build_array(jsonb_build_object('check', 'statement LBP balance = 500000 (separate)', 'ok', v_num = 500000, 'got', coalesce(v_num::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads the statement by token', 'ok', false, 'got', sqlerrm));
  end;
  begin
    res := res || jsonb_build_array(jsonb_build_object('check', 'unknown / malformed / null token -> null',
      'ok', public.get_ledger_statement('zzzzzzzzzzzzzzzzzzzzzzzz') is null
        and public.get_ledger_statement('x'' or 1=1 --') is null
        and public.get_ledger_statement(null) is null,
      'got', 'checked'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'unknown / malformed / null token -> null', 'ok', false, 'got', sqlerrm));
  end;
  begin
    perform public.record_customer_transaction(v_cust_a, 'payment', 1, null, null, null, 'USD', null);
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot record', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot record', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- REVOKE then REGENERATE (owner A), and anon reads again
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    v_bool := public.revoke_ledger_statement_token((v_tok ->> 'id')::uuid);
    v_tok3 := public.create_ledger_statement_token(v_cust_a);
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner revokes, and regenerate mints a DIFFERENT token',
      'ok', v_bool and (v_tok3 ->> 'token') <> (v_tok ->> 'token'), 'got', coalesce(v_bool::text, 'null') || ' ' || coalesce(v_tok3 ->> 'token', 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner revokes, and regenerate mints a DIFFERENT token', 'ok', false, 'got', sqlerrm));
  end;

  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  res := res || jsonb_build_array(jsonb_build_object('check', 'revoked token -> statement is null (page 404s)',
    'ok', public.get_ledger_statement(v_tok ->> 'token') is null, 'got', coalesce(public.get_ledger_statement(v_tok ->> 'token')::text, 'null')));
  res := res || jsonb_build_array(jsonb_build_object('check', 'regenerated token -> statement readable',
    'ok', public.get_ledger_statement(v_tok3 ->> 'token') is not null, 'got', coalesce(left(public.get_ledger_statement(v_tok3 ->> 'token')::text, 60), 'null')));

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
