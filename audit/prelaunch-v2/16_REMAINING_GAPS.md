# 16 — REMAINING GAPS (2026-09-28)

## Done on 2026-09-28
- **Deployed.** `main` at 0f76179 (merge of `feat/zero-subscription-features`), Vercel production READY; key pages checked live.
- **0314 applied right after the deploy** (privacy: private store columns, verification scans, licence number, internal order note, closed-job applications). Rolled-back test first: 74/74 checks. Live re-check after applying: home, explore, search, 5 storefronts, jobs, market, pricing, sitemap all 200; no production runtime errors or warnings.
- **0315 applied** (customers can read their own inquiries). Rolled-back test first: 16/16 checks.
- Supabase security advisor after both: no ERROR-level findings; `store_private_fields` appears under "SECURITY DEFINER executable by authenticated" by design (it returns rows only to the owner, staff or an admin).

## Post-launch cleanups (2026-09-28, branch feat/post-launch-cleanups)
- **Beirut day everywhere.** Twelve places took "today" from UTC (`setHours(0)` on the server, `toISOString().slice(0, 10)` in the browser), so from 00:00 to 03:00 Beirut: POS "today's sales" and the merchant dashboard's "today" count left out those sales, the deal of the day showed yesterday's pick, "deal today" saved yesterday's date, and date pickers still offered yesterday as the minimum. All now use `beirutToday` / `beirutYmd` (lib/quick-panel.ts).
- **Gift-card links can be replaced (0316).** `rotate_gift_card_link`, owner only; the old `/gift/<token>` 404s; code and balance are unchanged. Rolled-back test 12/12, then applied. «رابط جديد» button on each card.
- The POS gift-card "cash" note in F4 is moot: no screen reports cash-by-method; the POS header shows total sales, which correctly include card-paid sales.
- Jobs: the job page sends only the `jobs` and `auth` dictionary slices; the nav/home count and the sitemap now use the board's own predicate (not deleted, deadline not passed).
- Trust: the admin "verify" toggle is removed (it set a flag nothing records and fed the «موثّق» filter count); the verifiedBadge evidence string now names the real pipeline.
- Subscription upsell: "unlimited orders" (true on every plan), "higher search visibility" and "better support" removed; the copy now lists only checkable Pro facts, with the numbers filled from plan-tiers.
- Two tests failed only on a Windows CRLF checkout (sitemap bound check, 0314 verbatim check); both now normalise line endings.

## Waiting on the owner
1. **Google Merchant Center:** Matjar must claim matjarlb.com in one multi-client account before merchant feeds can be approved. The Meta catalog works without it.
2. **Merchants' own data:** 4 stores without an area, 3 without a logo or cover, 3 retail stores without products; no store has a return policy yet.
3. The Supabase secret key pasted in chat earlier: revocation never confirmed.

## Known gaps (not built, by design or for lack of data)
- Cuisine, clinic specialties, insurance, amenities, FAQ, next availability: no data exists; shown only when merchants fill them.
- «انشر مشروعك» public board and job alerts: no backend; not faked.
- Phone verification for Sunday Market: needs an SMS/OTP provider, which conflicts with zero cost.
- Loyalty balances of the same person in the app and in the shop stay separate until phones are verified.
- Unused pricing keys left in the dictionaries (P2-PRICE-10).

## Privacy follow-ups (2026-09-29, branch feat/review-privacy)
- **Review authors are private (P3-PRIV-05).** 0319 adds `my_store_review`, `has_reviewed_product`, `my_reviewed_store_ids` and `save_store_review` (definer, caller-only; the last restates the old RLS insert rules); the app uses them instead of reading or filtering on `customer_id`. 0320 then withdraws `reviews.customer_id`, `reviews.reply_by` and `product_reviews.customer_id` from signed-in users, as anon already had. Rolled-back test of both together: 22/22. 0319 applied before the deploy, 0320 after it (the previous build filtered on the column).
- **No email as a name.** `conversation_peer` / `my_conversations` return no name instead of the other person's email (0319), and the screens say «محادثة» (the old fallback to the store's name showed an owner their OWN shop). Review, product-review and product-question forms published `full_name ?? email`: they now publish a name or nothing (`src/lib/public-name.ts`; the card shows «زبون»). No stored name contained "@".

## Owner decisions applied (2026-09-29, branch feat/owner-decisions)
- **Real estate:** «المواعيد قريباً» is gone — appointments were removed from the sector's bundle; viewings stay on the live lead form (P0-FEAT-12).
- **Private Sunday Market sellers:** «راسل البائع» on an active listing without a store opens an in-app conversation (0317 `start_listing_conversation`); the thread starts with a draft naming the listing. No phone number changes hands. Rolled-back test 16/16, applied.
- **Renew cooldown:** once every 7 days (0317 `guard_listing_write`); a sooner renew keeps the old date, the seller's button is disabled and says when it opens (`src/lib/market-renew.ts`, test pins the 7 to the migration).
- **Loyalty card links can be replaced** (0318 `rotate_loyalty_card_link`, staff with customers): rolled-back test 12/12, applied; «رابط جديد» on each member.
- **Merchant dashboard totals** no longer stop at 1,000 orders: counts are exact database counts, sales are summed a page at a time.

Full list: `MATJAR_PRELAUNCH_ISSUES.csv` (151 rows, 0 open P0).
