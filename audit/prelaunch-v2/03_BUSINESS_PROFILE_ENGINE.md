# Prelaunch Phase 3: Business Profile Engine 2.0

Branch `feat/zero-subscription-features`. Nothing was committed, pushed or deployed, and there are no migrations. The only production reads were anon-key SELECTs and one read-only SQL query through the Supabase MCP (`has_store_purchase` per store review). Pilot sectors: Retail, Restaurant, Healthcare and Crafts/Services.

## 1. Engine design

The store page used to make three decisions inline:

1. **Which section exists.** This was a hand-written `present` map that copied each component's own null check.
2. **Which action the page leads with.** This was a nested ternary.
3. **Which sections were empty shells.** Nothing decided this. As a result, real stores showed a dashed «ما في منتجات» box, and 15 of 17 stores showed «لسا ما في تقييمات. كن أول مين يقيّم!» to visitors who couldn't write a review.

`src/lib/profile-engine.ts` now makes all three decisions. It is pure: no I/O and no dictionary.

| Function | Decides |
|---|---|
| `profileKind(sector)` | Maps sectors to kinds: `retail` (retail, pharmacy, farm), `restaurant` (food), `healthcare`, `services` (services, contractors, professional), and `generic` for everything else. |
| `resolveBusinessProfile(sector, facts)` | Returns the sector order from `resolveProfileOrder` (still the one composition per sector, in `sectors.ts`), filtered by **presence**. Also returns `modules`, `omitted`, `present`, `primaryCta` and `transacts`. |
| `resolveProfileSummary(facts)` | Returns the WHO / WHAT / WHEN / WHERE / HOW MUCH / WHY TRUST rows. A row exists only when its fact exists, and it links only to a section that is on the page. |
| `resolveProfile(sector, facts, summaryFacts)` | Runs both in two passes. The summary exists only with at least `SUMMARY_MIN_ROWS` (2) rows, and its rows link only to sections that are present. |
| `orderingEnabled` / `bookingEnabled` | Decide the primary CTA (see below). |
| `catalogPrimaryCount` | Counts the catalogue rows for each surface: services for appointments, goods for orders, every row for a browse-only catalogue. |
| `reviewVerification`, `summarizeReviews`, `sortReviews` | Reviews 2.0 labelling. |

The engine takes counts and booleans the page has already fetched (`ProfileFacts`). It fetches nothing and infers nothing. Modules are the page's existing section keys. Two keys were added to `ProfileSectionKey`:

- **`summary`**: the at-a-glance block. It is used only for the `healthcare` and `services` kinds. Retail and restaurant get no summary because their header (rating, open now, area) plus the delivery strip already answer those questions.
- **`loyalty`**: a slot. `src/components/store/profile-module-registry.ts` exports an empty `PROFILE_MODULE_SLOTS`. When the loyalty track registers `PROFILE_MODULE_SLOTS.loyalty = (props) => …`, the module becomes present on real stores in each sector's slot (before reviews) and gets its tab chip («الولاء»). Until then it renders nothing and has no tab.

The existing section components were reused unchanged: hero, header, doctors, hours, fulfilment, portfolio, catalogue, healthcare info and verifications. The page renders a section **only when `present[key]`**. The mobile tab rail and the sticky CTA are derived from the same map.

### Primary CTA rule (`profile.primaryCta`)

1. **Book an appointment** (`bookAppointment`) when the appointment engine renders with at least one service in it.
2. **«اطلب الآن»** (`orderNow`) for a restaurant, only when `orderingEnabled` is true. Every one of these must hold:
   - it is a real store
   - the `orders` module is on
   - the item surface is `order`
   - the sector's goods transact (offering resolver)
   - `canOrderProducts` is true
   - a checkout could be assembled
   - there is at least one item
3. For other goods sectors, the same checks produce add to cart (`addToCart`) instead of `orderNow`.
4. Otherwise, scroll to the request or enquiry form (`contactStore`).
5. Otherwise, WhatsApp, if the number survives `waNumber()`.
6. Otherwise, nothing.

### Composition changes in `sectors.ts` (profile-order parts only)

