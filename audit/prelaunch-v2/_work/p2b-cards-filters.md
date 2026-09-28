# Phase 2 track B: sector-aware discovery cards and filters

Branch `feat/matjar-prelaunch-foundation`. Nothing committed, pushed or deployed. No DB writes, no migrations.
The production counts below come from read-only SQL on `wesihatopiznatsyfxer` (17 active stores, 2026-09-24/25). They were then checked against the rendered HTML of `/ar/explore`, `/ar/category/healthcare`, `/ar/category/services`, `/ar/explore?priced=1`, `/en/explore?delivery=1` and `/ar` on a local dev server (port 3263, since stopped), plus a 375px screenshot of the explore and clinic cards.

## Design

- **One card.** `StoreCard` is still a single component. `src/lib/card-facts.ts` maps the 17 sectors onto 5 variants: `goods` (retail, farm, pharmacy), `food`, `clinic` (healthcare), `service` (services, beauty, petCare, fitness, sportsCourts, education, professional, contractors, events, hospitality) and `listing` (realEstate, automotive).
- **How facts are chosen.** `resolveSectorCard(category, source)` returns an ordered list of typed facts. It emits a fact only when a column or row backs it. The four existing catalogue facts (catalog, offers, providers, sections) are still decided by `resolveCardFacts` in `discovery.ts`, and the new resolver merges them in, so each rule lives in one place.
- **Where facts render.** `open`, `rating` and `location` draw in fixed places on the card: the badge, the star row, and the subtitle. For clinics, the location gets its own map-pin line. Everything else goes in the facts line:
  - food and goods: a compact row of facts;
  - services-style sectors: a lead sentence, «يبدأ من $X · N خدمات», with Arabic plural forms from `Intl.PluralRules`;
  - listings: count and entry price.
- **No N+1 queries.** `cardRollups(ids)` in `data/discovery.ts` reads three cached platform-wide rollups, one query each, revalidated every 60 s and tagged `stores`:
  - catalogue: now also service count, lowest priced service, lowest priced item;
  - providers;
  - active delivery zones: fee range and ETA range.

  Each store is then looked up by id; there is never a query per card. The row-level half (delivery/pickup switches, `min_order`, `prep_time`, `insurance`) comes off the `stores` row through the shared `storeRowCardSource`.
- **Which surfaces get what.**
  - Full facts line: `/explore`, `/category/*` and the home rails (`getStoresForListing` and `getFeaturedStores` now attach rollups).
  - Search page, favourites and the For-you strip: the honest badge only, with no facts line.
- **Prices.** "Starts from" uses the listed price, not the discount price. It can understate how cheap a store is but can never promise a price the buyer won't find.

## Per sector: fact, data source, and how many of the 17 stores show it today

