import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SearchX, Package, ShoppingBag, Store as StoreIcon } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { searchAll } from "@/lib/data/search";
import { getDiscoveryCoverage } from "@/lib/data/discovery";
import { getUsdLbpRate } from "@/lib/data/settings";
import { groupBySector, sectorOptions } from "@/lib/discovery";
import { regions } from "@/lib/catalog";
import {
  AREA_BY_SLUG,
  TRADES,
  hasIntent,
  intentLinks,
  type SearchIntent,
} from "@/lib/search-intent";
import { categoryIcons } from "@/components/category-icon";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronNext, ChevronPrev } from "@/components/ui/directional-icon";
import { StoreCard } from "@/components/store-card";
import { ProductMiniCard } from "@/components/product-mini-card";
import { MarketListingCard } from "@/components/market-listing-card";
import { StoreMapClient } from "@/components/store-map-client";
import type { MapStore } from "@/components/store-map";
import { TrackSearch } from "@/components/track-search";
import { SearchBox } from "@/components/search/search-box";
import { SearchScreenBar } from "@/components/search/search-screen-bar";
import { RecentSearches } from "@/components/search/recent-searches";
import { SectorShortcuts } from "@/components/search/sector-shortcuts";
import { KindHeading } from "@/components/search/kind-heading";
import { MapResultsLink } from "@/components/search/map-results-link";
import { searchHref } from "@/components/search/recent";
import { DemandCapture } from "@/components/search/demand-capture";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.search.title };
}