- **healthcare:** `summary, doctors, catalog, healthcareInfo, hours, location, branches, verifications, loyalty, reviews, …`. `hours` no longer has to sit above the booking engine because the summary's WHEN row carries «open now + today's hours».
- **services, contractors, professional:** `summary` right after the identity block. `services` also gains `verifications` before its reviews.
- **food, retail:** `loyalty` slot before `reviews`.
- **Default order:** `summary` after `header`, `loyalty` before `reviews`. Neither renders anywhere unless present.

The healthcare visit-terms card (`healthcareInfo`) is now shown **only with a fact the summary does not carry**: specialties, insurance or a cancellation window. Otherwise its «من $50 / مدّة الزيارة» pills repeated the summary and every service row, which made three copies of the same number.

## 2. Per-sector module table (real production stores, 2026-09-25)

Legend: ✅ shown · ⛔ omitted (no data) · — not in this sector's composition.

### Retail

| Module | Data source | sleepy care | ملحمة البركة | misk | Mehras / Qabass / ألبسة نسائي |
|---|---|---|---|---|---|
| Identity (hero + header) | stores.cover/logo/name, trust (lib/trust) | ✅ | ✅ | ✅ | ✅ |
| Offerings (catalogue) | products (active), store_sections | ✅ 3 | ✅ 10, 4 sections | ✅ 11, 3 sections | ⛔ 0 products; **was a dashed «no products» box** |
| Offers | products.discount/flash, inside the catalogue | ⛔ | ✅ 1 discount | ⛔ | ⛔ |
| Delivery / pickup + policies | accepts_delivery/pickup, return_policy, zones, couriers | ✅ | ✅ | ✅ | ✅ |
| Loyalty | slot (no component registered) | ⛔ | ⛔ | ⛔ | ⛔ |
| Reviews 2.0 | reviews + product_reviews | ⛔ **(was the empty state)** | ✅ 1 | ⛔ | ⛔ |
| Location | stores.lat/lng, store_locations | ✅ | ✅ | ✅ | Qabass ✅ (2 branches), others ⛔ |
| Hours | stores.hours grid | ✅ | ✅ | ✅ | ✅ / ✅ / ⛔ |
| Contact | header quick actions (phone, WhatsApp) | ✅ | ✅ | ✅ | ✅ |

### Restaurant

| Module | Data source | Let's meat |
|---|---|---|
| Delivery / pickup | stores + zones + couriers | ✅ |
| Menu | products (3, all with photos) | ✅ |
| Table reservations | `reservations` module | ✅ |
| Hours / opening status | stores.hours (header shows open now) | ✅ |
| Cuisine | **no column** | ⛔ |
| Popular items | **no public sales signal** (order_items is not anon-readable) | ⛔ |
| Reviews | none | ⛔ **(was the empty state)** |
| Primary CTA | engine | **«اطلب الآن»** (was «أضف إلى الطلب») |

### Healthcare

| Module | Data source | مركز الضنية الطبي | دكتور عمر الصمد |
|---|---|---|---|
| Summary: WHO | doctors (count + distinct specialties) | ✅ "الأطبّاء: 6", 3 specialties + «و3 غيرهم» | ⛔ no roster (never guessed from the store name) |
| Summary: WHAT | services + duration (duration_minutes or attributes.duration) | ✅ 3 services, 20–30 min | ✅ 3 services, 20–30 min |
| Summary: WHEN | hours: isOpenNow + daySpan (Beirut) | ✅ | ✅ |
| Summary: WHERE | stores.area, branches | ✅ (no link: no map pin) | ✅ |
| Summary: HOW MUCH | service prices (never $0), insurance | ✅ $50 to $90 | ✅ $30 |
| Summary: WHY TRUST | admin-reviewed trust signals, verified docs, store rating, fulfilled count | ✅ "تقييم 5.0 من 5 (1)" | ⛔ nothing to cite |
| Doctors / provider profiles | doctors (name, specialty, photo, bio) + service_providers | ✅ 6 | ⛔ |
| Services + booking | products item_kind=service, BookingPanel | ✅ | ✅ |
| Visit terms (specialties, insurance, cancellation) | stores.specialties/insurance/booking_cancel_hours | ⛔ all empty (only price and duration, now in the summary) | ⛔ |
| Credentials | store_verifications | ⛔ none | ⛔ none |
| Hours (week) | stores.hours | ✅ | ✅ |
| Location map | lat/lng | ⛔ | ⛔ |
| Reviews 2.0 | reviews | ✅ 1 (no verified badge; see §4) | ⛔ **(was the empty state)** |

