import type { ListingMode } from "./store-experience";

// ===== How a store is listed (0338) =====
//
// Two facts, and the difference matters:
//
//   unclaimed — stores.owner_id IS NULL. A directory row gathered from a public
//               source; nobody is behind it yet.
//   showcase  — stores.listing_mode = 'showcase'. Display only: no orders or
//               bookings through Matjar. Every unclaimed store is a showcase
//               (constraint stores_unowned_is_showcase), not the other way round.
//
// `owner_id` is what decides "unclaimed" everywhere, not `info_status`: anon can
// read it (0314), it is what the database's own guards test, and the two cannot
// disagree after a claim because admin_resolve_store_claim sets both at once.
//
// Pure, so the same rules run in loaders, components and tests.

export type ListingFacts = {
  unclaimed: boolean;
  showcase: boolean;
  listingMode: ListingMode;
};

export function resolveListing(row: {
  ownerId: string | null | undefined;
  listingMode?: string | null;
}): ListingFacts {
  const unclaimed = row.ownerId == null;
  const showcase = unclaimed || row.listingMode === "showcase";
  return { unclaimed, showcase, listingMode: showcase ? "showcase" : "full" };
}

const hasText = (v: string | null | undefined) => (v ?? "").trim() !== "";

/**
 * Whether an unclaimed page has enough on it to deserve a search result: a way
 * to reach the business or find it. A name and a sector alone is a thin page
 * about a real business, which says noindex and stays out of the sitemap.
 *
 * Sitemap ⊆ indexable: the sitemap's own query (src/app/directory/sitemap.ts)
 * filters on phone, whatsapp and website; `address` cannot be filtered there
 * because anon has no grant on the column, so a row with only an address is
 * indexable but not submitted. That direction is harmless; the reverse is the
 * Search Console error.
 */
export function directoryPageIndexable(store: {
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  address?: string | null;
}): boolean {
  return (
    hasText(store.phone) ||
    hasText(store.whatsapp) ||
    hasText(store.website) ||
    hasText(store.address)
  );
}

/** OpenStreetMap is the one source whose licence names its required credit. */
export function isOpenStreetMapSource(
  dataSource: string | null | undefined,
  sourceUrl: string | null | undefined,
): boolean {
  return (
    /openstreetmap|^osm/i.test(dataSource ?? "") ||
    /openstreetmap\.org/i.test(sourceUrl ?? "")
  );
}

/** A source link only ever points at http(s): the value came from an import. */
export function safeSourceUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Directions to a pin, for the contact actions of a display-only store. */
export function directionsHref(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  return lat != null && lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : null;
}
