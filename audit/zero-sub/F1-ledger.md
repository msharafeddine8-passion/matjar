# F1 — دفتر الدين (Digital Debt Ledger)

Branch `feat/zero-subscription-features` (base 48cdda3). Nothing committed, pushed or deployed. No `next build` was run.

## Status in one line

The code is written and passes every local gate. **Migration 0307 is written but NOT applied, and NOT tested against the database.** On the coordinator's instruction I ran nothing but read-only SELECTs against production. The rolled-back test is in `supabase/tests/0307_debt_ledger.test.sql`, ready to run before the apply.

**Deploy order matters.** The app code calls `ledger_balances`, `record_customer_transaction(…8 args)`, `create_/revoke_ledger_statement_token`, `get_ledger_statement` and the `ledger-attachments` bucket. None of these exist until 0307 is applied. If the app ships first, every store gets the new nav entry and then sees a load-error banner, saves that fail, and statement links that 404. Apply 0307 first, then deploy.

## 1. Data model: the brief's tables mapped onto what exists

| Brief | Existing object used | Notes |
|---|---|---|
| `ledger_customers` | `public.store_customers` | Same customer book as the CRM (38 rows in prod). Quick-add inserts here. It is unique on `(store_id, phone)`, and a duplicate phone opens the existing customer instead of failing. |
| `ledger_entries` | `public.customer_transactions` (0211) | Had 0 rows in production when I checked. |
| «أعطيت» (I gave) | `kind = 'charge'` | |
| «استلمت» (I received) | `kind = 'payment'` | |
| note | `label` (reused, max 500 chars) | No new note column. |
| photo | new `attachment_path text` | A storage path in the private bucket, never a URL. |
| — | `adjustment` (0211) | Kept. Counts like a charge. The UI does not create it. |

Nothing in `src/` used the ledger before this change. I checked with grep and against `pg_proc.prosrc`: nothing calls `customer_balance`, `store_customer_balances` or `record_customer_transaction`.

## 2. Migration `supabase/migrations/0307_debt_ledger.sql`

0306 was taken and 0308 is the other agent's Google feed, so 0307 was the free number.

1. **customer_transactions**
   - New column `attachment_path`.
   - New CHECK `currency in ('USD','LBP')`.
   - New CHECK that `attachment_path` must start with `<store_id>/`, be 38–300 characters and contain no `..`.
   - New CHECK that `label` is at most 500 characters.
   - **Closed a hole in 0211's policy:** its `WITH CHECK` did not require `customer_id` to belong to `store_id`. Staff of store A could write a row against store B's customer, and it would then show on that customer's public statement. The policy now requires the customer to be in the row's own store.
   - Revoked all table privileges from `anon`. RLS already returned nothing to anon.
   - New invoker trigger `customer_tx_stamp_actor` that stamps `created_by` from the JWT.
2. **Balances per currency.** Dropped 0211's `customer_balance(uuid)` and `store_customer_balances(uuid)`, which added USD and LBP together. Their return type had no currency column, so they could not be replaced in place. New functions, both SECURITY INVOKER over the existing RLS, `search_path=''`, executable by `authenticated` only:
   - `ledger_balances(p_store_id)` returns `customer_id, name, phone, currency, balance, last_activity, oldest_unpaid_charge_on`: one row per customer per currency. `oldest_unpaid_charge_on` settles payments oldest-first, and the "overdue > 7/30/60 days" filter uses it.
   - `ledger_customer_balances(p_customer_id)` returns the same per-currency figures for one customer.
3. **`record_customer_transaction` extended.** Dropped the 6-argument signature and recreated it with two optional trailing arguments, `p_currency` (default 'USD') and `p_attachment_path`. Leaving both versions would make every 6-argument call ambiguous. Existing call shapes (3–6 arguments, positional or named) resolve as before. New validation:
   - currency must be USD or LBP;
   - the date cannot be later than current_date + 1 (Beirut is ahead of UTC);
   - the note must be 500 characters or fewer;
   - the attachment must be under the store's own prefix;
   - **`order_id` must belong to the store** (0211 accepted any order);
   - `created_by = auth.uid()`.

   SECURITY DEFINER, revoked from public/anon/authenticated, granted to authenticated.
