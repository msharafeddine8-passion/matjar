# WS3 — Feature availability: single source of truth (P0)

Branch `feat/matjar-prelaunch-foundation`, working tree only (nothing staged, committed, pushed or built). Date 2026-09-24.

## 1. The registry model I ended with

`src/lib/feature-availability.ts` keeps every existing export untouched (`FeatureState`, `CAPABILITIES`, `FEATURES`, `PRICING_MATRIX`, `PLAN_HIGHLIGHTS`, `ROADMAP`, `OS_BAND`, `matrixCell`, `planHas`, `sectorCapabilities`, `isCapabilityLive`, `leadKinds`, …) — the other agents' edits to pricing-plans.tsx, pro-gate.tsx and the subscription page still typecheck against it. On top of that, one new section:

- **`FeatureStatus`** = `available | beta | coming_soon | internal | disabled` (public vocabulary). The internal `live | beta | soon` stays as-is and maps through `STATUS_OF_STATE`, so no consumer had to migrate.
- **`FeatureKey`** = `CapabilityKey | FeatureId` (59 keys). Six keys exist in both underlying tables (pos, inventory, team, rentals, messaging, reviews); a test asserts each pair agrees on state and plan so a shared key has exactly one truth.
- **`FEATURE_REGISTRY: Record<FeatureKey, FeatureRecord>`** — DERIVED at module load from `CAPABILITIES` + `FEATURES`, never a third hand-written list. Each record: `feature_key`, `status`, `eligible_plans` (from the plan floor: `basic/pro/business` that include it), `eligible_sectors` (the sectors whose storefront really surfaces it, via `sectorCapabilities()`; plan features with no storefront module list all 17), `label` (dictionary path — `pricing.features.<id>` or `os.modules.labels.<key>`), `description` (dictionary path `features.desc.<key>`), `source`.
- **`featureStatus(key, { plan?, sector? })` → `{ status, label, description, reason }`**. Reasons: `state` (own status), `plan` (below floor → `disabled`), `sector` (bundle never carries it → `disabled`), `sector_pending` (bundle declares it, sector held in directory-only mode → `coming_soon` — the ONE honest "soon"), `sector_routed` (bundle declares it, storefront routes the need through another engine, e.g. hotel hourly slots → stay engine → `disabled`, not "coming"). A not-live feature can never become `available` through any plan or sector.
- **`featureCopy(status, dict)`** → the one canonical word from the new dictionary namespace `features.status.*`: متاح / تجريبي / قريباً / غير متاح (Available / Beta / Coming soon / Not available). No component spells it again.
- Helpers: `sectorPendingCapabilities(sector)` (what a directory-only sector's own bundle promises but can't deliver yet — empty for every live sector), `featurePlanFloor(key)`, `featureLabel(key, dict)`, `featureDescription(key, dict)`, `dictPath(dict, path)`.
- Dictionary: ONE new top-level namespace `features` in both `ar.json` and `en.json` (one Edit per file, re-read immediately before, CRLF preserved, both `JSON.parse` clean): `status` (5), `requiresPlan`, `pendingNote`, `desc` (59 one-liners, MSA in Arabic).

## 2. Files changed (one line each)