### Crafts / Services

| Module | Data source | Alo sam taxi | Passion Glow | التوفيق للسياحة | مفروشات عبد الحفيظ (professional) |
|---|---|---|---|---|---|
| Summary | area/hours/services | ⛔ 1 row only (WHERE) | ✅ WHAT + WHEN + WHERE | ✅ WHEN + WHERE | ⛔ 1 row |
| Service request form | `requests` module | ✅ | ✅ | ✅ | ✅ |
| Portfolio | store_portfolio | ⛔ 0 rows | ⛔ | ⛔ | ⛔ |
| Catalogue | products (browse-only surface: every row) | ⛔ **was a dashed «الخدمات» box** | ✅ 2 | ⛔ | ⛔ |
| Hours | stores.hours | ⛔ | ✅ | ✅ | ⛔ |
| Reviews | none | ⛔ **(was the empty state)** | ⛔ | ⛔ | ⛔ |

Outside the pilots, Aanab_perfumes (beauty, 0 services, 3 goods) lost the «لا توجد خدمات» dashed box that sat above its real goods cart. Its catalogue tab now reads «منتجات للبيع».

## 3. What is deliberately not shown, and what would unlock it

| Module | Why omitted | Unlocked by |
|---|---|---|
| Gallery (separate strip) | The only photo sources are the cover (already the hero) and product photos (already in the menu or shelf). A second strip would duplicate them. | A `store_media` gallery, or portfolio rows with images |
| Image → offering links | `store_portfolio` has no product/service FK. Linking a portfolio photo to a service would be a guess. | A `store_portfolio.product_id` column (DB change, not in this track) |
| Cuisine (restaurant) | No column exists | `stores.cuisine` (or a food attribute) |
| Popular items | No anon-readable sales signal; `order_items` is private | A definer RPC returning top-N product ids per store |
| Specialties, insurance (clinic) | `stores.specialties` / `insurance` are empty for all 17 stores | The merchant fills them in settings. The visit-terms card and the HOW MUCH insurance line then appear automatically. |
| Parking / accessibility / amenities | No columns | Amenity fields on stores |
| Credentials (WHY TRUST) | 0 `store_verifications` rows, 0 `commercial_reg_verified` | Merchant uploads plus admin approval (existing flow) |
| Provider on a review | `reviews` has no provider/booking column | `reviews.booking_id` → doctor |
| FAQ, packages, related businesses | No FAQ table. Packages are bundles, already in the catalogue. Linking competitors on a merchant's page is a product decision, not a data gap. | An FAQ table; a product decision on related stores |
| Loyalty | No component registered yet | The loyalty track registers `PROFILE_MODULE_SLOTS.loyalty` |
| Map on either clinic | No lat/lng | Merchant sets the pin |

## 4. Reviews 2.0 rules

