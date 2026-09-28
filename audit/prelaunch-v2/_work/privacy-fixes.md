# Privacy and trust fixes: migration 0314 + app changes

Branch `feat/zero-subscription-features`, 2026-09-28. Nothing is committed, nothing is applied.
Production was only read with SELECTs: `stores` has 71 columns and 17 active rows; there are 0 verification docs, 0 `store_verifications` rows and 0 of 7 orders with a `store_note`. The latest applied migration is 0313.

**Status**
- `supabase/migrations/0314_privacy_hardening.sql` and `supabase/tests/0314_privacy_hardening.test.sql` are **written, not run, not applied**. Even rolled back, the test would run DDL on production, which this task forbids.
- The owner runs the test first (Supabase MCP `execute_sql` or the SQL editor), reads the `ALL CHECKS` row, and applies only if it is green.
- The app code works **before and after** the apply, so deploy order does not matter.

---

## P1-PRIV-01: `stores` columns readable by anyone

**What was exposed.** anon and authenticated both held a **table-level** SELECT on `stores`. The row policy `stores_select` only filters rows (active and not deleted, or owner, or `admin_can('stores')`). So a logged-out visitor could read all 71 columns of every active store, including:
- `tax_no`, `legal_name`, `legal_address`, `commercial_reg_no`
- `status_reason` and `status_changed_by` (the admin's note, and which admin wrote it)
- `invoice_next_no` (how many invoices the store has issued), `address`, `trial_ends_at`

Signing up is free, so fixing anon alone would not have been enough.

**Why a plain column revoke was not safe.** I checked every place `stores` is read:
- **Client side:** 100 `.from("stores")` chains and 41 embedded `stores(...)` selects.
- **Database side:** views, invoker functions and RLS policies.

Two traps came out of that:

1. **`owner_id` cannot be revoked from anon.** Many `to public` policies run `exists (select 1 from stores s where s.owner_id = auth.uid())` as the caller: `products_select`, `orders_select`, `bookings_select`, `order_items_select`, `store_staff_*`, `products_update/insert`. So do the invoker helpers `can_manage_store`, `staff_can` and `is_store_owner`. Postgres checks column privileges inside those subqueries. Revoking `owner_id` would make **every anonymous product read fail with 42501**, and the test checks exactly this.
2. **The dashboard reads its own store under the user's session** (the authenticated role): plan, trial, HR radius, books lock, and the legal fields in settings. `guard_locked_books` and `attendance_late_minutes` also read two of these columns as the invoker. Column grants are per role, not per row, so the owner and a random signed-in user cannot be told apart by a grant.

**Fix (0314 §1–2).**
- Drop the table-level SELECT from both roles.
- **anon** gets the 51 columns the public site uses (list below).
- **authenticated** gets 61 columns: everything except the private set.
- The **private set** is revoked from both roles:
  - `legal_name, tax_no, legal_address, commercial_reg_no, invoice_prefix`
  - `status_reason, status_changed_by`
  - `invoice_next_no, credit_note_next_no` (read only inside definer functions)
  - `address` (read by nothing)
- The private columns are served by `store_private_fields(uuid[])`, a SECURITY DEFINER function with `search_path=''`, executable only by authenticated. It scopes each field per row:

| Field | Who gets it |
|---|---|
| legal identity + `invoice_prefix` | owner, any staff member of the store (they print invoices), `admin_can('stores')` |
| `status_reason` | owner, admin |
| `status_changed_by` | admin only |
| A store the caller is not tied to | not returned at all |

INSERT and UPDATE privileges are unchanged, so the owner still saves the legal fields.

**Code changes (none crash before 0314 is applied).** `src/lib/store-private.ts` calls the RPC. If the function does not exist (before 0314), it falls back to the old direct select. If both fail it returns an empty map and never throws. It chunks ids 150 at a time.

| Page | Change |
|---|---|
| admin stores list | CR no., reason and acting admin now come from the getter |
| merchant home | reason via the getter, for owned stores only (staff never saw it anyway: `stores_select` hides a stopped store from staff) |
| store dashboard | reason via the getter, fetched only when the store is stopped |
| settings | legal fields via the getter. **Safety:** if they could not be loaded, the form leaves them out of its UPDATE, so a failed load can never blank a real tax number (`legal_loaded` flag) |
| order invoice page | it selected the store's legal columns and never used them (it prints the frozen `store_invoices` copy), so they were simply removed |

### The anon column list, and where each column is used

Kept in `src/lib/store-columns.ts` (`STORE_ANON_COLUMNS`). A test keeps it equal to the migration's grant and to what `src/` actually names.

| Column(s) | Used by (public code) |
|---|---|
| `id` | every read: `store-view.ts`, `stores.ts`, `discovery.ts`, `sitemap.ts`, `s/[code]`, `[handle]`, Google feed, product page, embeds |
| `owner_id` | **RLS subqueries and invoker helpers, as above**; product page (is this my store), `messages/[id]` embed, `jobs/new`, `market/new`, `wholesale/new`, `pricing` (`.eq owner_id`) |
| `business_type_id` | the join behind every `business_types(slug)` embed (`store-view`, `stores.ts`, `discovery`, feed, `service-request-form`, favorites, flash, `product-view`, `related.ts`, `search.ts`, `explore-client`, `product-mini-card`, `recently-viewed`), plus `.eq("stores.business_type_id")` in `related.ts` |
| `name` | `store-view`, `LISTING_SELECT`/`STORE_SELECT`, search `or()`, checkout, feed, policies page, embeds (orders, bookings, favorites, flash, offers, related, market, activity, messages) |
| `slug` | `store-view`, feed (`.eq slug`), sitemap, `[handle]`, `market.ts` embed |
| `description`, `area` | `store-view`, listing selects, search `or()`, discovery, favorites |
| `logo_url`, `cover_url`, `cover_position` | `store-view`, listing selects |
| `phone`, `whatsapp` | `store-view`, listing selects, checkout, embeds (`bookings/[id]`, `inquiries/[id]`, `orders/[id]`, market detail) |
| `region`, `service_area` | listing selects, discovery, `.eq("region")`, favorites |
| `status`, `deleted_at` | the `status='active'` / `deleted_at is null` filter on every public read; `store-view`, feed, flash and related embeds |
| `plan` | `store-view`, listing selects, `.or(plan.in.(pro,business))`, feed, favorites |
| `trial_ends_at` | Google feed (effective plan) |
| `is_verified`, `commercial_reg_verified`, `featured_until`, `rating_avg`, `rating_count`, `created_at` | listing and discovery selects, featured `or()`, ordering |
| `updated_at` | sitemap |
| `hours`, `lat`, `lng`, `insurance`, `min_order`, `prep_time`, `accepts_delivery`, `accepts_pickup` | `store-view`, listing selects, discovery, checkout, `product-view` embed |
| `booking_slot_minutes`, `booking_cancel_hours`, `instagram`, `facebook`, `website`, `payment_note`, `specialties`, `accent_color`, `storefront_layout`, `announcement`, `storefront_theme`, `loyalty_redemption_enabled`, `loyalty_points_per_unit` | `store-view`, and checkout / search / `product-view` where they apply |
| `short_code` | `s/[code]` short link |
| `return_policy`, `shipping_policy`, `google_feed_enabled` | policies page, `store-view`, Google feed |
| `request_intake` | `service-request-form` (the customer's request form) |

**Hidden from anon (20):** `address`, `opening_hours`, the private set, `vat_rate`, `vat_inclusive`, `books_locked_until`, `clock_radius_m`, `late_grace_minutes`, `auto_close_hours`, `status_changed_at`, `branch_stock_separate`, `google_feed_enabled_at`.

### Risks for the live storefront, and what guards each one

- **A column the public site uses was left out of the grant.** Then the whole query fails with 42501; the page does not just show an empty field. Three layers guard this:
  1. **Vitest, runs with every `npx vitest run`:** `src/lib/__tests__/store-column-grants.test.ts` scans every `stores` select, filter, `or()`, embed and `stores.x` filter in `src/`. It resolves select constants (`LISTING_SELECT`, `STORE_SELECT`, `STORE_COLUMNS`, template literals). It fails if public code names a column outside the anon list, if any code names a private column, or if a select argument cannot be resolved. I planted a violation (select, filter and embed) and confirmed it goes red.
  2. **SQL test, as anon:** one SELECT of all 51 anon columns, plus the real query shapes (store page, listing and search with the `business_types` join and `or()`, Google feed, checkout/short-link/sitemap columns, the `related.ts` stores filter), plus an anonymous **product read**. Each of the 20 hidden columns must be refused with 42501.
  3. **Future columns:** a column added to `stores` after 0314 is readable by no client until a migration grants it. `store-columns.ts` and the migration header say so.
- **Dashboard selects of now-private columns.** All 5 are rewritten, and the scanner now forbids naming a private column directly. The one sanctioned exception is the pre-0314 fallback in `store-private.ts`.
- **Deploy order.** The code never selects a revoked column directly, so it works on both sides of the apply.
- **What stays readable, on purpose:**
  - `owner_id` (a uuid) stays anon-readable. Revoking it needs the ownership checks moved behind a definer helper and about 10 policies rewritten; that is a follow-up.
  - `trial_ends_at` stays anon-readable because the live Google feed needs it.

---

## P1-PRIV-02: verification scans in a public bucket

**What was exposed.** `ImageUpload` always uploaded to the public `store-assets` bucket and stored `getPublicUrl`. A Lebanese commercial registration carries the owner's name, ID number and home address. Confirmed read-only: 0 docs exist and 0 objects under `store-assets/verifications/`, so no data migration is needed.

**Fix.**
- **0314 §4:** a new private bucket `verification-docs` (images only, 5 MB), modelled on `ledger-attachments`. Objects live under `<store_id>/<file>`.
  - Read: `can_read_verification_doc(name)`, i.e. `can_manage_store` (owner and staff) or `admin_can('verifications')`.
  - Upload and delete: `can_write_verification_doc(name)`, i.e. the owner only, matching the doc-row policy.
  - Both functions check the path shape before casting to uuid, as in 0283/0307.
  - A `NOT VALID` CHECK on `store_verification_docs.doc_url` forces **new** rows to hold a `<own store_id>/<file>` path, with no scheme and no `..`. Any old public URL is left alone.
- **Code:**
  - `ImageUpload` has an opt-in `privateBucket` mode: it uploads to the private bucket, returns the object path, and previews the picked file locally.
  - `verifications-manager` uses it (folder = the lowercased store id).
  - The merchant and admin verification pages turn stored values into links on the server, under the viewer's session: `resolveDocUrls()` makes one `createSignedUrls` call with a 600-second lifetime, and old `https://` URLs pass through unchanged.
  - Before 0314 the bucket is missing, so an upload shows the normal upload error and nothing leaks.

---

## P2-PRIV-03: licence number and approving admin readable by anon

**What was exposed.** All 15 `store_verifications` columns were granted to anon for verified rows, including `number`, `verify_url` and `reviewed_by`.

**Fix (0314 §3).** Column grants on `store_verifications`:
- **anon:** `id, store_id, kind, title, issuer, issued_on, expires_on, status, created_at`, which is what the storefront certificates section shows.
- **authenticated:** the same plus `number, verify_url, updated_at, reviewed_at, rejection_reason`, which the merchant and admin screens read.
- **Nobody** can read `reviewed_by` through the API.

The storefront query and the `StoreVerifications` component no longer select or render the licence number and `verify_url`.

**Still open:** a signed-in user can still read `number` and `verify_url` of *verified* rows, because the merchant and admin screens need those columns under the same role. Closing that needs a definer getter, the same pattern as §2.

---

## P2-PRIV-04: customer could read the merchant's internal order note

**What was exposed.** `orders_select` gives the customer their own order row, and every column comes with it, including `store_note`. The UI never showed it; the API did.

**Fix (0314 §5).**
- New table `order_staff_notes (order_id pk, store_id, note, updated_at, updated_by)`.
  - RLS: `staff_can(store_id,'orders')` for read, write and delete (the owner always passes).
  - The insert/update check also requires `store_id` to equal the order's store.
  - A stamp trigger sets `updated_by` and `updated_at`; clients cannot forge them.
- Existing notes are copied over and the column is blanked (0 rows today). This happens *before* the redirect trigger is created, so the copy is not deleted.
- **Compatibility trigger on `orders`** (invoker, so the caller's own RLS decides):
  - a write to `store_note` from an old browser build goes into `order_staff_notes`; an empty value deletes the note;
  - the column is always set back to NULL;
  - a `store_note` supplied on INSERT is dropped, so a customer cannot author a staff note.
- **Code:** `order-staff-note.ts`. The orders page reads the table with a fallback to the old column. The editor upserts or deletes through the table, and falls back to the old column **only** when the table is missing (PGRST205/42P01). A refusal is reported as a failure, not retried through the old column.

---

## P1-JOBS-08: closed or expired jobs accepted applications

**Fix (0314 §6).** `job_applications_insert` now also requires the job to be `status='active'`, not deleted, and `apply_deadline is null or apply_deadline >= (now() at time zone 'Asia/Beirut')::date`. The deadline day itself is still open, which is the same rule the job page uses. `job-apply-form` maps a 42501 refusal to the existing "Applications closed" text (`jobs.deadlinePassed`).

---

## P2-MARKET-CROSSPOST: listings created without a category

**What was wrong.** 7 of the 10 cross-posted listings in production have no category. The listing form requires one, and a listing without one is missing from category filters and from the per-category price check in moderation.

**No honest mapping exists.** Market categories are item types (phones, laptops, furniture, clothing…); a sector is a kind of business, and one "retail" shop sells both phones and clothes. So the form **asks**:
- ticking "Sunday Market" loads the active market categories and shows a required select;
- submit is refused *before* the product is written if no category is chosen, so a half-done save cannot happen;
- `buildCrossPostListing()` (a pure helper, tested) builds the row, including `category_id`.

New dictionary keys in `merchant.products`, added in both `ar` and `en` and anchored textually: `marketCategory`, `marketCategoryHint`, `marketCategoryPick`, `marketCategoryNeeded`.

The 7 existing listings without a category are **not** touched; that is for a moderator.

---

## Migration 0314 summary (written, NOT applied)

1. `stores`: revoke table-level SELECT from anon and authenticated; grant 51 columns to anon and 61 to authenticated.
2. `store_private_fields(uuid[])`: SECURITY DEFINER, `search_path=''`, revoked from public/anon/authenticated, granted to authenticated.
3. `store_verifications`: column grants (anon 9, authenticated 14, `reviewed_by` to no one).
4. Bucket `verification-docs` (private) with two path-check functions (invoker; revoked from all, granted to authenticated) and three `storage.objects` policies; `NOT VALID` CHECK on `store_verification_docs.doc_url`.
5. `order_staff_notes` table, RLS, indexes, stamp trigger, backfill, and the `orders_store_note_redirect` trigger.
6. `job_applications_insert` with the open-job check.

Every statement is idempotent. `npm run check:migrations`: PASS.

**The SQL test** is `supabase/tests/0314_privacy_hardening.test.sql`: 73 checks plus the `ALL CHECKS` row, with the migration embedded verbatim between the markers (a vitest fails if the two ever differ). It acts as anon, another signed-in user (store B's owner), the ordering customer, owner A, staff of A with and without `orders`, and a sub-admin holding `stores` + `verifications`. Every "sees 0" has a positive control.

It does **not** cover DELETE on `storage.objects`, because `storage.protect_delete()` blocks direct deletes. The delete predicate is checked through `can_write_verification_doc()` instead.

## Files changed

**New**
- `src/lib/store-columns.ts`
- `src/lib/store-private.ts`
- `src/lib/verification-docs.ts`
- `src/lib/order-staff-note.ts`
- `src/lib/market-crosspost.ts`
- `src/lib/__tests__/store-column-grants.test.ts`
- `src/lib/__tests__/privacy-helpers.test.ts`
- `supabase/migrations/0314_privacy_hardening.sql`
- `supabase/tests/0314_privacy_hardening.test.sql`

**Modified**
- `src/app/[lang]/(dashboard)/admin/stores/page.tsx`
- `src/app/[lang]/(dashboard)/admin/verifications/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/orders/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/orders/[orderId]/invoice/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/settings/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/verifications/page.tsx`
- `src/app/[lang]/(site)/store/[id]/page.tsx` (verification select only)
- `src/components/store-verifications.tsx`
- `src/components/store-settings-form.tsx`
- `src/components/image-upload.tsx`
- `src/components/verifications-manager.tsx`
- `src/components/order-note-editor.tsx`
- `src/components/orders-filter.tsx` (passes `storeId`)
- `src/components/job-apply-form.tsx`
- `src/components/product-form.tsx`
- `src/i18n/dictionaries/ar.json`, `src/i18n/dictionaries/en.json` (4 keys each; both still parse)

The activity-center agent's files and 0315 were not touched. 0315 does not touch `stores`, `orders`, `store_verifications` or `job_applications`, and its new `stores(name)` embeds are covered by the scanner.

## Gates (verbatim)

```
$ npx tsc --noEmit
(exit 0)

$ npx vitest run
 Test Files  68 passed (68)
      Tests  1389 passed (1389)

$ npx eslint <touched files>
C:\Users\m-cha\Documents\gh\matjar\src\components\product-form.tsx
  73:20  warning  'setBookMode' is assigned a value but never used  @typescript-eslint/no-unused-vars
C:\Users\m-cha\Documents\gh\matjar\src\components\verifications-manager.tsx
  70:9  warning  '_lang' is defined but never used  @typescript-eslint/no-unused-vars
✖ 2 problems (0 errors, 2 warnings)
(exit 0)

$ npm run check:migrations
SECURITY DEFINER convention check — 311 migrations replayed in order; 235 definer signature(s) live at HEAD (26 superseded signature(s) dropped along the way and not checked).
PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
```

Both lint warnings already exist at HEAD. The vitest count includes the other agent's tests in the shared tree.

**Not verified in a browser:** the new category select, the private upload preview, and the signed-link thumbnails. They need a signed-in merchant, and I did not have one to test with.

## What is left for the owner

1. Run `supabase/tests/0314_privacy_hardening.test.sql` (rolled back) and apply 0314 only if `ALL CHECKS` is true.
2. After applying, run `get_advisors` (security).
3. Optional follow-ups:
   - a definer getter for signed-in reads of verification `number`/`verify_url`;
   - move the ownership checks behind a definer helper so `owner_id` can be revoked from anon;
   - a moderator decides categories for the 7 existing cross-posts;
   - P3-PRIV-05 (`reviews.customer_id` readable by signed-in users) was not in scope.

## CSV rows

```
P1-PRIV-01|P1|privacy|(DB) stores + /merchant, /admin/stores, settings|all|Tax no., legal name/address, CR no., admin status note/actor, invoice counters, address of every active store readable by anon and any signed-in account|Table-level SELECT for anon+authenticated; row policy only filters rows; dashboard reads private columns under the session|Column grants (anon 51 used columns, authenticated all but 10 private); private columns via SECURITY DEFINER store_private_fields(uuid[]) scoped owner/staff/admin; code reads through src/lib/store-private.ts with pre-0314 fallback; source-scan test + anon SELECT test|supabase/migrations/0314_privacy_hardening.sql|written-not-applied|anon reads stores.tax_no|anon 42501 on 20 columns, authenticated 42501 on 10; storefront selects all 51 anon columns|owner_id and trial_ends_at stay anon-readable (RLS subqueries / Google feed); test not yet run
P1-PRIV-02|P1|privacy|/merchant/[storeId]/verifications, /admin/verifications|all|Verification document scans uploaded to the public store-assets bucket|ImageUpload always used store-assets + getPublicUrl|Private bucket verification-docs (<store_id>/<file>; read owner/staff/admin_can('verifications'), write owner), NOT VALID CHECK on doc_url, ImageUpload privateBucket mode, 600 s signed URLs rendered server-side, legacy URLs still read|src/components/verifications-manager.tsx|written-not-applied|public URL|signed URL, 10 min|0 docs today, no data migration
P2-PRIV-03|P2|privacy|(DB) store_verifications, /store/[id]|all|Verified rows exposed licence number, verify_url and reviewed_by (admin uuid) to anon|Public read policy with table-wide grant|Column grants: anon 9 badge columns, authenticated adds number/verify_url/reviewed_at/rejection_reason/updated_at, reviewed_by to nobody; storefront stops selecting/rendering number and verify_url|supabase/migrations/0314_privacy_hardening.sql|written-not-applied|15 cols anon|9 cols anon, reviewed_by none|signed-in users still read number/verify_url of verified rows
P2-PRIV-04|P2|privacy|(DB) orders, /merchant/[storeId]/orders|all|Merchant internal note orders.store_note readable by the ordering customer via REST|Row policy includes customer; column grants are per role|order_staff_notes table (staff_can orders), backfill + blank column, invoker redirect trigger for old writes, drop on insert; app reads/writes via src/lib/order-staff-note.ts with fallback|src/components/order-note-editor.tsx|written-not-applied|customer can select store_note|store_note always NULL; notes staff-only|0 notes today
P1-JOBS-08|P1|jobs|/jobs/[id]|all|Applications to closed, deleted or expired jobs accepted via the API|job_applications_insert checked only applicant_id|WITH CHECK requires job active, not deleted, deadline >= Beirut today; form shows "Applications closed" on 42501|supabase/migrations/0314_privacy_hardening.sql|written-not-applied|closed/expired job accepts|refused 42501|deadline day itself stays open
P2-MARKET-CROSSPOST|P2|market|/merchant/[storeId]/items (product form)|all|Product cross-posted to the Sunday Market without a category (7 of 10 live cross-posts)|product-form inserted listings with no category_id|Form asks for a market category (required select, checked before the product is saved); buildCrossPostListing() adds category_id; no sector mapping (categories are item types)|src/components/product-form.tsx|fixed|listing without category|category required|7 existing listings left for a moderator
```
