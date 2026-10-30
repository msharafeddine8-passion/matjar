// MP-039 / MP-040 / MP-041 — explicit ceilings for list fetches.
//
// PostgREST answers an unbounded `.select()` with at most `db-max-rows` (1000
// by default) and reports success. There is no error, no flag, no short-read
// signal: the array simply stops. A store with 1001 variants renders 1000 of
// them and looks fine. That failure is invisible in exactly the situation
// where it matters most — a merchant who finally grew past the ceiling.
//
// So every list fetch names its own ceiling here, and every fetch checks
// whether it came back full. A full page is not proof of truncation (a store
// with exactly 200 sections is legal), but it is the only observable the
// database gives us, and at these ceilings a false alarm is far cheaper than a
// silent one.
//
// Bounds are set comfortably above any plausible real-world value rather than
// close to today's data (36 stores / 63 products / 15 active stores), so the
// warning stays quiet until something genuinely unusual happens.

/** Row ceilings, one per surface. Raising one is a deliberate, reviewable act. */
export const FETCH_BOUNDS = {
  /** Variants of a single product (size × colour grids get wide). */
  productVariants: 200,
  /** Add-ons / options of a single product. */
  productOptions: 200,
  /** Modifier groups of a single product. */
  productModifierGroups: 50,
  /** Components listed inside one bundle. */
  bundleItems: 200,
  /** Components across every bundle in one store's catalog. */
  storeBundleItems: 2000,
  /** A single store's active catalog. Beyond this the storefront needs real
   *  pagination, not a bigger number — it renders the whole array. */
  storeProducts: 2000,
  /** Variant rows across a whole store's catalog (many per product). */
  storeVariants: 5000,
  /** Named sections/collections in one store. */
  storeSections: 200,
  /** Merchant-defined checkout fields in one store. */
  storeCheckoutFields: 50,
  /** Branch locations for the stores on one rendered page. */
  storeLocations: 500,
  /** Active delivery zones in one store. A zone is an area the merchant priced;
   *  a truncated list is a customer who cannot find their own area in the
   *  picker and, since 0229, therefore cannot order at all. */
  storeDeliveryZones: 200,
  /** One customer's saved addresses, for the checkout prefill. */
  customerAddresses: 100,
  /** Every active product platform-wide — discovery's catalog-facts rollup.
   *  This one scales with total catalog size, not store count, so it is the
   *  most likely of all of these to hit its ceiling first. */
  allProducts: 20000,
  /** Every store_sections row platform-wide (same rollup). */
  allStoreSections: 5000,
  /** Practitioner rosters platform-wide (doctors + service_providers). */
  allProviders: 5000,
  // No `follows` bound any more: MP-041's fix asks the follows table only about
  // the store ids on the rendered page, so that read is bounded by the page and
  // has no ceiling of its own to name here.
  /** One seller's own market listings. */
  myListings: 500,
  /** Reference taxonomies. lb_areas in particular is close enough to 1000 that
   *  the default PostgREST cap was a live risk, not a theoretical one. */
  referenceRows: 5000,
  /** Every non-deleted store, for the admin roster. ISS-013: that read carried
   *  no `.limit()` at all, which is not "unlimited" — it is PostgREST's
   *  1000-row default, silently. The screen that decides who is suspended was
   *  the one place in the app that could not be told it was seeing part of the
   *  list. */
  adminStores: 5000,
  /** Owned stores in one discovery read. Directory (unowned) rows are NOT here:
   *  they are counted by the database and paged a screen at a time, because
   *  thousands of them must never be loaded to answer one request. */
  ownedDiscoveryStores: 900,
  /** Owned stores that chose display-only (0338), for the cards. */
  ownedShowcaseStores: 2000,
  /** Open and recent claim requests on the admin queue. */
  adminClaimRequests: 300,
  /** Profiles resolved for the admin roster — each store's owner plus the admin
   *  who last moved its status, so two per store at worst. */
  adminStorePeople: 10000,
  /** The business-leader roster. Editorial content, so it grows slowly, but the
   *  admin read had the same missing `.limit()` as the store roster. */
  adminLeaders: 5000,
  /** Per-store feature-module overrides for every active store — a couple of
   *  dozen keys per store at the very worst. */
  adminStallModules: 10000,
  /** Offering rows — products, rooms, ticket types, vehicles — across every
   *  ACTIVE store, for the stalled-merchant report. Scales with catalogue size
   *  rather than store count, so it is the larger of this pair. */
  adminStallOfferings: 20000,
  /** Order / booking / request rows across every active store, for the single
   *  bit that report needs: has this shop ever had a customer at all. This is
   *  the read that gets expensive first — it grows with every sale the platform
   *  makes, to answer a question about a few dozen stores. When it stops being
   *  cheap the fix is an aggregate in the database, not a bigger number here. */
  adminStallDemand: 20000,
} as const;

