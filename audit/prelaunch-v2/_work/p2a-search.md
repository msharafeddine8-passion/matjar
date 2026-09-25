# P2-A: Search v2 (Arabic and Lebanese intent)

Branch `feat/matjar-prelaunch-foundation`. Nothing was committed, pushed, built or migrated. There were no DB writes. Production was only read, with the anon key: `trades`, `lb_areas`, `business_types`, `stores`, `doctors`, `listings`, plus the RPCs `normalize_search` and `search_products_fuzzy`.

## Files changed

- `src/lib/search-intent.ts` (new): pure intent parser. It contains the DB-parity `normalizeArabic`, the matching fold `foldArabic`, conservative stemming, and the 87-concept lexicon. It also holds the 47 trades and 45 areas copied from the seed, which the tests re-check. Store-plan building, ranking, product and listing term selection, and `intentLinks` live here too.
- `src/lib/__tests__/search-intent.test.ts` (new): 75 tests.
- `src/lib/data/search.ts`: `searchAll` parses intent first and returns `intent`. Products are searched for up to 3 terms and merged. Listings are searched for up to 2 terms, or the market's latest listings when the query names the section itself.
- `src/lib/data/stores.ts`: only `searchStores` changed. It takes an optional `plan` and runs 3 bounded reads in parallel: text, sector pull, and region pull. It also reads doctor specialties. Rows still go through `rowToStore` and `listable`, so blocked stores never rank. The pure module is loaded with a lazy `import()` inside the function, so no line outside it changed.
- `src/app/[lang]/(site)/search/page.tsx`: adds the intent line «فهمنا إنك عم تدوّر على: …» with link chips, and `<div id="demand-capture-slot" />` directly under the zero-result EmptyState.
- `src/components/header-search.tsx`: the scroll-revealed header search is now `hidden lg:block` (P1-MOBILE-01).
- `src/i18n/dictionaries/ar.json` and `en.json`: one `searchIntent` namespace each, inserted as one block right before `  "features": {`. The files were CRLF at insertion time and CRLF was kept. Both pass `JSON.parse`.

## Lexicon coverage

| Maps to | Concepts | Triggers | Examples |
|---|---|---|---|
| sector food | 1 | 55 | مطعم، مطاعم، اكل، برغر، بيتزا، شاورما، فلافل، فول، منقوشة، سندويش، مشاوي، كافيه |
| sector healthcare | 1 | 25 | دكتور، طبيب، حكيم، عيادة، عيادات، مستوصف، مستشفى، مركز طبي |
| healthcare + specialty | 12 | 59 | عيون، اسنان، امراض جلدية، توليد، طب اطفال، مسالك، اشعة، مختبر، تحاليل، طبيب نفسي |
| sector pharmacy | 1 | 8 | صيدلية، فارمسي، دوا، ادوية |
| sector retail (subtopics) | 6 | 58 | ملابس، تياب، البسة، اواعي، فساتين، صبابيط؛ iphone، ايفون، سامسونج، لابتوب، موبايل؛ مفروشات؛ سوبرماركت |
| sector beauty | 1 | 21 | صالون، حلاق، كوافير، تجميل، مكياج، اظافر، عطر |
| sector petCare | 1 | 18 | قطة، قطط، بسينة، كلب، بيطري، حيوانات |
| sector realEstate | 1 | 16 | شقة، شقق، عقار، ارض، فيلا، بيت للبيع |
| deal modifier (rent / sale) | 2 | 8 | ايجار، للايجار؛ للبيع. These are not a sector on their own: «سيارة للايجار» is a car. |
| sector automotive | 1 | 12 | سيارة، سيارات، اوتو، كراج |
| other sectors (education, fitness, sportsCourts, events, hospitality, professional, farm, services) + group sports | 9 | 55 | دورات، جيم، بادل، قاعة، فندق، محامي، مزرعة، تاكسي، سفر |
| section market | 1 | 13 | سوق الاحد / الأحد، مستعمل، second hand |
| section crafts (no trade) | 1 | 12 | حرفي، صنايعي، تصليح، مصلح، صيانة |
| section freelance | 1 | 8 | فريلانس، مستقل، عمل حر |
| section jobs | 1 | 11 | وظيفة، وظائف، وظايف، فرصة عمل |
| crafts trade (sector contractors) | 40 | 163 | كهربجي، سنكري، نجار، دهان، مبلط، مكيف، مكيف ما عم يبرد، براد، غسالة، مولد، طاقة شمسية، طرمبة، ستلايت |
| crafts trade (sector automotive) | 7 | 26 | ميكانيكي، بنشر، كوشوك، ونش، غسيل سيارات |

