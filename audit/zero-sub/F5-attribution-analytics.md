# F5 — Customer source attribution + core analytics taxonomy

Branch `feat/zero-subscription-features`. Nothing committed or deployed, and `next build` was not run.
**Migration 0312 is WRITTEN, NOT APPLIED.** The only queries sent to production were read-only SELECTs, used to look at the schema.

All of it has zero recurring cost. Tags and events are stored in Matjar's own Postgres. There is no Vercel Analytics custom event, no SaaS and no AI. It is reporting only: Matjar charges 0% commission, and the card, the summary page and the SQL comments all say so.

---

## 1. Source resolution (`src/lib/attribution.ts`, pure, tested)

The rules are checked in this order. The first one that matches wins.

| # | Signal | Result |
|---|---|---|
| 1 | `utm_source` on the store/product URL | `instagram` (instagram, ig, insta, instagram_bio, instagram_story); `whatsapp` (whatsapp, wa, whats_app, whatsapp_status, wa_status); `google` (google, google_ads, googleads, gmb, google_business, google_maps). Any other value becomes **`unknown`**, and the value is kept in the detail (`utm=facebook`) |
| 2 | Previous page in the same tab, on Matjar | `/search` → **matjar_search**; `/` (home), `/explore`, `/category/*`, `/categories`, `/merchants`, `/best-sellers`, `/hub` → **matjar_directory**; `/map` → **matjar_map**; `/market*` → **sunday_market**; `/offers`, `/flash`, `/clearance` → **offers_page**. Any other Matjar page (another store, cart, favorites…) → **`unknown`** with detail `from=<segment>`. It is never guessed as Matjar |
| 3 | `document.referrer` on a landing page | If the host is Matjar's own (for example a link opened in a new tab), its path is mapped with rule 2. `google.*` and the Android `googlequicksearchbox` app → google. `instagram.com` and `com.instagram.android` → instagram. `wa.me`, `whatsapp.com/.net` and `com.whatsapp` → whatsapp. Any other host → **`unknown`** with detail `ref=<host>`: only the host, never the path |
| 4 | No referrer and no previous page | **direct_link** |

- **Detail sanitising.** Only `[A-Za-z0-9_.:=;,/+-]` is kept, capped at 120 characters on the client and 160 in the database. Arabic, spaces, `@` and quotes are dropped, so a name, an email or a sentence can't get through. The SQL `public.attribution_detail` applies the same character class.
- **Memory.** First touch and last touch are kept per store in `localStorage["matjar-attr"]` for a 30-day window. At most 50 stores are kept, most recent first. A touch is recorded once per store per tab session (`sessionStorage`). Every storage access is wrapped in try/catch.
- **Last non-direct touch.** A `direct_link` or `unknown` touch does not overwrite a specific last touch that is still inside the window. Example: a customer finds a shop through Matjar search and comes back from a bookmark a week later. That still counts as search.
- **What an order or booking is tagged with.** The last touch. When the first touch differs, `first=<source>` is appended to the detail. If there is no touch in 30 days, the tag is **`unknown` / `no_touch`**, never a guess.
- **Capture.**
  - `<AttributionCapture />` is mounted with one line in `src/app/[lang]/layout.tsx`. It records the last two pathnames using `usePathname` only, never `useSearchParams` (see vercel-cost-guard).
  - The per-store touch runs inside the existing `TrackVisit`. Every storefront and product page already renders it, including `/[handle]` pages, so no other file needed editing.

## 2. Tagging path and why it is safe enough

The checkout RPCs and `checkout-form.tsx` / `lib/checkout.ts` were **not** touched. Rows are tagged **after** they are placed.

- **Orders.** `order-placed.tsx` renders `<TagSource kind="order" orderId=… />`. This calls `tag_order_source(p_order_id, p_source, p_detail, p_store_id)` (anon and authenticated), once per order per tab session.
- **Bookings.** The success block in `booking-panel.tsx` renders `<TagSource kind="booking" storeId=… />`. This calls `tag_booking_source(p_store_id, p_source, p_detail)` (authenticated only). A booking always has a signed-in customer (`bookings.customer_id` is NOT NULL). So this call needs no id: it labels the **caller's own** untagged bookings at that store from the last 15 minutes. That covers both the `place_booking` path and the legacy direct insert with one call.

