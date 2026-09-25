# F2 — WhatsApp action buttons (all plans, zero recurring cost)

Branch `feat/zero-subscription-features` (HEAD 3f09325). Nothing committed, pushed or deployed. **Migration 0309 is written and NOT applied.** No write of any kind went to the production database; the only database access was read-only `SELECT`s against `wesihatopiznatsyfxer`, used to learn the schema (staff_can, enum values, column nullability, the order triggers, and `get_guest_order`).

Every action is a free `https://wa.me/<number>?text=<encoded>` link. The merchant taps it, WhatsApp opens with the text filled in, and the merchant presses send from their own phone. There is no WhatsApp Business API, no SMS and no provider.

## Where each button lives

| Button | Screen | When it shows |
|---|---|---|
| «تأكيد الطلب» (order_confirmation) | Merchant orders list, on each order card: `merchant/[storeId]/orders`, via `orders-filter.tsx` → `OrderWaActions`. There is no separate order-detail page; the card is the detail view. | pending, accepted, preparing, ready, out_for_delivery |
| «تحديث الحالة» (order_status) | Same card | Every status |
| «اطلب تقييم» (review_request) | Same card | Status `completed` only. Disabled, with the reason shown, on guest orders: the review form at `/[lang]/orders/[id]` needs the customer's account. |
| «تذكير بالسلة» (abandoned_cart) | New page «سلات متروكة» at `merchant/[storeId]/abandoned-carts`, linked from the orders page header | Each cart, with an optional picker for coupons that can be redeemed now |
| «تأكيد الموعد» (booking_confirmation) | `merchant/[storeId]/bookings`, on each booking | pending, accepted, scheduled |
| «تذكير قبل بيوم» (booking_reminder) | Same | accepted or scheduled, with a date of today or later (Beirut time) |
| «ذكّرو عالواتساب» (debt_reminder) | Ledger customer page `merchant/[storeId]/ledger/[customerId]`. The button already existed. | Unchanged: disabled when there is no dialable number or nothing is owed |

**Every tap is logged** to `wa_action_log`. The insert is fire-and-forget: it is never awaited and fails silently, so it cannot block WhatsApp from opening. Each button then shows «آخر إرسال: من 3 أيام», and reads «هلّق» straight after a tap. The Arabic plural shapes are handled: من يوم / من يومين / من 3 أيام / من 11 يوم.

**Message language** is a separate setting, «لغة الرسالة» (عربي / English). It defaults to the dashboard language, is remembered on the device, and one switch changes it for every button on every screen. The ledger uses the same setting, so its default behaviour does not change.

**Links in messages point only at pages that exist:**
- Guest order: `/[lang]/track/[id]`. The customer confirms with their phone, through `get_guest_order`, which only serves guest orders.
- Account order: `/[lang]/orders/[id]`. This is also where the review form is.
- Booking: `/[lang]/bookings/[id]`, for account bookings only. For a guest booking, the link line is dropped.
- Cart: the store page (`/[lang]/<slug>` or `/[lang]/store/[id]`). The cart is kept in the customer's own browser, so no link can honestly reopen it. The screen says this.
- Ledger: the existing statement link.

## Templates: default Arabic text

The defaults are in `src/lib/wa-templates.ts` (`DEFAULT_WA_TEMPLATES`). Each one has an English version too.

- **order_confirmation**: `مرحبا {customer_name}،` / `معك {store_name}. وصلنا طلبك {order_number} وتأكّد.` / `{items}` / `المجموع: {total}` / `التوصيل المتوقّع: {eta}` / `فيك تتابع طلبك من هون: {link}` / `شكراً إلك!`
- **order_status**: `مرحبا {customer_name}،` / `طلبك {order_number} من {store_name} صار: {status}` / `فيك تتابع طلبك من هون: {link}`
- **review_request**: `مرحبا {customer_name}،` / `شكراً إنك طلبت من {store_name}! رأيك بيهمّنا كتير.` / `قيّمنا من هون، ما بياخد دقيقة: {link}`
- **abandoned_cart**: `مرحبا {customer_name}،` / `معك {store_name}. لاحظنا إنو طلبك ما كمل:` / `{items}` / `المجموع التقريبي: {total}` / `كود حسم إلك: {coupon}` / `إذا حابب تكمّل، نحنا هون: {link}`
- **booking_confirmation**: `مرحبا {customer_name}،` / `معك {store_name}. تأكّد موعدك:` / `{service}` / `التاريخ: {date}` / `الساعة: {time}` / `تفاصيل الموعد: {link}` / `منستناك!`
- **booking_reminder**: `مرحبا {customer_name}،` / `تذكير من {store_name} بموعدك:` / `{service}` / `التاريخ: {date}` / `الساعة: {time}` / `إذا في شي تغيّر، خبّرنا. منستناك!`
- **debt_reminder**: word for word the ledger's existing reminder, with the variables renamed. A test proves the output is identical: `مرحبا {customer_name}، معك {store_name}. حبّينا نذكّرك إنو المبلغ المسجّل عالدفتر: {balance}. فيك تشوف كشف حسابك هون: {link}` / `شكراً إلك.`

