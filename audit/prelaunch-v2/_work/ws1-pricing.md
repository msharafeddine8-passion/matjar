# Workstream 1 — Pricing single source of truth (P0)

Branch `feat/matjar-prelaunch-foundation`, working tree only (nothing staged, committed, pushed, built or deployed; no DB change).

## Outcome

Every subscription price, trial length, product cap, staff seat count and savings percentage a customer or merchant can see now resolves from `src/lib/plan-tiers.ts` (`PLAN_TIERS`, `PROMO_END`, `promoState`, `annualPrice`, `planProductLimit`) plus `TRIAL_DAYS` in `src/lib/plan.ts`. Copy that names one of those numbers carries a placeholder and is filled at render time by the new `src/lib/plan-copy.ts`. A guard test walks `src/**` and both dictionaries and fails if a plan number is typed back in.

No UI reads prices from the `public.plans` table (grep of `from("plans")`, `plans.price`, `price_monthly`, `price_yearly` in `src/` returned nothing; the guard test now asserts this permanently).

## Files changed

| File | Change |
|---|---|
| `src/lib/plan-copy.ts` (new) | `planCopyVars(now)` resolves `{days}`, `{freeProducts}`, `{basicProducts}`, `{proProducts}`, `{basicMonthly}`, `{proAnnual}` (promo-resolved) etc. from plan-tiers/plan.ts; `fillPlanCopy` / `planCopy` fill a string. Pure module, usable from client components. |
| `src/lib/__tests__/plan-price-ssot.test.ts` (new) | Guard: scans `src/**/*.{ts,tsx}` (comments stripped, plan-tiers.ts / plan.ts / tests excluded) and both dictionaries for literal plan prices (`$10/25/65/75/150/300/120/780`, Arabic-Indic digits too), `14-day`, product caps (3/30/200 products), staff seats, savings %, restricted to lines/strings in a plan context or under `pricing|faq|merchantsPage|merchant.subscription|os.pro|subscription|help|proGate`; asserts no `from("plans")` / `price_monthly` / `price_yearly` in src; asserts ar/en placeholder parity and that every plan-fact placeholder is one plan-copy fills; unit-tests promo-window resolution. The number sets are derived from PLAN_TIERS, so a price change moves the guard with it. |
| `src/i18n/dictionaries/en.json` | 11 strings: literal plan numbers replaced with placeholders (see duplications below). 22-line diff, CRLF preserved, parses. |
| `src/i18n/dictionaries/ar.json` | Same 11 strings, in sync with en. 22-line diff, CRLF preserved, parses. |
| `src/app/[lang]/(site)/pricing/page.tsx` | Metadata description fills `{days}`; FAQ answers filled from `planCopyVars(now)` (promo-resolved per request); the "how long does the annual offer last" answer (the one quoting promo prices and "the countdown above") is dropped once `PROMO_END` passes; passes `trialDays={TRIAL_DAYS}` to the cards. |
| `src/components/pricing-plans.tsx` | New `trialDays` prop; trial line under each card fills `{days}` from it. |
| `src/app/[lang]/(site)/help/page.tsx` | FAQ items filled with plan vars before both the FAQPage JSON-LD and the markup. |
| `src/app/[lang]/(site)/merchants/page.tsx` | `entryReassure` lines filled (`{freeProducts}`) before both CTAs; comment updated. |
| `src/app/[lang]/(site)/legal/page.tsx` | Terms said "3 products" as a hardcoded TSX literal in both locales (found by the guard test); now `{freeProducts}` filled at render. |
| `src/app/[lang]/(dashboard)/merchant/[storeId]/subscription/page.tsx` | `startTrialTitle` fills `{days}`; comment no longer names the number. |
| `src/app/[lang]/(dashboard)/merchant/[storeId]/items/page.tsx` | Product-limit gate: title `{limit}` = the store's real cap (`productCap`), body's tier caps from PLAN_TIERS. |
| `src/components/product-form.tsx` | Trigger error `free_product_limit` shows the filled `productLimitBody`. |
| `src/components/pro-gate.tsx` | Comment only: no longer names "$25/$65". Price line was already from PLAN_TIERS. |

