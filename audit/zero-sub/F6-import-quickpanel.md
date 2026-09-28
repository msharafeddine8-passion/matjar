# F6 — Excel import (all tiers) + «المساعد الذكي» quick-action panel (Pro + Business)

Branch `feat/zero-subscription-features` (HEAD 9e6a047), working tree only: nothing committed, pushed or deployed, no `next build`.
Zero recurring cost, no AI/LLM: every "smart" answer is a query under the caller's RLS.

**Database: migration 0311 is WRITTEN, NOT APPLIED. Its rolled-back test has NOT been run.** Only read-only SELECTs were run against production (`pg_get_functiondef`, `information_schema`, `pg_policies`, `pg_enum`). The code runs safely before 0311 is applied (see "Before / after 0311").

---

## 1. Import — one importer for three things

Routes: `merchant/[storeId]/import` (all three tabs; `#products`, `#customers` or `#ledger` opens a tab) and the existing `merchant/[storeId]/products/import`, which now shows the same importer. There is one implementation (`components/importer/*`). The old `components/product-import-client.tsx` was generalised into it and then deleted. The ledger page has a new «استورد أرصدة من إكسل» link to `/import#ledger`.

Flow, the same for every entity: download the template → upload `.xlsx` or `.csv` → columns are auto-detected from Arabic or English headers → the merchant confirms or changes the mapping (one select per field, showing required/optional, missing fields and one column chosen twice) → a review of the first 20 rows with each row's result or error, the full problem list, and create/update/skip counts → Import. Nothing is written before the merchant presses Import.

**Parsing happens in the browser.** This was the lighter choice for phones and costs nothing.
- A server action would need the whole file uploaded (Vercel caps a body at 4.5 MB, and every upload would be a billed invocation), and it would then have to send the rows back for review anyway.
- The file never leaves the device, and it holds personal data.
- `exceljs` (already a dependency) is dynamic-imported only when a file is chosen.
- Caps: 5 MB and 2,000 data rows. A file with too many rows is refused before any conversion (`actualRowCount`).
- While rows are converted, the loop yields to the browser every 250 rows and shows a counter. `.xls` gets its own "save as .xlsx" message.
- The bilingual template has Arabic headers in row 1 and English in row 2. The second header row is recognised and skipped (`isHeaderLike`). Example rows sit on a separate second sheet that is never imported, so a template uploaded unchanged cannot import sample data.

| Entity | How it is written | Duplicate rule |
|---|---|---|
| Products | One `import_products()` call, all-or-nothing in the database. Only rows that pass validation are sent; problem rows are listed and left out. | **By SKU**, case-insensitive. **Without a SKU: by exact name** (trimmed, case-insensitive), and only when exactly one product has that name. Two products sharing the name → the row is refused (`nameAmbiguous`). The UI says so in a note and marks each matched row «انطابق بالاسم». The same SKU, or the same SKU-less name, twice in the file → the later line is refused (`dupInFile`). |
| Customers | `store_customers` insert, 500 rows per statement, under the caller's RLS (`staff_can 'customers'`). | **By normalised phone** (`phoneKey` from wa-templates, the WhatsApp actions' key; Arabic-Indic digits normalised first). Without a phone, by exact name. An existing customer is **skipped and never overwritten**. The same phone twice in the file → the later line is refused. A phone too short to be one → error; a foreign number → warning only. |
| Ledger opening balances | New customers are created first (batch insert). Then **one `record_customer_transaction()` per customer per currency**, label **«رصيد افتتاحي»**, four calls in parallel with a progress counter. | The customer is found by normalised phone (or by exact name when there is no phone and exactly one customer has it), otherwise created. A customer who **already has a «رصيد افتتاحي» line in that currency is skipped for that currency**, so running the same file twice doubles nothing and a dropped connection is resumed by re-uploading. The same customer and currency twice in the file → the later line is refused. |