- **One list, newest first.** It combines store reviews and the reviews of this store's own products and services (`product_reviews`, anon column grant from 0287, chunked `.in()`, newest 30 per chunk). **No account id is selected** (MP-010 test still passes).
- **Each card shows:** stars (with an aria label), date (Asia/Beirut, `ar-LB-u-nu-latn`, Western digits), author (or «زبون»), what the review is about («عن: <product>» linking to the product page, or «تقييم للمتجر»), the comment, and the shop's reply with its own date.
- **Verification badge.** «طلبه عبر متجر» / "Ordered on Matjar" appears **only** when `reviewVerification()` returns `orderedOnMatjar`. That requires `source === "product"` and `product_reviews.verified === true`. This flag is derived by trigger from `order_items` on INSERT and UPDATE (0273), so the author cannot set it.
- **No store-level review is ever labelled verified.** The insert policy has required a completed purchase since 0143, but the row records nothing, and the author id is not readable by the page. Checked on production today: **3 of 5 live store reviews have no completed purchase behind them**, including the one on مركز الضنية الطبي. A blanket "verified" label would be false for 60% of them.
- **Legend.** One sentence under the heading says what the badge means and what its absence means.
- **Summary line.** It shows the store average and count (the same set as the header rating) and, separately, the number of product/service reviews. They are never averaged together, and no summary claims "all verified".
- **Presence.** The section appears when there is at least one review to read, **or** the signed-in viewer can write one: they already have a review, or `has_store_purchase(own uid, store)` is true (the same definer function the insert policy runs, called about themselves only). Signed-out visitors on a store with no reviews no longer see the empty state. The store's own `reviews` module switch is respected.
- **To badge store reviews**, a DB change is needed. The options are a derived `reviews.verified` column set by trigger (as 0273 does for products), or a definer RPC returning `(review_id, verified)` for a store. Either is outside this track (no migrations). Using the service-role client was ruled out by the rule in `supabase/admin.ts`.

## 5. Before / after per pilot store (390px, `audit/prelaunch-v2/shots/phase3/{before,after}/`)

