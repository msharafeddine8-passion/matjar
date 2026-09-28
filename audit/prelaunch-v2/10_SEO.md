# 10 — SEO foundation (§32)

Phase 5, 2026-09-25. Verified on the running dev server (`/robots.txt`,
`/sitemap.xml`, page `<head>`s) and in unit tests. **No URL moved and nothing
redirects**; every change is metadata, the sitemap or robots.

## The one rule

`src/lib/seo-rules.ts` holds the predicates, and the sitemap, robots.ts and each
page's `generateMetadata` import the same ones, so **the sitemap only lists what
the page itself indexes** (a submitted URL marked noindex is a Search Console
error). Tested in `src/lib/__tests__/seo-rules.test.ts`.

| Page type | Indexed when | Otherwise |
|---|---|---|
| Gated section landing (`/market`, `/jobs`, `/freelance`, `/wholesale`, `/delivery`, `/crafts`) | ≥ 1 live row (`getSectionSupply`, same bar as the nav link, `rail.ts MIN_NAV_ITEMS`) | left out of the sitemap; `/market` says `noindex, follow` (others: owners below) |
| `/category/[slug]` | ≥ 1 active store in the sector (`getDiscoveryCoverage`) | sitemap omits it; page already `noindex, follow` |
| `/crafts/[trade]` | ≥ 1 active provider (`trade_provider_counts`) | sitemap omits it; crafts agent adds `noindex, follow` |
| `/market/[id]` | `status = active` | sold/expired stay reachable, `noindex, follow`; not in sitemap |
| `/store/[id]`, `/[handle]` | real store | demo-catalog store (`isReal: false`, fabricated rating) → `noindex, follow` |
| `/search`, free-text `?q=` on explore/category | never | robots-disallowed + `noindex, follow` |
| private / write / token routes | never | robots-disallowed (list below) |

## Fixes

| Issue | Before | After | File |
|---|---|---|---|
| Sitemap rendered **per request** with a cookie-reading client (every crawler hit = 9 queries; a signed-in admin got RLS-widened rows) | dynamic, unbounded | `revalidate = 3600`, cookie-less `createPublicClient`, `.limit(5000)` per table | `src/app/sitemap.ts` |
| Sitemap listed empty sections and all 17 categories (11 of them noindexed, zero stores) | `/wholesale`, `/delivery` + 17 categories | only sections/categories with supply — 6 categories, no wholesale/delivery/crafts today | `src/app/sitemap.ts` |
| Sitemap had no hreflang | plain `<loc>` | every URL carries `xhtml:link` ar / en / x-default | `localizedSitemapEntries` |
| Crafts: nothing in the sitemap, not even the sign-up page | — | `/crafts/join` always; trade pages with providers | `ALWAYS_INDEXED_PATHS` |
| One store, two self-canonical URLs (`/store/<uuid>` and `/<slug>`) | duplicate | `/store/<uuid>` canonical → `/<slug>`; `/Misk` → `/misk` (stored lower-case slug) | `buildStoreMetadata` in `seo-rules.ts`; `store/[id]/page.tsx` generateMetadata; `[handle]/page.tsx` |
| Demo-catalog stores indexable with a made-up rating | indexable | `noindex, follow` | same |
| Market listing title rendered "X \| Matjar · متجر" (brand twice); sold/expired indexed | | "X · متجر"; noindex unless active; OG image with alt; twitter card | `market/[id]/page.tsx` |
| No canonical/hreflang on `/market`, `/best-sellers`, `/clearance`, `/map`, `/offers`, `/search` | none | `localeAlternates`; `/search` also `noindex, follow`; `/market` noindex at zero supply | those pages |
| Home: one bilingual title/description for both locales | "متجر \| Matjar" on /en | localized title (absolute), description, `og:locale` ar_LB / en_US | `(site)/page.tsx` |
| robots.txt missed private/write/token routes and the market facets | 15 prefixes × 2 | 33 prefixes × 2 + `/{lang}/market?` + `/*/market/*/edit`, `/*/crafts/p/*/request`; `meta-externalagent` joined the blocked crawlers | `src/app/robots.ts`, `robotsDisallowList()` |
| `/market/new`, `/market/[id]/edit` had no robots meta | | `noindex, nofollow` | those pages |
| Product JSON-LD for an unpriced good said `price: 0, InStock` | | no Offer without a real price | `productJsonLd` |
| AggregateRating guard was `rating && reviewCount` (a 7.5 or a 1.5 count passed) | | `aggregateRating()`: ≥ 1 integer count, 1..5 | `src/lib/jsonld.ts` |

