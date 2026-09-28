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
- Loyalty card links (not gift cards) still cannot be replaced.
- Owner decisions still open: real-estate "appointments coming soon" wording (P0-FEAT-12), a contact path for private Sunday Market sellers (P2-MARKET-09), a cooldown on listing renewal (P3-MARKET-12).
- Unused pricing keys left in the dictionaries (P2-PRICE-10); `reviews.customer_id` readable by signed-in users (P3-PRIV-05) needs a code audit of "have I reviewed" lookups before any column grant.
- The merchant dashboard sums every order in one unpaged read; past 1,000 orders the totals would stop at Supabase's default row cap.

Full list: `MATJAR_PRELAUNCH_ISSUES.csv` (151 rows, 0 open P0).
