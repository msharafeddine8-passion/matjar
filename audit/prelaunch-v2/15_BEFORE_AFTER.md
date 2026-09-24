# 15 — BEFORE / AFTER

Branch `feat/matjar-prelaunch-foundation`, baseline commit `7f74d0f`.
Screenshots: `audit/prelaunch-v2/shots/before/` (this section) and `shots/after/` (appended when phases land).
Captured with `node scripts/shots-prelaunch.mjs before` against a local production build
(`next build --webpack` + `next start`), Arabic RTL, widths 360 / 390 / 430 / 768 / 1024 / 1440.
Status table with page heights and horizontal-overflow check: `shots/before/STATUS.md`.

## Baseline (2026-09-24, before any change)

| route | result at all 6 widths |
|---|---|
| 01-home `/ar` | 200, no horizontal overflow |
| 02-explore `/ar/explore` | 200; 7,063 px tall at 390 (17 stores, one long list, no sector grouping) |
| 03-search `/ar/search?q=دكتور` | 200; 1 result, card shows Pro crown + «جديد» + «مفتوح» |
| 04-category `/ar/category/food` | 200 |
| 05-retail-store (sleepy care) | 200; heading «المنتجات والخدمات», cards «أضف للسلة» |
| 06-restaurant (Let's meat) | 200; **cards say «أضف للسلة» while sticky CTA says «أضف إلى الطلب»** (P1 noun mismatch → WS4) |
| 07-clinic (دكتور عمر الصمد) | 200; Pro crown beside the name in the trust row (P0 → WS2); services show duration + price; sticky «احجز موعدًا» |
| 08-appointment-service (أشعة) | 200; already reads as a service («خدمات مشابهة», «تقييمات الخدمة», book CTA); the word «منتج» still appears once (→ WS4) |
| 09-physical-product (طقم كنب) | 200 |
| 10-crafts-landing | 200 (0 providers in production — empty-state design, no placeholders) |
| 11-crafts-result `/ar/crafts/electrician` | 200 (zero supply; SEO indexing rule is Phase 5) |
| 12-freelance-landing | 200 (1 freelancer, 3 gigs) |
| 13-freelancer-profile | 200 |
| 14-jobs | 200 (empty state) |
| 15-market | 200 |
| 16-pricing | 200; 7,873 px tall at 390 |
| 17-merchants | 200; 10,101 px tall at 390 |

Observed P0 evidence that the code audit confirmed (see 01_P0_CONSISTENCY.md):
- Help FAQ carries literal plan prices («75$ / 150$ / 300$») outside `plan-tiers.ts`.
- The Pro crown renders in the same badge row as the trust badges on cards and the store header, and the
  header uses the same check icon for «سجل تجاري» and «موثّق».
- «قريباً / Soon» is hand-written in the footer and in the directory-only store note instead of resolving
  from the feature registry.
- Every one of the 15 active stores is unverified in the data, so no customer sees a verified badge today —
  the trust model is being fixed before the first merchant earns one.

## After Phase 1 (2026-09-24, local production build)

All 102 captures 200, no horizontal overflow. Verified by reading rendered text, not by heights:

| check | before | after |
|---|---|---|
| restaurant card button | «أضف للسلة» (sticky said «أضف إلى الطلب») | «أضف إلى الطلب» on all 4 |
| service page (أشعة) cart words / JSON-LD | Product-typed | 0 cart words; JSON-LD `Service` |
| clinic header «Pro» | same pill row as trust badges, no meaning | paid marker titled «اشتراك مدفوع», links to /trust#paid |
| /pricing annual FAQ | literal 75$ / 150$ / 300$ | same text, filled from plan-tiers; hidden after 30 Sep |
| /help free plan answer | literal «3 منتجات» | same text, filled from plan-tiers |
| /trust | no per-badge explanation | sections #registration #documents #identity #paid |
| /hub/leaders «موثّق» | on every card | 0 |
| leaked `{placeholder}` text anywhere checked | — | 0 |

New finding from the AFTER captures: on a store page at phone width the global search and the store search stack as two identical bars after scrolling (P1-MOBILE-01).