Not touched (other agents' territory, checked read-only): `feature-availability.ts` (reads PLAN_TIERS for count cells — correct), `business-os.tsx` (plan floors only, no prices), `store/**`, `store-card.tsx`, `offering.ts`, `data/stores.ts`, `site-footer.tsx`. No feature-availability API change was needed.

## Duplications found and how each was fixed

1. **`pricing.faq[4]` "$75 / $150 / $300" (en + ar)** — the only literal dollar prices outside plan-tiers. Now `(${basicAnnual} / ${proAnnual} / ${businessAnnual})` / `({basicAnnual}$ / …)`, promo-resolved through `annualPrice(tier, promoActive)` for the request; hidden after PROMO_END because it references "the countdown above".
2. **`pricing.faq[1]` "up to 30 products"** — `{basicProducts}`.
3. **Trial length "14" / "١٤" typed in 6 places** — `pricing.trialLine`, `pricing.freeTrial`, `pricing.trialBanner`, `pricing.faq[0].a`, `merchant.subscription.startTrialTitle` (both locales) and the pricing page `generateMetadata` description (hardcoded in TSX, both locales). All now `{days}` from `TRIAL_DAYS`. Note: `pricing.freeTrial` and `pricing.trialBanner` are not rendered anywhere (orphan keys) — parameterised anyway so they cannot regress if someone wires them up.
4. **`os.pro.productLimitTitle` "(3 products)"** — shown to ANY store that hit its cap, so a Basic store at 30 was told "3 products". Now `{limit}` = the store's actual `planProductLimit(effectivePlan)`. **`os.pro.productLimitBody` "3 / 30 / 200"** — `{freeProducts}` / `{basicProducts}` / `{proProducts}`. Filled in both the items page gate and the product-form trigger error.
5. **Free cap "3 products" repeated in 4 surfaces** — `faq.items[7].a` (/help), `merchantsPage.entryReassure[0]` (/merchants, rendered twice), and `/legal` terms (hardcoded TSX, both locales). All `{freeProducts}` = `planProductLimit("free")`.
6. **Arabic strings used Eastern Arabic numerals (١٤, ٣)** while the arabic-first-ui convention and the rest of the product use Western digits; interpolation now prints `14` / `3` consistently.

Comments that named prices (`pro-gate.tsx:42`) were updated; the historical notes in `plan.ts:13` and `feature-availability.ts:12` describe removed bugs (not current facts) and were left (feature-availability is not mine; the guard strips comments so they cannot trip it).

## P0 finding needing the owner's decision — DB disagrees with code

`public.plans` holds only `free $0/$0` and `pro $12 monthly / $120 yearly`; it has no `basic` or `business` rows, and its Pro price contradicts `PLAN_TIERS` (Pro $25/mo, $150 promo / $300 standard annual). `docs/plans-alignment-PENDING.sql` documents the mismatch. This is an unclear financial rule: I did **not** write a migration or change the table. What I did do: verified no code in `src/` prices anything from that table, and added a permanent test assertion so it cannot start. `public.subscriptions` has 0 rows and gating remains `stores.plan` + `trial_ends_at` (unchanged). The owner must decide whether `plans` is (a) reconciled to PLAN_TIERS, (b) dropped, or (c) becomes the source with PLAN_TIERS reading from it — until then the code is the only truth customers see.

## Other observations (not fixed, outside the pricing-number scope)

- `merchant.subscription.upgradeBody` promises "unlimited orders, higher search visibility, a Pro badge and better support" — feature claims, not numbers; they are not validated against `feature-availability.ts` the way the highlight list beneath them is. Suggest the feature-availability owner reviews it.
- Orphan dictionary keys under `pricing.*`: `freeTrial`, `trialBanner`, `free`, `pro`, `startFree`, `goPro`, `contactNote`, `discountOff` are not referenced by any component. Left in place (deleting keys mid-parallel-edit is churn), flagged for cleanup.
- `npx tsc --noEmit` currently reports errors only in files other agents are editing in this same tree (at my last run: `src/components/gig-card.tsx`, `src/lib/__tests__/trust.test.ts`; earlier runs also `trust-badges.tsx`, `explore-client.tsx`, `for-you-strip.tsx`, `feature-availability.ts` while the `trust` namespace was landing). None are in files from this workstream.

## Verification

- `npx tsc --noEmit` — 0 errors in any file of this workstream; the 2 remaining errors (`src/components/gig-card.tsx`, `src/lib/__tests__/trust.test.ts`) belong to other agents' in-flight changes.
- `npx vitest run src/lib/__tests__/plan-price-ssot.test.ts` — verbatim: `Test Files  1 passed (1)`, `Tests  6 passed (6)`. (First run failed on purpose: it caught the two hardcoded "3 products" lines in `legal/page.tsx`, which were then fixed.)
- `npx vitest run` (full suite) — verbatim: `Test Files  47 passed (47)`, `Tests  722 passed (722)`.
- `npx eslint <11 touched files>` — `0 errors, 2 warnings`; both warnings pre-exist and are unrelated (`items/page.tsx:68 'onTrial' unused`, `product-form.tsx:72 'setBookMode' unused`).
- Dictionaries: both `JSON.parse` cleanly; 4980 CRLF line endings each, 0 bare LF; diff is 22 lines per file.
- Render check on a private `next dev` on port 3251 (stopped afterwards; the port-3000 production server was not touched): fetched `/en|ar/pricing`, `/help`, `/merchants`, `/legal`. Visible text (script payloads stripped) contains 0 leaked `{…}` placeholders and shows `14 days free — no card`, `($75 / $150 / $300)`, `up to 30 products`, `list 3 products`, `up to 3 products without paying`, `list up to 3 products` and their Arabic equivalents; pricing meta description reads "…with a 14-day free trial." / "…وتجربة مجانية 14 يوم." The two dashboard pages (items, subscription) need a session and were verified by tsc + the unit test only.

## Issues (pipe-separated)

issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P0-PRICE-01|P0|pricing/data|(none — DB)|all|public.plans holds free $0 and pro $12/$120 only; no basic/business rows; contradicts PLAN_TIERS (pro $25 / $150 promo / $300)|Table predates the 3-tier model; docs/plans-alignment-PENDING.sql awaits owner decision|NOT changed (financial rule unclear). Verified no src/ code reads plans/price_monthly/price_yearly; guard test now asserts it|docs/plans-alignment-PENDING.sql; src/lib/__tests__/plan-price-ssot.test.ts|OPEN — owner decision|DB says Pro $12/mo|Code remains the only source customers see; DB unchanged|Decide: reconcile plans to PLAN_TIERS, drop it, or make it the source
P0-PRICE-02|P0|pricing|/pricing|all|FAQ "annual offer" answer hardcodes $75 / $150 / $300 in ar+en|Literal prices typed into dictionary|Placeholders {basicAnnual}/{proAnnual}/{businessAnnual} filled from annualPrice(tier, promoActive) per request; answer hidden after PROMO_END|src/i18n/dictionaries/{ar,en}.json pricing.faq[4]; src/app/[lang]/(site)/pricing/page.tsx|FIXED|"($75 / $150 / $300)" forever|"($75 / $150 / $300)" while promo runs, then the question disappears|Only literal $ plan prices found outside plan-tiers
P0-PRICE-03|P0|pricing|/pricing|all|FAQ says Basic is "up to 30 products" as a literal|Cap typed into dictionary|{basicProducts} from PLAN_TIERS.basic.products|src/i18n/dictionaries/{ar,en}.json pricing.faq[1]; pricing/page.tsx|FIXED|"up to 30 products"|same text, number from PLAN_TIERS|
P0-PRICE-04|P0|pricing/subscription|/pricing, /merchant/[id]/subscription|all|Trial length "14"/"١٤" typed in 5 dictionary strings and the pricing meta description|TRIAL_DAYS not threaded into copy|{days} filled from TRIAL_DAYS via plan-copy; PricingPlans gets trialDays prop; metadata filled|ar/en pricing.trialLine, pricing.freeTrial, pricing.trialBanner, pricing.faq[0].a, merchant.subscription.startTrialTitle; pricing/page.tsx; pricing-plans.tsx; subscription/page.tsx|FIXED|"14 days free — no card" (literal, ١٤ in Arabic)|"14 days free — no card" (from TRIAL_DAYS, Western digits)|pricing.freeTrial and pricing.trialBanner are orphan keys (unrendered)
P0-PRICE-05|P0|merchant OS|/merchant/[id]/items (+ product form error)|all|Product-limit gate title says "(3 products)" for every store, including a Basic store capped at 30; body hardcodes 3/30/200|Free-plan copy reused for all tiers; caps typed into dictionary|Title {limit} = the store's planProductLimit(effectivePlan); body {freeProducts}/{basicProducts}/{proProducts} from PLAN_TIERS; product-form trigger error filled too|ar/en os.pro.productLimitTitle/Body; items/page.tsx; product-form.tsx|FIXED|Basic store at 30 items told "You've reached the limit (3 products)"|"You've reached the limit (30 products)"|Real merchant-facing wrong number, not just duplication
P0-PRICE-06|P0|marketing/legal|/help, /merchants, /legal|all|Free cap "3 products" repeated in /help FAQ, /merchants reassurance (x2) and /legal terms (hardcoded in TSX, ar+en)|planProductLimit("free") not threaded into copy|{freeProducts} filled by plan-copy at render (help also fills the FAQPage JSON-LD)|ar/en faq.items[7].a, merchantsPage.entryReassure[0]; help/page.tsx; merchants/page.tsx; legal/page.tsx|FIXED|"up to 3 products" typed 4 times|same text, number from plan-tiers|/legal hit was found by the new guard test, not the manual audit
P1-PRICE-07|P1|i18n|/pricing, /merchants, /merchant/[id]/subscription|all|Arabic strings used Eastern Arabic numerals (١٤، ٣) against the product convention (Western digits)|Hand-typed copy|Interpolated numbers print Western digits|ar.json (same keys as above)|FIXED|"١٤ يوم تجربة مجانية"|"14 يوم تجربة مجانية"|Side effect of the placeholder change
P1-PRICE-08|P1|guardrail|(all)|all|Nothing stopped a plan number from being typed back into copy or a component|No regression test|Added plan-price-ssot.test.ts (source scan + dictionary scan + plans-table read ban + ar/en placeholder parity); number sets derived from PLAN_TIERS|src/lib/__tests__/plan-price-ssot.test.ts|FIXED|—|6 tests pass; full suite 722/722|Restricted to plan context so "$10 delivery fee" / "last 14 days" charts are not flagged
P2-PRICE-09|P2|copy|/merchant/[id]/subscription|all|upgradeBody promises "unlimited orders, higher search visibility, a Pro badge" — feature claims not validated against feature-availability|Hand-written copy outside the FEATURES table|Not changed (not a price; feature-availability owner's call)|ar/en merchant.subscription.upgradeBody|OPEN|—|—|Flagged for the feature-availability workstream
P2-PRICE-10|P2|i18n hygiene|/pricing|all|pricing.freeTrial, trialBanner, free, pro, startFree, goPro, contactNote, discountOff are unreferenced|Leftovers from the old 2-tier page|Not deleted (avoid churn during parallel edits); parameterised where they held numbers|src/i18n/dictionaries/{ar,en}.json|OPEN|—|—|Safe to delete in a quiet moment