4. **`ledger_statement_tokens`** `(id, store_id, customer_id, token, created_at, created_by, revoked_at)`.
   - The token is 18 bytes from `extensions.gen_random_bytes`, base64url-encoded: 24 characters, **144 bits**. There is a shape CHECK on it.
   - At most one live token per customer (partial unique index), plus indexes on the foreign keys.
   - RLS: `authenticated` gets **SELECT only**, through `staff_can(store_id,'customers')`. Nobody can insert a token they chose or rewrite one.
   - `create_ledger_statement_token(p_customer_id)` (definer) returns the customer's live token if one exists, otherwise creates one, and handles the race between two tabs. It returns `{id, token, created_at}`.
   - `revoke_ledger_statement_token(p_id)` (definer) sets `revoked_at`.
   - **`get_ledger_statement(p_token)`** (definer, granted to anon and authenticated) returns only:
     - store name and logo;
     - the customer's **name** (never the phone);
     - entries (date, kind, amount, currency, label; the most recent 1000, oldest first);
     - per-currency balances, computed over all entries;
     - `generated_at`.

     It returns NULL for an unknown, malformed or revoked token, or a deleted store. It never returns an attachment, staff identity, fx rate or any ids.
5. **Bucket `ledger-attachments`**: private, 3 MB limit, jpeg/png/webp only.
   - I copied 0234's `digital-goods` pattern, with one change: the path check lives in the invoker function `can_access_ledger_attachment(name)`. It checks that the first path segment looks like a uuid before casting it (the reason 0283 gives), then calls `staff_can(<store_id>, 'customers')`.
   - One policy, `for all to authenticated`, restricted to that bucket.
6. **No plan check anywhere.** This is deliberate (see §4).

The SQL bodies of `ledger_balances` and the statement JSON were checked as **read-only SELECTs** against production, run with a nil uuid so they returned nothing. The token expression was checked the same way and produced 24 characters. **No DDL, DML or rolled-back transaction was executed.**

## 3. The rolled-back test (written, NOT run)

`supabase/tests/0307_debt_ledger.test.sql` is one transaction:

```
begin;
  <0307 verbatim>
  fixtures
  assertions
  select * from r
rollback;
```

The migration text is spliced in byte-for-byte from the migration file. If 0307 changes, regenerate the test or paste the new migration between the markers. 0307 is idempotent, so the same file also works as a regression test after the apply.

**Fixtures**:
- two free-plan stores and their two owners;
- store A staff with `customers:true`;
- store A staff with `customers:false` (orders/products/bookings on);
- three customers, one of them in store B.

**Checks**: about 60 rows plus an `ALL CHECKS` summary row. The exact count depends on which branch of each check fires. Each row records the actual value or error in `got`.
- **Catalog:** the old functions are gone, the old overload is gone, the anon grants are right, the 4 definer functions pin `search_path` to empty, the bucket is private.
- **Owner A:**
  - records USD, LBP and a line with an attachment;
  - the 0211 six-named-argument call still works and defaults to USD;
  - `created_by` is stamped;
  - two currency rows; USD = 80 and LBP = 500000 (not 500080); `ledger_customer_balances` has 2 rows;
  - oldest-first overdue dates are d-40 and d-10;
  - rejected: EUR through the RPC, EUR by direct insert, another store's attachment path, a future date;
  - creating the token twice returns the same token, with the 24-character shape;
  - cannot insert or rewrite a token;
  - can write and read `<storeA>/…` in storage.
- **Staff with `customers`:** sees 3 balance rows, records a payment, sees the token and the photo, and cannot attach a store A line to store B's customer.
- **Staff without `customers`:** 0 balances, 0 lines, 0 tokens. Record, create-link and revoke all fail with `not allowed`. No storage read or upload.
- **Owner B:** reads 0 of A's balances, lines, tokens and photos. Cannot record on A's customer, cannot insert a B row on A's customer, cannot revoke A's link, cannot upload under A's prefix. Positive control: B works on B.
- **Anon:** no ledger lines, no tokens, no `ledger_balances`, no storage, cannot record.
  - The statement reads correctly by token.
  - **Contains no phone, no "phone" key, no attachment, no owner, staff or customer ids.**
  - 6 entries; USD 70 and LBP 500000 kept separate.
  - Unknown, SQL-ish and null tokens return NULL.
- **Revoke then regenerate:** the old token returns NULL, the new one differs and is readable.

**Outcome table: none. The test has not been run.** When the coordinator runs it, the output of `select n, check_name, ok, got from r order by n` is the table that belongs here.

## 4. Permission and tier decision