- **Totals:** 87 concepts and 568 triggers. All 47 of 47 trade slugs are covered.
- **Places:** 45 areas plus 27 real spelling variants, for example «ابو سمرا» and «طرابلوس/trablos». The 5 regions are covered.
- **Ambiguous words are deliberately not treated as places:**
  - «صور» means pictures, so only Latin «Tyre/sour» resolves to Tyre.
  - «حمرا», «شوف», «كورة» and «مزرعة» resolve as places only when written with ال (الحمرا، الشوف، الكورة، المزرعة).
  - «الجبل» is not a place, because «جبل محسن» is in Tripoli.
- **Also left out on purpose:**
  - «بيت» alone, because it appears in shop names.
  - «فرن» alone, because it means bakery.
  - «جلدية» alone, because «ملابس جلدية» is leather clothing.

**Normalisation finding.** The brief assumed `normalize_search` folds ة to ه. It does not. `translate('أإآٱىة','ااااية')` maps ة to itself, and I confirmed this on production: `normalize_search('مَدْرَسَةٌ')` returns `مدرسة`. `normalizeArabic` mirrors the DB exactly, with 15 fixtures taken from live RPC output. The ة→ه fold happens only inside `foldArabic`, which is used for matching.

## The 8 real zero-result queries, now

This is `parseSearchIntent` plus the same reads and ranking as `searchStores`, run read-only against production with the anon key on 2026-09-25.

| Query | Understood | Now returns | Chip / link |
|---|---|---|---|
| مطاعم | food | 1 store: Let's meat | /ar/explore?sector=food |
| ملابس | retail (clothing subtopic) | 1 store: ألبسة نسائي ولادب. The 8 unrelated retailers are held back by the subtopic precision rule. | /ar/explore?sector=retail |
| سوق الاحد | section market | 3 Sunday-Market listings (latest): ايفون 11 برو ماكس، MARTADEL، 3 كيلو فخاد | /ar/market |
| قطة | petCare | **0.** Production has no active petCare store, although the brief assumed one exists. The intent line shows «عناية بالحيوانات». The explore chip is hidden because coverage is 0, and the empty state plus the demand-capture slot handle it. | (hidden, sector empty) |
| فول | food | 1 store: Let's meat | /ar/explore?sector=food |
| للرجال | no sector (audience word); stems to «رجال» | 1 store: Aanab_perfumes («الروائح الرجالية») | none |
| ايتوماكس | nothing (brand) | 0. This is documented as a brand with no match; nothing is invented. | none |
| etumax | nothing (brand) | 0, same as above | none |

The brief's examples:

- «دكتور عيون طرابلس» → healthcare + ophthalmology + Tripoli (north). It returns دكتور عمر الصمد (description «عيادة عيون») and then مركز الضنية الطبي (doctor «أخصائي طب و جراحة عيون»). Chip: /ar/explore?sector=healthcare&region=north.
- «مكيف ما عم يبرد» → crafts / `ac-service`, services group. It returns 0 stores. Chip: /ar/crafts/ac-service.
- «شقة للايجار» → realEstate + rent. It returns 0 because there is no realEstate store, so the chip is hidden.
- «برغر» → food. It returns Let's meat.
- «iphone» → retail. It returns Qabass Computers plus the listing «ايفون 11 برو ماكس», found through the Arabic spelling.