| Variant (sectors live today) | Fact | Data source | Shown today |
|---|---|---|---|
| all | Open/closed badge | `stores.hours` through `isOpenNow`/`beirutClock`, **only when hours exist** | 14 / 17 (before: 17; 3 showed «مفتوح» with no hours) |
| all | Rating | `rating_avg` and `rating_count` ≥ 1 | 2 / 17 (the rest show «جديد», as before) |
| all | Location | `stores.area`, falling back to the `region` name | 16 / 17 (1 store has neither) |
| goods, food (retail 9, food 1) | Delivery / pickup | `accepts_delivery`, `accepts_pickup` | 10 / 10 (both still on the column default everywhere) |
| goods, food | Delivery fee range / free | active `store_delivery_zones.fee` | 0 (no zones exist) |
| goods, food | Delivery time | zones `eta_min_minutes` / `eta_max_minutes` | 0 |
| goods, food | Minimum order | `stores.min_order` | 0 (null everywhere) |
| food | Prep time | `stores.prep_time` (merchant's own text) | 0 (null) |
| goods, food | Offers / N products / N sections | existing catalogue rollup | offers 2, catalog 8 (retail 6, food 1, beauty 1), sections 2 |
| clinic (2) | Starting price | lowest active **service** price | 2 / 2 ($30, $50) |
| clinic | N services | count of `item_kind='service'` | 2 / 2 (3 each) |
| clinic | Practitioners | doctors + service_providers | 1 / 2 (6) |
| clinic | Insurance | `stores.insurance` | 0 (empty) |
| service (services 3, beauty 1, professional 1) | Starting price · N services | as for clinics | 1 / 5 (Passion Glow: $150, one service) |
| service | Catalogue count when there are no services | products counted as **products**, not "services" | 1 (the perfume shop in beauty: «3 منتج», which used to read «3 خدمة») |
| listing (0 stores) | N listings · starting price | catalogue count, lowest priced item of any kind | 0 (no stores in these sectors) |

## Filters added, and when they appear

The rules are unchanged: `filterAvailability`, where `partition` means some-but-not-all of the stores must match. What's new is that a page pinned to one sector now judges each filter against **that sector's** stores, using `coverage.bySectorCounts` (built in `getDiscoveryCoverage`).

| Filter | URL | Backing | Asked for by | Today |
|---|---|---|---|---|
| `delivers` | `delivery=1` | `accepts_delivery` column | retail, farm, pharmacy, food | Hidden: 17/17 accept delivery, so the filter narrows nothing. It appears once any merchant turns delivery off. |
| `pickup` | `pickup=1` | `accepts_pickup` column | same | Hidden, same reason |
| `hasPricedServices` | `priced=1` | at least one active, priced service row | healthcare, professional, contractors, services, beauty, petCare, fitness, sportsCourts, education | **Shown** on `/explore` (3/17) and `/category/services` (1/3). Hidden on `/category/healthcare` (2/2 match, so it narrows nothing) and `/category/beauty` (0/1). |

- **Mobile:** the new chips use the existing `BottomSheet` in `discovery-filters.tsx`; no new UI pattern.
- **Hand-typed links still work:** `?delivery=1` returns all 17 stores, even though the chip isn't offered.
- **Filters combine as AND:** catalogue, offers and priced-services now intersect when several are on. Before, turning on offers silently dropped the catalogue condition.

## Files changed

- `src/lib/card-facts.ts` (new): the variants, `resolveSectorCard`, `storeCardSource`, `storeRowCardSource` and the `CardStore` type.
- `src/lib/discovery.ts`: 3 new `FilterKey`s, the new coverage fields, `SectorCounts`, `scopedCounts`, the `scope` argument to `filterAvailability`, the sector intents, and the query and URL state.
- `src/lib/data/discovery.ts`: coverage now counts delivery, pickup, priced services and `bySectorCounts`; the catalogue rollup gains service and price data; added `fetchZoneFacts` and the exported `cardRollups`; `rowToStore` sets `hoursKnown` and the row facts; results apply the new filters; cache keys bumped to v2.
- `src/lib/data/stores.ts`: `LISTING_SELECT` adds the fulfilment and insurance columns; `rowToStore` sets `hoursKnown` and `facts`; `fetchActiveStores` and `getFeaturedStores` attach the rollups; `markFavorites` is now generic. **`searchStores` is not touched.**
- `src/components/store-card.tsx`: the facts row now comes from `resolveSectorCard` with a small per-variant switch; the open badge shows only when hours are known; no stray «·» after the sector; LTR isolation for prices and ranges; the favourite heart sits in its own positioning wrapper.
- `src/components/explore-client.tsx`: passes `cardDict`.
- `src/components/discovery-page.tsx`: adds `sectorCards` to both dictionary slices.
- `src/components/discovery-filters.tsx`: adds the 3 new chips and a label lookup. This file wasn't on the territory list, but it is the explore filter UI the brief asked me to wire.
- `src/components/store-rail.tsx`: takes `CardStore[]` and renders the facts line.
- `src/components/for-you-strip.tsx`: sets `hoursKnown` from hours; the RPC returns no fulfilment columns, so the strip shows no facts line.
- `src/i18n/dictionaries/{ar,en}.json`: one new `sectorCards` namespace, inserted as text before `  "features": {`. CRLF is preserved (5164/5164 lines) and both files pass `JSON.parse`.
- `src/lib/__tests__/card-facts.test.ts` (new, 25 tests): per-sector order, a "no fact without data" case for every fact, production scenarios, and the source builders.
- `src/lib/__tests__/discovery.test.ts`: fixtures updated, plus new tests for delivery/pickup, priced services, scoped counts and URL state.

## Deliberately not shown, because the data doesn't exist

| Signal | Why not | What the merchant form would need |
|---|---|---|
| Cuisine (restaurants) | No column | A `cuisines text[]` multi-select from a fixed list (Lebanese, grills, shawarma…), so it can be filtered |
| Specialty (clinics) | `stores.specialties` is empty for all 17 stores | A specialty picker per clinic or doctor from a fixed taxonomy, not free text |
| Next availability | Needs the booking engine per store (slots minus bookings), which is not cheap on a list | A cached nightly or 15-minute `next_free_slot` per store written by the booking engine |
| Delivery fee / time | No `store_delivery_zones` rows on production | Merchants add at least one zone with a fee and ETA. The card shows them the moment a zone exists. |
| Minimum order / prep time | null for every store | The fields exist in settings; onboarding should prompt for them for food and goods stores |
| Insurance | Empty for both clinics | A structured multi-select of insurers |
| Service area (crafts/freelance) | The professional cards belong to Phase 4 | — |

## Gates, verbatim

```
== tsc
tsc exit 0
== vitest
 Test Files  52 passed (52)
      Tests  914 passed (914)
== eslint
eslint exit 0
```

ESLint ran on every file I touched. The one unrelated tsc error seen mid-run (`admin/demand/page.tsx` missing `./demand-admin-client`) was another agent's work in progress and was gone by the final run.

## For whoever owns the search page

`StoreCard` props are backward compatible. Search results already carry `hoursKnown` and row `facts`, because they go through `rowToStore`. The badge honesty therefore already applies on `/search`. To get the facts line there as well, pass `factsDict={dict.discovery} cardDict={dict.sectorCards}`; for the zone and catalogue half, merge `cardRollups(ids)`.

## CSV

```
issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P1-CARDS-01|P1|cards|/explore,/category/*,/,/search,/favorites|all|Green «مفتوح» badge on stores that publish no hours|isOpen defaults to true when hours are missing and the card drew the default as a fact|hoursKnown carried from rowToStore; badge drawn only from an `open` fact|src/components/store-card.tsx; src/lib/data/stores.ts; src/lib/data/discovery.ts; src/components/for-you-strip.tsx|fixed|17/17 cards claimed open or closed|14/17 (3 without hours show no badge); favourites show no badge|open-by-default still decides listing and the openNow filter (see P1-FILTER-06)
P1-CARDS-02|P1|cards|/explore,/category/*,/|all|One generic facts line: no fulfilment, no starting price, no clinic location|resolveCardFacts only knew catalogue counts|resolveSectorCard with 5 variants; batched rollups (service price, zones)|src/lib/card-facts.ts; src/components/store-card.tsx; src/lib/data/discovery.ts|fixed|counts only|delivery/pickup on 10 goods/food cards; «يبدأ من $X · N خدمات» on 3 service cards; map-pin location on 2 clinics|every fact tested for absence when data is missing
P1-CARDS-03|P1|cards|/explore|beauty|Perfume shop's 3 products labelled «3 خدمة»|catalogue noun came from the sector, not from item_kind|services-style card with a known 0 services counts products as products|src/lib/card-facts.ts|fixed|«3 خدمة»|«3 منتج»|
P1-CARDS-04|P2|cards|/explore|all|Subtitle printed a trailing «·» when area was empty|unconditional `{cat} · {area}`|separator only when there is a location; region name as fallback|src/components/store-card.tsx|fixed|4 cards ended in «·»|3 show the region, 1 shows the sector alone|
P1-CARDS-05|P2|cards|all card surfaces|all|Favourite heart overlapped the open badge at the start corner|favorite-button.tsx hard-codes `relative`, which competes with the `absolute` passed in|card wraps the button in its own absolute span|src/components/store-card.tsx|fixed (workaround)|heart on top of badge|heart at end corner|root cause remains in src/components/favorite-button.tsx (not my territory)
P1-CARDS-06|P2|cards|/search|all|Search results render the card without the facts line|search page doesn't pass factsDict/cardDict or rollups|none (not my territory); props are optional and ready|src/app/[lang]/(site)/search/page.tsx|open|no facts line|—|badge honesty already applies via rowToStore
P1-CARDS-07|P2|cards|/,/explore|all|Count grammar: «3 منتج», «1 products», «1 reviews»|dict.discovery.nouns and featured.reviews are single forms|services count now uses plural forms; other nouns untouched|src/i18n/dictionaries/*.json (discovery namespace)|open|—|—|needs plural sets for discovery.nouns
P1-CARDS-08|P2|cards|/explore,/category/food,/category/healthcare|food,healthcare|Cuisine, specialty and next availability not shown|no column / empty column / no cheap query|omitted by design|—|deferred|—|—|see the data-gap table for the merchant-form fields needed
P1-FILTER-01|P1|filters|/explore,/category/{retail,food,farm,pharmacy}|goods,food|No delivery filter|—|`delivers` (delivery=1) on accepts_delivery, partition-gated|src/lib/discovery.ts; src/lib/data/discovery.ts; src/components/discovery-filters.tsx|fixed|—|hidden today (17/17 universal); appears when a merchant turns delivery off|
P1-FILTER-02|P1|filters|same|goods,food|No pickup filter|—|`pickup` (pickup=1) on accepts_pickup, partition-gated|same|fixed|—|hidden today (17/17 universal)|
P1-FILTER-03|P1|filters|/explore,/category/services|services-style|No way to find stores that publish a price|—|`hasPricedServices` (priced=1) from the catalogue rollup|same|fixed|—|shown on /explore (3/17) and /category/services (1/3); hidden on healthcare (2/2) and beauty (0/1)|
P1-FILTER-04|P1|filters|/category/*|all|Filter availability judged on marketplace totals, even on a pinned sector page|coverage had no per-sector breakdown|bySectorCounts + scopedCounts; filterAvailability(key, coverage, scope)|src/lib/discovery.ts; src/lib/data/discovery.ts|fixed|a no-op chip possible on a sector page|chips judged against the sector's own stores|falls back to marketplace totals when there is no breakdown
P1-FILTER-05|P2|filters|/explore|all|offers + catalogue together dropped the catalogue condition|`hasOffers ? offers : catalog`|predicates intersect|src/lib/data/discovery.ts|fixed|OR-like|AND|harmless before (an offer implies a catalogue row)
P1-FILTER-06|P2|filters|/explore?open=1, home "open now" rail|all|"Open now" includes stores with no hours|open-by-default rule in lib/hours.ts|not changed; the card no longer shows a badge for them|src/lib/data/discovery.ts|open|—|—|product decision: include in "open now", or require published hours
```
