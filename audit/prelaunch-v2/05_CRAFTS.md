# 05 — Crafts (صيانة وحِرَف) — prelaunch phase 4

Branch `feat/zero-subscription-features`. Not committed, pushed or deployed. The production database was only read (SELECTs); nothing was written or migrated.

## What production holds (read 2026-09-25)

| | rows |
|---|---|
| `craft_providers` | 0 |
| `craft_requests` | 0 (`provider_id uuid NOT NULL`) |
| `trade_provider_counts()` | empty: every one of the 47 trades has 0 active providers |
| `demand_requests` (0306) | exists; `submit_demand()` accepts section `contractors` |

The section had already been rebuilt intent-first before this phase («شو خربان؟» box, symptom chips, an honest empty state with real counters, a 3-step request flow that refuses to invent a provider). This phase adds to it. It does not redesign it.

## The journey after this phase

**Home → «شو خربان؟» → trade → provider, or a service request**

1. **Home.** `CraftsDoor` links to `/crafts` from the home page, and `getNavSections` keeps crafts linked at zero supply (the owner decided this on 2026-09-02). Unchanged.
2. **«شو خربان؟» (`/crafts`).** The box now reads the sentence with the same lexicon site search uses (`parseSearchIntent` from `src/lib/search-intent.ts`, called through the new `craftIntentFromProblem`). It runs locally, with no round trip. «بدي سنكري بطرابلس» shows `فهمنا: [سبّاك] [📍 طرابلس]`, sets the area picker to Tripoli (until the customer picks an area themselves), and carries `trade=plumber&area=tripoli` into the request URL. The `search_trades` RPC still runs for words the lexicon does not know, and its hits are offered after the understood one.
3. **Trade page (`/crafts/[trade]`).** Unchanged for visitors. Its metadata now follows the zero-supply rule (see below).
4. **Provider or request (`/crafts/requests`).**
   - When a trade or area was left on «مش متأكد», the flow now infers it from the description and says so: «من وصفك، هيدي شغلة تصليح برادات. ومنطقتك الميناء.» Choosing a value by hand always wins.
   - If `browse_crafts` returns providers, the customer picks one and files a real `craft_requests` row (the existing path).
   - If nobody matches, which is every case today, the honest no-match step keeps the WhatsApp handoff and the "register your trade" link. It now also offers the **existing demand form** (`DemandCapture` → `submit_demand`, section `contractors`), so a customer who will not open WhatsApp can leave the brief with the team. The contact field is optional. The team reads these at `/admin/demand`. The copy says plainly that nothing routes automatically. The old line «بلا حرفي مسجّل ما منقدر نخزّن الطلب» is replaced, because it is no longer true.

Verified in a real browser at 390px against the dev server (`audit/prelaunch-v2/_work/shots-phase4-flow.mjs`):

```
ask: area= tripoli chips= [ 'سبّاك', 'طرابلس' ]
url: /ar/crafts/requests?problem=بدي+سنكري+بطرابلس&trade=plumber&area=tripoli
trade select: plumber area: tripoli
step2 has demand prompt: true | wa: true
inferred trade: fridge-repair area: mina      ← «البراد ما عم يبرد بالميناء», no trade in URL
```

## Noindex rules (my pages' metadata)

The rule is `supplyRobots()` in `src/lib/professional.ts`: a page is indexable only when real supply is behind it **and** the view is canonical and unfiltered. `follow` is always true.

| route | robots | canonical |
|---|---|---|
| `/crafts` | `index, follow`. It has content of its own (the symptom index and the 47-trade taxonomy), so `uniqueContent: true` | `/{lang}/crafts` |
| `/crafts/[trade]` with 0 active providers (`trade_provider_counts`) | `noindex, follow` | `/{lang}/crafts/{slug}` |
| `/crafts/[trade]` with ≥1 provider | `index, follow` | same |
| `/crafts/[trade]?area=…` / `?q=…` / `?sort=` other than rating | `noindex, follow` | bare trade URL |
| `/crafts/all` (free-text catch-all) | `noindex, follow` | — |
| `/crafts/requests` | `noindex, follow` (unchanged) | — |

Measured (`shots/phase4/after-status.md`): `/ar/crafts` gives `index, follow`; `/ar/crafts/electrician` and `?area=tripoli` both give `noindex, follow`. Before this phase all three had no robots tag. The SEO track's `sitemap.ts` leaves out the same trades using the same RPC (`craftTradeIndexable`), so the sitemap and the pages agree.

## Privacy

`craft_providers` has no address column. Its location fields are `region` and `area_id`, an `lb_areas` neighbourhood; coverage comes from `craft_provider_areas`. The profile resolver (`toCraftProfessional`) renders region and covered areas only. The phone is a `tel:` action, never printed as text. Nothing in this phase widens that. The customer's own `craft_requests.address` stays in the request.

## Not built, and why

- **A request stored without a provider in `craft_requests`.** `provider_id` is NOT NULL, and that constraint is what the rate limit, the read policy and the review gate depend on. A provider-less request table would be a schema change, so I wrote no 0315 migration. The demand table already stores exactly this kind of unmet need.
- **Matching or dispatch.** None exists, so none is claimed. The copy says the brief is read by the team.
- **Availability and response times on cards.** No data behind them (0 providers), so nothing is shown.
- **Portfolio, before/after and pricing modes.** Already implemented in `src/components/professional/**` and `lib/professional.ts` (`per_unit`, `quote_required`, `beforeImageUrl`). They cannot render against real data until a provider exists.

## Gap found, not fixed (outside my files)

- The lexicon does not know «كهربا» or «الكهربا مقطوعة», the most common Lebanese problem sentence, so it resolves to no trade. The fix is to add these triggers to `trade("electrician", …)` in `src/lib/search-intent.ts` (Phase 2 file). I did not add a parallel synonym list in my own files.

## Files

- `src/lib/professional.ts`: `supplyRobots()`, `splitServicesByOwner()`
- `src/lib/pro-market.ts` (new): `craftIntentFromProblem()` (lexicon reuse plus handling of «ب/بال/عال/لل» prepositions), job helpers
- `src/components/crafts/craft-problem-ask.tsx`: local understanding, area auto-fill, «فهمنا:» row
- `src/components/crafts/craft-request-flow.tsx`: trade/area inference with a visible note; `DemandCapture` on no-match
- `src/app/[lang]/(site)/crafts/(index)/page.tsx`: metadata (canonical, robots), `understood` label
- `src/app/[lang]/(site)/crafts/[trade]/page.tsx`: zero-supply and filtered robots, canonical
- `src/app/[lang]/(site)/crafts/requests/page.tsx`: inferred labels, demand copy overlay, no-match copy
- `src/i18n/dictionaries/{ar,en}.json`: new `proMarket` namespace (single insertion before `"features"`, CRLF kept, JSON.parse validated)
- Tests: `src/lib/__tests__/pro-market.test.ts` (new), `src/lib/__tests__/professional.test.ts` (extended)
