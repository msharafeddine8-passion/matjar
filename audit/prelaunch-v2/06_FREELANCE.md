# 06 — Freelance (خدمات مستقلّة) — prelaunch phase 4

## What production holds (read 2026-09-25)

- `gigs`: 3 active, all owned by **باشن** (`8b6f9cdc-3100-4f4b-a2df-3cb3e7c1e80a`), in the design, photography and acting categories
- Freelance reviews: there is no review table. `rating_count` is 0 on every gig.
- There is no project, brief or lead table for freelance.

A people-first pass had already landed before this phase: `/freelance` defaults to a **people** grid built by `groupGigsByPerson`, which is tested in `freelance-people.test.ts`; `/freelance/pro/[id]` is a real profile rendered through the shared `ProfessionalProfile` blocks; filters that cannot split the list stay hidden. This phase closes the places where one person still looked like several sellers, and fixes the CTAs.

## The journey after this phase

**`/freelance` → professional → portfolio → service → request an offer**

1. **`/freelance`, people tab (default).** One card per person, unchanged. **Services tab:** gigs are now grouped under the person who offers them (`خدمات باشن` plus a link to `شوف ملفّه`). Before, the tab showed three GigCards in a flat grid, which read as three sellers.
2. **Professional (`/freelance/pro/[id]`).** The primary CTA is now **«اطلب عرض»**, which opens `/freelance/brief?to=<id>`. The secondary CTA is **«راسل»**, which opens the existing conversation (`start_conversation`), now styled as a secondary button. Before, the labels were «اطلب تسعيرة» and «تواصل مع المستقل», and both were solid primary buttons. The sticky phone bar uses the same label. The page still says «جديد على متجر — ما بعدو خلّص شغل عبر متجر، فما في تقييمات» instead of showing stars, so no rating or response time is invented.
3. **Portfolio.** The service covers remain a thumbnail strip into each service page. The profile's `portfolio` block renders only when real work samples exist, and today none do.
4. **Service (`/freelance/[id]`).** The person row at the top is unchanged. Changes:
   - The CTA is now **«اطلب عرض»** (a brief to this person, with the category prefilled) plus **«راسل»**, both inline and in the phone sticky bar. Before, the only action was "contact".
   - **«خدمات تانية من باشن»**: a compact list of the same person's other active services, with «كل خدمات باشن» linking to the profile.
   - "Related" is now **other freelancers only** (`splitServicesByOwner`), headed «مستقلّين تانيين بنفس المجال». Today that list is empty, so the section is hidden. Before, "related" was `browse_gigs` by category, which counted the same person's gigs as other sellers.

## «انشر مشروعك»: what exists, and what was not built

The backend has **no project table**. `craft_requests` is for trades and requires a provider. What exists is `/freelance/brief`: the buyer writes the brief once, picks a freelancer, and it is **delivered as a message in «الرسائل»** (the page says so: «الطلب بيوصل كرسالة بصندوق «الرسائل» تبع متجر»). I did **not** build a public project board or any "we'll match you" promise, because nothing would read the posts or match them. «اطلب عرض» leads into that honest brief flow.

## Noindex rules

| route | robots | canonical |
|---|---|---|
| `/freelance` (bare) | `index, follow` while ≥1 active gig (the cached `getSectionSupply` count the header uses); `noindex, follow` at 0 | `/{lang}/freelance` |
| `/freelance?cat/region/verified/available/q/view=…` | `noindex, follow` | bare URL |
| `/freelance/pro/[id]` | indexable (unchanged); 404 when the person has no profile and no active gig | self |
| `/freelance/brief` | `noindex, follow` (unchanged) | — |

Measured: `/ar/freelance` gives `index, follow`; `/ar/freelance?view=services` gives `noindex, follow`. Before, neither page had a robots tag.

## For the SEO track (not my files)

- `sitemap.ts` lists `/freelance/{gigId}` but not `/freelance/pro/{id}`. The profile is the people-first page, and it should be in the sitemap. One entry per distinct `freelancer_id` of the active gigs would do it.
- A `Person` / `ProfessionalService` JSON-LD on `/freelance/pro/[id]` would need to come from `src/lib/jsonld.ts`, which is the SEO agent's file. Omit `aggregateRating` until a real review exists.

## Files

- `src/app/[lang]/(site)/freelance/(browse)/page.tsx`: robots/canonical in `generateMetadata`; services tab grouped by person
- `src/app/[lang]/(site)/freelance/pro/[id]/page.tsx`: «اطلب عرض» / «راسل»
- `src/app/[lang]/(site)/freelance/[id]/page.tsx`: offer CTA, same-person list, related = others only, two-button sticky bar
- `src/components/contact-freelancer-button.tsx`: optional `label`, `variant`, `className` (backwards compatible; `/u/[id]` is unchanged)
- `src/lib/professional.ts`: `splitServicesByOwner()`, `supplyRobots()`, both tested in `professional.test.ts`
