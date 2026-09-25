# Phase 2 · Track C — Zero-result demand capture

Branch `feat/matjar-prelaunch-foundation`, uncommitted (nothing staged, committed or pushed). Date 2026-09-25.

## 1. Migration `supabase/migrations/0306_demand_requests.sql` — APPLIED to production

Applied with `apply_migration` as `0306_demand_requests` (schema_migrations version `20260925072611`). The apply was not refused. It creates new objects only and touches no existing rows. The SQL that was applied is the repo file's body, byte for byte; only the long header comment was shortened.

| Object | What it does |
|---|---|
| `public.demand_requests` | Columns as specified (id, q ≤120, q_norm, section, region, area ≤60, contact ≤80, contact_kind phone/whatsapp/email, note ≤300, user_id → auth.users on delete set null, status new/contacted/fulfilled/dismissed, created_at). I added `handled_at` and `handled_by` (→ auth.users on delete set null) so each status change records who made it and when. A check requires contact and contact_kind to be both null or both set. 6 indexes cover the rate limits, the q_norm aggregation, the status queue and the `handled_by` FK. |
| RLS + grants | RLS is on. `revoke all … from public, anon, authenticated`. Only `select` is granted, to `authenticated`, and it is narrowed by the policy `demand_requests_admin_read`: `admin_can('growth')`. anon has no table privilege at all. No role can INSERT, UPDATE or DELETE directly. |
| `submit_demand(p_q, p_section, p_region, p_area, p_contact, p_contact_kind, p_note) → uuid` | SECURITY DEFINER, `search_path = ''`. Collapses whitespace and trims. `normalize_search` must give ≥2 chars and q must be ≤120. An unknown section or region is **dropped to null, not refused**, so a stale URL param never fails a request. Contact: kind is taken as given, otherwise inferred (`@` → email). Arabic-Indic and Persian digits are converted to ASCII, separators stripped, `00` → `+`, then checked against `^\+?[0-9]{7,15}$`. Emails are lower-cased and regex-checked. Errors are raised as `demand_<code>` with P0001. `revoke all … from public, anon, authenticated; grant execute … to anon, authenticated;` |
| `set_demand_status(p_id, p_status)` | SECURITY DEFINER. Requires `admin_can('growth')`. Changes status only and stamps handled_at/handled_by. Executable by authenticated only. |
| `demand_summary(p_days int)` | SECURITY DEFINER plpgsql. Returns **zero rows** unless `admin_can('growth')`. Gives one row per q_norm: `q_norm, sample_q, section, region, searches` (search_logs with results_count = 0), `requests` (DISTINCT requesters: user, else contact, else row; dismissed excluded), `reachable` (distinct contacts), `last_seen`. Ranked by requests×3 + searches, limit 200, days clamped to 1..365. Executable by authenticated only. |
| `purge_demand_personal_data()` + pg_cron job `matjar-demand-retention` (`30 3 * * *`) | Nulls contact, contact_kind, note and user_id on rows older than **180 days**. It keeps q, section, region and area as anonymous aggregate signal. pg_cron already runs 5 jobs on this project (0039/0118/0120/0177), so I scheduled the job instead of leaving it as a follow-up. Revoked from all three roles, so only cron can run it. |

**Permission area: `growth`.** `admin-sections.ts` has no insights or demand section. Merchant acquisition already lives under `growth` (0150). Adding a new section would give the policy a permission nobody can be granted, which is the trap 0216 warns about. Super admins pass `admin_can` anyway.

**Abuse limits.** All windows are rolling and the counts are not serialised, so one concurrent burst can overshoot by its own concurrency. That is acceptable here because this is not a money path.
- Signed in: 5 per user_id per 24h.
- Any contact: 5 per normalised contact per 24h.
- Anonymous without contact: 3 per identical q_norm + region per 60s.
- Anonymous of any kind: 30 per 60s across the whole platform. This is a flood guard, so a script cycling fake contacts still hits a ceiling.

### Rolled-back test — verbatim (`begin; <migration>; <checks>; select * from r; rollback;` on `wesihatopiznatsyfxer`)

After the test, rollback was confirmed: `tbl=absent, cron_jobs=0, fns=0`.

