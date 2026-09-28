# 16 — REMAINING GAPS (2026-09-28)

## Done on 2026-09-28
- **Deployed.** `main` at 0f76179 (merge of `feat/zero-subscription-features`), Vercel production READY; key pages checked live.
- **0314 applied right after the deploy** (privacy: private store columns, verification scans, licence number, internal order note, closed-job applications). Rolled-back test first: 74/74 checks. Live re-check after applying: home, explore, search, 5 storefronts, jobs, market, pricing, sitemap all 200; no production runtime errors or warnings.
- **0315 applied** (customers can read their own inquiries). Rolled-back test first: 16/16 checks.
- Supabase security advisor after both: no ERROR-level findings; `store_private_fields` appears under "SECURITY DEFINER executable by authenticated" by design (it returns rows only to the owner, staff or an admin).

## Waiting on the owner
1. **Google Merchant Center:** Matjar must claim matjarlb.com in one multi-client account before merchant feeds can be approved. The Meta catalog works without it.
2. **Merchants' own data:** 4 stores without an area, 3 without a logo or cover, 3 retail stores without products; no store has a return policy yet.
3. The Supabase secret key pasted in chat earlier: revocation never confirmed.

## Known gaps (not built, by design or for lack of data)
- Cuisine, clinic specialties, insurance, amenities, FAQ, next availability: no data exists; shown only when merchants fill them.
- «انشر مشروعك» public board and job alerts: no backend; not faked.
- Phone verification for Sunday Market: needs an SMS/OTP provider, which conflicts with zero cost.
- Loyalty balances of the same person in the app and in the shop stay separate until phones are verified.
- Gift-card links cannot be revoked yet; POS "today" counts gift-card payments as cash.
- A few P2 cleanups: unused pricing keys, upgrade-copy claims not tied to the registry, real-estate "coming soon" wording, the whole dictionary sent to the job page.

Full list: `MATJAR_PRELAUNCH_ISSUES.csv` (151 rows, 0 open P0).
