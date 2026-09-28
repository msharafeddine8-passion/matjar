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

- **Plans**: code source of truth `src/lib/plan-tiers.ts` (basic/pro/business, PROMO_END 2026-09-30). DB table `public.plans` still says pro = $12/$120 with no basic/business rows; `subscriptions` has 0 rows; `stores.plan` is set by hand (free 24 · pro 9 · business 5). Resolved 2026-09-24: the owner confirmed the code prices and migration 0305 aligned the table.
- **Verification**: `stores.is_verified`, `stores.commercial_reg_verified`, table `store_verifications` (kind/status/reviewed_by). All 15 active stores unverified; 0 verification rows. `craft_providers.verified`, freelancer verified flag exist separately.
- **Feature availability**: `src/lib/feature-availability.ts` (`live | beta | soon`, CAPABILITIES) consumed by pricing/merchants/subscription/business-os; three surfaces hand-wrote «قريباً».
- **Sectors/offerings**: `src/lib/sectors.ts` (modules, profile order), `src/lib/offering.ts` (`resolveOffering` → variant/cta/noun/sections), `src/lib/discovery.ts` (per-sector search fields, filters, card facts).
- **Search**: `searchStores` (ILIKE on name/description/area) + `search_products_fuzzy` (trigram) + market listings; DB-side `normalize_search` strips tashkeel and unifies أ/إ/آ/ى/ة; `search_logs` records every query with `results_count` (zero-result demand data already exists but has no capture form and no admin view).
- **Reviews**: `reviews` (store), `product_reviews` (`verified` = purchase), `craft_reviews`; 2 stores have reviews.
- **Analytics**: `track_store_visit` (store_visits: source/device/city), `log_search`, `hub_tool_events`. No client event taxonomy.
- **Onboarding**: `/merchant/new` single form; admin approval flips `stores.status`.

## Phase log

- Phase 1 (P0 consistency): done. Every P0 row is fixed, including the two live-DB changes the owner approved on 2026-09-24 (migrations 0304, 0305). See `01_P0_CONSISTENCY.md`.
- Phase 2 (discovery): done — search V2, sector-aware cards and filters, zero-result demand capture (migration 0306). See `02_DISCOVERY.md`.
- Phase 3 (business profile engine): done. See `03_BUSINESS_PROFILE_ENGINE.md`.
- Phase 4 (crafts, freelance, jobs): done. See `05`, `06`, `07`.
- Phase 5 (SEO, Sunday Market moderation, trust, privacy): done in code; 0313 applied, 0314 waits for the deploy. See `08`, `09`, `10`.
- Phase 6 (activity and retention, analytics): done; 0315 pending. See `11_ANALYTICS.md`.
- Phase 7 (final QA): build, lint, typecheck, 1389 unit tests, 21 browser tests incl. axe WCAG A/AA, 102 screenshots at 6 widths. See `12_ACCESSIBILITY.md`.

Also on the same branch: the six zero-subscription features (debt ledger, WhatsApp actions, Google feed, loyalty and gift cards, source attribution, Excel import and quick panel). See `audit/zero-sub/`.

Remaining: `16_REMAINING_GAPS.md`. Issues: `MATJAR_PRELAUNCH_ISSUES.csv` (151 rows, 0 open P0).