### Verified heads (dev server)

```
/en                      canonical /en · hreflang ar/en/x-default · og:locale en_US · Organization+WebSite JSON-LD
/ar/market               canonical /ar/market · hreflang pair
/en/market/<id>          "ايفون 11 برو ماكس · متجر" · canonical self · Product JSON-LD · BreadcrumbList
/ar/search               robots "noindex, follow" · canonical /ar/search
/en/store/<uuid of misk> canonical https://matjarlb.com/en/misk
/ar/Misk                 canonical https://matjarlb.com/ar/misk
```

## Structured data per page type

| Page | Type | Status |
|---|---|---|
| Home | `Organization` + `WebSite` (SearchAction) | existing, unchanged |
| Store | `LocalBusiness` **subtype by sector**: food → FoodEstablishment, retail → Store, healthcare → MedicalBusiness, pharmacy → Pharmacy, beauty → HealthAndBeautyBusiness, fitness/sportsCourts → SportsActivityLocation, automotive → AutomotiveBusiness, realEstate → RealEstateAgent, hospitality → LodgingBusiness, professional → ProfessionalService, contractors → HomeAndConstructionBusiness, others → LocalBusiness. Physician is not used: a clinic is not one doctor. | builder done (`schemaTypeForSector`, `storeJsonLd({ sector })`); **hook pending** — see below |
| Product / service / dish | `Product`+`Offer` / `Service` (provider) / `MenuItem` | existing; Offer now omitted without a real price |
| Sunday Market listing | `Product` + `Offer` (InStock / SoldOut), seller = store only for merchant listings; nothing for pending/expired/unpriced | **new** `listingJsonLd`, wired in `market/[id]/page.tsx` |
| Job | `JobPosting` (+ `validThrough`, `hiringOrganization.sameAs/logo`) | builder extended; **hook pending** |
| All pages with breadcrumbs | `BreadcrumbList` | existing |
| Ratings | `AggregateRating` only from ≥ 1 real review | all builders via `aggregateRating()` |

### One-line hooks for the page owners (not edited here)

- **Store page body** (profile-engine agent), `src/app/[lang]/(site)/store/[id]/page.tsx`, the `storeJsonLd({...})` call: add
  `sector: store.category,` and change `url` to
  `` `${SITE_URL}/${lang}${storeCanonicalPath(id, store.slug)}` `` (import `storeCanonicalPath` from `@/lib/seo-rules`) so the JSON-LD url matches the canonical.