/**
 * Sound the alarm when a bounded fetch comes back full.
 *
 * Server-side `console.warn` rather than a thrown error or a returned flag:
 * every caller is a read path that renders a page, and a store that has grown
 * past its ceiling should still serve — loudly degraded, not broken. The
 * message names the surface and the bound so the fix is a one-line edit here.
 *
 * @param rows  the array PostgREST returned (nullish is treated as empty)
 * @param limit the ceiling that was passed to `.limit()`
 * @param what  human-readable surface name, e.g. `"product_variants (product 123)"`
 */
export function warnIfTruncated(
  rows: readonly unknown[] | null | undefined,
  limit: number,
  what: string,
): void {
  const n = rows?.length ?? 0;
  if (n < limit) return;
  console.warn(
    `[matjar:fetch-bound] ${what} returned ${n} rows and hit its ${limit}-row ceiling. ` +
      `Rows beyond the ceiling are NOT rendered. Raise the bound in ` +
      `src/lib/data/bounds.ts or paginate this surface.`,
  );
}

// ---------------------------------------------------------------------------
// Reading past one round trip.
//
// A `.limit()` makes truncation audible; it does not make the rows arrive. A
// store past `storeProducts` still cannot show its catalog. These two helpers
// close that half: they issue the SAME query repeatedly over `.range()` windows
// and concatenate, so the ceiling in FETCH_BOUNDS stops being "what one HTTP
// response can carry" and becomes "the point at which a human should look".
//
// The warning still fires — at the ceiling, not at 1000 — and it now means
// something genuinely extraordinary rather than "PostgREST's default happened".

/** Rows per round trip. PostgREST's own `db-max-rows` default; asking for more
 *  in one request is silently capped here anyway, so this is the real page. */
export const PAGE_ROWS = 1000;

/** Ids per `.in(...)` filter. The filter travels in the query string, so a
 *  2000-id `.in()` is a ~75KB URL — rejected by proxies long before the
 *  database sees it. Chunking keeps every request a normal-sized one. */
export const ID_FILTER_CHUNK = 200;

/** What a supabase-js query resolves to, narrowed to the part paging needs. */
type PageResponse<T> = { data: T[] | null };

/**
 * Page through one query until it runs out of rows or hits `ceiling`.
 *
 * `fetchPage` must apply `.range(from, to)` to an otherwise IDENTICAL query on
 * every call — same select, same filters, same order. The order must also be
 * total (add a unique tiebreaker such as `id`): `.range()` pages a result set
 * by position, so two rows the database is free to return in either order can
 * otherwise appear twice or not at all.
 *
 * A short page ends the loop, which costs one extra request when the row count
 * is an exact multiple of the page size — the price of not needing a count.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  ceiling: number,
  what: string,
): Promise<T[]> {
  const rows = await pageThrough(fetchPage, ceiling);
  warnIfTruncated(rows, ceiling, what);
  return rows;
}

/**
 * The same, for a query filtered by a list of ids: chunk the ids, page each
 * chunk, concatenate. Row order across chunks follows the id order, which is
 * why every caller here regroups the result into a map or a set rather than
 * rendering it in arrival order.
 */
export async function fetchAllByIds<T>(
  ids: readonly string[],
  fetchPage: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<PageResponse<T>>,
  ceiling: number,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length && rows.length < ceiling; i += ID_FILTER_CHUNK) {
    const chunk = ids.slice(i, i + ID_FILTER_CHUNK);
    const got = await pageThrough<T>(
      (from, to) => fetchPage(chunk, from, to),
      ceiling - rows.length,
    );
    rows.push(...got);
  }
  warnIfTruncated(rows, ceiling, what);
  return rows;
}

/** Shared loop. Returns what it managed to read; the callers above own the
 *  warning so it fires once per surface, not once per chunk. */
async function pageThrough<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  ceiling: number,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < ceiling) {
    const want = Math.min(PAGE_ROWS, ceiling - rows.length);
    const { data } = await fetchPage(rows.length, rows.length + want - 1);
    // Null is an error or an empty set; neither can be paged past. Stopping
    // here keeps the pre-existing `data ?? []` behaviour of every caller.
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < want) break;
  }
  return rows;
}
