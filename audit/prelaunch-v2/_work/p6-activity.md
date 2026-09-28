# Phase 6: customer activity centre and retention (§30, §31)

Branch `feat/zero-subscription-features`, on top of HEAD 67980f0. Nothing is committed, and nothing was changed in the production database. The only database calls were read-only SELECTs on schema, policies, grants, enums and row counts.

## Decision: «طلباتي» keeps its name and its URL

- The bottom tab already pointed at `/[lang]/activity`, which showed four kinds: orders, bookings, craft requests and inquiries. I extended that screen rather than creating a new one.
- The tab label stays «طلباتي». In Arabic, «طلب» is the everyday word for "something I asked for". Every row also states its own kind (حجز، إقامة، تذاكر، طلب عرض سعر، إعلان بالسوق…), so no row is presented as an order unless it is one. Renaming the app's main tab just before launch would cost more recognition than it gains.
- **URLs kept:** `/activity`, `/orders`, `/orders/[id]`, `/bookings`, `/bookings/[id]`, `/crafts/requests/[id]`, `/inquiries/[id]`, `/favorites`, `/following`, `/track/[orderId]`, `/jobs/[id]`, `/market/[id]`, `/market/[id]/edit`, `/messages`.
- **Redirected:** none. Nothing moved, so there are no broken links.

## Types covered (10)

| kind | table | status vocabulary (domain) | card link | next action (primary) | "again" |
|---|---|---|---|---|---|
| order | `orders` | `order` | `/orders/[id]` | تتبّع الطلب while open; قيّم تجربتك when completed and not yet reviewed; otherwise شوف الطلب | اطلب نفس الشي (checked reorder sheet) |
| booking | `bookings` | `booking` | `/bookings/[id]` | شوف حجزك | احجز من جديد → `/store/{id}?service={product}` (the existing booking deep link), shown after completed, no_show or cancelled |
| stay | `stay_bookings` | `stayBooking` (0191) | `/store/{id}` (StaySearch lives there; there is no customer detail page) | شوف الإقامة بصفحة المكان | احجز من جديد, shown after checked_out, completed or cancelled |
| rental | `rental_bookings` | `rentalBooking` (0298) | `/store/{id}` (RentalSearch) | شوف الحجز بصفحة الشركة | احجز من جديد, shown after returned, completed or cancelled |
| ticket | `event_tickets` | `eventTicket`, new domain: `reserved` is the only value that is ever written | `/store/{id}` (EventTickets) | شوف الحدث, with the seat count | — |
| service | `service_requests` | `serviceRequest` (0083+0207) | `/store/{id}`, where ServiceRequestForm lists the customer's own requests with the accept and counter buttons | «وصلك عرض سعر — ردّ عليه» while `quoted`; otherwise شوف طلبك. The amount shown is the quote, or the customer's counter once one exists | اطلب من جديد, shown after completed |
| craft | `craft_requests` | `craftRequest` | `/crafts/requests/[id]` | قيّم الشغل while completed and not yet reviewed (`craft_reviews` embed); otherwise شوف طلب الخدمة | رجاع اطلب نفس الحرفي → `/crafts/p/{provider}` (the repeat-professional link) |
| lead | `leads` | `lead` | `/inquiries/[id]`, which carries the shop's phone and WhatsApp | شوف استفسارك | — |
| job | `job_applications` | `jobApplication`, new domain: the table has no status column, so every row gets the app-side value `sent` («انبعت للشركة») | `/jobs/[job_id]` | شوف الوظيفة | — |
| listing | `listings` (seller = me, not deleted) | `marketListing` | `/market/[id]` | شوف إعلانك. Rejected or draft rows go to صلّح الإعلان وابعته من جديد and expired rows to جدّد الإعلان, both linking to `/market/[id]/edit` | — |

**Card design, the same for every type:**
- The icon for the kind.
- The kind label and the created date (Beirut time, Western digits).
- A «بدّو منّك شي» badge, shown only when it really is the customer's move.
- The counterpart's name, then the title.
- The appointment date or range, from the row's own date column (never a computed ETA), and the ticket count.
- A status pill with words from the row's own domain and a colour for its phase.
- An amount, only where the row states one.
- The primary action line.
- A separate "again" button below the link. A button nested inside an `<a>` is invalid, so it sits outside.

**Tabs and layout:**
- There are 11 filter chips: الكل plus the 10 kinds. Chips with nothing behind them are hidden.
- The chips sit on a sticky, horizontally scrolling rail on mobile.