**Variables:**
- `{customer_name}`, `{store_name}`, `{link}`: all templates.
- `{order_number}`: `#` plus the first 8 characters of the id. This is the reference the order list and the confirmation screen already show, never the raw UUID.
- `{total}`: `$25 (≈ 2,237,500 ل.ل.)`. The LBP part uses the live `app_settings` rate and is left out when no rate is set.
- `{items}`: one `• name ×2` line per item.
- `{eta}`: only from real data: the order's `scheduled_for`, or its delivery zone's `eta_min/max_minutes`. Otherwise the line is dropped.
- `{status}`: the status in customer wording.
- `{balance}`: per currency, never converted.
- `{service}`, `{date}`, `{time}`: bookings.
- `{coupon}`: carts.

**Rendering rules (tested):**
- A missing value **drops the whole line it sits on**, so no raw `{var}` is ever sent and nothing is invented. `{customer_name}` is the one exception: it empties quietly, so «مرحبا {customer_name}،» becomes «مرحبا،».
- An unknown or typo'd variable is dropped when sending. In the editor preview it is shown highlighted with a warning instead.
- If an override drops to nothing, the default is used.
- **Length guard:** the whole wa.me URL is kept at or under 1,900 characters, below the ~2,000 where some clients cut the URL. The guard works in this order:
  1. It lists fewer items and adds a "+ N غيرن" line.
  2. It drops trailing lines, but never the line with the link.
  3. As a last resort it cuts the text at a code point boundary and ends it with "…".
  
  A shortened message shows «الرسالة كانت طويلة، قصّرناها…».

## Migration 0309 (written, NOT applied)

File: `supabase/migrations/0309_whatsapp_actions.sql`. 0309 is the next free number after 0308. Production's latest applied migration is 0306, so 0307 and 0308 are pending as well.

- **`store_wa_templates`** `(store_id, key, locale 'ar'|'en', body, updated_at, updated_by; unique(store_id,key,locale))`.
  - Holds overrides only; deleting a row is "reset to default".
  - CHECK constraints restrict the 7 keys and 2 locales; `body` must be 1–1,000 characters after trimming.
  - A trigger stamps `updated_at`/`updated_by` from `auth.uid()` and trims the body.
  - RLS: **any member of the store may read** (`can_manage_store`), because staff buttons need the wording. **Only the owner may write** (`is_store_owner`), matching settings being owner-only.
  - Grants: nothing to anon.
- **`wa_action_log`** `(id, store_id, key, target_type 'order'|'booking'|'cart'|'ledger_customer', target_id, actor_id default auth.uid(), created_at)`.
  - **Insert and select only.** There is no update/delete grant and no policy for either.
  - A CHECK constraint ties each key to its target type.
  - Read and insert are both `staff_can(store_id, perm)`, where perm is **orders** for order/cart, **bookings** for booking, and **customers** for ledger_customer. These are the same keys `checkout_intents` (0291) and the ledger (0307) already use.
  - An insert must also pass these checks:
    - `actor_id = auth.uid()`.
    - `created_at` is within ±5 minutes, so no backdating.
    - The target exists in the same store and is visible to the caller under their own RLS.
  - `target_id` has no FK on purpose. It is polymorphic, and a cart row is deleted when it converts.
