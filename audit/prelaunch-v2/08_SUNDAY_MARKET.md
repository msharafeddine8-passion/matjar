# 08 — Sunday Market trust & moderation (§25)

Phase 5, 2026-09-25. Branch `feat/zero-subscription-features`. Production was read
(SELECT only) to confirm every finding below; **nothing was applied**. The schema
half is `supabase/migrations/0313_market_moderation.sql` with its rolled-back test
`supabase/tests/0313_market_moderation.test.sql`. Neither has been run.

## Production state (read-only, 2026-09-25)

| | |
|---|---|
| listings | 3 active, 3 pending, 2 rejected, 3 expired, 1 draft (12) |
| listings without a category | 7 of 12 |
| listing_reports / content_reports on listings | 0 / 0 |
| listings naming a store the seller does not run | 0 |
| expiry cron `expire-stale-listings` | active, daily 03:00 UTC, 60 days |

## What was wrong

1. **Moderation could be bypassed (P0).** `listings_update_own` lets the seller
   write *any* column of their own row. One request (`PATCH {status:'active'}`)
   published a pending or rejected listing with no moderator; `is_featured`,
   `views` and `created_at` (a date in 2099 = top of "newest" and never expires)
   were equally writable. The form only sends `draft`/`pending`; nothing enforced it.
2. **Store impersonation (P1).** `store_id` was never checked against the seller.
   The listing page renders a store listing with a check badge and **that store's**
   WhatsApp + phone (`src/app/[lang]/(site)/market/[id]/page.tsx`, seller card).
3. **A market sub-admin could not moderate (P1).** `/admin/market` is gated on
   `admin_can('market')`, but the UPDATE policy said `is_super_admin()`. Approve /
   reject / feature by a market sub-admin updated 0 rows, returned no error, and
   the client then wrote an "approved" audit-log row for a change that never happened.
4. **Deleting a reported listing erased the reports (P1).** `listing_reports`
   cascades on delete and the seller may hard-delete their own row.
5. **Suspension did not reach the market (P1).** `user_is_active()` gated inserts
   only: a suspended user's live listings stayed public and they could still edit
   and relist.
6. **No queue, no signals (P2).** The admin page listed every listing by date;
   there was no duplicate detection, no price check, no seller history, no
   rejection reason the seller could read.

## Feature matrix

| Feature | Before | Now | Where |
|---|---|---|---|
| Report a listing | present (`listing_reports`, 15/h, 1 per user) | unchanged | `src/components/listing-report.tsx` |
| Reports queue | present (`/admin/market/reports`) | now reports a 0-row write instead of logging it | `src/components/admin-market-reports-client.tsx` |
| Moderation state | `draft/pending/active/sold/rejected/expired` — not enforced | enforced by DB guard; `reviewed_by/reviewed_at/moderation_note` added | 0313 §A–B |
| Listing expiry | present (60 d cron) | unchanged; queue shows days left; seller can only renew to *now* | 0039, 0313 §B, `daysUntilExpiry` |
| Duplicate detection | none | same seller + same normalised title (Arabic variants/diacritics folded), or the same photo URL across sellers — **flag only** | `src/lib/market-moderation.ts` `findDuplicates` |
| Suspicious price | none | below 1/5 or above 5× the category median (≥ 5 approved samples) — **flag only** | `priceSignal`, `categoryPriceStats` |
| Contact moved off-platform | none | Lebanese phone number or link in title/description — flag | `hasContactInText` |
| Category validation | optional | required to submit for review (draft may still skip it); `noCategory` signal for old rows | `src/components/listing-form.tsx` |
| Seller history | none | member since, suspended?, total/live/rejected/removed listings, open/total reports | 0313 §E `market_seller_facts` (moderator-only) |
| Blocked-user controls | inserts only | suspended user: no writes at all; their listings drop out of public reads | 0313 §B, §D |
| Moderation queue | none | `/admin/market/queue` — pending + flagged live listings, priority-sorted, approve / reject-with-reason | `src/app/[lang]/(dashboard)/admin/market/queue/page.tsx`, `src/components/admin-market-queue.tsx` |
| Rejection reason to seller | none | reason key stored in `moderation_note`, shown in the seller's language on "My listings" | `src/components/my-listings-manager.tsx`, `getMyListings` |
| Evidence survives seller delete | no | seller DELETE → soft delete (reports + history kept) | 0313 §C |
| Automated deletion | — | **none, by design.** Every signal only orders the queue; a human approves or rejects. | — |
| Phone verification | — | **not feasible**: no SMS gateway, no existing OTP; `profiles.phone` is self-typed and unverified. Documented, not faked. | — |

## Migration 0313 (written, NOT applied)

- `listings`: `reviewed_by`, `reviewed_at`, `moderation_note` (≤ 500 chars).
- `guard_listing_write` — BEFORE INSERT/UPDATE, SECURITY INVOKER, acts only when
  `current_user in ('authenticated','anon')` and the caller is not
  `admin_can('market')` (the established guard pattern — definer RPCs, the cron and
  `admin_soft_delete` pass through). Seller transitions allowed: → draft/pending,
  active → sold, sold|expired → active; editing content of a non-draft listing
  forces `pending`; everything else raises `42501`.
- `soft_delete_own_listing` — BEFORE DELETE; a seller's delete becomes
  `deleted_at = now()`.
