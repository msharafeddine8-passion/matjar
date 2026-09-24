# 01 — P0 CONSISTENCY (Phase 1)

Status: implemented on `feat/matjar-prelaunch-foundation`, not deployed. Gates after the phase:
tsc clean · lint 0 errors · vitest 49 files / 786 tests passing · `next build --webpack` succeeds ·
AFTER screenshots 17 routes × 6 widths all 200, no horizontal overflow (`shots/after/STATUS.md`).
Detailed per-workstream reports: `_work/ws1-pricing.md`, `_work/ws2-trust.md`, `_work/ws3-features.md`.
Every issue is a row in `MATJAR_PRELAUNCH_ISSUES.csv`.

## 1. Pricing single source of truth
- Source: `src/lib/plan-tiers.ts` (+ `TRIAL_DAYS` in `src/lib/plan.ts`). Owner confirmed these prices on 2026-09-24.
- Copy that names a plan number carries a placeholder filled by `src/lib/plan-copy.ts` (pricing, help incl. JSON-LD, merchants, legal, subscription, items limit gate, product form).
- Real bug fixed: a Basic store at its 30-product cap was told "limit (3 products)".
- Guard: `plan-price-ssot.test.ts` fails if a plan number is typed into source or dictionaries, or if UI reads `public.plans`.
- Open: `public.plans` still says Pro $12/$120 with no Basic/Business rows. Nothing reads it. Aligning it is a live-DB change awaiting approval.

## 2. PRO is not VERIFIED
- `src/lib/trust.ts`: trust kinds `registration` (commercial_reg_verified), `documents` (store_verifications status verified), `identity` (craft/freelancer admin toggles, worded as "reviewed by the Matjar team", not an ID check). Paid status is a separate type and never a trust signal.
- `src/components/trust-badges.tsx`: one icon per kind, each links to `/trust#<kind>`; the paid marker is Crown + "اشتراك مدفوع", links to `/trust#paid`.
- Real bug fixed: the admin plan dropdown wrote `is_verified = true` for any paid plan — buying a plan set a trust flag. `is_verified` has no recorded meaning, so it is no longer rendered anywhere.
- Unbacked "موثّق" removed from every Business Leaders card (no verification column exists).
- Today: 0 stores carry any trust signal, so customers see no verified badge until an admin actually verifies something.

## 3. Feature availability single source of truth
- `src/lib/feature-availability.ts` gains `FEATURE_REGISTRY` (derived from the existing tables, not a third list), `featureStatus(key, {plan, sector})`, `featureCopy(status)` with the one vocabulary متاح / تجريبي / قريباً / غير متاح.
- Hand-written «قريباً» removed from footer, directory-store note, roadmap, academy, hub; merchant module locks now use the enforced plan floor (module catalog tiers had drifted from enforcement).
- Guard: `feature-availability-ssot.test.ts`.

## 4. Offering experience resolver
- `resolveOffering` now also answers showsStock / showsQuantity / showsOptions / showsDuration / showsUnitPrice / cardBadge / addableToCart; product page, cards, store grid and JSON-LD (Service vs Product) read it.
- Restaurant cards now say «أضف إلى الطلب», matching the sticky CTA.
- Open P0: the order RPCs do not reject service items server-side. The fix (a BEFORE INSERT trigger on `order_items`, zero existing conflicts) is designed but was not written or tested against the live DB — blocked as a production change pending owner approval.

## 5. Public data quality gate
- `src/lib/data-quality.ts`: `ok / incomplete / blocked`; blocked only for no name, placeholder/digit-only name, or no contact; blocked stores leave ranked lists but stay reachable by URL; admin sees a quality column and cannot approve a blocked store; merchants see their gaps in the checklist.
- Run on production data (`13_DATA_QUALITY.md`): 17 stores → 10 ok, 7 incomplete, 0 blocked. Nothing deleted or changed.
