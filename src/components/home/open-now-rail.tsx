import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { getStoresForListing } from "@/lib/data/stores";
import { StoreRail } from "@/components/store-rail";
import { railOnlyIfEnough } from "@/lib/rail";
import { DEFAULT_QUERY, discoveryHref, withQuery } from "@/lib/discovery";

/** Same ceiling FeaturedStores uses — a phone rail nobody reaches the end of. */
const MAX = 8;

// "مفتوح هلق" — the stores a customer can act on right now.
//
// The rail is not a new query. It reuses the listing every discovery surface
// already reads and keeps only stores that PUBLISHED hours and whose clock is
// inside them: `isOpen && hoursKnown`.
//
// A store with no hours still counts as open where that protects the customer
// (it is never shown as closed, and can still be ordered from), but "open now"
// is a claim about the clock, and a heading must not make it for a store whose
// own card shows no «مفتوح» badge (store-card.tsx gates the badge on
// hoursKnown). /explore?open=1, where "see all" goes, uses the same rule
// (lib/data/discovery.ts), so the rail, its badges and the filter still agree.
//
// The heading says "open now" and nothing else. It does NOT say "near you":
// nothing on this page knows where the customer is, only a minority of live
// stores carry coordinates, and nothing here sorts by distance — the same
// reason FeaturedStores refuses that phrase two sections below.
export async function OpenNowRail({
  lang,
  dict,
}: {
  lang: Locale;
  dict: Dictionary;
}) {
  const open = (await getStoresForListing())
    .filter((s) => s.isOpen && s.hoursKnown)
    .slice(0, MAX);

  // Nothing open at this hour is a real answer, and an empty state that says so
  // is a section a customer has to scroll past at 3am. The rail simply is not
  // there; /explore still is.
  if (open.length === 0) return null;

  return (
    <StoreRail
      // Below three the row stands down on phones — a two-card horizontal
      // scroller promises "there is more" and breaks it in the same frame.
      className={railOnlyIfEnough(open.length)}
      stores={open}
      lang={lang}
      dict={dict}
      title={dict.home.openNow}
      // Built through discoveryHref rather than written by hand so the link and
      // parseDiscoveryQuery can never spell the same filter differently.
      href={discoveryHref(
        `/${lang}/explore`,
        withQuery(DEFAULT_QUERY, { openNow: true }),
      )}
      seeAll={dict.featured.viewAll}
    />
  );
}