**The tab badge (`needsCustomer`) now counts only things the customer can clear:**
- **Completed order:** counts only if the customer has not reviewed that store (store reviews are one per store) and the order finished within the last 30 days. Before, every completed order counted forever.
- **Accepted or scheduled booking:** counts only if its day is today or later in Beirut.
- **Confirmed stay or rental:** counts only until its end date.
- **Quote request:** counts while the status is `quoted`.
- **Completed craft request:** counts until it is rated.
- **Market listing:** counts while it is `rejected`.

**Freelance briefs and project requests:** there is no table for them. `freelance/brief` sends each brief as a conversation, so the activity screen links to them through a «الرسائل وطلبات المشاريع» tile pointing at `/messages`. I did not invent a queue.

**Speed:**
- One query per kind, 10 kinds plus one read of the customer's own `reviews.store_id`, all in one `Promise.all`.
- Names come in through embedded selects (store, unit, vehicle, ticket type, provider, job posting, and `craft_reviews(id)`), so there is no N+1.
- 50 rows per kind.
- `getCustomerActivity` is now wrapped in React `cache()`, so the layout's badge read and the page's list share one set of queries within a request.
- **Cost to watch:** the layout runs this on every signed-in page, and that is now 11 parallel reads instead of 4. It is still one round trip of latency, but it is more database work per navigation.

**RLS: each customer sees only their own rows.** I checked this against production pg_policies (read-only):
- `orders`, `bookings`, `craft_requests` and `service_requests` all have policies that include `customer_id = auth.uid()`.
- `stays_select`, `rental_bookings_select` and `tickets_select` include `customer_id = auth.uid()`.
- `job_applications_select` includes `applicant_id = uid`.
- `listings_select_public` includes `seller_id = uid`.
- `reviews_select_public` includes the caller's own rows, and `customer_id` is column-granted.
- Every query also filters on the caller's id, so a merchant who is also a customer does not get their store's rows mixed into their personal list.

## Bug found: customers cannot read their own inquiries (P1)

- The only SELECT policy on `leads` is `leads_select_store` (`staff_can(store_id,'orders')`).
- So for any customer who is not staff of that store, the inquiries tab has always been empty and `/inquiries/<own id>` returns a 404.
- On production today, 3 leads carry a `customer_id`.
- **Fix, written but NOT applied:**
  - `supabase/migrations/0315_activity_center.sql` adds one permissive SELECT policy, `leads_select_own`, to `authenticated`, using `customer_id = (select auth.uid())`. It adds no insert, update or delete policy.
  - The test is `supabase/tests/0315_activity_center.test.sql`: the migration verbatim between the markers (a diff confirms it is identical), then 16 checks and an ALL CHECKS row.
  - The checks act as customer A, customer B (the positive control), store staff with `orders` (who must be unchanged, including the guest lead), store B's owner and anon.
  - The test has not been run.
- The code already reads leads, so the inquiries tab lights up the moment 0315 is applied. Until then that read returns zero rows and the tab stays hidden, which is exactly how it behaves today.
- **Column note:** the customer can read `assigned_to` (an opaque staff uuid) and `last_contacted_at` on their own row. A column-level revoke is not possible, because `authenticated` is also the merchant's role.

## Retention (existing data only, no AI)

| feature | status | how |
|---|---|---|
| Reorder | **built** | `ReorderSheet` runs one query for `order_items` with the products as they are now, then `planReorder()`. It shows price changes against `effectivePrice()` (the same function the store charges with: flash, then discount, then base), quantities lowered to tracked stock, and what cannot come back and why (gone, unavailable, out of stock, has options, is a service). It merges into the store's existing `matjar-cart-<store>` cart using the larger quantity, so it never wipes the cart and never doubles it, then opens the store. The old `ReorderButton` on `/orders/[id]` blindly overwrote the whole cart, including items with variants that the grid cart would charge at the base price. It now uses the same sheet. |
| Rebook | **built** | Bookings go to `/store/{id}?service={product}`, which preselects the service in the existing BookingPanel. Stays, rentals and quote requests go to the store page, where their panels live. The form is not prefilled beyond the service: those panels take no prefill parameters, and adding some would mean touching the booking engine. |
| Repeat professional | **built** | Completed craft requests offer رجاع اطلب نفس الحرفي, linking to `/crafts/p/{provider}`. |
| "Again" rail | **built** | The top of the activity screen shows one entry per place, newest first, up to 6 (`againCandidates`). |
| Favorites and saved listings | **built (entry points)** | Head-only counts (no rows cross the wire) for `wishlist`, `follows` and `listing_favorites`. Each count links to the screen that already manages it (`/favorites`, `?tab=products`), and a count of 0 is not shown. |
| Recently viewed | **built** | The existing `RecentlyViewed` component is now read-only when it gets no `currentId`, so viewing the activity page does not record anything. It also rejects non-UUID localStorage entries, which previously made the `.in()` query return a 400, and its `dict` prop is narrowed to `product` and `offering` (about 4KB). |
| `favorite_added` analytics | **built** | One line after a successful insert in `wishlist-button` (product), `favorite-button` (store card), `follow-button` (store) and `listing-favorite-button` (listing). Only ids and slug tokens are sent, no PII (`track()` enforces this). |
| Loyalty cards in activity | **skipped, not safe** | `loyalty_accounts` has no user link, only `phone_key`. Its only policy is `staff_can(store_id,'customers')`, and `profiles.phone` is typed, not verified. F4 says that linking by a typed phone "would let anyone claim a stranger's points". Account points already appear in `/account` (LoyaltyPanel). |
| Recommendations | not built (out of scope by design) | — |

