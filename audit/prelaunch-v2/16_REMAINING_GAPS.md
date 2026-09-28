# 16 — REMAINING GAPS (2026-09-28)

## Waiting on the owner
1. **Deploy.** Nothing on this branch is on matjarlb.com yet.
2. **Apply 0314 right after the deploy** (privacy: private store columns, verification scans, licence number, internal order note, closed-job applications). Not before: the live main code still reads those columns (see `_work/privacy-fixes.md`, "Deploy order").
3. **Apply 0315** (customers can read their own inquiries). Additive, safe any time.
4. **Google Merchant Center:** Matjar must claim matjarlb.com in one multi-client account before merchant feeds can be approved. The Meta catalog works without it.
5. **Merchants' own data:** 4 stores without an area, 3 without a logo or cover, 3 retail stores without products; no store has a return policy yet.
6. The Supabase secret key pasted in chat earlier: revocation never confirmed.

## Known gaps (not built, by design or for lack of data)
- Cuisine, clinic specialties, insurance, amenities, FAQ, next availability: no data exists; shown only when merchants fill them.
- «انشر مشروعك» public board and job alerts: no backend; not faked.
- Phone verification for Sunday Market: needs an SMS/OTP provider, which conflicts with zero cost.
- Loyalty balances of the same person in the app and in the shop stay separate until phones are verified.
- Gift-card links cannot be revoked yet; POS "today" counts gift-card payments as cash.
- A few P2 cleanups: unused pricing keys, upgrade-copy claims not tied to the registry, real-estate "coming soon" wording, the whole dictionary sent to the job page.

## Until the deploy
Sunday Market: since 0313 a seller's delete is a soft delete; the live code still lists the seller's own deleted listings to them (the branch code filters them). Public visitors are unaffected.

Full list: `MATJAR_PRELAUNCH_ISSUES.csv` (151 rows, 0 open P0).
