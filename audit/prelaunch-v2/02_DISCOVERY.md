# 02 — DISCOVERY (Phase 2)

Status: implemented on `feat/matjar-prelaunch-foundation`, not deployed. Migration 0306 (demand capture, new objects only) was applied to production after a rolled-back test.
Gates: tsc clean · lint 0 errors · vitest 52 files / 915 tests · `next build --webpack` succeeds.
Detailed reports: `_work/p2a-search.md`, `_work/p2b-cards-filters.md`, `_work/p2c-demand.md`. Every finding is a row in `MATJAR_PRELAUNCH_ISSUES.csv`.

## Why this phase mattered
Production `search_logs` before the phase: 10 of the last 12 searches returned nothing. «مطاعم» failed three times while a restaurant existed; «ملابس» failed while «ألبسة نسائي ولادب» existed. Search matched the literal words against store names only.

## Search V2 (`src/lib/search-intent.ts`)
- Pure parser: DB-identical Arabic normalisation, light stemming, a lexicon of 87 concepts (568 trigger words, Arabic / Lebanese / English / Arabizi), sector and section routing, the 47 real craft trades, the 45 real areas. Tests fail on any invented slug.
- Store search ranks text matches, same-sector stores, same-region stores and doctor specialties; blocked stores never appear; results carry the same card facts as /explore.
- The search page says what it understood («فهمنا إنك عم تدوّر على …») with links to the matching filtered view or section.

Checked on a local production build (390 px):

| query | before | after |
|---|---|---|
| مطاعم | 0 | Let's meat + link to food |
| ملابس | 0 | ألبسة نسائي ولادب + link to retail |
| سوق الاحد | 0 | 3 Sunday Market listings + /market |
| فول / برغر | 0 | Let's meat |
| دكتور عيون طرابلس | — | both clinics, link to healthcare in the North |
| مكيف ما عم يبرد | — | link to /crafts/ac-service, plus the «خبّرنا» form |
| iphone | — | Qabass Computers + an iPhone market listing |
| قطة, etumax | 0 | still 0 (no petCare store, unknown brand) → «خبّرنا» form |

## Sector-aware cards and filters (`src/lib/card-facts.ts`)
- One `StoreCard`, five layouts (goods, food, clinic, services, listing). A fact renders only when data backs it: delivery/pickup (10 stores), «يبدأ من $X · N خدمات» (3), clinic location line (2). Delivery fee, time, minimum order, prep time, insurance: 0 stores have entered them, so nothing is shown.
- Not shown because the data does not exist: cuisine, clinic specialty, next availability.
- New data-backed filters `priced`, `delivery`, `pickup`, each offered only when it would change the result in that scope.
- Counts use real Arabic plurals («3 منتجات», «تقييم واحد»).
- "Open now" (home rail and filter) now requires published hours; stores with none are no longer claimed open.

## Zero-result demand capture (migration 0306)
- `demand_requests` table, insert only through `submit_demand` (validated, rate-limited, anonymous allowed), admin view at `/admin/demand` behind the existing `growth` permission, contacts shown only there and cleared after 180 days by a daily job.
- The form appears only when a search returns nothing; contact is optional and the form says why it is asked for.

## Mobile
- The duplicate search bar on scroll (P1-MOBILE-01) is gone: the sliding header search is desktop-only; phones keep the one permanent bar.
