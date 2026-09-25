"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions, type CategoryKey, type GroupKey, type RegionKey } from "@/lib/catalog";
import {
  DISCOVERY_SORTS,
  activeFilterCount,
  clearedQuery,
  discoveryHref,
  withQuery,
  type BooleanFilterKey,
  type DiscoveryQuery,
  type FacetOption,
  type FilterKey,
} from "@/lib/discovery";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { groupIcons } from "@/components/category-icon";

export type DiscoveryFacets = {
  groups: FacetOption<GroupKey>[];
  sectors: FacetOption<CategoryKey>[];
  regions: FacetOption<RegionKey>[];
};

type Dict = Pick<
  Dictionary,
  "discovery" | "catalog" | "groups" | "sort" | "explore" | "common" | "sectorCards"
>;

const BOOLEAN_KEYS: BooleanFilterKey[] = [
  "openNow",
  "delivers",
  "pickup",
  "hasOffers",
  "hasCatalog",
  "hasPricedServices",
  "rated",
  "verified",
  "registered",
];

/** The newer filters' labels live in the sectorCards namespace; the original
 *  six keep theirs in discovery. One lookup so the chip code needs neither. */
function booleanLabel(dict: Dict, key: BooleanFilterKey): string {
  if (key === "delivers" || key === "pickup" || key === "hasPricedServices")
    return dict.sectorCards.filters[key];
  return dict.discovery[key];
}

function chipClass(active: boolean) {
  return active
    ? "border-primary bg-primary text-primary-foreground"
    : "border-border bg-surface text-foreground hover:border-primary/40";
}

/**
 * The filter bar for /explore and /category/[slug].
 *
 * Every control is an <a href>, not a button that mutates state. That is the
 * whole design: a filtered view is a URL, so it can be shared, bookmarked,
 * opened in a new tab, reached with the back button and crawled — none of which
 * was true while the filtering happened in this component's memory. The chips
 * are in the document even on a phone (CSS hides the desktop row, it is not
 * removed), so a crawler sees the links without running the sheet.
 *
 * Which chips exist at all is not decided here. The page resolves them from live
 * counts (lib/discovery.ts) and passes only the ones the data can honour, so
 * this file never has to know that twelve sectors are empty.
 */
