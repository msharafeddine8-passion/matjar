# 00 — EXECUTIVE SUMMARY (living document)

Program: MATJAR PRELAUNCH FOUNDATION · branch `feat/matjar-prelaunch-foundation` · started 2026-09-24 from `main@7f74d0f`.
Production was NOT deployed by this program. Merging the branch is the owner's decision.

## Start-safely gates (baseline, before any change)

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 8 pre-existing warnings |
| `npm test` (vitest) | 45 files, 699 tests, all passing |
| `npm run build` (`next build --webpack`) | compiled, TypeScript finished |
| baseline screenshots | 17 routes × 6 widths, all HTTP 200, no horizontal overflow (`shots/before/STATUS.md`) |

## Existing model (inspected before touching anything)

- **Plans**: code source of truth `src/lib/plan-tiers.ts` (basic/pro/business, PROMO_END 2026-09-30). DB table `public.plans` still says pro = $12/$120 with no basic/business rows; `subscriptions` has 0 rows; `stores.plan` is set by hand (free 24 · pro 9 · business 5). `docs/plans-alignment-PENDING.sql` is waiting for the owner's price decision. → unclear financial rule, not migrated.
- **Verification**: `stores.is_verified`, `stores.commercial_reg_verified`, table `store_verifications` (kind/status/reviewed_by). All 15 active stores unverified; 0 verification rows. `craft_providers.verified`, freelancer verified flag exist separately.
- **Feature availability**: `src/lib/feature-availability.ts` (`live | beta | soon`, CAPABILITIES) consumed by pricing/merchants/subscription/business-os; three surfaces hand-wrote «قريباً».
- **Sectors/offerings**: `src/lib/sectors.ts` (modules, profile order), `src/lib/offering.ts` (`resolveOffering` → variant/cta/noun/sections), `src/lib/discovery.ts` (per-sector search fields, filters, card facts).
- **Search**: `searchStores` (ILIKE on name/description/area) + `search_products_fuzzy` (trigram) + market listings; DB-side `normalize_search` strips tashkeel and unifies أ/إ/آ/ى/ة; `search_logs` records every query with `results_count` (zero-result demand data already exists but has no capture form and no admin view).
- **Reviews**: `reviews` (store), `product_reviews` (`verified` = purchase), `craft_reviews`; 2 stores have reviews.
- **Analytics**: `track_store_visit` (store_visits: source/device/city), `log_search`, `hub_tool_events`. No client event taxonomy.
- **Onboarding**: `/merchant/new` single form; admin approval flips `stores.status`.

## Phase log

- Phase 1 (P0 consistency): done except two items awaiting owner approval (DB price table, server-side service guard) — see `01_P0_CONSISTENCY.md`.