Opening-balance conversion (`openingEntries`, tested):
- A positive balance becomes a `charge`, a negative one a `payment` of the absolute value (a credit), and zero writes nothing.
- There is at most one line per currency. **USD and LBP are never added together, netted or converted.**
- A currency must be stated, either in a Currency column or as a marker in the amount (`$120`, `400,000 ل.ل.`). It is **never assumed.** A marker that contradicts the Currency column is refused.
- Separate «الرصيد بالدولار» and «الرصيد بالليرة» columns are supported.
- An optional Date column sets `happened_on` so overdue tracking starts from the real date. It defaults to today in Beirut and a future date is refused.
- Amounts accept `1,500,000`, `1.500.000`, `12,50`, `(40)`, `40-` and Arabic-Indic digits.

Templates (`.xlsx`, one per entity) have the Arabic header row, the English header row, and an RTL sheet view in Arabic.

## 2. «المساعد الذكي» — the quick-action panel

It sits at the top of the dashboard home (`merchant/[storeId]/page.tsx`), above the phone's "today" block.
- **Pro + Business.** A store below Pro sees the same chips greyed out with a lock, a one-line upgrade prompt and a link to `/subscription`. No server call is made for it.
- **Each chip loads on tap:** one server action per tap (`quick-panel-actions.ts`), and answers are cached per chip for the visit.
- The only automatic read is the exceptions strip, a handful of counts fetched after mount.
- Every action re-checks sign-in, store membership, the **effective plan ≥ Pro**, and **the chip's staff permission** before any query. The chip list is also filtered by permission and by the sector's modules on the page.