Why `tag_order_source` is safe enough to grant to anon:
1. **It writes a label once.** It only succeeds while `source IS NULL`. The first label wins, and later calls are no-ops that return `false`. It reads nothing back.
2. **15-minute window.** It only works while `created_at > now() - 15 min`.
3. **Ownership.** A signed-in caller may tag their own order or a guest order. An anon caller may tag only a guest order (`customer_id IS NULL`). Nobody can tag another signed-in customer's order.
   - Consequence, documented in the test: any caller who holds a guest order's id can tag it in the window. A guest order has no owner to check.
4. **The order id is a random UUID** that only the placing browser received. It can't be enumerated.
5. **Store check.** If `p_store_id` is given, it must be the order's store, so a touch recorded for shop A can't label an order at shop B.
6. **Worst case** if all of the above were beaten: one order in one report shows the wrong source. No money, status, stock, PII or permission changes.
7. **The value is whitelisted** (the RPC and a CHECK constraint agree), and the detail is sanitised.
8. **Merchants can't forge their own numbers.** `guard_attribution_columns` is a SECURITY INVOKER trigger following the house pattern (`current_user in ('authenticated','anon')`). It throws away any browser-role write to `source`/`source_detail`: the columns become NULL on insert and keep their old value on update. A merchant therefore can't relabel their own orders as "Matjar brought this", and existing screens keep working.

Side effect: tagging bumps `orders.updated_at` / `bookings.updated_at` through the existing `set_updated_at` trigger.

Other booking tables are **not** tagged: `rental_bookings` and `service_requests`. Their success UIs (`rental-search.tsx`, `service-request-form.tsx`) belong to the crafts/freelance change. The same two-line pattern (column + `TagSource`) applies once that change lands.

## 3. New vs returning (computed in SQL, never stored)

This is done inside `public.store_attribution_report(store, 'YYYY-MM')`.

- **Interactions.** An interaction is a non-cancelled, non-rejected order or booking at the store.
- **Returning.** An interaction is from a **returning** customer when an **earlier** interaction at the same store has the same `customer_id`, or the same `public.wa_phone_key(phone)`. `wa_phone_key` comes from 0309 and mirrors `phoneKey()` in `src/lib/wa-templates.ts`.
- **Unidentified.** An interaction with no `customer_id` and no usable phone can't be matched. It is counted as **unidentified**, never as new.
- **Cancelled or rejected** orders and bookings count neither as interactions nor as history.

## 4. Dashboard card definition

Component: `src/components/attribution/matjar-brought-card.tsx`. It is a self-contained async server component. It is mounted with **one JSX line** plus one import in `merchant/[storeId]/page.tsx`, after the widgets grid: `{canOrders && <MatjarBroughtCard …/>}`.

- **Headline:** «متجر جابلك **X** هالشهر بقيمة **$Y**»
  - Arabic count forms: زبون جديد واحد / زبونين جداد / N زباين جداد / N زبون جديد.
  - English: "Matjar brought you N new customers this month, worth $Y".
  - When X = 0, it shows «لسا ما وصلك زبون جديد عن طريق متجر هالشهر».
- **X** counts new customers whose interaction this month came from **exactly these sources: matjar_directory, matjar_search, matjar_map, sunday_market, offers_page**. The card prints that list. Instagram, WhatsApp, Google, direct links, unknown and untagged are never counted in X.
- **Y** is the total of those new customers' **first orders**, in USD. Lira orders are shown next to it as «+ N ل.ل.», never converted into it. Bookings have no value, so they only add to X.
- **Month:** the current Beirut calendar month. The client computes `beirutMonth()` with `Intl` in `Asia/Beirut`, the same approach as `beirutClock`, which only exposes the day and minute. SQL computes the range with `make_timestamptz(..., 'Asia/Beirut')`.
- **Breakdown:** every source seen this month, with orders, bookings and new customers, Matjar's sources first with a badge. Orders from before tagging existed are their own row, «قبل تفعيل التتبّع».
- **Footer:** «هيدا تقرير بس — متجر ما بياخد ولا قرش عمولة على مبيعاتك.» and a link to the summary page.
- **Who sees it:**
  - The owner, and staff with `orders`.
  - Booking counts only appear for callers who also hold `bookings`.
  - Before 0312 is applied, it shows a one-line "not available yet" message.
  - Staff without `orders` get nothing: the RPC returns 42501.