- **Tier: free on every plan.**
  - Registered in the single source of truth as `FEATURES.debtLedger` (`state: live`, `plan: free`, `osModule: ledger`). `featureStatus('debtLedger', {plan:'free'})` returns `available`.
  - It uses the `copy` / `OwnCopyFeatureId` mechanism the Google-feed agent added to the same file. Its label lives in `ledger.feature.*`, so it needs no `pricing.features` key and is not a /pricing row.
  - `OS_MODULE_META.ledger` has **no `minPlan`**, the pages have no plan guard, and the database has no plan check. The ledger never goes through the `customers` Pro module or its `ProGate`.
- **Staff permission: I reused the existing `customers` key rather than adding `ledger`.**
  - `staff_can()` is always true for the owner, so the owner always has the ledger on every plan.
  - `store_customers` and `customer_transactions` have been RLS-gated on `staff_can(…,'customers')` since 0211. A staff member holding `customers` could already read and write these exact rows through the API. Showing them the screen grants nothing new.
  - A new `ledger` key would have forced one of two surprises. Either `store_customers` gets widened to a second key, which silently hands every customer's phone number to people who never had it. Or the screen is hidden from `customers` holders while the database still lets them write.
  - Staff seats are Pro, so on a free store the ledger is owner-only in practice.
  - The nav gates on `perm: "customers"` (I widened the `perm` union type), and `requireLedgerAccess` checks the same key.
  - Side note, not changed: the existing CRM screen checks the `orders` permission while its RLS checks `customers`. That mismatch predates this work.

## 5. Files changed (mine)

- `supabase/migrations/0307_debt_ledger.sql`: new; the migration above.
- `supabase/tests/0307_debt_ledger.test.sql`: new; the rolled-back test (migration spliced in verbatim).
- `src/lib/ledger.ts`: new pure helpers:
  - per-currency balances in integer cents, running balances, oldest-first overdue;
  - Beirut "today", the list summary and sort (the exchange rate is used **for ordering only**), search;
  - keypad amount parsing (Arabic-Indic digits, ٫), formatting with Western digits;
  - the WhatsApp reminder builder, the statement URL;
  - export rows, and CSV with a BOM, CRLF line endings and formula-injection escaping.
- `src/lib/__tests__/ledger.test.ts`: new, 23 tests. Includes checks that the ledger is registered free and appears exactly once per sector's nav.
- `src/lib/feature-availability.ts`: added the `debtLedger` FeatureId, its FEATURES entry, and the `OwnCopyFeatureId` union member. Shared file; the other agent's edits there are untouched.
- `src/lib/sectors.ts`: added the `ledger` OsModuleKey, its `OS_MODULE_META` entry (NotebookPen icon, perm `customers`, no minPlan), `"customers"` in the `perm` union, and `ledger` first in `MONEY` and `MONEY_WITH_SUPPLIERS`. That gives one nav entry in every sector.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/layout.tsx`: one line, `ledger: dict.ledger.nav` in `moduleLabel`.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/ledger/access.ts`: new; auth + `can_manage_store` + owner-or-`customers` check, no plan check.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/ledger/page.tsx`: new; the customer list.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/ledger/[customerId]/page.tsx`: new; one customer's page.
- `src/app/[lang]/statement/[token]/page.tsx`: new public statement.
  - Placed **outside `(site)`** so the page ships none of the marketplace chrome or client bundle.
  - `noindex, nofollow, nocache`, `referrer: no-referrer`, `force-dynamic`.
  - Returns a real `notFound()` for bad, unknown or revoked tokens. There is no `loading.tsx` over it.
  - Print styles via `print:` variants.
- `src/components/ledger/ledger-home.tsx`: new client component.
  - Per-currency totals, search, the All/7/30/60 overdue filter chips, and the list sorted by amount outstanding.
  - Quick add: pick an existing customer or enter name + phone.
  - Export to Excel (`exceljs`, dynamic import, per-currency `SUMIF` totals, right-to-left sheet in Arabic) and CSV. Both page through the 1000-row limit.
- `src/components/ledger/ledger-customer.tsx`: new client component.
  - Per-currency balance, the two big «أعطيت»/«استلمت» buttons.
  - WhatsApp reminder (`wa.me` via `waLink`, creates a token on first use).
  - Statement link management: copy, open, revoke, regenerate.
  - Entries with a running balance per currency, view the photo (60-second signed URL), delete.
