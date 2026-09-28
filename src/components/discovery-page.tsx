import { SearchX } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { CategoryKey } from "@/lib/catalog";
import { dictSlice } from "@/lib/dict-slice";
import {
  clearedQuery,
  discoveryHref,
  groupOptions,
  isDefaultQuery,
  parseDiscoveryQuery,
  regionOptions,
  resolveFilters,
  sectorOptions,
  withQuery,
  type DiscoveryQuery,
} from "@/lib/discovery";
import {
  getDiscoveryCoverage,
  getDiscoveryResults,
} from "@/lib/data/discovery";
import { getUsdLbpRate } from "@/lib/data/settings";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DiscoveryFilters } from "@/components/discovery-filters";
import { ExploreClient } from "@/components/explore-client";
import { SectorShortcuts } from "@/components/search/sector-shortcuts";

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** The query a page will actually run: the URL, with a category page's sector
 *  forced so `?sector=` cannot be used to browse a different sector from inside
 *  one, and so the canonical URL of /category/food is never /category/food with
 *  a contradicting parameter. */
export function resolveQuery(
  sp: RawSearchParams,
  pinned?: CategoryKey,
): DiscoveryQuery {
  const q = parseDiscoveryQuery(sp);
  return pinned ? { ...q, sector: pinned, group: null } : q;
}

/**
 * The body shared by /explore and /category/[slug].
 *
 * Both pages ask the same question — "which stores, given these constraints" —
 * and the only difference is whether the sector is chosen by the buyer or fixed
 * by the route. Keeping one server component means the URL contract, the
 * emptiness rules and the pagination behave identically on both, rather than
 * drifting the way two copies of a filter bar always do.
 */
export async function DiscoveryPage({
  lang,
  dict,
  base,
  query,
  pinned,
  header,
}: {
  lang: Locale;
  dict: Dictionary;
  /** Locale-prefixed path, e.g. `/ar/explore`. */
  base: string;
  query: DiscoveryQuery;
  pinned?: CategoryKey;
  /** Rendered above the filters — each route's own title block. */
  header?: React.ReactNode;
}) {
  const [coverage, result, lbpRate] = await Promise.all([
    getDiscoveryCoverage(),
    getDiscoveryResults(query),
    getUsdLbpRate(),
  ]);

  const filters = resolveFilters(pinned ? [pinned] : null, coverage);
  const facets = {
    groups: groupOptions(coverage),
    sectors: sectorOptions(coverage),
    regions: regionOptions(coverage),
  };

  // A pinned sector lives in the path, so it is stripped from every link this
  // page builds — one page, one address.
  const linkQuery: DiscoveryQuery = pinned ? { ...query, sector: null } : query;
  const sectorIsEmpty = pinned != null && (coverage.bySector[pinned] ?? 0) === 0;
  // Browse belongs on the arrival screen only. The moment a buyer has typed or
  // narrowed something, the answer is the page, and a grid of doors above it
  // pushes that answer off the phone.
  const showBrowse = pinned == null && isDefaultQuery(query);
  const pageHref = (p: number) =>
    discoveryHref(base, withQuery(linkQuery, { page: p }));

  return (
    <Container className="py-6 sm:py-8">
      {header}

      <DiscoveryFilters
        lang={lang}
        dict={dictSlice(dict, [
          "discovery",
          "catalog",
          "groups",
          "sort",
          "explore",
          "common",
          "sectorCards",
        ])}
        base={base}
        query={query}
        filters={filters}
        facets={facets}
        pinned={pinned}
        total={result.total}
      />

      {/* Browse, on the screen where there is nothing to narrow yet.
          Phones only: the sector facet row above is `hidden lg:flex`, so at
          desktop width these tiles would be a second copy of a control the
          buyer can already see, while on a phone the sectors exist nowhere
          except inside the filter sheet. A category page is excluded — you are
          already inside a sector, and the doors out of it are the sibling links
          in its own header. */}
      {showBrowse && (
        <SectorShortcuts
          className="mt-6 lg:hidden"
          title={dict.categories.title}
          titleId="sec-browse"
          options={facets.sectors}
          names={dict.catalog}
          countLabel={dict.discovery.storesCount}
          href={(key) => discoveryHref(base, withQuery(linkQuery, { sector: key }))}
        />
      )}

      <section aria-labelledby="sec-results" className="mt-6">
        <h2 id="sec-results" className="text-sm text-muted-foreground">
          <span className="font-bold tabular-nums text-foreground">
            {result.total}
          </span>{" "}
          {dict.explore.results}
        </h2>

        <div className="mt-4">
          {result.stores.length > 0 ? (
            <ExploreClient
              lang={lang}
              dict={dictSlice(dict, [
                "explore",
                "catalog",
                "featured",
                "discovery",
                "trust",
                "offering",
                "sectorCards",
              ])}
              stores={result.stores}
              lbpRate={lbpRate}
              term={query.q}
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title={dict.discovery.emptyTitle}
              description={dict.discovery.emptyBody}
              // On a sector with no merchant at all, "clear the filters" would
              // reload the same empty page. The only honest way out is the rest
              // of the marketplace.
              action={
                sectorIsEmpty
                  ? { href: `/${lang}/explore`, label: dict.explore.title }
                  : {
                      href: discoveryHref(base, {
                        ...clearedQuery(linkQuery),
                        q: "",
                      }),
                      label: dict.discovery.clearAll,
                    }
              }
            />
          )}
        </div>

        {result.pageCount > 1 && (
          <nav
            aria-label={dict.sort.label}
            className="mt-8 flex items-center justify-center gap-3"
          >
            {result.page > 1 ? (
              <ButtonLink href={pageHref(result.page - 1)} variant="secondary">
                {dict.discovery.prevPage}
              </ButtonLink>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted-foreground tabular-nums">
              {result.page} / {result.pageCount}
            </span>
            {result.page < result.pageCount && (
              <ButtonLink href={pageHref(result.page + 1)}>
                {dict.discovery.nextPage}
              </ButtonLink>
            )}
          </nav>
        )}
      </section>
    </Container>
  );
}
