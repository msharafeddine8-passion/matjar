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
