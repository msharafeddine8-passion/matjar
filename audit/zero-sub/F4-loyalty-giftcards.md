# F4 — Loyalty stamps and gift cards (Pro and Business)

Branch `feat/zero-subscription-features`. Nothing was committed, pushed or deployed.
**Migration 0310 is written but NOT applied.** No write reached the production
database: every query I ran there was a read-only `SELECT` (live function
definitions, column lists, trigger lists).

Zero recurring cost. There is no loyalty app, no gift-card app, no SMS, no WhatsApp
API and no AI. A card is a server-rendered page behind an unguessable link. The
merchant sends that link from their own phone as a `wa.me` link built with the
shared `waUrl`.

---

## 1. Data model: the brief compared with what exists

| Brief proposal | What was built | Why |
|---|---|---|
| `loyalty_programs` | **New.** One row per store (PK `store_id`). `kind` = `stamps` or `points`, `is_active`, `stamps_required` (2–50), `stamp_scope` = `order`/`product`/`section` (a section is this repo's product category, `store_sections`), `points_per_usd` (1–100), `redeem_threshold`, and the reward text in AR and EN. | No store-level program existed. Only the redemption opt-in did. |
| `loyalty_accounts` | **New.** One member of one store, keyed by `wa_phone_key(phone)` (from 0309), `unique(store_id, phone_key)`, plus a 144-bit card `token`. | The existing ledger is keyed to a signed-in **user**, so a walk-in customer or a guest could never earn. |
| `loyalty_events` | **New, append-only.** Stamps and points for phone accounts: reason `order`, `pos`, `adjust` (a note is required), `reward` or `reversal`. Partial unique indexes allow at most one earn per order and one per POS sale. | This holds only what the user ledger cannot hold. |
| (the points system) | **Reused and not duplicated.** `loyalty_ledger`, `redeem_loyalty_points`, checkout redemption (0110), `loyalty_redemption_enabled` / `loyalty_points_per_unit` and the 0220 refund are unchanged. `award_loyalty_on_complete` is restated from the live definition with one changed line (the store's earn rate, §2). | No second points system. The same store rate applies to both holders. |
| `gift_cards` | **New.** A 12-character `code` (the spending credential) and a separate `token` (a view-only link). `currency` is USD or LBP, plus `initial_amount`, `balance` (a check keeps it between 0 and `initial_amount`), `expires_on`, `status` = `active`/`void`, and the recipient's name. | — |
| `gift_card_redemptions` | **New, append-only.** Rows are `redeem` or `refund` (a refund points back to its redemption through a unique `refund_of`). It stores the amount in the card's currency, `amount_usd`, the `fx_rate` used, and `order_id` / `pos_sale_id` / `order_payment_id`. | — |

Coupons are untouched.

## 2. How phone accounts relate to the existing user ledger

The rule is **one holder per purchase**, so nothing can be counted twice:

* **Stamps program.** Every completed order that has a phone adds stamps to that phone's card, whether the buyer was signed in or a guest. So does every POS sale where the cashier types a phone. `loyalty_ledger` never holds stamps. Signed-in shoppers still earn their account points exactly as before.
* **Points program.**
  * An order **with** an account (`customer_id` set) earns in `loyalty_ledger`, as it always has, and can be spent at checkout (0110).
  * An order **without** an account (a guest) earns on the **phone** card, and so does a POS sale.
  * The phone path skips any order that has a `customer_id`. The test proves an account holder's order adds 60 to the ledger and 0 to the phone card.
* **Earn rate.** The merchant's "X points per $1" is `loyalty_points_rate(store)`. It equals the program's rate while a points program is active on Pro or Business, and 1 in every other case. So a store without a program earns exactly 1 point per $1, as before (the test checks this). The one changed line in `award_loyalty_on_complete` is marked `-- 0310`.
* **The honest limit.** A signed-in customer who also shops in the store sees two balances: online points in `/account` and in-store points on the card. Merging them would need a **verified** phone on the profile, which the platform does not have. Linking by a typed phone would let anyone claim a stranger's points.

## 3. Award and redeem hooks (file, and what changed)

| Hook | Where | Change |
|---|---|---|
| Online earning | DB trigger `orders_loyalty_card_award`: `AFTER UPDATE OF status … WHEN (new.status='completed' AND old.status IS DISTINCT FROM 'completed')` | Only when an order completes; pending orders never earn. Completed orders are final (0246), so no reversal is needed. It is wrapped so a loyalty error can never block completing an order. |
| Account-holder points rate | `award_loyalty_on_complete` (restated) | One line: `floor(total) * loyalty_points_rate(store_id)`. |
| POS earning | `src/components/pos-terminal.tsx` + new `src/components/loyalty/pos-extras.tsx` | The terminal now reads the sale id that `pos_record_sale` already returned. **After** the sale is recorded it calls `loyalty_credit_pos_sale(sale, phone)`: idempotent, and only within 24 h. Two optional fields were added (a customer phone and a gift code), plus a result line that includes the «أرسل بطاقة الولاء» link. `pos_record_sale` is unchanged. |
| POS page config | `merchant/[storeId]/pos/page.tsx` | Reads the program kind and `store_accepts_gift_cards` (both fail softly) and passes `extras`. |
| Checkout gift card | `src/components/checkout/checkout-form.tsx` (+ new `src/components/gift-cards/checkout-gift-card.tsx`) | One import, one state, one field rendered when `store.acceptsGiftCards` is true, and one call **after** the order exists: `redeem_gift_card_order`. It never throws; its result goes into `PlacedOrder.giftCardNote`. The place-order RPCs are not changed. |
| Confirmation | `src/components/checkout/order-placed.tsx` | Renders `giftCardNote`: what the card paid and what is left to pay, or why the card could not be applied. |
| Checkout context | `src/lib/checkout.ts` (optional `acceptsGiftCards`), `src/lib/data/checkout.ts` | Adds one `rpc('store_accepts_gift_cards')` to the cached read. An error returns false, so there is no field before the migration. The cache tag is refreshed when a card is issued or voided (`gift-cards/actions.ts`, owner-checked). |
| Deleted POS sale | DB trigger `pos_sales_reverse_extras` (BEFORE DELETE) | Puts the gift-card amount back on the card. Takes the sale's stamps or points back off the member, but never below zero. |
| Cancelled or rejected order | DB trigger `orders_gift_card_refund` | Puts every redeemed amount back on its card and writes the matching `order_payments` refund, exactly once per redemption. |

## 4. Gift-card currency rules

* A gift card is **tender, not a discount**. Redeeming it writes an `order_payments` row (method «بطاقة هدية · Gift card», amount in USD). `orders.total` is never rewritten, so every report still reads the amount of record, and the merchant sees what has been paid and what is left to collect.
* A **USD card** pays USD one for one.
* An **LBP card** is converted at the rate saved on **the order or POS sale** (`fx_rate`, 0209), never today's rate and never a rate the browser sends.
  * With no saved rate the redemption is refused (`no_rate`).
  * The card is debited in whole pounds: `round(due × rate)`.
  * A card that covers everything pays exactly what is due.
  * A card that covers only part credits `trunc(lbp / rate, 2)` USD. That rounds in the merchant's favour by less than one cent and never takes more from the card.
* The report splits issued, redeemed, outstanding, expired-balance and voided-balance **per currency**. USD and LBP are never added together. For LBP it shows the "≈ USD at today's rate" figure as information only.
* An expiry date runs to the end of that day in Asia/Beirut time.

## 5. Race safety

The order (or POS sale) row is locked `FOR UPDATE` first, then the card row is locked `FOR UPDATE`, then one `UPDATE gift_cards SET balance = balance - x WHERE id = … AND balance >= x AND status = 'active'` does the debit. Two checkouts spending the same card queue on the card lock; the second sees the reduced balance. The lock order is always order or sale first, then card, so the two paths cannot deadlock.

The test simulates a stale balance, where the caller holds 39 but the row is already at 0, and the `UPDATE` guard refuses it (`card_empty`).

Loyalty adjustments and rewards lock the member's row, so two taps cannot hand out two rewards. A balance can never go below zero.

## 6. Plan enforcement (Pro and Business)

* **Registry.** `loyaltyStamps` and `giftCards` were added to `FEATURES`, using the own-copy label mechanism (`loyaltyCards.feature.*`), at `plan: "pro"`.
* **Screens.** Both screens call `hasPlan(effectivePlan(plan, trial), "pro")`. Below Pro they show `ProGate`. A downgraded store still sees its existing gift cards and can void them.
* **Database.** `store_plan_is_pro()` reads `stores.plan` and `trial_ends_at` **from the row inside a separate RPC**. The 0308 "claim a plan in the same UPDATE" trick cannot apply: nothing here is a trigger on `stores`, and browsers cannot write `stores.plan`.
  * **Checked:** configuring a program, adding members, adding stamps or points by hand, issuing a card, and automatic earning (which pauses below Pro).
  * **Not checked:** redeeming a gift card, giving a reward, correcting a balance down, voiding a card. That money or reward is already the customer's.

## 7. Permissions

| Action | Who |
|---|---|
| Program settings; issue, void or list gift cards (the list shows every code) | **Owner only** |
| Members, card links, manual adjustments, giving rewards | Owner, or staff with `customers` |
| POS: attach a phone to a sale; redeem a code at the till | Owner, or staff with `orders` **or** `pos` (the POS screen opens on `orders`; `pos_sales` RLS uses `pos`) |
| One card or gift card by token; checking a code at a store; redeeming on the guest order it just placed | anon |

A signed-in customer's order can be paid by code only by that customer. Payment by code is allowed only on an order that is **pending and at most 30 minutes old**. A code from another store answers "not found", exactly like an unknown code.

## 8. Migration 0310 (written, NOT applied)

`supabase/migrations/0310_loyalty_giftcards.sql`

* **Tables:** the five new tables above, with RLS on. Browsers get no insert, update or delete grants; `authenticated` gets select only, filtered by policy. Every foreign key is indexed.
* **Definer functions:** 18 SECURITY DEFINER functions, all with `search_path = ''` and an explicit `revoke … from public, anon, authenticated` / `grant`.
* **Internal helpers:** `store_plan_is_pro`, `loyalty_points_rate`, `loyalty_account_upsert`, `loyalty_earn`, `gift_card_debit`, `gift_code_normalize`. They are SECURITY INVOKER with browser `EXECUTE` revoked.
* **Codes:** 12 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I), 60 random bits from `gen_random_bytes`, one byte masked to 5 bits per character (uniform, because 32 divides 256). Printed `XXXX-XXXX-XXXX`.
* **Tokens:** 144 bits, the same shape as 0307's.
* **Idempotent:** every statement uses `if not exists` / `create or replace` / `drop … if exists`.

**Verification script:** `supabase/tests/0310_loyalty_giftcards.test.sql`.
* It follows the 0307/0309 structure: `begin;` → the migration pasted verbatim between the `-- ==== MIGRATION 0310 (verbatim) ====` / `-- ==== END MIGRATION 0310 (verbatim) ====` markers → fixtures → temp table `r (n, check_name, ok, got)` → `ALL CHECKS` → `rollback;`.
* It runs **113 checks** acting as owner A, staff (customers), staff (orders), owner B, the signed-in customer and anon, plus a downgrade scenario.
* **Local pre-flight.** I ran the exact file in PGlite against a hand-written **stub** of the schema: 113 of 113 passed, `ALL CHECKS | 0 failed of 113`. The stub is not production: it lacks the real triggers such as notifications, CRM capture and automations. The production rolled-back run is still yours to do.

## 9. Files

**New**
- `supabase/migrations/0310_loyalty_giftcards.sql`, `supabase/tests/0310_loyalty_giftcards.test.sql`
- `src/lib/loyalty.ts`, `src/lib/gift-cards.ts`, `src/lib/__tests__/loyalty.test.ts`, `src/lib/__tests__/gift-cards.test.ts` (40 tests)
- `src/components/loyalty/loyalty-manager.tsx`, `src/components/loyalty/pos-extras.tsx`
- `src/components/gift-cards/gift-card-manager.tsx`, `src/components/gift-cards/checkout-gift-card.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/loyalty/page.tsx`
- `src/app/[lang]/(dashboard)/merchant/[storeId]/gift-cards/{page.tsx, actions.ts, [cardId]/print/page.tsx}`: the print page shows the logo, amount, code and a QR code to the balance page, and prints through the browser.
- `src/app/[lang]/loyalty/[token]/page.tsx`, `src/app/[lang]/gift/[token]/page.tsx`: public pages that are noindex and no-referrer, server-rendered with no client JavaScript, and give a real 404 for an unknown token. **No `loading.tsx`.**

**Edited (minimal)**
- `src/lib/feature-availability.ts`: 2 ids added to `FeatureId`, 2 added to `OwnCopyFeatureId`, and 2 `FEATURES` entries placed after the other agent's `quickPanel`.
- `src/i18n/dictionaries/{ar,en}.json`: one `loyaltyCards` namespace per file, inserted textually just before `  "features": {`. CRLF is preserved, the AR and EN key trees are identical, the files pass `JSON.parse`, and the diff contains only insertions.
- `src/components/checkout/checkout-form.tsx`, `src/components/checkout/order-placed.tsx`, `src/lib/checkout.ts`, `src/lib/data/checkout.ts`: see §3.
- `src/components/pos-terminal.tsx`, `merchant/[storeId]/pos/page.tsx`: see §3.
- `merchant/[storeId]/coupons/page.tsx` (**nav entry**): two link cards, «بطاقة الولاء» and «بطاقات الهدايا». I put them there, not in `src/lib/sectors.ts`, because a new `OsModuleKey` needs labels in the `os` / `merchant` dictionary namespaces and exhaustive label maps in the merchant layout, bottom nav and OS home, all outside my territory. The coupons screen is the owner's Pro marketing screen, the same audience and plan floor. Staff with `customers` reach `/loyalty` by URL, and the till reaches both features from the POS itself.
- `src/components/loyalty-panel.tsx`: **not changed**. Phone points never write to `loyalty_ledger`, so the account panel's history labels stay correct.

## 10. What was not verified in a browser

* **Checked by HTTP only.** Against the dev server another agent already had running (port 3282):
  * `/ar/loyalty/<token>`, `/en/gift/<token>` and malformed tokens return a **real 404**. Before 0310 is applied, that is what every token gets.
  * `/ar/merchant/<id>/{loyalty,gift-cards,gift-cards/<id>/print,pos,coupons}` compile and redirect to login (307).
  * A live store page renders 200 with the updated checkout.
* **Not seen at all.** Nothing was seen signed in: the program form, members, issuing, the printed card, the gift field at checkout, the POS fields and the filled card pages all need the migration applied and a Pro merchant session. RTL layout, the printed card's size on paper, and the QR scan need a real device and a real printer.

## 11. Gates (verbatim)

```
$ npx tsc --noEmit
(no output — clean)

$ npx vitest run
 Test Files  59 passed (59)
      Tests  1122 passed (1122)

$ npx eslint <every file listed in §9>
(no output — clean)

$ npm run check:migrations
PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
```

## 12. Before or after you apply

1. Run `supabase/tests/0310_loyalty_giftcards.test.sql` (rolled back) and expect `ALL CHECKS | 0 failed of 113`, then apply 0310.
2. `get_advisors` (security and performance) after applying.
3. Known limits worth deciding on later:
   * A POS sale paid partly by gift card still has `pos_sales.payment_method = 'cash'`. The card part lives in `gift_card_redemptions`, so "cash taken today" on the POS screen overstates cash by the gift-card amounts.
   * A cancelled order that is later reactivated is due in full; its card credit was already returned.
   * Card links cannot be rotated yet. There is no revoke, unlike the 0307 statement links.


## Applied to production (2026-09-28)

Rolled-back run first (migration + fixtures + assertions in one uncommitted transaction), a follow-up read confirmed nothing persisted, then apply_migration:

| migration | checks |
|---|---|
| 0310 loyalty & gift cards | 113 / 113 |
| 0311 import | 22 / 22 |
| 0312 attribution & events | 55 / 55 |
| 0313 market moderation & review trust | 51 / 51 |

After apply: existing loyalty_ledger rows unchanged (5), orders (7) and listings (12) unchanged, 2 of 5 store reviews now verified_purchase (both backed by a completed purchase), 0 product reviews lost their flag. Supabase security advisor: no finding names any new object.