- `src/components/ledger/ledger-entry-form.tsx`: new quick entry.
  - The kind comes preselected from the button tapped, the amount field is autofocused with `inputmode="decimal"`, the USD/LBP choice is remembered per device (localStorage, wrapped in try/catch), the date defaults to today.
  - Optional note, and a photo via `capture="environment"`.
- `src/components/ledger/ledger-sheet.tsx`: new. The shared BottomSheet on phones; an inline panel from `lg` up, because the shared sheet is `lg:hidden`.
- `src/components/ledger/compress-photo.ts`: new. JPEG, 1280px max side, about 450 KB target, done client-side before upload.
- `src/components/ledger/print-button.tsx`: new. `window.print()` for Save as PDF; the statement's only client component.
- `src/i18n/dictionaries/ar.json`, `en.json`: one new top-level `ledger` namespace (126 lines each).
  - Inserted as a single text insertion immediately before `  "features": {`, with CRLF line endings preserved.
  - The file was read immediately before inserting; `JSON.parse` confirmed exactly one new top-level key and no other bytes changed.
  - The Arabic is light Lebanese, as the brief asked and matching the other agent's new strings. The `arabic-first-ui` skill says MSA, so flag it if the product should use MSA.
- `audit/zero-sub/F1-ledger.md`: this report.

Not touched: `robots.ts`, `proxy.ts`, the CRM, `staff-manager.tsx` (`customers` is already a grantable permission), and anything in the Google-feed agent's territory.

## 6. Not verified in a browser

- **No screen was opened in a browser.**
  - Every ledger RPC and the bucket are missing until 0307 is applied, so the merchant pages can only show their error state today.
  - I cannot sign in as a merchant: entering credentials is off-limits.
  - I did not start a dev server, because a second `next dev` in the same tree would contend for `.next` with the other agent.
- Not yet seen working, pending the migration and a real session:
  - RTL layout at 375px and on desktop, including the inline panel;
  - the 10-second entry flow on a real phone keypad and camera capture;
  - photo compression and upload, and signed-URL viewing;
  - the WhatsApp deep link opening from the pre-opened tab on iOS and Android;
  - Excel and CSV opening in Excel with Arabic;
  - statement print / Save as PDF;
  - the statement's 404 status.
- Once 0307 is applied: run the test file, run `get_advisors` (security and performance), then do a real-device pass.

## 7. Gates (verbatim)

`npx tsc --noEmit`: no output, exit 0.

`npx vitest run`:
```
 Test Files  54 passed (54)
      Tests  975 passed (975)
```
`npx vitest run src/lib/__tests__/ledger.test.ts`:
```
 Test Files  1 passed (1)
      Tests  23 passed (23)
```
`npx eslint src/lib/ledger.ts src/lib/__tests__/ledger.test.ts src/components/ledger "src/app/[lang]/statement" "src/app/[lang]/(dashboard)/merchant/[storeId]/ledger" "src/app/[lang]/(dashboard)/merchant/[storeId]/layout.tsx" src/lib/sectors.ts src/lib/feature-availability.ts`: no output, exit 0. That includes `matjar/no-raw-directional-icon`: the list uses `ChevronNext` and the back links use `ChevronPrev`.

`npm run check:migrations`:
```
SECURITY DEFINER convention check — 303 migrations replayed in order; 207 definer signature(s) live at HEAD (26 superseded signature(s) dropped along the way and not checked).
...
1 known violation(s) grandfathered by scripts/definer-baseline.json (already applied to production; fixing one needs a NEW migration):
  - public.bump_coupon_use/0 [public-only] — (pre-existing, not from 0307)
PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
```


## Applied to production (2026-09-25)

- 0307 run first inside an uncommitted transaction against production: **62 of 62 checks passed** (owner, staff with and without the customers permission, another store's owner, anon; per-currency balances, FIFO overdue date, statement token read/revoke, no phone/attachment/staff id on the statement, storage isolation). A follow-up read confirmed nothing persisted. Then applied with apply_migration.
- 0308 (Google feed columns + guard) run the same way: **10 of 10 checks passed** (owner blocked without policies, trial counts as Pro, a free store cannot pass by claiming plan=pro in the same update, non-owner touches 0 rows). Applied.
- Supabase security advisor after both: no finding names any new object.
- Still not done: the ledger and feed screens have not been opened in a browser as a signed-in merchant.