- `src/lib/feature-availability.ts` — +287 lines: public status vocabulary, derived `FEATURE_REGISTRY`, `featureStatus`, `featureCopy`, `sectorPendingCapabilities`, `featurePlanFloor`, label/description helpers. Every prior export unchanged.
- `src/lib/modules-catalog.ts` — `ModuleTier` now `free | pro | business`; `inventory` pro→business, `classes`/`memberships`/`courses` pro→free, `team` free→pro, so the field equals the enforced plan floor (test-guarded).
- `src/components/site-footer.tsx` — hand-written `قريباً / Soon` removed; the App Store / Google Play badge word comes from `featureStatus("nativeApp")` + `featureCopy`, and the badge disappears when the registry says available. Section links stay supply-gated exactly as before (no label, hidden — that is not a feature-status matter).
- `src/components/store/store-products-section.tsx` — `dict.store.comingSoonNote` replaced by a registry-built note: lists only `sectorPendingCapabilities(store.category)` with `featureLabel` + `featureCopy("coming_soon")`; renders nothing when nothing is pending; stale comment about hotels/cars/events fixed.
- `src/components/feature-roadmap.tsx` — badge word is `featureCopy(featureStatus(id).status)` instead of the parallel `pricing.states.*` vocabulary.
- `src/content/academy.ts` — "coming soon" comment removed; new `academyCategoryStatus(guideCount): FeatureStatus` derives the category state from supply.
- `src/components/hub/academy-explorer.tsx` — empty categories print `featureCopy(academyCategoryStatus(n))` instead of `hub.academy.soon`.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/modules/page.tsx` — lock computed from `featurePlanFloor(key)` + `hasPlan(store.plan, floor)` instead of `MODULE_CATALOG.tier`/`isPro`.
- `src/components/modules-manager.tsx` — `ModuleItem` is `{ key, floor, locked, enabled }`; badge shows the real plan name (`pricing.tiers[floor].name`), note is `features.requiresPlan` with the plan filled in (was a fixed "Requires Pro" even for Business screens).
- `src/app/[lang]/(site)/hub/page.tsx` — leaders card no longer says "Soon" unconditionally: counts `business_leaders.published = true` (same predicate `/hub/leaders` renders from) and prints `featureCopy("coming_soon")` only at zero; dropped a pre-existing unused `Camera` import.
- `src/app/[lang]/(site)/hub/leaders/page.tsx` — empty-state badge uses `featureCopy("coming_soon")` instead of `hub.leaders.comingBadge`.
- `src/i18n/dictionaries/ar.json`, `src/i18n/dictionaries/en.json` — one appended namespace `features` each (see §1).
- `src/lib/__tests__/feature-availability-ssot.test.ts` — NEW guard test (§4).
- `audit/prelaunch-v2/_work/ws3-features.md` — this report.

Confirmed and left alone as the brief asked: `src/components/professional/professional-services.tsx:145` and `src/components/crafts/craft-empty-state.tsx:36` only mention "coming soon" in comments describing what they deliberately do NOT render; both pass the guard scan.

Not touched (other agents' territory): `pricing-plans.tsx`, `pricing/page.tsx`, `plan-tiers.ts`, `offering.ts`, `lib/data/stores.ts`, `store-card.tsx`, `store-header.tsx`, `help/page.tsx`, `trust.ts`. **pricing-plans.tsx needs no change**: it reads `PLAN_HIGHLIGHTS`/`matrixCell`, which remain the registry. If it ever prints a status word, the exact change is `import { featureCopy, featureStatus } from "@/lib/feature-availability"` and `featureCopy(featureStatus(id).status, dict)` in place of any literal.

## 3. Contradictions found (feature · where it said available · where it said soon · the truth · how I know)

1. **Native app** — footer badges said "قريباً/Soon" (`site-footer.tsx:22`, hand-written); `/pricing` and `/merchants` roadmap said "لسّا مش مبني / Not built yet" (`pricing.states.soon`). Truth: `FEATURES.nativeApp.state = "soon"` (MOBILE_APP.md — Capacitor shell exists, not submitted). Two vocabularies for one fact → both now `featureCopy("coming_soon")` = قريباً / Coming soon.
2. **Cart / direct purchase for real estate** — the storefront note (`store.comingSoonNote`) promised "الحجز والشراء المباشر قريبًا" (booking AND direct purchase coming soon) on every directory-only store; the registry never offers `orders` to real estate at all (`sectorConfig.realEstate.features` has no `orders`; `resolveStoreExperience` → `canOrderProducts:false`; `featureStatus("orders",{sector:"realEstate"})` = `disabled`/`sector`). A purchase that was never planned was being promised. Now the note names only `appointments` (the one thing the bundle declares and directory-only mode withholds) and it vanishes the day real estate leaves `DIRECTORY_ONLY_SECTORS`.
3. **Inventory plan** — merchant module manager labelled it "Pro" and locked/unlocked on Pro (`MODULE_CATALOG.inventory.tier = "pro"`); `/pricing` matrix, `business-os.tsx` and the inventory screen gate it at **Business** (`OS_MODULE_META.inventory.minPlan = "business"`, `FEATURES.inventory.plan = "business"`). A Pro store could switch inventory on and then meet a Business lock. Fixed at the source + consumer.
4. **Classes / memberships / courses plan** — module manager locked them behind Pro (`tier:"pro"`); their merchant screens carry no plan guard (`OS_MODULE_META.classes/memberships/courses` have no `minPlan`), `CAPABILITIES.*.plan = "free"`, and `/pricing` includes bookings (which covers classes) on every plan. A free gym could not enable the classes it can already run. Fixed.
5. **Team (providers/doctors) plan** — module manager let a free store enable `team` (`tier:"free"`); the doctors screen behind it is `isPro` (`OS_MODULE_META.doctors.minPlan="pro"`, `FEATURES.team.plan="pro"`, `/pricing` sells it at Pro). Fixed; caught by the new tier≡floor test.
6. **Locked-module note** — `os.modules.proNote` "Requires Pro" was shown for every locked module, including Business-only inventory. Now `features.requiresPlan` with the real plan name.
7. **Business leaders directory** — `/hub` hero card said "Soon" unconditionally (`hub/page.tsx:139`, `hub.leaders.comingBadge`) while `/hub/leaders` renders a live directory the moment one profile is `published`. Truth is the count; now count-driven with the canonical word.
8. **Academy categories** — `academy.ts` declared management + growth "coming soon" in a comment and the explorer printed its own `hub.academy.soon` "قريبًا"; the truth is guide supply (0 guides). Now derived (`academyCategoryStatus`) and printed with `featureCopy`.
9. **Roadmap vocabulary** — `pricing.states` was a second set of status words (beta "In review", soon "Not built yet") alongside the footer's and the academy's. Unified through `featureCopy`.

Consistent, verified, left as-is (dictionary prose, not UI logic): `pricing.faq` "Online payment is coming soon" and `pricing.featureNotes.onlinePayment` agree with `FEATURES.onlinePayment.state="soon"` (no payment provider anywhere in the repo); `hub.leaders.emptyNote` "They'll appear soon" only renders in the zero-profile branch. `/help` FAQ (`faq.items`) states cash-on-delivery, 0% commission, badge never awarded — all agree with the registry.

Registry vs public pages audit (POS, inventory, CRM/customers, staff, loyalty, delivery, appointments, cart): `/pricing` matrix, price cards, pro-gate, subscription page, business-os tiles, `/merchants` sector cards and the store profile modules all render from `FEATURES`/`CAPABILITIES`/`sectorCapabilities()` — no hand-written list remains (the existing `feature-availability.test.ts` already bans the old dictionary lists; the new guard bans the words). The only consumer that read something else was the module manager (items 3–6).

**Not marked available because I cannot prove it from code (flagged, not invented):** nothing new. `verifiedBadge` stays `beta` (pipeline exists, zero stores verified); `onlinePayment`, `nativeApp` stay `coming_soon`. Real estate `appointments` resolves to `coming_soon` because `store-experience.ts` says so ("engine not ready") while the merchant bundle still ships a bookings screen for it — an owner decision is pending: either drop `appointments` from `sectorConfig.realEstate.features` (then nothing is promised "soon") or take real estate out of `DIRECTORY_ONLY_SECTORS`. Either edit flows through the registry automatically.

Now-unused dictionary keys (leave for the dictionary owner; I did not do a second Edit): `store.comingSoonNote`, `hub.academy.soon`, `hub.leaders.comingBadge`, `hub.soon`, `pricing.states`, `os.modules.proNote`.

## 4. Guard test — `src/lib/__tests__/feature-availability-ssot.test.ts`

(a) Registry validation: every key present once; status ∈ vocabulary; label + description paths resolve to non-empty strings in BOTH dictionaries (plus the 5 status words); `eligible_plans ⊆ PLAN_ORDER` and a contiguous suffix (never dropped on a higher tier); `eligible_sectors ⊆ categoryKeys`; shared keys agree across tables; `MODULE_CATALOG[key].tier === featurePlanFloor(key)` for all 23 modules. Behaviour: pos/inventory plan gating, roadmap never available under any plan/sector, realEstate appointments = `coming_soon/sector_pending`, realEstate orders = `disabled/sector`, hospitality timeslot = `disabled/sector_routed`, pending list empty for every live sector and exactly `["appointments"]` for realEstate.

(b) Source scan of `src/components/**`, `src/app/**`, `src/content/**`, `src/lib/**` (`.ts/.tsx`), comments stripped, for `قريباً` / `قريبًا` / bare `قريبا` / `coming soon` (any case) / `\bSoon\b`; allow-list = the registry file and the test itself. Currently zero offenders.

## 5. CSV

issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P0-FEAT-01|P0|footer|all pages|all|App-store badges hand-wrote "قريباً/Soon" while the roadmap called the same feature "Not built yet"|footer had its own literal instead of reading feature-availability|word from featureStatus("nativeApp")+featureCopy; badge hidden when available|src/components/site-footer.tsx|fixed|const soon = lang==="ar"?"قريباً":"Soon"|featureCopy(featureStatus("nativeApp").status, dict)|section links stay supply-gated (hidden, never labelled)
P0-FEAT-02|P0|storefront|/store/[id]|realEstate|Directory-only note promised "booking AND direct purchase coming soon" for a sector whose bundle has no cart|fixed dictionary sentence not tied to the sector bundle|note built from sectorPendingCapabilities(sector) + featureLabel + featureCopy; renders nothing when nothing pending|src/components/store/store-products-section.tsx|fixed|dict.store.comingSoonNote|features.pendingNote with {items}=المواعيد, {status}=قريباً|realEstate orders resolves disabled/sector, so purchase is never promised
P0-FEAT-03|P0|merchant modules|/merchant/[id]/modules|all with inventory|Module manager labelled inventory "Pro" and unlocked it on Pro; the screen and /pricing gate it at Business|MODULE_CATALOG.tier hand-maintained, not the enforced minPlan|tier set to business; page locks on featurePlanFloor + hasPlan|src/lib/modules-catalog.ts, modules/page.tsx, modules-manager.tsx|fixed|tier:"pro"|tier:"business" (== OS_MODULE_META.inventory.minPlan)|guarded by tier≡floor test
P0-FEAT-04|P0|merchant modules|/merchant/[id]/modules|fitness, sportsCourts, education|classes/memberships/courses locked behind Pro while their screens have no plan guard and /pricing includes them on every plan|same stale tier field|tier set to free|src/lib/modules-catalog.ts|fixed|tier:"pro"|tier:"free"|free gym can now enable classes it already runs
P0-FEAT-05|P0|merchant modules|/merchant/[id]/modules|healthcare, beauty, petCare, professional, education, fitness|team toggle open on free while the doctors screen behind it is isPro and /pricing sells team at Pro|same stale tier field|tier set to pro|src/lib/modules-catalog.ts|fixed|tier:"free"|tier:"pro"|found by the new guard test
P0-FEAT-06|P1|merchant modules|/merchant/[id]/modules|all|Locked note always said "Requires Pro", even for Business-only modules|single fixed string os.modules.proNote|features.requiresPlan with the real plan name; badge shows plan name|src/components/modules-manager.tsx|fixed|"Requires Pro"|"Requires the Business plan" / "يتطلّب خطة Business"|os.modules.proNote now unused
P0-FEAT-07|P1|hub|/hub|n/a|Leaders card said "Soon" unconditionally while /hub/leaders goes live at the first published profile|hard-coded badge string, no supply check|count business_leaders.published=true; coming_soon word only at zero|src/app/[lang]/(site)/hub/page.tsx|fixed|{h.leaders.comingBadge}|count>0 ? heroBrowse : featureCopy("coming_soon")|same predicate as the leaders page
P0-FEAT-08|P1|hub academy|/hub/academy|n/a|management/growth declared "coming soon" by hand in academy.ts + explorer printed its own "قريبًا"|status written in a comment/dictionary instead of derived from supply|academyCategoryStatus(guideCount) → featureCopy|src/content/academy.ts, src/components/hub/academy-explorer.tsx|fixed|a.soon|featureCopy(academyCategoryStatus(n), dict)|"New" badge on an empty category still shows next to it — cosmetic, not availability
P0-FEAT-09|P1|hub leaders|/hub/leaders|n/a|Empty-state badge "Soon" hand-written in dictionary key comingBadge|own badge string|featureCopy("coming_soon")|src/app/[lang]/(site)/hub/leaders/page.tsx|fixed|{l.comingBadge}|{featureCopy("coming_soon", dict)}|hub.leaders.comingBadge now unused
P0-FEAT-10|P1|roadmap|/pricing, /merchants|all|Roadmap badge used a second status vocabulary (pricing.states: "Not built yet"/"In review")|two dictionaries of status words|featureCopy(featureStatus(id).status)|src/components/feature-roadmap.tsx|fixed|t.states.soon / t.states.beta|features.status.coming_soon / features.status.beta|pricing.states now unused
P0-FEAT-11|P0|registry|n/a|all|No single API answered "is X available for plan P in sector S" and nothing prevented a new hand-written "Soon"|registry was two tables without a resolver or a guard|FEATURE_REGISTRY + featureStatus/featureCopy + ssot guard test|src/lib/feature-availability.ts, src/lib/__tests__/feature-availability-ssot.test.ts, dictionaries|fixed|—|59-key derived registry, 5-status vocabulary, source scan|every prior export kept
P0-FEAT-12|P2|storefront|/store/[id]|realEstate|Real estate still promises appointments "coming soon" while its merchant OS ships a bookings screen and the lead form already exists|DIRECTORY_ONLY_SECTORS holds realEstate; bundle keeps appointments|owner decision: drop appointments from the realEstate bundle or take it out of directory-only; registry follows either|src/lib/store-experience.ts, src/lib/sectors.ts|open|coming_soon/sector_pending|—|not changed: cannot prove the engine is wired for this sector

## 6. Test results (verbatim)

`npx tsc --noEmit` — errors ONLY in files owned by other agents (their in-flight dictionary keys): first run 9 errors in `src/app/[lang]/(site)/product/[id]/page.tsx` (priceOnConsult/soldOut/scanToBook) and `src/components/product-mini-card.tsx`; a later run showed those gone and 8 errors for `dataQuality` in `src/app/[lang]/(dashboard)/admin/page.tsx`, `src/components/admin-store-actions.tsx`, `src/components/admin-stores-client.tsx`. Filtered to my files:

```
own-file tsc errors above (empty = none)
```

`npx vitest run src/lib/__tests__/feature-availability-ssot.test.ts src/lib/__tests__/feature-availability.test.ts src/lib/__tests__/store-experience.test.ts src/lib/__tests__/offering.test.ts`:

```
 RUN  v4.1.10 C:/Users/m-cha/Documents/gh/matjar

 Test Files  4 passed (4)
      Tests  74 passed (74)
   Start at  15:52:16
   Duration  844ms (transform 305ms, setup 0ms, import 749ms, tests 427ms, environment 0ms)
```

`npx vitest run` (full suite):

```
 Test Files  1 failed | 48 passed (49)
      Tests  1 failed | 769 passed (770)
   Start at  15:50:40
   Duration  2.63s (transform 7.52s, setup 0ms, import 13.29s, tests 3.59s, environment 0ms)
```

The one failure is `src/lib/__tests__/data-contracts.test.ts` → `"search.ts:39 → products"` (an unbounded query in `src/lib/data/search.ts`, which `git status` shows modified by another agent, +62/−10; I did not touch it).

`npx eslint` on all 12 files I touched:

```
✖ 1 problem (0 errors, 1 warning)   ← pre-existing unused `Camera` import in hub/page.tsx
```

then after removing that import:

```
eslint clean
```

Dictionary validation: `node -e "JSON.parse(...)"` for ar.json and en.json → both parse; `features.desc` has 59 keys in each; `features.status.coming_soon` = قريباً / Coming soon; CRLF line endings preserved in the appended block (verified with `od -c`).