| Chip | Query (under the caller's RLS) | Action | Permission |
|---|---|---|---|
| طلبات اليوم | `orders` where `created_at` is in Beirut's today [00:00, 24:00), found with Intl rather than getDay/getHours. Returns the exact count, the latest 10, and totals per currency excluding cancelled/rejected (all pages read). | Open orders; each row links to its order. | `orders` |
| شو ناقص بالمخزون؟ | `products` where `stock` is not null and `stock <= low_stock_threshold`, the inventory screen's own rule (default 5; untracked stock is never low). | **No supplier-order concept exists** (`store_suppliers` is contacts and `supplier_transactions` is a payables ledger; there is no purchase-order table). The panel says so. The action opens **inventory** on Business and **products** on Pro, because inventory is a Business screen. | `products` |
| مين عليه دين؟ | `ledger_balances(store)` gives the **top 10 per currency, each list ranked in its own currency** and never converted, with days overdue. | The WhatsApp «تذكير بالدين» per customer uses the store's own `debt_reminder` wording (0309). The statement link comes from `create_ledger_statement_token`, only owed currencies are listed, and each tap is logged to `wa_action_log` (ledger_customer/debt_reminder). | `customers` |
| مواعيد بكرا | `bookings` where `requested_date` = Beirut tomorrow (or, when it has no date, `starts_at` falls in tomorrow's Beirut day), status pending/accepted/scheduled. | The existing `BookingWaActions`: «تأكيد الموعد» for pending, and **«تذكير قبل بيوم» (`booking_reminder`)** for accepted/scheduled, with the tap logged. | `bookings` |
| سلات متروكة | `store_abandoned_carts(store)` (0309, applied; re-checks `orders`). | `WaActionButton` with `abandoned_cart` and the tap logged. No coupon is pre-selected. | `orders` |
| زباين ما رجعوا | `store_customers`, and their latest real date from ledger lines (`happened_on`, by customer), orders (`created_at` → Beirut date, by phone key; only when the person has `orders`), and bookings (`requested_date`, else created date, capped at today; only when the person has `bookings`). **A customer is inactive when that latest date is more than 30 days ago.** Customers with no dated activity are **not listed** (nothing says they ever came). Their count is shown, and the answer names the sources it used. | A wa.me link per customer with a **merchant-editable short text** (`{name}`/`{store}` filled in, 500 chars, remembered on the device). **No coupon is invented.** There is no log, because `wa_action_log` has no key for offers and adding one would need a migration. | `customers` |
| مبيعات هالأسبوع | Online `orders` excluding cancelled/rejected, plus `pos_sales` **only when the person may read POS** (`staff_can 'pos'`, owner always; a failed POS read fails the whole answer rather than claiming no POS). Weeks start **Monday 00:00 Beirut**. It compares **this week so far with the same stretch of last week** and also shows last week's full total, per currency. A % is shown only when one currency is in play. USD totals get "≈ LBP" from the live `getUsdLbpRate`. The screen says which sources were used. | Open reports. | `orders` |

**Exceptions strip** (shown without asking; an item appears only when its count is above 0 and the person may see it):

| Item | Rule |
|---|---|
| Low stock | The same rule as the chip. Links to inventory (Business) or products (Pro). |
| Overdue debts | Customers whose `ledger_balances.oldest_unpaid_charge_on` (payments settled FIFO) is **more than 30 days** ago. Links to the ledger. |
| Unconfirmed orders | `status = 'pending'` and `created_at` **more than 2 hours ago** (head count). Links to orders. |
| Tomorrow's unconfirmed bookings | Tomorrow (Beirut) with `status = 'pending'`. Links to bookings. |

Constants live in `src/lib/quick-panel.ts`: `INACTIVE_DAYS = 30`, `OVERDUE_DAYS = 30`, `UNCONFIRMED_ORDER_HOURS = 2`.

Beirut dates: `beirutClock()` in `hours.ts` returns a weekday and minutes, not a calendar date. So the date helpers (`beirutYmd`, `beirutDayStart`, `beirutWeeks`) use `Intl` with `Asia/Beirut` in the same way, and no `getDay`/`getHours` is used anywhere. Both DST days are tested (23-hour spring day, 25-hour autumn eve).

## 3. Plan registry

`src/lib/feature-availability.ts` has two new entries:
- `excelImport`: free, with copy under `importer.feature.*`.
- `quickPanel`: pro, with copy under `quickPanel.feature.*`.

Both are added to `OwnCopyFeatureId` (the label mechanism F1/F2 used). The other agent's `loyaltyStamps` and `giftCards` entries coexist.

## 4. Migration 0311 (written, NOT applied) — `supabase/migrations/0311_import_quickpanel.sql`

**`import_products()` is restated in full**, not patched:
- It drops the **Pro plan gate**. The **product cap stays**, enforced once with real numbers (free 3 · basic 30 · pro 200 · business unlimited).
- Permission tightens from `can_manage_store` to **`staff_can(store,'products')`**. Before, a staff member holding only `bookings` could bulk-write the catalogue through this definer function, even though products' RLS refuses them a single insert.
- It adds the **exact-name fallback** for SKU-less rows and refuses ambiguous names with `name_ambiguous`.
- It returns `matched_by_name`.
- It rejects more than 5,000 rows.
- Everything else is unchanged: two passes, all-or-nothing, blank cells leave a field alone, and cost stays NULL (0222).
- It carries explicit `revoke … from public, anon, authenticated` and `grant … to authenticated`.

**`import_rules()`** is a constant, invoker-rights function that tells the app whether 0311 is live. It is executable by authenticated users only.

Customers, balances and the panel need **no** database change: they reuse `store_customers` RLS, `record_customer_transaction`, `ledger_balances`, `store_abandoned_carts`, `create_ledger_statement_token` and `wa_action_log`.

**Rolled-back test:** `supabase/tests/0311_import_quickpanel.test.sql` has the migration verbatim between the markers (checked byte-for-byte), then the fixtures and 22 checks into `r` plus an `ALL CHECKS` row.

Fixtures:
- **Store A: FREE with an expired trial**, so its cap really is 3 (`grant_store_trial` only fills a null `trial_ends_at`).
- Store B: Pro.

Checks, by actor:
- **Catalog:** definer with `search_path=''`; grants; `import_rules` is invoker with no execute for anon; no `store_has_plan` left in the function but the cap is.
- **Owner A:**
  - `import_rules()` returns the expected value.
  - The free store imports.
  - A SKU-less name matches the one product.
  - A SKU updates case-insensitively and a blank cell leaves the field alone.
  - The free cap refuses 2 + 2 > 3 with the real numbers and writes nothing, while 1 new row is created with cost NULL.
  - Row errors are reported.
  - A non-array input raises 22023.
  - The import log is stamped.
- **Staff with `products`:** imports.
- **Staff without `products`:** 42501.
- **Owner B:** refused on store A (42501); `name_ambiguous` writes nothing; a name match plus the same SKU-less name twice in one file makes one product, not two; cannot read A's import log.
- **Anon:** cannot call either function; nothing reached the store.

**Run it before applying** (Supabase MCP `execute_sql` or the SQL editor), then `apply_migration`, then `get_advisors`.

### Before / after 0311 (the code runs either way)

Before 0311:
- `import_rules()` is missing, so the page keeps the old rules.
- A store **below Pro** sees products locked, with the upgrade CTA and the note that it opens after the update. Customers and balances already work on every plan.
- SKU-less name matching works only where the matched product **has** a SKU (the client fills that SKU in). A SKU-less row that would match a SKU-less product is refused (`nameNeedsCode`) rather than duplicated.
- If the RPC still answers "requires the Pro plan", the screen shows the same notice rather than crashing.

After 0311: products are open on every plan and full name matching is on.

## 5. Files

New:
- `src/lib/import-mapping.ts`, `src/lib/__tests__/import-mapping.test.ts`
- `src/lib/quick-panel.ts`, `src/lib/__tests__/quick-panel.test.ts`
- `src/components/importer/import-page.tsx`, `src/components/importer/import-wizard.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/import/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/quick-panel-actions.ts`
- `src/components/quick-panel/quick-panel.tsx`
- `supabase/migrations/0311_import_quickpanel.sql`, `supabase/tests/0311_import_quickpanel.test.sql`
- this report

Changed:
- `src/app/[lang]/(dashboard)/merchant/[storeId]/products/import/page.tsx` renders the shared importer.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/page.tsx` has the panel at the top.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/ledger/page.tsx` has the import link.
- `src/lib/feature-availability.ts`
- `src/i18n/dictionaries/{ar,en}.json` got two namespaces, `importer` and `quickPanel`, in one textual CRLF insertion before `"features": {`. Afterwards one line in each was edited in place (`quickPanel.weekSales.sourcesOnline`). Both files pass `JSON.parse`, contain no bare LF, and have AR/EN key parity (126 + 78 keys).

Deleted: `src/components/product-import-client.tsx`, now superseded.

## 6. Not verified in a browser

- Nothing in the UI was verified in a real browser. Every screen here needs a signed-in merchant, and this session cannot sign in (entering credentials is off-limits).
- A request to the already-running dev server (port 3282) for `/import`, `/products/import`, the dashboard and the ledger returned **307 → /login**. That is the proxy, so it does **not** prove the pages compiled; only `tsc` and `eslint` do.
- Still to check on a real phone with a Pro store and a Free store:
  - RTL layout of the chips (horizontal scroll) and of the mapping selects.
  - The exceljs load and parse time of a 2,000-row file.
  - A real template download and re-upload.
  - The WhatsApp hand-off (the popup is opened inside the tap for the debt reminder).
  - Every chip against real data.
- Known limits:
  - The inactivity answer reads at most 5,000 of the most recent rows per source; a larger history could misdate a customer.
  - The ledger import is not one transaction; resume-by-re-upload is the safety net.
  - Customer-offer taps are not logged.
  - The importer cap check shown before import counts SKU-less rows as new (it can over-warn, never under-warn); the database is the gate.

## 7. Gates (verbatim tails)

```
npx tsc --noEmit            → (no output)  TSC_EXIT=0
npx eslint <13 touched files> → (no output)  ESLINT_EXIT=0
npx vitest run              →  Test Files  59 passed (59)
                                Tests  1122 passed (1122)
  (new: import-mapping.test.ts + quick-panel.test.ts = 71 tests)
npm run check:migrations    →  PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
```


## Applied to production (2026-09-28)

Rolled-back run first (migration + fixtures + assertions in one uncommitted transaction), a follow-up read confirmed nothing persisted, then apply_migration:

| migration | checks |
|---|---|
| 0310 loyalty & gift cards | 113 / 113 |
| 0311 import | 22 / 22 |
| 0312 attribution & events | 55 / 55 |
| 0313 market moderation & review trust | 51 / 51 |

After apply: existing loyalty_ledger rows unchanged (5), orders (7) and listings (12) unchanged, 2 of 5 store reviews now verified_purchase (both backed by a completed purchase), 0 product reviews lost their flag. Supabase security advisor: no finding names any new object.