| Store | Before | After |
|---|---|---|
| **sleepy care** (retail) | catalogue, delivery, **empty reviews** («لسا ما في تقييمات…» + login), map, hours. 4059px. | catalogue, delivery, map, hours. The empty reviews block is gone. 3877px. Sticky «أضف إلى السلة». |
| **Let's meat** (food) | delivery, menu, table booking, hours, **empty reviews**. Sticky «أضف إلى الطلب». | delivery, menu, table booking, hours. Sticky **«اطلب الآن»** (orders module + order surface + 3 items + checkout all true). 3583px. |
| **دكتور عمر الصمد** (healthcare) | «قبل ما تحجز» card (price-from + visit length), hours, services, **empty reviews**. | **«بلمحة سريعة»** card: WHAT (3 services · 20–30 min), WHEN (closed now · today 09:00–15:00), WHERE (address), HOW MUCH ($30). Then services + booking, hours. No WHO row (no roster) and no WHY TRUST row (nothing to cite). Duplicate price card removed. |
| **مركز الضنية الطبي** (healthcare) | «قبل ما تحجز» card, doctors, hours, services, one review with no date. | Summary with all six rows (6 doctors, 3 specialties + 3 more; 3 services; open now + today's span; address; $50 to $90; rated 5.0 from 1 review). Then doctors, services + booking, hours, Reviews 2.0 (dated, «تقييم للمتجر», **no verified badge**, because production shows no completed purchase behind it). |
| **Alo sam taxi** (services) | request form, **a «الخدمات» heading over a dashed empty box**, **empty reviews**. 2660px. | Request form only; the page is exactly what the business can do. Summary omitted (one fact only). 2239px. |
| ملحمة البركة (retail, the one store with a verifiable review) | Reviews: name + stars + comment, undated. | Reviews 2.0: summary «5.0 من 5 · تقييمات المتجر: 1», legend, dated card «11 آب 2026», «تقييم للمتجر». No badge, because it is a store review (§4), even though this author does have a completed order. |

Also fixed: the WhatsApp fallback sticky bar was built with an `href` but the page never passed it to `StoreStickyCta`, so it rendered `href="#undefined"`. The page now passes `href`.

## 6. Files changed

- `src/lib/profile-engine.ts` (new): the engine.
- `src/lib/__tests__/profile-engine.test.ts` (new): 32 tests.
- `src/lib/sectors.ts`: profile-order parts only (`ProfileSectionKey` + `summary`/`loyalty`, default order, healthcare/food/retail/services/contractors/professional compositions).
- `src/app/[lang]/(site)/store/[id]/page.tsx`:
  - engine wiring and `present` from the engine
  - the review `created_at` and `product_reviews` reads
  - the `has_store_purchase` self-check
  - summary and loyalty nodes, Reviews 2.0
  - sticky CTA from the engine, plus the `href` fix

  The SEO agent's `generateMetadata` change in the same file was left intact.
- `src/components/store/store-profile-summary.tsx` (new): the WHO/WHAT/WHEN/WHERE/HOW MUCH/WHY TRUST block. LTR isolates keep prices, times and ranges in order inside Arabic; `ChevronNext` from `directional-icon`.
- `src/components/store/profile-module-registry.ts` (new): the loyalty slot.
- `src/components/store/store-products-section.tsx`: two minimal fixes. The browse-only catalogue judges emptiness on every row, and a booking store with no services but a goods cart no longer draws «no services» above it.
- `src/components/reviews/profile-reviews.tsx` (new) and `src/components/reviews/review-card.tsx` (new): Reviews 2.0.
- `src/i18n/dictionaries/ar.json`, `en.json`: one new top-level `profile` namespace each (`cta`, `tabs`, `summary`, `reviews`). Inserted as a single CRLF textual insertion before `  "features": {`, validated with `JSON.parse`, with no bare LF introduced.
- `src/components/store-reviews.tsx`: untouched. Its `Review` type is still what the page and the MP-010 contract test read. `StoreReviews` is no longer rendered by the store page.

## 7. Gates (verbatim)

```
npx tsc --noEmit -p .
src/lib/__tests__/seo-rules.test.ts(58,48): error TS2367: This comparison appears to be unintentional because the types '"" | "/explore" | … ' and '"/merchant" | "/admin" | … ' have no overlap.
TSC=2
```
This is the only error, and it is in `seo-rules.test.ts`, a new untracked file from the SEO/moderation track. An earlier run on this track's files alone gave `TSC_EXIT=0`, before that file appeared.

```
npx eslint src/lib/profile-engine.ts src/lib/sectors.ts "src/app/[lang]/(site)/store/[id]/page.tsx" src/components/store/store-profile-summary.tsx src/components/store/profile-module-registry.ts src/components/store/store-products-section.tsx src/components/reviews/profile-reviews.tsx src/components/reviews/review-card.tsx src/lib/__tests__/profile-engine.test.ts
ESLINT=0
```

```
npx vitest run src/lib/__tests__/profile-engine.test.ts src/lib/__tests__/profile-order.test.ts src/lib/__tests__/data-contracts.test.ts
 Test Files  3 passed (3)
      Tests  77 passed (77)

npx vitest run            (whole suite)
 Test Files  1 failed | 64 passed (65)
      Tests  1 failed | 1314 passed (1315)
 FAIL  src/lib/__tests__/data-contracts.test.ts > no query in src/lib/data can silently truncate > bounds every select — an unbounded one stops at 1000 rows and says nothing
   expected [ 'market.ts:381 → listings' ] to deeply equal []
```
That failure is in `src/lib/data/market.ts`, another track's modified file. This track's files pass the same contract suite, including MP-010 (no `customer_id` in any public projection; the viewer's own `.eq("customer_id", user.id)` filter is kept).

No `next build` was run. The screenshots came from the dev server already running on port 3282 (another agent's). A second `next dev` in the same directory refuses to start, so 3281 was never used and nothing needed killing.

## 8. CSV rows

```
issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P1-PROFILE-01|P1|store-profile|/store/[id]|all|Stores with no catalogue rendered a heading over a dashed «ما في منتجات / الخدمات» placeholder|Catalogue section was always rendered; presence map only fed the tab rail|Engine presence decides rendering; catalogue omitted when empty|src/lib/profile-engine.ts; src/app/[lang]/(site)/store/[id]/page.tsx|fixed|Mehras, Qabass, ألبسة, Alo sam taxi showed an empty box|Section absent|Demo catalogue still renders
P1-PROFILE-02|P1|reviews|/store/[id]|all|«لسا ما في تقييمات. كن أول مين يقيّم!» shown on 15/17 stores to visitors who cannot review (needs completed purchase)|Reviews section always present on real stores|Present only with ≥1 review or a signed-in viewer who has a review or has_store_purchase|src/lib/profile-engine.ts; page.tsx|fixed|Empty state + login link|Omitted for anon; shown to eligible viewer with «فيك تكون أول واحد بيقيّم»|Respects store `reviews` module switch
P1-PROFILE-03|P1|healthcare|/store/[id]|healthcare|Patient had to scroll across four sections to learn who/what/when/where/how much/why trust|No summary module|resolveProfileSummary + StoreProfileSummary; each row only from existing facts, links only to present sections|src/lib/profile-engine.ts; src/components/store/store-profile-summary.tsx|fixed|No summary|Dennieh: 6 rows; Omar: 4 rows (no WHO, no WHY TRUST)|Also on services/contractors/professional when ≥2 rows
P1-PROFILE-04|P1|restaurant-cta|/store/[id]|food|Restaurant sticky CTA said «أضف إلى الطلب»; brief requires «اطلب الآن» only where ordering is actually enabled|CTA label from offering resolver; no ordering-enabled rule|orderingEnabled(): real store + orders module + order surface + goods transact + canOrderProducts + checkout + ≥1 item|src/lib/profile-engine.ts; page.tsx|fixed|«أضف إلى الطلب»|«اطلب الآن» on Let's meat; never when any condition fails (tested)|
P1-PROFILE-05|P1|reviews-trust|/store/[id]|all|Risk of calling store reviews verified; production shows 3/5 store reviews have no completed purchase|reviews row stores no transaction fact; author id not public|reviewVerification(): only product_reviews.verified=true earns «طلبه عبر متجر»; store reviews never badged; legend explains|src/lib/profile-engine.ts; src/components/reviews/*|fixed|Undated, no subject, no verification distinction|Dated (Beirut, Western digits), subject, badge only with evidence|Badging store reviews needs a DB change (derived reviews.verified or definer RPC)
P1-PROFILE-06|P2|reviews|/store/[id]|all|Product/service reviews never appeared on the store profile|Store page read only `reviews`|Store page reads product_reviews for its own catalogue (anon grant columns, no account id), merged with «عن: <product>»|page.tsx|fixed|Absent|Merged, newest first|0 product reviews in production today
P1-PROFILE-07|P2|sticky-cta|/store/[id]|all|WhatsApp fallback sticky bar rendered href="#undefined"|Page built {href} but passed only targetId to StoreStickyCta|Pass href through|page.tsx|fixed|Dead link on stores with no engine/form|wa.me link|
P1-PROFILE-08|P2|catalogue|/store/[id]|services|Browse-only catalogue judged emptiness on goods only while listing every row|primary = goods for non-appointment surfaces|Catalogue surface counts every row (catalogPrimaryCount + products-section)|src/components/store/store-products-section.tsx; profile-engine.ts|fixed|Services-only trade → «no products» over nothing|Service rows listed|
P1-PROFILE-09|P2|catalogue|/store/[id]|beauty|Booking store with 0 services but goods drew «لا توجد خدمات» above its goods cart|Empty-primary placeholder not aware of goods section|Skip heading + placeholder when goods cart renders; tab says «منتجات للبيع»|store-products-section.tsx; page.tsx|fixed|Aanab_perfumes: dashed box|Goods cart only|
P1-PROFILE-10|P2|healthcare|/store/[id]|healthcare|Price-from and visit length printed three times (visit-terms card, summary, each service row)|healthcareInfo present on price/duration alone|healthcareInfo only with specialties/insurance/cancellation when a summary renders|src/lib/profile-engine.ts|fixed|«قبل ما تحجز» card duplicating|Card omitted on both clinics (no such facts recorded)|
P1-PROFILE-11|P2|loyalty|/store/[id]|all|No place for the loyalty feature on the profile without editing the page|—|`loyalty` module key + PROFILE_MODULE_SLOTS registry; renders nothing until registered|src/components/store/profile-module-registry.ts; sectors.ts|done|—|Slot ready|For the loyalty/gift-card track
P1-PROFILE-12|P3|data|/store/[id]|restaurant, healthcare|Cuisine, popular items, specialties, insurance, parking, amenities, FAQ, image→service links have no data|Columns/tables absent or empty for all 17 stores|Omitted, never placeholder; unlock list in §3|—|open|—|—|Needs merchant data or schema (no migrations in this track)
```
