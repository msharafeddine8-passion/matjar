# 09 — Trust: privacy exposure (§36) and review verification (§18)

Phase 5, 2026-09-25. Every finding was checked against production with read-only
SELECTs (RLS policies, `has_column_privilege`, row counts). Nothing was applied.

## A. Privacy — what a logged-out visitor (anon) or any account can read

Severity is for launch: **P1** = fix before real merchants fill the field,
**P2** = fix soon, **P3** = note.

| # | Sev | Data | Who can read it | Evidence | Rows today | Status |
|---|---|---|---|---|---|---|
| PRIV-01 | P1 | `stores.tax_no`, `legal_name`, `legal_address`, `commercial_reg_no`, `owner_id`, `status_reason`, `status_changed_by`, `trial_ends_at`, `invoice_next_no`, `credit_note_next_no`, `books_locked_until`, `clock_radius_m`, `late_grace_minutes` | **anon**, for every active store (all 71 columns have an anon column grant; `stores_select` row policy is `status='active' and deleted_at is null`) | `has_column_privilege('anon','public.stores','tax_no','select') = true`; columns from `supabase/migrations/0212_tax_invoice.sql:25-26` | 0 active stores have tax/legal fields filled | **Reported, not fixed** (outside territory). Fix: a migration revoking anon SELECT on those columns (no `.select("*")` on `stores` exists in `src/`, so column-level revoke is safe to do) — verify every anon `stores` select first. `legal_address` of a home-based merchant is a private address. |
| PRIV-02 | P1 | Verification document images (`store_verification_docs.doc_url`) | **anyone with the URL** — uploaded to the public `store-assets` bucket | `src/components/verifications-manager.tsx:210-220` (`folder="verifications/<storeId>"`, comment says public by design), `src/components/image-upload.tsx:141-148` (`store-assets`, `getPublicUrl`) ; bucket `store-assets public=true` | 0 docs | **Reported.** The table's RLS is owner + `admin_can('verifications')` (good) but the file is public. A Lebanese commercial registration carries the owner's full name, ID number and home address. Fix: a private bucket + signed URLs for owner/admin, and an explicit opt-in for a public "evidence" thumbnail. |
| PRIV-03 | P2 | `store_verifications.number`, `issuer`, `verify_url`, `reviewed_by` (admin uuid), `rejection_reason` | **anon**, for verified, unexpired rows (all 15 columns granted) | policy `store_verifications_public_read`, `supabase/migrations/0196_emergency_hardening.sql:13` | 0 verified | **Reported.** Licence numbers are arguably public trust data; `reviewed_by` (which admin approved) is not. Fix: column grants. |
| PRIV-04 | P2 | `orders.store_note` (merchant's internal note) | the **ordering customer**, via REST (row policy `orders_select` includes `customer_id = auth.uid()`; table-level column grant) | `src/components/order-note-editor.tsx:9-11` says "customers never see"; no customer page selects it (`src/app/[lang]/(site)` has no `store_note`) | 0 notes | **Reported.** UI is correct; the API is not. Column privileges are per role, not per row, so the fix is moving the note to a staff-only table (`order_staff_notes`, RLS `staff_can(store_id,'orders')`). |
| PRIV-05 | P3 | `reviews.customer_id`, `product_reviews.customer_id` | any **authenticated** user (table-level SELECT); anon is correctly column-restricted | `has_column_privilege('authenticated','public.reviews','customer_id','select') = true` | 5 + 1 rows | **Reported.** Lets a signed-in user map reviewers to account ids (MP-010 fixed only the anon path). `craft_reviews` is correct (no grant). |
| PRIV-06 | P3 | `craft_providers.phone`, `whatsapp` | anon, active providers | public by design — the professional page shows the contact (`src/lib/data/crafts.ts:463`); no address column exists (region/area only) | 0 active providers | OK by design; crafts agent owns the pages. |
| PRIV-07 | — | `listings.seller_id` | anon | uuid only; an individual seller is shown as "مستخدم", never named | — | OK. `listingJsonLd` never names a private seller either. |
| OK | — | `profiles` (phone, role) | own row + super admin | `profiles_select` | — | OK |
| OK | — | `store_customers` (phone, **notes**) | `staff_can(store_id,'customers')`, authenticated only | `store_customers_manage` | — | OK |
| OK | — | `store_verification_docs` rows | owner + `admin_can('verifications')` | `store_verification_docs_manage` | — | OK (the file itself: PRIV-02) |
| OK | — | `job_applications` | applicant + the job's poster | `job_applications_select` | — | OK |
| OK | — | token pages `/gift/[token]`, `/loyalty/[token]`, `/statement/[token]` | bearer URL | each page sets `robots`; robots.txt now also disallows them | — | OK |

Fixed in this territory: the Sunday Market listing JSON-LD never names a private
seller; robots.txt disallows every bearer-token and private per-user route in both
locales (`src/lib/seo-rules.ts` `PRIVATE_PATH_PREFIXES`).

## B. Review trust — what "verified" means in the data

| Table | Tied to a transaction? | Flag | Before 0313 | After 0313 |
|---|---|---|---|---|
| `reviews` (store) | Insert policy requires `has_store_purchase` (a **completed** order or booking at the store) — but the row is not linked to an order, and 3 of 5 rows predate the gate | none | no flag; the store header/JSON-LD average includes the 3 legacy rows (1 on an active store) | `reviews.verified_purchase` = `has_store_purchase(customer, store)`, set by trigger on insert/update, not writable by clients, backfilled (2 true / 3 false today) |
| `product_reviews` | Insert needs no purchase | `verified` (trigger) | `verified` = the author had **any** order containing the product — pending, cancelled and rejected included | `verified` = a **completed** order containing the product; existing rows recomputed (0 verified today either way) |
| `craft_reviews` | Insert policy requires a **completed** `craft_request` between this customer and provider | none needed — every row is transaction-verified by construction | same | same |
| self-reviews | nothing stopped an owner/staff member reviewing their own store or products (1 live row: an owner's 5★ of their own, now suspended, store) | — | allowed | new rows refused (`42501`); the existing row is left for a human |

### The rule the UI must follow (profile-engine agent, Reviews 2.0)

1. A **store** review may say "verified purchase" / «مشتري موثّق» **only when
   `reviews.verified_purchase = true`**. Before 0313 is applied the column does not
   exist: every store review is *unconfirmed* — which is exactly what
   `reviewVerification()` in `src/lib/profile-engine.ts` already returns for
   `source: "store"`. After 0313, add the column to the anon select (the grant is
   in the migration) and map `true → verified`.
2. A **product/service** review may say "ordered on Matjar" when
   `product_reviews.verified = true`. Do **not** upgrade the wording to "bought" /
   "verified purchase" until 0313 is applied — before it, `verified` also counts
   cancelled and never-fulfilled orders. The current `"orderedOnMatjar"` label is
   the right one for both states.
3. A **crafts** review is always from a completed job; it may say so.
4. **Never** derive "verified" from anything else (a reply, a rating, account age).
5. **Averages and counts** may include unverified rows (they are real reviews by
   real accounts), but a verified count, if shown, must be computed from the flag.
6. **JSON-LD:** `AggregateRating` only via `aggregateRating()` in
   `src/lib/jsonld.ts` — ≥ 1 real review, rating inside 1..5, integer count. No
   builder emits anything that says "verified" (tested:
   `src/lib/__tests__/jsonld.test.ts`, `seo-rules.test.ts`).

## CSV rows

```
P1-PRIV-01|P1|privacy|(DB) stores|all|Tax no., legal name/address, CR no., owner id and internal status columns of every active store are anon-readable|All 71 stores columns carry an anon column grant; row policy only filters status|Revoke anon SELECT on the sensitive columns (no select("*") on stores in src/)|supabase/migrations/0212_tax_invoice.sql:25|open|anon reads stores.tax_no|—|0 active stores have those fields today; outside this territory
P1-PRIV-02|P1|privacy|/merchant/[storeId]/verifications|all|Verification document photos go to the public store-assets bucket|ImageUpload always uploads to store-assets + getPublicUrl|Private bucket + signed URLs for owner/admin; opt-in public thumbnail|src/components/verifications-manager.tsx:210|open|public URL|—|0 docs today
P2-PRIV-03|P2|privacy|(DB) store_verifications|all|Verified rows expose number, verify_url and reviewed_by (admin uuid) to anon|Public read policy with table-wide grant|Column grants for anon|supabase/migrations/0196_emergency_hardening.sql:13|open|15 cols anon|—|0 verified rows
P2-PRIV-04|P2|privacy|(DB) orders|all|Merchant internal note orders.store_note readable by the ordering customer via REST|Row policy includes customer; column grants are per role|Move to a staff-only table|src/components/order-note-editor.tsx:9|open|customer can select store_note|—|UI never shows it; 0 notes today
P3-PRIV-05|P3|privacy|(DB) reviews, product_reviews|all|customer_id readable by any signed-in user|Table-level SELECT for authenticated|Column grants for authenticated as for anon|supabase (grants)|open|—|—|anon path already fixed (MP-010)
P1-REVIEW-01|P1|reviews|/product/[id]|all|product_reviews.verified true after a cancelled/pending order|Trigger checked any order, not a completed one|Trigger requires orders.status = completed; rows recomputed|supabase/migrations/0313_market_moderation.sql|written-not-applied|cancelled order ⇒ verified|completed only|0 verified rows today
P1-REVIEW-02|P1|reviews|/store/[id]|all|Owners/staff could review their own store and products|No self-review guard|BEFORE INSERT trigger refuses owner/staff (42501)|supabase/migrations/0313_market_moderation.sql|written-not-applied|1 live self-review|new ones refused|existing row left for a human
P2-REVIEW-03|P2|reviews|/store/[id]|all|Store reviews carry no verification flag; 3/5 predate the purchase gate|Purchase gate is a policy, never recorded on the row|reviews.verified_purchase via trigger + backfill + anon grant|supabase/migrations/0313_market_moderation.sql|written-not-applied|no flag|2 true / 3 false|UI rule in 09_TRUST.md §B
P3-REVIEW-04|P3|reviews/seo|all JSON-LD|all|Guarantee no JSON-LD labels a review verified or emits a rating without reviews|Rating guard was inline and partial|Shared aggregateRating() + tests|src/lib/jsonld.ts|fixed|rating on any truthy pair|≥1 review, 1..5, integer count|—
```