- **Every plan:** registered as `FEATURES.sourceAttribution` with `plan: "free"`, `state: "live"`, and its own dictionary copy.

**Monthly summary page:** `merchant/[storeId]/reports/matjar-summary?month=YYYY-MM`.
- **Decision:** owner/staff-only, with **no public tokenized copy**. The content is what makes it shareable: totals only, since the RPC returns aggregates. It comes with a ready-made sentence that the merchant sends from their own phone (free `wa.me/?text=`) or copies into a story.
- A public link would need a token table plus an anon-readable function that shows a shop's order volume to anyone holding the link. That is more attack surface than a screenshot needs.
- The page also has previous/next month navigation, stat tiles, the breakdown, a "how we count" list, and `robots: noindex`.

## 5. Event whitelist and where each fires

- **Storage.** `public.product_events` (id, name, store_id, offering_id, sector, offering_type, region, source_surface, session_id, user_id, created_at).
  - Every text column is CHECKed as a slug token `^[a-z0-9][a-z0-9_.:-]{0,39}$`.
  - No column can hold a phone, email, name or free text.
  - RLS allows platform admins to read. Nobody can write directly.
- **Write path.** `log_event(...)` (SECURITY DEFINER, anon and authenticated):
  - checks the name whitelist,
  - requires the store to be active,
  - rate-limits to **120 events per minute per session**,
  - never raises.
- **Beacon endpoint.** `log_events(text)` is the batched endpoint: at most 20 events per call, parsed defensively.
- **Client.** `track(name, props)` in `src/lib/analytics.ts`:
  - batches (flushes after 4 s or at 10 events),
  - on `pagehide`/hidden, sends with `navigator.sendBeacon`,
  - otherwise uses `fetch keepalive`.
  - Both send `text/plain`, a CORS simple request with no preflight, to `/rest/v1/rpc/log_events?apikey=<publishable key>`.
  - The session id is a random UUID per tab. It is not the TrackVisit device id and not the account.

| Event | Status | Where |
|---|---|---|
| business_viewed | **fires** | `TrackVisit` path="store" (once per store per session) |
| offering_viewed | **fires** | `TrackVisit` path="product" (already on the product page, so the product page needed no edit) |
| contact_clicked | **fires** | Storefront WhatsApp/phone links are rendered by several components (store-header, store-sticky-cta, store-branches, the store page), not one. Instead, `AttributionCapture` counts a delegated click on `wa.me` / `api.whatsapp.com` / `tel:` links, only on the page where a store was just viewed. `source_surface` = `store:whatsapp`, `store:tel`, `product:whatsapp`… |
| transaction_completed | **fires** | `TagSource` in `order-placed.tsx` (offering_type `order`) and in the booking success block (offering_type `booking`) |
| search_started, search_submitted, zero_result, search_result_clicked | pending | The search page belongs to the SEO change. `search_logs` + `log_search` (0216) already records submitted queries and zero results on the server |
| add_to_cart, checkout_started | pending | The checkout and cart files belong to the loyalty change |
| favorite_added | pending | Needs the favorite button (one `track()` line) |
| booking_started | pending | One `track()` line on the first booking step (not added, to keep the booking-panel edit to the success block) |
| service_request_created, job_viewed, job_applied, project_posted | pending | Crafts/freelance/jobs belong to that change |

## 6. Funnels (§35)

Legend: ✅ fires today · ⏳ pending (owner of the missing file in brackets).

- **Retail:**
  - ⏳ search_started → ⏳ search_submitted (server-side in search_logs today) → ⏳ zero_result (search_logs today) → ⏳ search_result_clicked [SEO]
  - → ✅ business_viewed → ✅ offering_viewed → ⏳ favorite_added → ⏳ add_to_cart [loyalty] → ⏳ checkout_started [loyalty] → ✅ transaction_completed(order)
  - Side branch: ✅ contact_clicked.
  - Attribution: `orders.source` ✅.