## Files changed

- `src/lib/activity.ts` (new): the pure helpers.
  - Kinds; normalisation of 10 raw shapes into one row type.
  - `needsCustomer` rules; primary and "again" next-action rules; the "again" rail.
  - `planReorder`, `parseCart`, `mergeCart`.
  - Date formatting in Beirut time with Western digits.
- `src/lib/__tests__/activity.test.ts` (new): 29 tests.
- `src/lib/data/activity.ts`: rewritten as a fetch-only layer (11 parallel reads, `cache()`); it re-exports the types.
- `src/lib/status-labels.ts`: new domains `eventTicket` and `jobApplication`; tones for stayBooking, rentalBooking, serviceRequest, marketListing, eventTicket and jobApplication; `ACTIVITY_DOMAINS` extended to all 10 kinds.
- `src/lib/__tests__/status-labels.test.ts`: `DB_VALUES` entries for the two new domains.
- `src/app/[lang]/(site)/activity/page.tsx`: all 10 kinds, the saved tiles, the messages tile and recently viewed.
- `src/components/activity-list.tsx`: type-aware cards, 11 tabs, the "again" rail and buttons, and the reorder sheet.
- `src/components/activity/reorder-sheet.tsx` (new).
- `src/components/reorder-button.tsx`: now opens the checked sheet. It also no longer serialises the whole dictionary.
- `src/app/[lang]/(site)/orders/[id]/page.tsx`: call-site props for ReorderButton only.
- `src/components/recently-viewed.tsx`: optional `currentId`, UUID filter, narrowed `dict`, optional `title`.
- `src/components/{wishlist,favorite,follow,listing-favorite}-button.tsx`: the `favorite_added` hook.
- `src/i18n/dictionaries/{ar,en}.json`:
  - One new top-level namespace, `activityCenter` (43 keys; `activity` already existed).
  - Inserted as one textual insertion before `"features"`; CRLF is preserved and both files pass `JSON.parse`.
  - The Arabic is Lebanese, matching the existing `activity` block.
- `supabase/migrations/0315_activity_center.sql` and `supabase/tests/0315_activity_center.test.sql` (new, **not applied, not run**).

## Not verified in a browser

- The signed-in activity screen: the cards, the rail, the reorder sheet and the saved tiles. It needs a signed-in customer with real rows. Creating a test account on the production database was out of bounds, so rendering, RTL and the 360px layout still need a check on a real phone.
- The reorder flow end to end: the cart merge followed by the store page picking the cart up.
- The `favorite_added` events actually landing in `product_events`. `track()` skips `navigator.webdriver`, so automation cannot prove it either.

**What was verified on `next dev -p 3284`:**
- `/ar/activity` and `/en/activity` compile, and anonymous visitors get `NEXT_REDIRECT … /ar/login?next=/ar/activity`.
- `/ar/orders`, `/ar/favorites`, `/ar/market`, a product page, a store page, a market listing and `/ar/orders/<uuid>` all compile and return 200 with no errors in the dev log.
- The server was killed with `taskkill /T` afterwards.

## Gates (verbatim)

```
npx tsc --noEmit
src/components/image-upload.tsx(157,9): error TS2304: Cannot find name 'privateBucket'.
src/components/image-upload.tsx(159,15): error TS2304: Cannot find name 'privateBucket'.
src/components/image-upload.tsx(214,14): error TS2304: Cannot find name 'privateBucket'.
TSC EXIT: 2
```

These three errors are all in `image-upload.tsx`, which belongs to the parallel privacy-fixes agent and is mid-edit. None of my files report errors.