/**
 * Search, as a screen rather than a query string with a list under it.
 *
 * One route serves both halves of the same act. With no term it is what you
 * land on when you tap search and have not decided the word yet: a field with
 * the keyboard already up, your own recent searches, and the sectors that
 * actually have stores. With a term it is the answer — and it keeps the field,
 * so correcting one letter does not mean going back out to the header.
 *
 * ONE TREE, TWO READINGS. Below `lg` this is the app's search screen: its own
 * bar with a back chevron, results grouped by KIND with the count each query
 * returned, and a way onto the map. From `lg` up it is the results page that
 * was already here, grouped by SECTOR, unchanged. Both come out of the same
 * markup on purpose — rendering the phone screen as a separate subtree would
 * put every store card and every product image into the document twice, and on
 * a phone the browser would fetch both copies.
 *
 * Two rules run through it. Nothing is a group unless it has rows: the sector
 * headings are read off the results, so "مطاعم" cannot appear above an empty
 * list, and the map link does not exist unless some result carries a pin. And
 * nothing is invented — there is no "trending" block, because the table that
 * would have to supply it holds two rows from one minute of one day.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ q?: string; region?: string; view?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const l = lang as Locale;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const t = dict.search;
  const wantsMap = sp.view === "map" && q !== "";

  // Coverage is the same sixty-second cached read the discovery pages make, so
  // wanting it on both halves of this screen costs one round trip platform-wide
  // rather than one per search.
  const [results, lbpRate, coverage] = await Promise.all([
    q ? searchAll(q, l, sp.region) : null,
    q ? getUsdLbpRate() : Promise.resolve(0),
    wantsMap ? Promise.resolve(null) : getDiscoveryCoverage(),
  ]);

  const stores = results?.stores ?? [];
  const products = results?.products ?? [];
  const listings = results?.listings ?? [];
  const total = stores.length + products.length + listings.length;
  const storeGroups = groupBySector(stores);
  const intent = results?.intent ?? null;

  // The only results that can become a pin. `searchStores` selects lat/lng and
  // most rows come back null — 7 of the 15 live stores have ever been placed —
  // so this is a filter over what the query returned, never an assumption about
  // it. Products and Sunday-Market listings have no coordinates at all and are
  // not counted here; the link says "results" and means the mappable ones,
  // which is why the number is printed beside it.
  const mapStores: MapStore[] = stores.flatMap((s) =>
    s.lat != null && s.lng != null
      ? [{ id: s.id, name: s.name[l], lat: s.lat, lng: s.lng }]
      : [],
  );

  const resultsHref = searchHref(lang, q);
  const mapHref = q
    ? `/${lang}/search?${new URLSearchParams({ q, view: "map" }).toString()}`
    : "";

  // ---------------------------------------------------------------------
  // The map of one search's results.
  //
  // A separate view rather than a toggle on the list: the list and the map
  // want the whole width of a phone, and a shared link should open the one
  // that was shared. Reached only from the link above, which does not render
  // when there is nothing to plot — but the view is a URL, so it still has to
  // survive being typed with a term that plots nothing.
  // ---------------------------------------------------------------------
  if (wantsMap) {
    return (
      <div className="pb-16">
        <Container className="py-4 sm:py-8">
          <Link
            href={resultsHref}
            className="inline-flex h-11 items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronPrev aria-hidden className="h-4 w-4" />
            {t.mapBack}
          </Link>
          <h1 className="mt-2 text-xl font-extrabold tracking-tight sm:text-3xl">
            {t.mapHeading}{" "}
            <span className="text-primary">&ldquo;{q}&rdquo;</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">
              {mapStores.length}
            </span>{" "}
            {dict.discovery.storesCount}
          </p>
          <div className="mt-4">
            {mapStores.length ? (
              <StoreMapClient
                stores={mapStores}
                lang={l}
                heightClass="h-[60vh] sm:h-[70vh]"
              />
            ) : (
              <EmptyState icon={SearchX} title={dict.map.empty} />
            )}
          </div>
        </Container>
      </div>
    );
  }

  // The browse blocks belong where there is nothing else to read: before a term
  // is typed, and after one came back with nothing. Above a page of answers
  // they are furniture between the buyer and what they asked for.
  const showBrowse = !q || total === 0;

  return (
    <div className="pb-16">
      {/* The phone screen's own bar, full-bleed above the gutter. Rendered
          first so that when both fields carry autoFocus the one a phone can
          actually focus is the one that gets it — a focus() call on the
          display:none field beside it is a no-op that leaves this one alone. */}
      <SearchScreenBar
        lang={lang}
        initial={q}
        labels={{
          placeholder: dict.hero.searchPlaceholder,
          back: dict.common.back,
          clear: t.clear,
          submit: t.openSearch,
        }}
        className="lg:hidden"
      />

      <Container className="py-5 sm:py-8">
        {/* The page where somebody types what they want was the one page that
            never recorded it. A search that returns 0 here is a merchant this
            marketplace has not recruited yet, named by a customer. */}
        {q && (
          <TrackSearch
            q={q}
            section="search"
            results={total}
            region={sp.region ?? null}
          />
        )}

        {/* The heading the document needs either way. On a phone the bar above
            already says what screen this is and repeating it costs a third of
            the first viewport, so it is read but not drawn; from `lg` up it is
            the page title it has always been. */}
        <h1 className="sr-only text-2xl font-extrabold tracking-tight lg:not-sr-only lg:text-3xl">
          {q ? (
            <>
              {t.resultsFor}{" "}
              <span className="text-primary">&ldquo;{q}&rdquo;</span>
            </>
          ) : (
            t.title
          )}
        </h1>

        <div className="hidden lg:mt-4 lg:block">
          <SearchBox
            lang={lang}
            initial={q}
            labels={{
              placeholder: dict.hero.searchPlaceholder,
              submit: t.openSearch,
              clear: t.clear,
            }}
          />
        </div>

        {q ? (
          <p className="text-sm text-muted-foreground lg:mt-3">
            <span className="font-bold tabular-nums text-foreground">
              {total}
            </span>{" "}
            {t.resultsCount}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground lg:mt-3">{t.prompt}</p>
        )}

        {/* What the words were understood to mean, and the filtered views
            that answer it directly (P1-SEARCH-01). Drawn with or without
            results: «سوق الاحد» is best answered by the market itself. */}
        {intent && hasIntent(intent) && (
          <IntentLine
            intent={intent}
            lang={l}
            dict={dict}
            sectorHasStores={(s) =>
              coverage ? (coverage.bySector[s] ?? 0) > 0 : true
            }
          />
        )}

        {/* No `action` on purpose. The way out of a search that found nothing
            is the two blocks below — the buyer's own recent terms, and the
            sectors that really have stores — and a third button repeating that
            offer would be the only 40px target on this screen. */}
        {q && total === 0 && (
          <>
            <EmptyState
              className="mt-6"
              icon={SearchX}
              title={t.empty}
              description={t.emptyHint}
            />
            {/* A search that found nothing is still worth something: the
                buyer can tell us what they wanted (lib/demand.ts). */}
            <div className="mt-4">
              <DemandCapture
                lang={l}
                q={q}
                section={intent?.sector ?? "search"}
                region={sp.region ?? intent?.region ?? null}
                dict={{ demand: dict.demand }}
              />
            </div>
          </>
        )}

        {total > 0 && (
          <div className="mt-6 space-y-8 lg:mt-8 lg:space-y-10">
            {stores.length > 0 && (
              <section aria-labelledby="kind-stores">
                {/* Phone only: one group for the kind, with the count off the
                    array. Desktop has no such heading — it reads the sector
                    headings below, which is the grouping it already had. */}
                <KindHeading
                  id="kind-stores"
                  icon={StoreIcon}
                  label={t.stores}
                  count={stores.length}
                />

                {/* One section per sector that actually returned a store. A
                    butcher and a restaurant are not "results", they are two
                    different answers, and the heading is the only thing that
                    says which. On a phone the same headings stay, demoted to a
                    sub-label inside the kind group: the store grid is a single
                    column there, so hiding them would leave three unexplained
                    gaps in one list, and dropping the sections would mean a
                    second copy of every card. */}
                <div className="space-y-5 lg:space-y-10">
                  {storeGroups.map(({ sector, items }) => {
                    const Icon = categoryIcons[sector];
                    const id = `sec-${sector}`;
                    return (
                      <section key={sector} aria-labelledby={id}>
                        <h2
                          id={id}
                          className="mb-3 flex items-center gap-2 text-sm font-bold text-muted-foreground lg:mb-4 lg:text-lg lg:font-extrabold lg:text-foreground"
                        >
                          <Icon
                            aria-hidden
                            className="h-4 w-4 shrink-0 text-primary lg:h-5 lg:w-5"
                          />
                          {dict.catalog[sector].name}
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            ({items.length})
                          </span>
                        </h2>
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                          {items.map((store) => (
                            <StoreCard
                              key={store.id}
                              store={store}
                              lang={l}
                              dict={dict}
                              factsDict={dict.discovery}
                              cardDict={dict.sectorCards}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>

                {/* Renders itself out of existence at zero located stores. */}
                <MapResultsLink
                  href={mapHref}
                  label={t.mapAll}
                  count={mapStores.length}
                  className="mt-5 lg:hidden"
                />
              </section>
            )}

            {products.length > 0 && (
              <section aria-labelledby="sec-products">
                {/* The fuzzy RPC matches services as readily as goods (a
                    clinic's أشعة is a `products` row), so the heading says
                    both on every width — the phone label already did. */}
                <KindHeading
                  id="sec-products"
                  icon={Package}
                  label={t.kindProducts}
                  desktopLabel={t.kindProducts}
                  count={products.length}
                />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {products.map((p) => (
                    <ProductMiniCard
                      key={p.id}
                      lang={l}
                      id={p.id}
                      name={p.name}
                      nameEn={p.nameEn}
                      price={p.price}
                      discountPrice={p.discountPrice}
                      imageUrl={p.imageUrl}
                      storeName={p.storeName}
                      lbpRate={lbpRate}
                      offering={{
                        itemKind: p.itemKind,
                        category: p.category,
                        durationMinutes: p.durationMinutes,
                      }}
                      copy={dict.offering}
                    />
                  ))}
                </div>
              </section>
            )}

            {listings.length > 0 && (
              <section aria-labelledby="sec-listings">
                <KindHeading
                  id="sec-listings"
                  icon={ShoppingBag}
                  label={t.listings}
                  desktopLabel={t.listings}
                  count={listings.length}
                />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {listings.map((listing) => (
                    <MarketListingCard
                      key={listing.id}
                      listing={listing}
                      lang={l}
                      dict={dict}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {showBrowse && (
          <div className="mt-6 space-y-8 lg:mt-8">
            <RecentSearches
              lang={lang}
              titleId="sec-recent"
              labels={{ title: t.recent, clear: t.clear }}
            />
            {coverage && (
              <SectorShortcuts
                title={dict.categories.title}
                titleId="sec-browse"
                options={sectorOptions(coverage)}
                names={dict.catalog}
                countLabel={dict.discovery.storesCount}
                href={(key) => `/${lang}/category/${key}`}
              />
            )}
          </div>
        )}
      </Container>
    </div>
  );
}

type Dict = Awaited<ReturnType<typeof getDictionary>>;

/** The name of the place the intent resolved: the area when one was named
 *  («طرابلس»), else the region («الشمال»). */
function placeName(intent: SearchIntent, lang: Locale): string | null {
  const area = intent.area ? AREA_BY_SLUG.get(intent.area) : undefined;
  if (area) return area[lang];
  const region = regions.find((r) => r.key === intent.region);
  return region ? region.name[lang] : null;
}

const tradeName = (slug: string | undefined, lang: Locale) =>
  TRADES.find((tr) => tr.slug === slug)?.[lang] ?? null;

/**
 * «فهمنا إنك عم تدوّر على: صحة وعيادات · عيون · طرابلس» and, under it, one
 * link per view that answers it (lib/search-intent.ts intentLinks: the real
 * /explore params, a crafts trade page, a section root). Every label is read
 * from data the platform already has — catalog names, the trades and areas
 * seed, section titles — so the line cannot name a thing that does not exist.
 */
function IntentLine({
  intent,
  lang,
  dict,
  sectorHasStores,
}: {
  intent: SearchIntent;
  lang: Locale;
  dict: Dict;
  sectorHasStores: (s: NonNullable<SearchIntent["sector"]>) => boolean;
}) {
  const t = dict.searchIntent;
  const place = placeName(intent, lang);
  const trade = tradeName(intent.trade, lang);
  const sectionTitle = (s: NonNullable<SearchIntent["section"]>) =>
    ({
      market: dict.market.title,
      crafts: dict.crafts.title,
      freelance: dict.freelance.title,
      jobs: dict.jobs.title,
    })[s];

  const parts = [
    intent.sector && !intent.trade ? dict.catalog[intent.sector].name : null,
    !intent.sector && intent.group ? dict.groups[intent.group].name : null,
    intent.specialty ? t.specialties[intent.specialty] : null,
    trade,
    intent.section ? sectionTitle(intent.section) : null,
    intent.deal ? t[intent.deal] : null,
    place,
  ].filter((x): x is string => !!x);

  const links = intentLinks(intent, lang, sectorHasStores);
  const label = (link: (typeof links)[number]): string => {
    if (link.kind === "section") {
      return link.section === "crafts" && trade
        ? `${trade} · ${sectionTitle("crafts")}`
        : sectionTitle(link.section);
    }
    const what = link.sector
      ? dict.catalog[link.sector].name
      : link.group
        ? dict.groups[link.group].name
        : t.allStores;
    // The link filters by REGION (discovery has no area filter), so the chip
    // names the region — «الشمال», not «طرابلس» — and promises only that.
    const regionName = regions.find((r) => r.key === link.region)?.name[lang];
    return regionName
      ? t.inPlace.replace("{what}", what).replace("{where}", regionName)
      : what;
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface-muted/60 p-3 sm:p-4">
      <p className="text-sm text-muted-foreground">
        {t.understood}{" "}
        <span className="font-bold text-foreground">{parts.join(" · ")}</span>
      </p>
      {links.length > 0 && (
        <nav aria-label={t.goTo} className="mt-2.5 flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-11 items-center gap-1 rounded-full border border-primary/30 bg-surface px-4 text-sm font-bold text-primary transition-colors hover:border-primary lg:h-9"
            >
              {label(link)}
              <ChevronNext aria-hidden className="h-4 w-4" />
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