- Policies: update/delete `admin_can('market')`; public read also needs
  `user_id_is_active(seller_id)` (new definer, anon+authenticated).
- `market_seller_facts(uuid[])` — definer, `search_path=''`, authenticated only,
  raises `42501` for non-moderators.
- Review-trust fixes (see `09_TRUST.md`).

Test (`supabase/tests/0313_market_moderation.test.sql`, about 50 checks, one
`ALL CHECKS` row): seller, another user, market moderator, a jobs-only admin, a
suspended user, anon; every refusal in its own exception block with a positive
control. `npm run check:migrations` passes with 0313 included.

**Safe before 0313:** the queue works on listing-level signals and shows "seller
history appears once migration 0313 is applied"; the reject button only sends
`moderation_note` when the history RPC answered (same migration); the seller's
reason read is a separate, error-tolerant query.

## Still open

- Private (non-merchant) sellers have **no contact path** on the listing page — a
  buyer can only favourite or report. Product decision (in-app messaging vs.
  revealing a number), not a moderation fix.
- `src/components/product-form.tsx:247` (merchant cross-post to the market) inserts
  a listing with no category. Not in this territory; the queue flags it.
- Renew: an active listing can be renewed (moved to the top of "newest") any
  number of times. 0313 clamps it to *now*; a cooldown is a product call.
- When 0313 is applied, the one existing self-review (owner of a now-suspended
  store) should be looked at by a human — nothing deletes it automatically.

## CSV rows

```
P0-MARKET-01|P0|market/trust|/market/[id]|all|A seller could publish past moderation (status active), self-feature, set views, and future-date created_at with one PATCH|listings_update_own lets the seller write every column; nothing enforced the form's draft/pending|guard_listing_write (invoker trigger) — seller transitions limited, system columns kept|supabase/migrations/0313_market_moderation.sql|written-not-applied|pending→active by the seller|42501|test: 0313_market_moderation.test.sql
P1-MARKET-02|P1|market/trust|/market/[id]|all|A listing could name any store and show that store's badge, WhatsApp and phone|store_id never checked against the seller|staff_can(store_id,'products') required on insert/update|supabase/migrations/0313_market_moderation.sql|written-not-applied|any store|own store only|0 rows today
P1-MARKET-03|P1|market/admin|/admin/market|all|A market sub-admin's approve/reject/feature updated 0 rows silently and was logged as done|UPDATE policy said is_super_admin(); client never checked the row count|Policy → admin_can('market'); client .select("id") and says so on 0 rows, no log|supabase/migrations/0313_market_moderation.sql; src/components/admin-market-client.tsx|UI fixed; DB written-not-applied|"approved" logged, nothing changed|approve works / failure reported|—
P1-MARKET-04|P1|market/trust|/account|all|Deleting a reported listing deleted its reports|listing_reports cascade + seller hard delete|Seller DELETE → soft delete (BEFORE DELETE trigger); seller screen hides removed rows|supabase/migrations/0313_market_moderation.sql; src/lib/data/market.ts|written-not-applied|reports erased|reports kept|—
P1-MARKET-05|P1|market/trust|/market|all|A suspended user's listings stayed public and editable|user_is_active() only on insert|Public read requires user_id_is_active(seller); guard refuses all writes by a suspended user|supabase/migrations/0313_market_moderation.sql|written-not-applied|public|hidden until reinstated|reversible, human decision
P2-MARKET-06|P2|market/admin|/admin/market/queue|all|No moderation queue, duplicate detection, price check or seller history|—|Queue page + pure signals (duplicates, price outliers, contact in text, no category, seller history) — flag only, no automated action|src/lib/market-moderation.ts; src/app/[lang]/(dashboard)/admin/market/queue/page.tsx; src/components/admin-market-queue.tsx|fixed (history after 0313)|none|priority-sorted queue|tested
P2-MARKET-07|P2|market|/market/new|all|Category optional — 7/12 listings have none|form never required it|Required to submit for review (drafts exempt)|src/components/listing-form.tsx|fixed|optional|required|—
P2-MARKET-08|P2|market|/account|all|A rejected seller never learned why|no reason column|moderation_note (reason key) + shown in the seller's language|0313; src/components/my-listings-manager.tsx|UI fixed; DB written-not-applied|—|"سبب الرفض: …"|—
P2-MARKET-09|P2|market|/market/[id]|all|Private (non-merchant) sellers have no contact path|contact buttons render only for store listings|Product decision: in-app message vs number|src/app/[lang]/(site)/market/[id]/page.tsx|open|—|—|not a moderation fix
P2-MARKET-10|P2|market|/merchant/[storeId]/products|retail|Merchant cross-post inserts a listing without a category|product-form insert omits category_id|Pass a market category or map from the product|src/components/product-form.tsx:247|open|—|—|outside territory; queue flags it
P3-MARKET-11|P3|market|—|all|Phone verification|no SMS gateway, no OTP mechanism (zero-cost)|Documented; not faked|—|not-feasible|—|—|—
P3-MARKET-12|P3|market|/account|all|Renew can bump an active listing to the top any number of times|no cooldown|0313 clamps created_at to now(); cooldown is a product call|supabase/migrations/0313_market_moderation.sql|partial|any date|now() only|—
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