- **`wa_phone_key(text)`**: an immutable, invoker helper. It matches `phoneKey()` in TS: digits only, strips `00` and `961`, strips the trunk zero. Keserwan `09…` is handled correctly.
- **`store_abandoned_carts(p_store_id)`**: `SECURITY DEFINER`, `search_path=''`, revoked from public/anon/authenticated, then granted to authenticated.
  - It checks `staff_can(p_store_id,'orders')` and raises `42501` otherwise.
  - It returns intents last touched **between 1 hour and 14 days ago** with **no order from the same phone at that store since the cart was last touched**. Phones are compared through `wa_phone_key`, so format differences cannot hide a conversion.
  - I used `updated_at` rather than `created_at`. A cart re-armed today, after an order three weeks ago, is a new abandonment, and an order after the latest attempt is a recovery. A recovered cart drops off the list on its own.
  - Items are priced at **current** catalogue prices; a live discount below the price wins. Lines whose product is gone, or whose id is malformed, get `unit_price null` and are counted in `unpriced_items`, never guessed.
  - It also returns `last_wa_at`.
- `npm run check:migrations`: PASS, no new violation.

**Verification script:** `supabase/tests/0309_whatsapp_actions.test.sql`.
- It is one `begin … rollback`, with the migration spliced in verbatim and results collected into temp table `r`.
- It runs about 45 checks as five actors: owner A, staff with **only** `orders`, staff **without** `orders` (bookings + customers), store B's owner, and anon.
- The fixtures cover six carts: fresh, stale, recovered via `+961 76 333 444`, an old order that is not a recovery, a malformed-items cart, and store B's cart. They also include a product with a discount, a gone product, and a malformed product id/quantity.
- **It has not been run.** Per the database rule, not even a rolled-back transaction was executed. No local Postgres is available to syntax-check it, so the first run by the owner is also its first parse. Check the `ALL CHECKS` row.

**Before 0309 is applied, the code degrades gracefully:**
- Buttons use the default text from code.
- The log insert fails silently and «آخر إرسال» stays hidden.
- The template editor still previews but says saving waits on the database update («حفظ النصوص بيشتغل بعد ما يتفعّل تحديث قاعدة البيانات»).
- The abandoned-carts page falls back to computing the same rule in TS (`isAbandonedCart`, `priceCart`) from `checkout_intents` + `orders` + `products`, under the caller's own RLS.

## Checkout: no change, on purpose

`record_checkout_intent` fires **only when the customer taps «تأكيد الطلب»**, after the phone passes the `tooShort` check. It is awaited for at most 1.5 s, before the order insert whose trigger deletes the intent. So the brief's condition is met: it fires "only on submit". **I did not move it earlier:**

- **Audit finding MP-007** (privacy, high, marked fixed) was specifically the on-blur capture: sending phone, name and cart to the merchant before any order, with no disclosure. It was fixed by moving capture to the confirm tap. Migration 0278 also sizes its rate limits on "one intent per tapped confirm button".
- **What customers are told today.** The phone field (`store.checkoutPhoneNote`) says «لمّا تأكّد الطلب، رقمك وسلّتك بيوصلو لهيدا المتجر ليقدر يتابع معك طلبك.» The privacy page (`(site)/privacy/page.tsx`) says the number, name and cart are recorded "when you tap the button to place an order … even if the order then fails or you close the page … so the store can follow up … usually on WhatsApp."
- Capturing earlier would make both statements false. That would be tracking the published policy does not describe, which the brief rules out. Changing the policy is the owner's decision.

**What this means for the list.** «سلات متروكة» shows customers who tapped confirm but whose order never arrived: a failed placement, a network drop, a tab closed mid-submit, or a rejected coupon or zone. It does not show people who typed a number and left.

**If the owner wants capture at phone entry:** first update `checkoutPhoneNote` (AR + EN) and the privacy page (both locales) to say the number and cart go to the store once typed. Then capture on blur of a `phoneIssue(...) === null` number in `checkout-form.tsx`. That is about a 10-line change; the RPC and its rate limits already tolerate re-arming the same (store, phone).

The list shows the customer-facing disclosure in a note: «الزبون بيعرف: تحت زر التأكيد مكتوب إنو رقمو وسلّتو بيوصلو للمتجر ليتابع معو، وهيك مكتوب بسياسة الخصوصية.»

## Tier

`whatsappActions` is registered in `src/lib/feature-availability.ts`: `state: "live"`, `plan: "free"`, and its own copy through the ledger/feed label mechanism (`copy: { label: "waActions.feature.label", … }`, added to `OwnCopyFeatureId`). No screen, button or database object has a plan check.