| n | check_name | result |
|---|---|---|
| 1 | A1 anon select table | ok refused: permission denied for table demand_requests |
| 2 | A2 anon direct insert | ok refused: permission denied for table demand_requests |
| 3 | A3 anon no-contact same q+region #1 | accepted |
| 4 | A3 anon no-contact same q+region #2 | accepted |
| 5 | A3 anon no-contact same q+region #3 | accepted |
| 6 | A3 anon no-contact same q+region #4 | refused: demand_rate_limited |
| 7 | A4 invalid contact | ok refused: demand_invalid_contact |
| 8 | A5 arabic-digit whatsapp + bogus section/region | accepted |
| 9 | A6a 1-char query | ok refused: demand_query_too_short |
| 10 | A6b 121-char query | ok refused: demand_query_too_long |
| 11 | A6c 301-char note | ok refused: demand_note_too_long |
| 12 | A7 same email #1 | accepted |
| 13 | A7 same email #2 | accepted |
| 14 | A7 same email #3 | accepted |
| 15 | A7 same email #4 | accepted |
| 16 | A7 same email #5 | accepted |
| 17 | A7 same email #6 | refused: demand_rate_limited |
| 18 | A8 anon set_demand_status | ok refused: permission denied for function set_demand_status |
| 19 | A9 anon demand_summary | ok refused: permission denied for function demand_summary |
| 20 | A10 anon purge fn | ok refused: permission denied for function purge_demand_personal_data |
| 21 | B1 non-admin select sees rows | 0 (ok) |
| 22 | B2 non-admin direct update | ok refused: permission denied for table demand_requests |
| 23 | B3 signed-in user #1 | accepted |
| 24 | B3 signed-in user #2 | accepted |
| 25 | B3 signed-in user #3 | accepted |
| 26 | B3 signed-in user #4 | accepted |
| 27 | B3 signed-in user #5 | accepted |
| 28 | B3 signed-in user #6 | refused: demand_rate_limited |
| 29 | B4 non-admin demand_summary rows | 0 (ok) |
| 30 | B5 non-admin set_demand_status | ok refused: not_allowed |
| 31 | S1 stored row | q=طلب مستخدم 1 \| q_norm=طلب مستخدم 1 \| section=search \| region=beirut \| area=∅ \| contact=∅ \| kind=∅ \| note=∅ \| user=signed-in |
| 32 | S1 stored row | q=فول \| q_norm=فول \| section=∅ \| region=∅ \| area=الميناء \| contact=03123456 \| kind=whatsapp \| note=بدي فول مدمس \| user=anon |
| 33 | S1 stored row | q=مطاعم تجربة \| q_norm=مطاعم تجربة \| section=search \| region=north \| area=∅ \| contact=∅ \| kind=∅ \| note=∅ \| user=anon |
| 34 | S1 stored row | q=ملابس 1 \| q_norm=ملابس 1 \| section=search \| region=∅ \| area=∅ \| contact=test.demand@example.com \| kind=email \| note=∅ \| user=anon |
| 35 | C1 admin select rows | 14 |
| 36 | C2 admin demand_summary | مطاعم تجربة \| section=search \| region=north \| searches=0 \| requests=3 \| reachable=0 |
| 37 | C2 admin demand_summary | فول \| section=stores \| region=∅ \| searches=1 \| requests=1 \| reachable=1 |
| 38 | C2 admin demand_summary | ملابس 4 \| section=search \| region=∅ \| searches=0 \| requests=1 \| reachable=1 |
| 39 | C2 admin demand_summary | طلب مستخدم 1 \| section=search \| region=beirut \| searches=0 \| requests=1 \| reachable=0 |
| 40 | C2 admin demand_summary | طلب مستخدم 2 \| section=search \| region=beirut \| searches=0 \| requests=1 \| reachable=0 |
| 41 | C2 admin demand_summary | طلب مستخدم 3 \| section=search \| region=beirut \| searches=0 \| requests=1 \| reachable=0 |
| 42 | C2 admin demand_summary | طلب مستخدم 4 \| section=search \| region=beirut \| searches=0 \| requests=1 \| reachable=0 |
| 43 | C2 admin demand_summary | طلب مستخدم 5 \| section=search \| region=beirut \| searches=0 \| requests=1 \| reachable=0 |
| 44 | C3 admin set contacted | ok, handled_by is admin: true |
| 45 | C4 admin invalid status | ok refused: invalid_status |
| 46 | D1 anon flood 40 attempts | 21 accepted in this loop; then: demand_rate_limited |
| 47 | D2 anon rows in last 60s | 30 |
| 48 | E1 purge cleared rows | 1 |
| 49 | E2 old row after purge | q=قديم \| contact=∅ \| note=∅ \| user=∅ |
| 50 | E3 cron job | matjar-demand-retention 30 3 * * * select public.purge_demand_personal_data(); |
| 51 | G1 table privs | authenticated:SELECT |
| 52 | G2 fn exec demand_summary | anon=false authenticated=true |
| 53 | G2 fn exec purge_demand_personal_data | anon=false authenticated=false |
| 54 | G2 fn exec set_demand_status | anon=false authenticated=true |
| 55 | G2 fn exec submit_demand | anon=true authenticated=true |