- **Healthcare (clinics, labs):**
  - ⏳ search_* → ✅ business_viewed → ✅ offering_viewed (service) → ⏳ booking_started → ✅ transaction_completed(booking)
  - Side branch: ✅ contact_clicked (WhatsApp/phone to the clinic).
  - Attribution: `bookings.source` ✅.
- **Crafts:**
  - ⏳ search_* → ✅ business_viewed (craftsman's store page) → ✅ contact_clicked → ⏳ service_request_created [crafts]
  - Attribution for `service_requests` ⏳ [crafts].
- **Freelance / jobs:**
  - ⏳ search_* → ⏳ job_viewed / ✅ business_viewed (when the profile is a store page) → ✅ contact_clicked → ⏳ project_posted / ⏳ job_applied [freelance/jobs]

## 7. Migration summary — `supabase/migrations/0312_attribution_events.sql` (NOT APPLIED)

1. `orders.source` and `bookings.source`, each with a CHECK on the 10-value vocabulary; `source_detail` capped at 160. All `add column if not exists`.
2. `guard_attribution_columns()`, a SECURITY INVOKER trigger, on BEFORE INSERT OR UPDATE of `orders` and `bookings`. EXECUTE is revoked from public, anon and authenticated.
3. `attribution_detail(text)`, an immutable sanitiser.
4. `tag_order_source(uuid,text,text,uuid)`: DEFINER, `search_path=''`, anon and authenticated.
5. `tag_booking_source(uuid,text,text)`: DEFINER, authenticated.
6. `store_attribution_report(uuid,text)`: DEFINER, authenticated, re-checks `staff_can(orders)`. Booking rows are counted only with `staff_can(bookings)`.
7. `product_events` plus indexes on (name, time), (store, time), (session, time) and user_id. Every foreign key is indexed. RLS: admin read. No write grants.
8. `log_event(...)`: DEFINER, anon and authenticated, rate-limited.
9. `log_events(text)`: DEFINER, anon and authenticated. It has a single unnamed text parameter so that PostgREST accepts a raw `text/plain` beacon body.

Every statement is idempotent. There is **no plan check** anywhere.

**Test:** `supabase/tests/0312_attribution_events.test.sql`.
- It embeds the migration verbatim between `-- ==== MIGRATION 0312 (verbatim) ====` / `-- ==== END MIGRATION 0312 (verbatim) ====`; byte equality was checked.
- Fixtures: stores A, B and D (active) and C (pending), owners, two staff, two customers and a super admin. There is a month of orders and bookings at store A with known sources, phones typed different ways, a cancelled order, an unidentified order, an untagged order and a lira order. Store D holds the fresh orders used for the tagging checks.
- About 55 checks, written into the temp table `r (n, check_name, ok, got)` and ending with an `ALL CHECKS` row. They cover:
  - **Owner:** report numbers, the guard discards the owner's relabel, cross-store refusal.
  - **Staff with orders only:** booking columns NULL, booking-only rows hidden.
  - **Staff without orders:** 42501, reads 0 events.
  - **Other store's owner:** 42501, plus a positive control on their own report, and a store-B touch can't label another store's order.
  - **Customers:** can't tag someone else's order; a direct booking insert can't set source; `tag_booking_source` labels exactly their own fresh booking.
  - **Anon:**
    - tags a fresh guest order, and a second tag is a no-op;
    - can't tag orders older than 15 minutes, a customer's order, or with a bad source;
    - can't call the booking-tag RPC or the report;
    - event whitelist, inactive store, malformed batch, the 20-per-batch cap, the 120-per-minute rate limit, no direct read or write.
  - **Admin:** reads events, tokens are lower-cased, a typed name is dropped to NULL, and anon events carry no user id.
- **It has NOT been run.** Running it is itself DDL inside a rolled-back transaction, which the rules for this task forbid.

## 8. Files changed

New:
- `supabase/migrations/0312_attribution_events.sql`
- `supabase/tests/0312_attribution_events.test.sql`
- `src/lib/attribution.ts`: vocabulary, resolution, touch reducer, Beirut month, report summary
- `src/lib/attribution-client.ts`: guarded session/local storage
- `src/lib/analytics.ts`: `track()`, whitelist, batching, beacon
- `src/lib/data/attribution-report.ts`: RPC loader that never throws
- `src/components/attribution/attribution-capture.tsx`, `tag-source.tsx`, `matjar-brought-card.tsx`, `attribution-view.tsx`, `share-summary.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/reports/matjar-summary/page.tsx`
- `src/lib/__tests__/attribution.test.ts` (50 tests), `src/lib/__tests__/analytics.test.ts` (8 tests)

Shared files, minimal edits:
- `src/app/[lang]/layout.tsx`: one import plus `<AttributionCapture />`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/page.tsx`: one import plus one JSX line after the widgets grid
- `src/components/track-visit.tsx`: `touchStore` plus two `track()` calls, and two imports
- `src/components/checkout/order-placed.tsx`: one import plus `<TagSource kind="order" …/>`
- `src/components/booking-panel.tsx`: one import plus `<TagSource kind="booking" …/>` in the success block
- `src/lib/feature-availability.ts`: `sourceAttribution` in `FeatureId`, `OwnCopyFeatureId` and `FEATURES` (free, live)
- `src/i18n/dictionaries/ar.json`, `en.json`: one top-level `attribution` namespace each, inserted textually before `  "features": {`. The file's CRLF line endings were kept, and both files pass `JSON.parse` (+113 lines each, no other line touched).

## 9. Not browser-verified

None of these were exercised in a browser in this session:
- The dashboard card and the summary page rendering, in both locales, with RTL and the Lebanese copy.
- `TagSource` actually tagging, and the `sendBeacon` / `fetch keepalive` to `log_events`.
- Whether the Supabase gateway accepts `?apikey=` for a publishable `sb_publishable_…` key, and whether PostgREST accepts the `text/plain` body for the unnamed-parameter function. Both are expected to work; neither is verified. Before 0312 they fail silently by design.
- The delegated `contact_clicked` listener.
- The internal previous-path capture across client navigations.
- `wa.me/?text=` share and clipboard copy.
- The SQL test file itself (see §7).

## 10. Gates (verbatim)

```
npx tsc --noEmit                       -> tsc exit=0
npx eslint <the 16 files touched>      -> eslint exit=0
npx vitest run                         ->  Test Files  63 passed (63)
                                                Tests  1233 passed (1233)
npm run check:migrations               -> PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
node JSON.parse ar.json / en.json      -> ar JSON.parse ok; attribution keys: feature,sources,customers,card,summary
                                          en JSON.parse ok; attribution keys: feature,sources,customers,card,summary
```

An earlier `tsc` run in this session showed 20 errors, all in `src/app/[lang]/(site)/store/[id]/page.tsx` and `src/components/store/store-profile-summary.tsx`. Those files belong to the business-profile change, which was mid-edit. None of the errors were in these files, and the final run above is clean.

## 11. To go live

1. Run `supabase/tests/0312_attribution_events.test.sql` against production. It rolls back. Expect `ALL CHECKS = true`.
2. Apply `0312_attribution_events.sql` through `apply_migration`, then run `get_advisors`.
3. On a real phone:
   - open a store from `/ar/search`;
   - place a guest order;
   - check that `orders.source = 'matjar_search'`;
   - check that the dashboard card counts the order.
4. Confirm `product_events` receives beacon rows. If it doesn't, the likely cause is the `?apikey` query parameter; the fallback is a header-based fetch.


## Applied to production (2026-09-28)

Rolled-back run first (migration + fixtures + assertions in one uncommitted transaction), a follow-up read confirmed nothing persisted, then apply_migration:

| migration | checks |
|---|---|
| 0310 loyalty & gift cards | 113 / 113 |
| 0311 import | 22 / 22 |
| 0312 attribution & events | 55 / 55 |
| 0313 market moderation & review trust | 51 / 51 |

After apply: existing loyalty_ledger rows unchanged (5), orders (7) and listings (12) unchanged, 2 of 5 store reviews now verified_purchase (both backed by a completed purchase), 0 product reviews lost their flag. Supabase security advisor: no finding names any new object.
