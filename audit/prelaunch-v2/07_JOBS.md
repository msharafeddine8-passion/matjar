# 07 — Jobs (الوظائف) — prelaunch phase 4

## What production holds (read 2026-09-25)

| id | status | type | region | deadline | deleted |
|---|---|---|---|---|---|
| f8cd325f… (passion) | active | full_time | north | — | — |
| a6a51dd1… (الأمان للتامين) | active | full_time | beirut | — | — |

`job_applications`: 1 row. RLS `job_postings_select` = `(status='active' and deleted_at is null) or poster`. `job_postings_insert` requires `owns_store()`, so only merchants can post.

## Home prominence

The home page does **not** have a jobs section. `HomeMore` shows one compact tile, gated by `getNavSections().jobs = hasEnough(count)` with `MIN_NAV_ITEMS = 1` (`src/lib/data/section-supply.ts`, counting `status='active'`). With 0 live jobs the tile and the header link disappear. With 2 there is a small tile and no big section. Nothing was changed there.

One mismatch, reported and not fixed because the file is outside my territory: the supply count uses `status='active'` only. The board now also drops soft-deleted postings and those past their deadline. Today both predicates give 2. If every posting expires, the tile would still link to a board that shows the empty state (a useful page, not a dead end). The fix is to add `.is('deleted_at', null)` and a deadline filter to `countSections` in `section-supply.ts`.

## The journey after this phase

**`/jobs` → details, or a useful empty state**

1. **Board (`/jobs`)**
   - **Live only:** `status='active'`, `deleted_at is null`, and `apply_deadline` is null or ≥ **Beirut's** today (`isJobOpen`, `beirutToday`). Before, a posting past its deadline was listed as open.
   - **Filters only when they split the list** (`visibleJobFilters`): today that means the region row (Beirut / North) and no type row, since both postings are full-time. Before: 5 type chips and 6 region chips, drawn even above an empty list. Unknown `?type=` / `?region=` values are dropped instead of queried, and an active filter always stays tappable so it can be undone.
   - A count line («وظيفتين») and dated cards: «نُشرت 29 تموز» in Beirut time with Western digits and Levantine month names (`formatDay`, `ar-LB-u-nu-latn`). Before: «29 يوليو» from the runtime's bare `"ar"` locale, with no label and no timezone. A deadline shows as «آخر موعد 1 تشرين الأول».
2. **Details (`/jobs/[id]`)**
   - The deadline is checked against Beirut's day, not UTC (UTC would close a posting at 02:00–03:00 on its last day).
   - After the deadline, the page stays reachable for applicants but gets `noindex, follow`, **stops emitting JobPosting JSON-LD**, and replaces the empty "deadline passed" box with «هالوظيفة ما عادت عم تستقبل طلبات» and a «شوف كل الوظائف» link.
   - The back link now has a 44px touch target.
3. **Useful empty state (`JobsEmptyState`)**. It shows when there are no live jobs, or when a filter empties the list (then it leads with «شوف كل الوظائف»):
   - **Businesses:** «عندك محل وبدّك حدا يشتغل معك؟» → **«انشر وظيفة»** (`/jobs/new`, which handles the merchant-only gate)
   - **Job seekers:** «عم تدوّر على شغل؟» → «اعرض خدماتك كمستقل» (`/freelance/new`) and «سجّل حرفتك» (`/crafts/join`). These are the two places a person can be found by customers today without waiting for an employer.
   - A plain line: «ما عنّا لهلّق تنبيهات للوظائف الجديدة…»

## «خبّرني لما تنزل فرص جديدة»: not built

Checked on production and in code:

- `saved_searches` (0048): columns `q, category, region, city`. It is written by the market filters only, and **nothing reads it to send anything** (no cron, no edge function, no API route references it). 0 rows.
- `push_subscriptions`: used by `/api/push/broadcast` (admin broadcast) and `/api/push/hook`. There is no per-topic or per-search fan-out. 0 rows.
- `demand_requests` (0306) records a volunteered contact for a **human** follow-up. It is not an alert system.

None of these can carry a jobs alert without new infrastructure (a subscription table and a sender triggered on `job_postings` insert). As the brief instructs, I did not build the button, and the empty state says there are no alerts instead of implying there are.

## Noindex rules

| route | robots | canonical |
|---|---|---|
| `/jobs` with ≥1 live job | `index, follow` | `/{lang}/jobs` |
| `/jobs` with 0 live jobs | `noindex, follow` | same |
| `/jobs?` with any parameter (valid filter or junk) | `noindex, follow` | bare URL |
| `/jobs/[id]` still open | indexable (unchanged), JSON-LD emitted | self |
| `/jobs/[id]` past deadline | `noindex, follow`, no JSON-LD | self |

Measured: `/ar/jobs` gives `index, follow`; `/ar/jobs?type=internship` gives `noindex, follow` and renders the filtered empty state. Before, both had no robots tag, and the second showed 11 chips above «ما في وظائف مطابقة حالياً».

## For the SEO track / others (not my files)

- `jsonLd.jobPostingJsonLd` has no `validThrough`. Pass `apply_deadline` (as the end of that day in Asia/Beirut) when set. Google treats a JobPosting without an expiry as indefinitely open.
- `sitemap.ts` lists every `status='active'` job, including ones past their deadline, which the page now marks noindex. Filter on `apply_deadline is null or >= today`.
- **Database gap (not fixed, no migration written):** the `job_applications_insert` policy checks only `applicant_id = auth.uid()`. It does not check that the posting is active or before its deadline, so the UI's closed state is the only barrier. A `WITH CHECK (exists (select 1 from job_postings j where j.id = job_id and j.status = 'active' and j.deleted_at is null and (j.apply_deadline is null or j.apply_deadline >= (now() at time zone 'Asia/Beirut')::date)))` would close it. This needs a rolled-back test first, per `supabase-verify`.
- **Performance (existing, not introduced here):** `JobApplyForm` is a client component that receives the whole `dict`, so the entire dictionary is serialised into every job page's RSC payload. Pass `dictSlice(dict, ["jobs"])` instead.

## Files

- `src/app/[lang]/(site)/jobs/(index)/page.tsx`: live-only query (request-cached), validated params, split-only filters, count, Beirut dates, robots/canonical, new empty state
- `src/app/[lang]/(site)/jobs/[id]/page.tsx`: Beirut deadline, noindex and no JSON-LD after deadline, closed state with a way on, formatted deadline, back-link touch target
- `src/components/jobs/jobs-empty-state.tsx` (new)
- `src/lib/pro-market.ts`: `beirutToday`, `isJobOpen`, `formatDay`, `visibleJobFilters` (tested in `pro-market.test.ts`)