A place on its own, «طرابلس», returns all 16 North stores, with the ones whose area names Tripoli first.

## Gates (verbatim)

```
npx tsc --noEmit -p .            → tsc exit 0
npx vitest run                   → Test Files  52 passed (52) / Tests  915 passed (915)
npx vitest run src/lib/__tests__/search-intent.test.ts → Tests  75 passed (75)
npx eslint src/lib/search-intent.ts src/lib/__tests__/search-intent.test.ts src/lib/data/search.ts src/lib/data/stores.ts "src/app/[lang]/(site)/search/page.tsx" src/components/header-search.tsx → eslint exit 0
```

Not run: `next build` (forbidden) and the port-3291 server (skipped as instructed). The page and header changes are not browser-verified and need a real-phone check.

## Notes for the orchestrator

- **P1-MOBILE-01: the store page has no store-scoped search.** I searched `src/components/store/**`, `store-products.tsx` and the store route. The two stacked bars are both global: `MobileSearch`, the permanent `lg:hidden` row in the header, and `HeaderSearch`, which slides in after `scrollY > 460` at every width. So the fix is the second option in the brief: hide the scroll-revealed one below `lg`. It fixes every long page, not only store pages, and desktop is unchanged. No «دوّر بـ{storeName}» field exists to rename.
- **`stores.ts` is being edited by the card-facts agent.** My change is confined to `searchStores`. Search results still return `Store[]`; `attachCardRollups` is not called on them. If the card-facts work wants its facts line on search cards, it should add that call at the end of `searchStores`.
- **Where the reference data comes from.** The trade and area lists are in code and cite migration 0236. Production returned the identical 47 and 45 rows. The tests re-parse that migration, so any invented or drifted slug fails CI.
- **Ranking rules:**
  - Residual text first, then intent words, then specialty, then area, region, sector, and rating.
  - A different stated region excludes a store. A null region keeps it.
  - Intent vocabulary only ranks stores inside the understood sector, so «صيانة سيارة» does not return a taxi firm.
  - A specialty is precise: «اسنان» with no dentist returns 0, not an eye clinic.
  - Subtopics (clothing, electronics, trades) drop sector members that match no word when some member does.

## CSV