```
npx eslint <15 touched files>
ESLINT EXIT: 0          (includes matjar/no-raw-directional-icon)

npx vitest run
 Test Files  66 passed (66)
      Tests  1355 passed (1355)
```

## CSV rows

```
issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P1-ACTIVITY-01|P1|activity|/[lang]/inquiries/[id], /[lang]/activity|real estate, automotive (leads)|Customer's own inquiries never appear in طلباتي and /inquiries/<own id> is a 404|leads has only leads_select_store (staff_can orders); no policy lets the customer read their own row (0190/0198)|Migration 0315 adds permissive SELECT leads_select_own to authenticated using customer_id = auth.uid(); rolled-back test with 16 checks|supabase/migrations/0315_activity_center.sql; supabase/tests/0315_activity_center.test.sql|written, NOT applied, test NOT run|3 production leads with customer_id are invisible to their authors|after apply: each customer reads only their own leads; staff unchanged|Code already reads leads; tab appears automatically after apply
P1-ACTIVITY-02|P1|activity|/[lang]/activity|all|طلباتي showed only orders, bookings, craft requests and inquiries; stays, rentals, event tickets, quote requests, job applications and Sunday Market listings were missing|Data layer covered 4 of the 10 customer tables|10 kinds, one parallel read each, embedded names, type-aware cards with their own status vocabulary and next action|src/lib/activity.ts; src/lib/data/activity.ts; src/components/activity-list.tsx; src/app/[lang]/(site)/activity/page.tsx|done (not browser-verified signed-in)|4 kinds|10 kinds|Freelance briefs have no table; linked through /messages
P1-ACTIVITY-03|P1|activity|all pages (tab badge)|all|The طلباتي badge counted every completed order and every accepted booking forever, so the customer could never clear it|needsCustomer ignored reviews and dates|Review asked only if the store is unreviewed and the order finished within 30 days; appointments only until their Beirut day; stays and rentals until checkout; quotes while quoted; crafts until rated|src/lib/activity.ts|done|badge grows without bound|badge = things the customer can act on|Unit-tested at a fixed instant incl. the Beirut midnight edge
P1-ACTIVITY-04|P1|activity|/[lang]/activity|all|Activity dates used the browser time zone and plain `ar`, so Eastern Arabic digits could appear|Intl.DateTimeFormat("ar") with no timeZone|formatInstant (Asia/Beirut, ar-LB-u-nu-latn); date-only columns formatted at UTC so they never shift a day|src/lib/activity.ts|done|browser zone, ٢٨|Beirut, 28|—
P2-RETENTION-01|P2|retention|/[lang]/orders/[id], /[lang]/activity|retail, food|"أعد الطلب" overwrote the whole store cart, blindly re-adding items that are switched off, sold out, have variants (charged at the base price) or are services|ReorderButton wrote the old lines straight into localStorage|Checked reorder sheet: current effectivePrice, price changes shown, stock-capped quantities, drop reasons, merged into the existing cart (max, not sum)|src/components/activity/reorder-sheet.tsx; src/components/reorder-button.tsx; src/lib/activity.ts|done (not browser-verified)|cart replaced, wrong items|only honest items, customer sees the diff|—
P2-RETENTION-02|P2|retention|/[lang]/activity|services, stays, rentals, crafts|No way back into a provider the customer already used|—|"Again" rail and per-card buttons: book again (?service= deep link), request again, hire the same tradesman again|src/lib/activity.ts; src/components/activity-list.tsx|done|—|one tap to the existing flow|No prefill beyond the service: those panels take no params
P2-RETENTION-03|P2|retention|/[lang]/activity|all|Saved products, followed stores, saved listings and recently viewed were not reachable from the main tab|—|Head-only counts linking to /favorites; the RecentlyViewed strip in read-only mode|src/app/[lang]/(site)/activity/page.tsx; src/components/recently-viewed.tsx|done|—|—|RecentlyViewed no longer 400s on corrupt localStorage ids
P2-RETENTION-04|P2|analytics|product, store, market pages|all|favorite_added was whitelisted in 0312 but never fired|No hook in the favorite buttons|One-line track() after a successful insert in 4 buttons|src/components/{wishlist,favorite,follow,listing-favorite}-button.tsx|done|0 events|event per add|ids and tokens only
P2-RETENTION-05|P2|retention|/[lang]/activity|all|Loyalty cards shown in activity|loyalty_accounts is keyed by phone_key with no user link; profile phone is unverified|Skipped on purpose (F4: linking by a typed phone lets anyone claim a stranger's points)|—|won't do (safety)|—|—|Account points remain in /account
```