export function DiscoveryFilters({
  lang,
  dict,
  base,
  query,
  filters,
  facets,
  pinned,
  total,
}: {
  lang: Locale;
  dict: Dict;
  /** Locale-prefixed path this bar navigates within, e.g. `/ar/explore`. */
  base: string;
  query: DiscoveryQuery;
  filters: FilterKey[];
  facets: DiscoveryFacets;
  /** Matches for the state now in the URL — the number the page behind the
   *  sheet is already showing. The CTA may print it because it is counted, not
   *  predicted: every chip in the sheet is a link, so the navigation has
   *  happened by the time this arrives. A sheet that batched selections and
   *  applied them on close could not honestly name a count, which is the reason
   *  the chips were left as links rather than turned into checkboxes. */
  total: number;
  /** Set on /category/[slug], where the sector lives in the PATH. Every link
   *  below then omits it: `?sector=services` on top of `/category/services` is
   *  a second address for one page, which is exactly what the canonical work
   *  in the page metadata exists to prevent. */
  pinned?: CategoryKey;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [term, setTerm] = useState(query.q);
  // The URL is the source of truth: when the buyer arrives on a shared link or
  // presses Back, the box has to show the term that produced what is on screen.
  const committed = useRef(query.q);
  useEffect(() => {
    if (query.q !== committed.current) {
      committed.current = query.q;
      setTerm(query.q);
    }
  }, [query.q]);

  const has = (key: FilterKey) => filters.includes(key);
  // What the links are built from; identical to `query` except on a pinned page.
  const linkQuery: DiscoveryQuery = pinned ? { ...query, sector: null } : query;
  const href = (patch: Partial<DiscoveryQuery>) =>
    discoveryHref(base, withQuery(linkQuery, patch));
  // Counted off linkQuery, so the sector a category page is FOR is not reported
  // to the buyer as a filter they chose and can clear.
  const active = activeFilterCount(linkQuery);
  const regionName = (key: RegionKey) =>
    regions.find((r) => r.key === key)?.name[lang] ?? key;

  // Typing replaces the address rather than pushing it, so a search does not
  // bury the previous page under twenty history entries.
  function search(next: string) {
    setTerm(next);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      committed.current = next.trim();
      router.replace(discoveryHref(base, withQuery(linkQuery, { q: next.trim() })), {
        scroll: false,
      });
    }, 400);
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const booleanChips = BOOLEAN_KEYS.filter(has).map((key) => ({
    key,
    label: booleanLabel(dict, key),
    href: href({ [key]: !query[key] } as Partial<DiscoveryQuery>),
    on: query[key],
  }));

  const sectorChips = has("sector") ? facets.sectors : [];
  const regionChips = has("region") ? facets.regions : [];
  const groupChips = has("group") ? facets.groups : [];

  const clearHref = discoveryHref(base, clearedQuery(linkQuery));

  return (
    <div className="space-y-3">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (searchTimer.current) clearTimeout(searchTimer.current);
          committed.current = term.trim();
          router.push(
            discoveryHref(base, withQuery(linkQuery, { q: term.trim() })),
          );
        }}
        className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 focus-within:border-primary"
      >
        <Search aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          value={term}
          onChange={(e) => search(e.target.value)}
          placeholder={dict.explore.searchPlaceholder}
          aria-label={dict.explore.searchPlaceholder}
          className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {term && (
          <button
            type="button"
            onClick={() => search("")}
            aria-label={dict.discovery.clearAll}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {/* Groups are navigation, not a filter drawer item — they stay on screen
          at every width. One scrolling row on a phone: nine wrapped chips push
          the results, the thing the buyer came for, a screen down. */}
      {groupChips.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
          <Link
            href={href({ group: null, sector: null })}
            className={`inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${chipClass(
              !query.group && !query.sector,
            )}`}
          >
            {dict.explore.allCategories}
          </Link>
          {groupChips.map(({ key, count }) => {
            const GIcon = groupIcons[key];
            const on = query.group === key;
            return (
              <Link
                key={key}
                href={href({ group: on ? null : key, sector: null })}
                aria-current={on ? "true" : undefined}
                className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${chipClass(on)}`}
              >
                <GIcon aria-hidden className="h-4 w-4" />
                {dict.groups[key].name}
                <span className="text-xs font-medium tabular-nums opacity-70">
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Phones: one bar, one sheet. */}
      {(booleanChips.length > 0 ||
        sectorChips.length > 0 ||
        regionChips.length > 0) && (
        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setSheet(true)}
            className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors ${chipClass(active > 0)}`}
          >
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {dict.discovery.filters}
            {active > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1 text-xs font-bold text-primary tabular-nums">
                {active}
              </span>
            )}
          </button>
          {active > 0 && (
            <Link
              href={clearHref}
              className="inline-flex h-11 items-center px-2 text-sm font-semibold text-muted-foreground underline"
            >
              {dict.discovery.clearAll}
            </Link>
          )}
        </div>
      )}

      {/* Desktop: the same links, laid out. In the document at every width, so a
          crawler finds them whether or not it opens a sheet. */}
      <div className="hidden flex-col gap-3 lg:flex">
        {sectorChips.length > 0 && (
          <FacetRow label={dict.discovery.sector}>
            {sectorChips.map(({ key, count }) => (
              <Chip
                key={key}
                href={href({ sector: query.sector === key ? null : key })}
                on={query.sector === key}
                label={dict.catalog[key].name}
                count={count}
              />
            ))}
          </FacetRow>
        )}
        {regionChips.length > 0 && (
          <FacetRow label={dict.discovery.region}>
            {regionChips.map(({ key, count }) => (
              <Chip
                key={key}
                href={href({ region: query.region === key ? null : key })}
                on={query.region === key}
                label={regionName(key)}
                count={count}
              />
            ))}
          </FacetRow>
        )}
        {booleanChips.length > 0 && (
          <FacetRow label={dict.discovery.filters}>
            {booleanChips.map((c) => (
              <Chip key={c.key} href={c.href} on={c.on} label={c.label} />
            ))}
            {active > 0 && (
              <Link
                href={clearHref}
                className="inline-flex h-11 items-center px-2 text-sm font-semibold text-muted-foreground underline"
              >
                {dict.discovery.clearAll}
              </Link>
            )}
          </FacetRow>
        )}
        {/* Sort is tied to there being something to sort. When the page has
            resolved to no filters at all — an empty sector — three ways to
            order nothing is one more dead control. */}
        {filters.length > 0 && (
          <FacetRow label={dict.sort.label}>
            {DISCOVERY_SORTS.map((s) => (
              <Chip
                key={s}
                href={href({ sort: s })}
                on={query.sort === s}
                label={dict.sort[s]}
              />
            ))}
          </FacetRow>
        )}
      </div>

      {/* The sheet ends where the thumb already is, with the count it earned.
          The number is the live one for the URL the page is on — the chips
          inside are links, and the sheet stays open across that navigation, so
          a buyer narrows and watches this number move before deciding they are
          done. Nothing here forecasts a selection that has not been applied. */}
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={dict.discovery.filters}
        closeLabel={dict.common.close}
        footer={
          <div className="flex items-center gap-2">
            {active > 0 && (
              <Link
                href={clearHref}
                onClick={() => setSheet(false)}
                className="flex h-12 shrink-0 items-center justify-center rounded-xl border border-border px-5 text-sm font-bold"
              >
                {dict.discovery.clearAll}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setSheet(false)}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {dict.discovery.showResults}
              <span className="tabular-nums">({total})</span>
            </button>
          </div>
        }
      >
        {/* A tap here no longer dismisses the sheet. Closing on the first chip
            meant a buyer who wanted "open now" AND "has offers" had to find the
            filter button twice, and it made the footer's count unreadable —
            gone before the page behind had recounted. */}
        <div className="space-y-5 pb-2">
          {sectorChips.length > 0 && (
            <SheetGroup label={dict.discovery.sector}>
              {sectorChips.map(({ key, count }) => (
                <Chip
                  key={key}
                  href={href({ sector: query.sector === key ? null : key })}
                  on={query.sector === key}
                  label={dict.catalog[key].name}
                  count={count}
                />
              ))}
            </SheetGroup>
          )}
          {regionChips.length > 0 && (
            <SheetGroup label={dict.discovery.region}>
              {regionChips.map(({ key, count }) => (
                <Chip
                  key={key}
                  href={href({ region: query.region === key ? null : key })}
                  on={query.region === key}
                  label={regionName(key)}
                  count={count}
                />
              ))}
            </SheetGroup>
          )}
          {booleanChips.length > 0 && (
            <SheetGroup label={dict.discovery.filters}>
              {booleanChips.map((c) => (
                <Chip key={c.key} href={c.href} on={c.on} label={c.label} />
              ))}
            </SheetGroup>
          )}
          <SheetGroup label={dict.sort.label}>
            {DISCOVERY_SORTS.map((s) => (
              <Chip
                key={s}
                href={href({ sort: s })}
                on={query.sort === s}
                label={dict.sort[s]}
              />
            ))}
          </SheetGroup>
        </div>
      </BottomSheet>
    </div>
  );
}

function FacetRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label me-1 w-24 shrink-0 text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function SheetGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-label text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  href,
  on,
  label,
  count,
}: {
  href: string;
  on: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      // aria-pressed is only valid on role="button". On a link the browser
      // ignores it entirely, so a screen-reader user had no way to tell which
      // sector filter was active — axe reports it as a critical violation
      // across all 13 chips. aria-current is the link equivalent, and it is
      // announced.
      aria-current={on ? "page" : undefined}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${chipClass(on)}`}
    >
      {label}
      {count != null && (
        <span className="text-xs font-medium tabular-nums opacity-70">
          {count}
        </span>
      )}
    </Link>
  );
}