```
issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P1-SEARCH-01|P1|search|/[lang]/search|food,retail|Category words (مطاعم، ملابس، فول، برغر) returned zero stores although matching stores exist|searchStores was one ILIKE of the whole query on name/description/area; nobody names a shop «مطاعم»|Intent lexicon maps category words to CategoryKeys; searchStores also pulls stores of that sector and ranks them; subtopic precision rule|src/lib/search-intent.ts; src/lib/data/stores.ts|fixed|مطاعم 0; ملابس 0; فول 0; برغر 0|مطاعم 1 (Let's meat); ملابس 1 (ألبسة نسائي ولادب); فول 1; برغر 1|Verified read-only on production 2026-09-25
P1-SEARCH-02|P1|search|/[lang]/search|market|«سوق الاحد» (the section's own name) returned zero|Listings were searched by title ILIKE of the whole query; section names meant nothing|Section intents (market/crafts/freelance/jobs); a market-only query returns the latest listings and a chip to /[lang]/market|src/lib/search-intent.ts; src/lib/data/search.ts; search/page.tsx|fixed|0|3 listings + /ar/market chip|«مستعمل» behaves the same
P1-SEARCH-03|P1|search|/[lang]/search|all|Plurals, articles and clitics (للرجال، المطاعم، عيادات) missed|No normalisation or stemming on the store/product path|foldArabic + conservative stemVariants (ال/لل/وال/بال/و; ات/ين/ون/ية/ة), the typed word always first; alef and final ة wildcards in ILIKE for words of 4+ letters|src/lib/search-intent.ts|fixed|للرجال 0|للرجال 1 (Aanab_perfumes «الرجالية»)|Stems never shorter than 3 letters
P1-SEARCH-04|P1|search|/[lang]/search|all|A place inside the query («دكتور عيون طرابلس») was matched as literal text|No location extraction|45 lb_areas + aliases + region words; region filters (null region kept), area boosts; a place-only query pulls its region|src/lib/search-intent.ts; src/lib/data/stores.ts|fixed|0|2 clinics, Tripoli first|Ambiguous words (صور، حمرا، شوف، كورة، جبل) are not places
P1-SEARCH-05|P1|search|/[lang]/search|contractors|Repair problems («مكيف ما عم يبرد») had no path to the crafts section|Crafts trades were not connected to site search|40+7 trade concepts using only real public.trades slugs; chip to /[lang]/crafts/<trade>?area=<slug>|src/lib/search-intent.ts; search/page.tsx|fixed|0 and no link|0 stores + /ar/crafts/ac-service chip|Test asserts every lexicon slug exists in migration 0236
P1-SEARCH-06|P2|search|/[lang]/search|healthcare|Specialty searches ignored doctors.specialty and stores.specialties|Store search read neither|13 specialties; doctors.specialty OR read to store ids; stores.specialties added to the text OR; a specialty with no match returns 0 rather than another clinic|src/lib/search-intent.ts; src/lib/data/stores.ts|fixed|دكتور عيون طرابلس 0|2|No dentist on the platform, so «اسنان» still returns 0 (supply gap)
P1-SEARCH-07|P2|search|/[lang]/search|retail|«iphone» missed the listing titled «ايفون 11 برو ماكس»|Single-script title ILIKE|Pairable concepts (iphone, samsung) also search the other script's spelling in listings|src/lib/search-intent.ts; src/lib/data/search.ts|fixed|0|2 (Qabass + the listing)|Only tight synonym sets cross scripts
P1-SEARCH-08|P1|search|/[lang]/search|all|Zero-result page offered no route to the filtered views that answer the query|No intent display|Intent line «فهمنا إنك عم تدوّر على: …» + chips to /explore?sector/group/region (parseDiscoveryQuery params), crafts trade, section roots; chips onto sectors with 0 stores are hidden; #demand-capture-slot under EmptyState|search/page.tsx; dictionaries (searchIntent)|fixed|none|intent line + chips|Demand form to be mounted by the demand track
P1-SEARCH-09|P2|search|/[lang]/search|—|Brand queries (ايتوماكس / etumax) return zero|No such brand on the platform|None invented: confidence 0, literal text search only; route to demand capture|src/lib/search-intent.ts|wontfix-data|0|0|A supply gap, not a search bug
P1-SEARCH-10|P3|search|/[lang]/search|—|The brief assumed normalize_search folds ة→ه|The SQL translate maps ة to itself (verified live)|normalizeArabic mirrors the DB exactly (15 live fixtures); the ة→ه fold only in foldArabic for matching|src/lib/search-intent.ts; search-intent.test.ts|documented|—|—|Changing the DB function was out of scope (no migrations)
P1-SEARCH-11|P2|supply|/[lang]/explore|petCare,realEstate,automotive|«قطة», «شقة للايجار», «صيانة سيارة» are understood but have no stores|No active store in those sectors in production|Intent line names the need; empty-sector chips hidden; demand capture handles the rest|search/page.tsx|open-supply|0|0 (understood)|Recruitment target, per search_logs
P1-MOBILE-01|P1|mobile|/[lang]/store/[id]|all|On a phone after scrolling, two identical search bars stack in the header|Global MobileSearch (permanent, lg:hidden) plus HeaderSearch (revealed after scrollY>460 at every width); no store-scoped search exists|HeaderSearch wrapper gets `hidden lg:block`; desktop unchanged|src/components/header-search.tsx|fixed-unverified|2 bars below lg after scroll|1 bar below lg|Affects every long page; needs a real-phone check (no dev server was run)
```