## One wa.me builder

`src/lib/phone.ts` now exports `waUrl(digits, text?)`, the single place the wa.me URL format is written. `phone.waLink`, `whatsapp.waLink` and `wa-templates` all call it.
- `whatsapp.waLink` stays as a documented compatibility wrapper, so its seven callers are untouched. It keeps its never-null contract: bare digits for an undialable number, and `""` for WhatsApp's own chat picker, which `order-dispatch` uses.
- One small difference: with empty text it now emits no `?text=` instead of an empty `?text=`. WhatsApp treats the two the same.

## Files changed

**New**
- `src/lib/wa-templates.ts`: pure keys, defaults, rendering, length guard, values, phoneKey, cart eligibility, pricing, coupons, plurals.
- `src/lib/wa-actions-server.ts`: defensive loaders for the templates and the latest tap per target.
- `src/lib/__tests__/wa-templates.test.ts`: 36 tests.
- `src/components/wa-actions/wa-client.ts`: message-language store, origin, minute clock, «آخر إرسال» formatting, fire-and-forget log.
- `src/components/wa-actions/wa-action-button.tsx`: the `<a href>` button and the language toggle.
- `src/components/wa-actions/order-wa-actions.tsx`: the order-card row.
- `src/components/wa-actions/booking-wa-actions.tsx`: booking confirmation and reminder.
- `src/components/wa-actions/abandoned-carts-list.tsx`: the carts list with the coupon picker.
- `src/components/wa-actions/wa-template-editor.tsx`: the settings editor (AR/EN tabs, chips, live preview, save, reset).
- `src/app/[lang]/(dashboard)/merchant/[storeId]/abandoned-carts/page.tsx`: «سلات متروكة» (owner, or staff with `orders`).
- `src/app/[lang]/(dashboard)/merchant/[storeId]/settings/whatsapp/page.tsx`: the template editor page (owner only).
- `supabase/migrations/0309_whatsapp_actions.sql`: the migration. Not applied.
- `supabase/tests/0309_whatsapp_actions.test.sql`: the rolled-back verification. Not run.

**Modified**
- `src/components/orders-filter.tsx`: WhatsApp row on each order card, plus `customer_id` and `delivery_zone_id` on the card type.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/orders/page.tsx`: selects `customer_id` and `delivery_zone_id`; loads templates, rate, last taps and zone ETAs; adds the «سلات متروكة» link.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/bookings/page.tsx`: booking buttons and the message-language toggle.
- `src/components/ledger/ledger-customer.tsx`: the reminder renders from the `debt_reminder` template, logs the tap, and shows «آخر إرسال». Otherwise unchanged.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/ledger/[customerId]/page.tsx`: loads the reminder template and the last tap.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/settings/page.tsx`: a link card to the template editor.
- `src/lib/feature-availability.ts`: the `whatsappActions` entry.
- `src/lib/phone.ts`: the `waUrl` builder.
- `src/lib/whatsapp.ts`: `waLink` delegates to `waUrl`.
- `src/i18n/dictionaries/ar.json` and `en.json`: one new top-level namespace `waActions` each (+115 lines), inserted textually before `  "features": {`. CRLF was preserved, the diff is insertion only, and both files pass `JSON.parse`.

## Not browser-verified

None of the new or changed screens were opened in a browser. They all sit behind a merchant login, and I do not sign in with credentials, so nothing was checked visually. That covers: the orders card buttons, the bookings buttons, the ledger reminder, «سلات متروكة», and the template editor, in both locales and in RTL. The `<a href>` hand-off to the WhatsApp app on a real phone, and how well Arabic reads inside WhatsApp, need a real device. Everything that is verified is verified by the type checker, the unit tests and lint below.

## Gates (verbatim)

```
== tsc
tsc exit 0
== vitest
 Test Files  55 passed (55)
      Tests  1011 passed (1011)
== eslint (touched files)
C:\Users\m-cha\Documents\gh\matjar\src\app\[lang]\(dashboard)\merchant\[storeId]\bookings\page.tsx
  203:29  warning  'waNum' is assigned a value but never used  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
eslint exit 0
== check:migrations
PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
== dictionaries
ar json ok
en json ok
```

The one lint warning (`waNum` in the bookings page) was already there at HEAD. It is not from this change.