Notes on the table:
- Row 37 shows the `full join` working against real data. The test «فول» request merged with the existing production zero-result search for «فول» (searches=1).
- D1 accepted 21 because 9 anon rows already existed from A3, A5 and A7; 9 + 21 = 30, which is the cap.

Post-apply check on production: table present with 0 rows, RLS on, cron job scheduled, anon execute is `submit_demand` only. `get_advisors(security)` lists the three new callable definer RPCs under the generic "SECURITY DEFINER executable by anon/authenticated" lint. That is intended, the same as every other public RPC here. No RLS or policy findings for the new table.

## 2. Mount JSX for the search page (not edited — owned by the search agent)

`src/app/[lang]/(site)/search/page.tsx` does **not** contain `<div id="demand-capture-slot" />` yet (checked by grep). Put this directly after the zero-result `<EmptyState … title={t.empty} … />` block. The page already has `q`, `total`, `l`, `dict` and `sp`:

```tsx
import { DemandCapture } from "@/components/search/demand-capture";

{q && total === 0 && (
  <div className="mt-4">
    <DemandCapture
      lang={l}
      q={q}
      section="search"
      region={sp.region ?? null}
      dict={dict}
    />
  </div>
)}
```

- `section` may also be a sector key (e.g. `"food"`) if the page knows the matched sector from search-intent. The RPC accepts both surfaces and all 17 catalog sectors.
- The component resets itself when `q` changes, so it needs no `key`.
- Props interface: `DemandCaptureProps { lang: Locale; q: string; section?: string | null; region?: string | null; dict: Dictionary }`.

## 3. Files changed

- `supabase/migrations/0306_demand_requests.sql` — new: table, RLS, 4 definer functions, retention cron.
- `src/lib/demand.ts` — new: shared limits, section/region whitelist, contact normalisation, `validateDemand`, RPC error mapping, `waDigits`.
- `src/lib/__tests__/demand.test.ts` — new: 16 tests, including one that reads the migration and fails if its limits, regions or sections drift from `demand.ts`.
- `src/components/search/demand-capture.tsx` — new: collapsed one-line prompt → form → «وصلتنا، شكرًا».
- `src/app/[lang]/(dashboard)/admin/demand/page.tsx` — new: `requireAdminSection("growth")`, `demand_summary(30|90)` via `?days=90`, recent 200 requests.
- `src/app/[lang]/(dashboard)/admin/demand/demand-admin-client.tsx` — new: stats, unmet-demand table, recent requests with contact links and a status select that calls `set_demand_status`.
- `src/components/admin-nav.tsx` — +11/−3. One array item, one icon entry and one import. Two small helpers were also needed, because the nav takes both the permission and the label from the item key: `demand` is gated by `growth` and labelled from `dict.demand.nav`, since `admin.nav` is not my namespace. The command palette picks the entry up automatically.
- `src/i18n/dictionaries/ar.json`, `en.json` — one new top-level `demand` namespace per file, inserted textually before `  "features": {`. CRLF was preserved (0 bare LF) and both files pass `JSON.parse`. No other key was touched.

## 4. Privacy notes