- **Jobs page** (jobs agent), `src/app/[lang]/(site)/jobs/[id]/page.tsx`, the `jobPostingJsonLd({...})` call: add
  `validThrough: job.apply_deadline,` (and, for a store's posting, `companyUrl` / `companyLogo`).
- **Crafts / jobs / freelance / wholesale / delivery landing pages:** for zero supply,
  `robots: sectionRobots(count)` from `@/lib/seo-rules` (the sitemap already omits them).

## CSV rows

```
P1-SEO-01|P1|seo/cost|/sitemap.xml|all|Sitemap rendered on every request (9 queries per crawler hit) with a cookie client; an admin's session widened it|createClient() reads cookies → dynamic route; no revalidate; no limits|revalidate 3600 + createPublicClient + .limit(5000) per table|src/app/sitemap.ts|fixed|dynamic, unbounded|1 render/hour, anon-scoped|vercel-cost-guard
P1-SEO-02|P1|seo|/sitemap.xml|all|Sitemap submitted empty sections and zero-store categories that the pages themselves noindex|Static path list and every categoryKey|Supply-gated via getSectionSupply / getDiscoveryCoverage / trade_provider_counts on shared predicates|src/app/sitemap.ts; src/lib/seo-rules.ts|fixed|17 categories + /wholesale,/delivery|6 categories; empty sections omitted|sitemap ⊆ indexable, tested
P2-SEO-03|P2|seo|/sitemap.xml|all|No hreflang in the sitemap|entries per locale without alternates|xhtml:link ar/en/x-default on every entry|src/lib/seo-rules.ts|fixed|—|reciprocal pairs|—
P1-SEO-04|P1|seo|/store/[id], /[handle]|all|A store with a slug had two self-canonical URLs; /Passion and /passion differed|canonical built from the route, not the store|buildStoreMetadata → storeCanonicalPath(slug)|src/lib/seo-rules.ts; src/app/[lang]/(site)/store/[id]/page.tsx; src/app/[lang]/(site)/[handle]/page.tsx|fixed|/ar/store/<uuid> self|→ /ar/<slug>|no URL moved
P1-SEO-05|P1|seo/trust|/store/[id]|all|Demo-catalog stores (fabricated ratings) indexable|no robots rule for isReal=false|noindex, follow|src/lib/seo-rules.ts|fixed|indexable|noindex|—
P2-SEO-06|P2|seo|/market/[id]|—|Title "X \| Matjar · متجر"; sold/expired listings indexable; no structured data|hard-coded brand + template; no status rule|Plain title, listingRobots, listingJsonLd|src/app/[lang]/(site)/market/[id]/page.tsx|fixed|brand twice|"X · متجر"|—
P2-SEO-07|P2|seo|/market,/best-sellers,/clearance,/map,/offers,/search|all|No canonical/hreflang; /search had no noindex meta|generateMetadata omitted alternates|localeAlternates; /search noindex; /market noindex at zero supply|those page.tsx files|fixed|none|pairs|—
P2-SEO-08|P2|seo|/en|all|English home served the Arabic-first bilingual title|layout default only|Localized absolute title/description/og:locale|src/app/[lang]/(site)/page.tsx|fixed|"متجر \| Matjar"|"Matjar — every shop…"|—
P2-SEO-09|P2|seo/cost|/robots.txt|all|Private, write and bearer-token routes and the market facets were crawlable|hand-kept list|robotsDisallowList() from PRIVATE_PATH_PREFIXES + facets + wildcards; meta-externalagent blocked|src/app/robots.ts; src/lib/seo-rules.ts|fixed|15×2 prefixes|33×2 + facets|—
P2-SEO-10|P2|seo|/store/[id]|healthcare,food,…|Every store typed LocalBusiness|no sector input|schemaTypeForSector + storeJsonLd({sector})|src/lib/jsonld.ts|partial|LocalBusiness|subtype once the store page passes sector|hook for profile agent in 10_SEO.md
P2-SEO-11|P2|seo|/product/[id]|retail|Unpriced goods emitted Offer price 0 InStock|price ?? 0 fallback|No Offer without a real price|src/lib/jsonld.ts|fixed|price 0|no Offer|—
P2-SEO-12|P2|seo|all JSON-LD|all|Rating guard accepted out-of-range values|inline truthy check|aggregateRating(): ≥1 integer count, 1..5|src/lib/jsonld.ts|fixed|—|—|tested
P2-SEO-13|P2|seo|/jobs/[id]|—|JobPosting without validThrough|builder had no field|validThrough + hiringOrganization sameAs/logo|src/lib/jsonld.ts|partial|—|needs job.apply_deadline passed|hook for jobs agent
P3-SEO-14|P3|seo|/store/[id]|all|Store JSON-LD url is /store/<uuid> while canonical is /<slug>|page body builds the url|pass storeCanonicalPath(id, store.slug)|src/app/[lang]/(site)/store/[id]/page.tsx|open|mismatch|—|profile agent's file
```