- Contact is optional. The field's hint says what it is for: «اختياري — منستعملو بس لنخبرك إذا لقينا». The success message makes no promise about delivery or timing.
- Nothing is stored that the person did not type, apart from `auth.uid()` when they are signed in. No IP, no user agent, no fingerprint.
- Only admins with `growth` can read rows (RLS + table grants). anon cannot even SELECT. The admin page is the only place a contact is rendered. It shows "signed-in user" rather than the user id.
- Retention is enforced by a daily cron, not just promised. After 180 days contact, kind, note and user_id are cleared; the query, section, region and area remain as anonymous demand. The admin page states this rule next to the list.
- Status changes go through a definer RPC that can only change `status`, and each change stamps handled_by and handled_at.
- The tests created no demand data on production; everything was rolled back and the rollback verified.

## 5. Gates (verbatim tails)

```
npx tsc --noEmit        → (no output) TSC_EXIT=0
npx vitest run          → Test Files  52 passed (52) · Tests  914 passed (914)
npx vitest run src/lib/__tests__/demand.test.ts → Test Files 1 passed (1) · Tests 16 passed (16)
npx eslint src/lib/demand.ts src/lib/__tests__/demand.test.ts src/components/search/demand-capture.tsx "src/app/[lang]/(dashboard)/admin/demand/page.tsx" "src/app/[lang]/(dashboard)/admin/demand/demand-admin-client.tsx" src/components/admin-nav.tsx → ESLINT_EXIT=0
npm run check:migrations → PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
```

Not verified: I did not render the component or the admin page in a browser. No dev server was started, and the search page mount is pending.

## 6. CSV

```
issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P1-DEMAND-01|P1|search/demand|/[lang]/search|all|A zero-result search ends at "no results"; the searcher cannot say what they wanted, where, or ask to hear back|search_logs records only that a search failed; no capture step or table existed|demand_requests table + submit_demand RPC (validated, trimmed, rate-limited) + DemandCapture component|supabase/migrations/0306_demand_requests.sql; src/components/search/demand-capture.tsx|done (mount pending, search-page owner)|10 of the last 12 searches returned 0 and left nothing behind|Collapsed prompt «ما لقيت يلي بدّك ياه؟ خبّرنا ومنحاول نجيبلك ياه» → query/region/area/optional contact/note → «وصلتنا، شكرًا»|Applied to prod 20260925072611; mount JSX in §2
P1-DEMAND-02|P1|admin/insights|/[lang]/admin/demand|all|No admin view of unmet demand; admin_search_gaps (0216) existed but nothing rendered it outside the 7-day attention card|No page or aggregate combined zero-result searches with requests|demand_summary(p_days) (admin_can('growth'), zero rows otherwise) + /admin/demand page with 30/90-day switch, recent requests, and set_demand_status|src/app/[lang]/(dashboard)/admin/demand/*; src/components/admin-nav.tsx|done|Demand data visible only by raw SQL|Ranked list (requests×3 + searches, distinct requesters, reachable contacts, region, section) + status workflow new→contacted/fulfilled/dismissed|Gated by the existing 'growth' section; no new permission area
P1-DEMAND-03|P1|privacy|n/a|all|Volunteered contacts could be kept forever and read too widely|New data class with no retention or access rule|RLS + revoked table grants (admin read only), contact optional, no IP/UA, daily pg_cron purge of contact/note/user_id after 180 days|supabase/migrations/0306_demand_requests.sql|done|n/a (new table)|anon: permission denied; non-admin: 0 rows; purge verified in rolled-back test (E1/E2)|Cron job matjar-demand-retention 30 3 * * *
P2-DEMAND-04|P2|abuse|n/a|all|An open anonymous form can be flooded or used to spam a contact|Anon-callable RPC|Limits: 5/user/24h, 5/contact/24h, anon no-contact 3 per q_norm+region/60s, anon 30/60s platform-wide; kind rate-limit message in UI|supabase/migrations/0306_demand_requests.sql; src/lib/demand.ts|done|n/a|Every limit tripped as designed in the rolled-back test (A3/A7/B3/D1)|Counts are not serialised; one concurrent burst can overshoot slightly (accepted)
P2-DEMAND-05|P2|consistency|n/a|all|Form and RPC could drift apart on limits and whitelists|Two languages holding the same rules|Single DEMAND_LIMITS/DEMAND_SECTIONS in src/lib/demand.ts + a test that reads 0306 and asserts every cap, rate limit, region and section|src/lib/demand.ts; src/lib/__tests__/demand.test.ts|done|n/a|16 tests green; drift now fails CI|Arabic-Indic digits handled identically in TS and SQL
```
