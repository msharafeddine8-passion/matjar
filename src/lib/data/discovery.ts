import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public-client";
import {
  categoryGroup,
  categoryKeys,
  groupCategories,
  regions,
  toCategoryKey,
  type CategoryKey,
  type RegionKey,
  type Store,
} from "@/lib/catalog";
import { isOpenNow, parseHours } from "@/lib/hours";
import type { StorePlan } from "@/lib/plan-tiers";
import { FETCH_BOUNDS, warnIfTruncated } from "./bounds";
import { followedAmong } from "./stores";
import { getShowcaseStoreIds } from "./store-listing";
import { sanitizeDisplayName, validateStorePublic } from "@/lib/data-quality";
import {
  DISCOVERY_PAGE_SIZE,
  EMPTY_COVERAGE,
  EMPTY_SECTOR_COUNTS,
  type DiscoveryCoverage,
  type DiscoveryQuery,
  type SectorCounts,
} from "@/lib/discovery";
import { storeRowCardSource, type SectorCardSource } from "@/lib/card-facts";

// Server-side discovery: the query string IS the query.
//
// /explore used to hand the browser a two-hundred-row window and let it filter
// in memory, which meant a filtered view existed only inside one tab. It could
// not be linked, bookmarked, shared to WhatsApp — the way almost every Matjar
// link actually travels — or crawled, so none of the filtered pages could ever
// rank. This module is the /market pattern applied to stores: read the URL,
// query the database, render the answer.

/** `hoursKnown` says whether `isOpen` is a fact (published hours read on the
 *  Beirut clock) or the platform's open-by-default for a store with none. The
 *  card only draws an open/closed badge for the former. */
export type DiscoveryStore = Store & {
  facts: SectorCardSource;
  hoursKnown: boolean;
};

export type DiscoveryResult = {
  stores: DiscoveryStore[];
  /** Matches across all pages, after every filter. */
  total: number;
  page: number;
  pageCount: number;
};

// phone / whatsapp / service_area are selected for the data quality gate
// only (lib/data-quality.ts); the card renders none of them. The fulfilment
// and insurance columns feed the sector-aware facts line (lib/card-facts.ts).
const STORE_SELECT =
  "id, owner_id, name, description, area, region, phone, whatsapp, service_area, plan, is_verified, commercial_reg_verified, featured_until, logo_url, cover_url, cover_position, lat, lng, hours, rating_avg, rating_count, created_at, accepts_delivery, accepts_pickup, min_order, prep_time, insurance, business_types!inner(slug)";

type StoreRow = {
  id: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  area: string | null;
  region: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  service_area?: string | null;
  plan: StorePlan | null;
  is_verified: boolean | null;
  commercial_reg_verified: boolean | null;
  featured_until: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cover_position: number | null;
  lat: number | null;
  lng: number | null;
  hours: unknown;
  rating_avg: number | null;
  rating_count: number | null;
  created_at: string;
  accepts_delivery?: boolean | null;
  accepts_pickup?: boolean | null;
  min_order?: number | string | null;
  prep_time?: string | null;
  insurance?: string | null;
  business_types: { slug: string } | null;
};

/** The public data quality gate (lib/data-quality.ts): a `blocked` row —
 *  no usable name, or no way to contact the business — is not ranked on
 *  /explore. Its own page still answers; the admin roster says why. Nothing
 *  on production is blocked today; this holds the next one. */
function isListable(row: StoreRow): boolean {
  return (
    validateStorePublic(
      {
        name: row.name,
        category: row.business_types?.slug ?? null,
        area: row.area,
        service_area: row.service_area,
        region: row.region,
        phone: row.phone,
        whatsapp: row.whatsapp,
        description: row.description,
        logo_url: row.logo_url,
        cover_url: row.cover_url,
      },
      {
        sector: toCategoryKey(row.business_types?.slug),
        directory: row.owner_id == null,
      },
    ).level !== "blocked"
  );
}

function rowToStore(
  row: StoreRow,
): Store & { hoursKnown: boolean; rowFacts: SectorCardSource } {
  const ratingAvg = row.rating_avg != null ? Number(row.rating_avg) : 0;
  // Render-only: the stored name keeps its stray whitespace, the card does not.
  const name = sanitizeDisplayName(row.name);
  const hours = parseHours(row.hours);
  return {
    hoursKnown: hours != null,
    rowFacts: storeRowCardSource(row),
    id: row.id,
    unclaimed: row.owner_id == null,
    showcase: row.owner_id == null,
    name: { ar: name, en: name },
    area: { ar: row.area ?? "", en: row.area ?? "" },
    region: (row.region as RegionKey) ?? undefined,
    category: toCategoryKey(row.business_types?.slug, `store ${row.id}`),
    // A store that has not configured hours is never shown as closed — missing
    // data must not send a customer away. `hoursKnown` above is what stops the
    // card from also CLAIMING it is open.
    isOpen: isOpenNow(hours, new Date()) ?? true,
    // Pass the tier through as-is: collapsing anything-but-pro to "free" made
    // Business stores (the top tier) render as unsubscribed on every card.
    plan: row.plan ?? "free",
    verified: row.is_verified ?? false,
    registered: row.commercial_reg_verified ?? false,
    rating: ratingAvg > 0 ? ratingAvg : undefined,
    reviews: row.rating_count != null ? Number(row.rating_count) : 0,
    featured:
      row.featured_until != null && new Date(row.featured_until) > new Date(),
    logoUrl: row.logo_url,
    coverUrl: row.cover_url,
    coverPosition: row.cover_position ?? 50,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
  };
}

// ---------------------------------------------------------------------------
// Catalogue facts
// ---------------------------------------------------------------------------

type CatalogFact = {
  catalogCount: number;
  hasOffers: boolean;
  sectionCount: number;
  /** Active item_kind = 'service' rows. */
  serviceCount: number;
  /** Lowest listed price (> 0) among those services; null when none is priced. */
  serviceMinPrice: number | null;
  /** Lowest listed price (> 0) over every active row; null when none is. */
  itemMinPrice: number | null;
};

/** The LISTED price, not the discount: an offer can end between the card and
 *  the item page, and a list-price floor can only understate how cheap a
 *  store is — never promise a price the buyer then cannot find. */
const minPositive = (cur: number | null, v: unknown): number | null => {
  const n = v == null ? NaN : Number(v);
  if (!Number.isFinite(n) || n <= 0) return cur;
  return cur == null || n < cur ? n : cur;
};

/** Per-store catalogue counts, in two small queries rather than one per card.
 *  Public and identical for every visitor, so it is cached alongside the store
 *  listing and busted by the same "stores" tag. */
const fetchCatalogFacts = unstable_cache(
  async (): Promise<Record<string, CatalogFact>> => {
    const supabase = createPublicClient();
    const [{ data: products }, { data: sections }] = await Promise.all([
      supabase
        .from("products")
        .select("store_id, in_offers, discount_price, price, item_kind")
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(FETCH_BOUNDS.allProducts),
      supabase
        .from("store_sections")
        .select("store_id")
        .limit(FETCH_BOUNDS.allStoreSections),
    ]);
    // Platform-wide rollups: these scale with total catalog size rather than
    // store count, so they are the first of all the bounded fetches that will
    // realistically hit a ceiling. Truncation understates every affected
    // store's product count and can hide its "has offers" badge entirely.
    warnIfTruncated(products, FETCH_BOUNDS.allProducts, "products (discovery catalog facts)");
    warnIfTruncated(sections, FETCH_BOUNDS.allStoreSections, "store_sections (discovery catalog facts)");
    const out: Record<string, CatalogFact> = {};
    const get = (id: string) =>
      (out[id] ??= {
        catalogCount: 0,
        hasOffers: false,
        sectionCount: 0,
        serviceCount: 0,
        serviceMinPrice: null,
        itemMinPrice: null,
      });
    for (const p of (products ?? []) as {
      store_id: string;
      in_offers: boolean | null;
      discount_price: number | null;
      price: number | string | null;
      item_kind: string | null;
    }[]) {
      const f = get(p.store_id);
      f.catalogCount += 1;
      if (p.in_offers === true || p.discount_price != null) f.hasOffers = true;
      f.itemMinPrice = minPositive(f.itemMinPrice, p.price);
      if (p.item_kind === "service") {
        f.serviceCount += 1;
        f.serviceMinPrice = minPositive(f.serviceMinPrice, p.price);
      }
    }
    for (const s of (sections ?? []) as { store_id: string }[]) {
      get(s.store_id).sectionCount += 1;
    }
    return out;
  },
  // Key bumped with the shape: an entry cached before the service/price
  // rollups existed would otherwise be served for a minute without them.
  ["discovery-catalog-facts-v2"],
  // 5 min, not 60 s: every merchant write busts the "stores" tag
  // (cache-actions.ts), so this only bounds staleness from other paths. At 60 s
  // these rollups were a quarter of all SSR requests (~6,100/day).
  { revalidate: 300, tags: ["stores"] },
);

/** Practitioner rows (doctors, and the newer service_providers roster) per
 *  store. A clinic card leads with who works there, so this is the one fact a
 *  healthcare result is built around — and the reason the card shows nothing of
 *  the sort today is simply that no store has entered one. */
const fetchProviderCounts = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const supabase = createPublicClient();
    const [{ data: doctors }, { data: providers }] = await Promise.all([
      supabase.from("doctors").select("store_id").limit(FETCH_BOUNDS.allProviders),
      supabase
        .from("service_providers")
        .select("store_id")
        .limit(FETCH_BOUNDS.allProviders),
    ]);
    warnIfTruncated(doctors, FETCH_BOUNDS.allProviders, "doctors (discovery provider counts)");
    warnIfTruncated(providers, FETCH_BOUNDS.allProviders, "service_providers (discovery provider counts)");
    const out: Record<string, number> = {};
    for (const r of [...(doctors ?? []), ...(providers ?? [])] as {
      store_id: string;
    }[]) {
      out[r.store_id] = (out[r.store_id] ?? 0) + 1;
    }
    return out;
  },
  ["discovery-provider-counts"],
  // 5 min, not 60 s: every merchant write busts the "stores" tag
  // (cache-actions.ts), so this only bounds staleness from other paths. At 60 s
  // these rollups were a quarter of all SSR requests (~6,100/day).
  { revalidate: 300, tags: ["stores"] },
);

type ZoneFact = {
  feeMin: number;
  feeMax: number;
  etaMin: number | null;
  etaMax: number | null;
};

// Platform-wide: zones are a handful of rows per delivering store.
const ALL_ZONES_LIMIT = 5000;

/** Active delivery zones per store, rolled up to a fee range and an ETA range.
 *  They are the only real source of "how much / how long" on a card: a store
 *  with no zone has neither, and the card says neither. */
const fetchZoneFacts = unstable_cache(
  async (): Promise<Record<string, ZoneFact>> => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("store_delivery_zones")
      .select("store_id, fee, eta_min_minutes, eta_max_minutes")
      .eq("active", true)
      .limit(ALL_ZONES_LIMIT);
    warnIfTruncated(data, ALL_ZONES_LIMIT, "store_delivery_zones (discovery zone facts)");
    const out: Record<string, ZoneFact> = {};
    const pos = (v: unknown) => {
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    for (const z of (data ?? []) as {
      store_id: string;
      fee: number | string | null;
      eta_min_minutes: number | null;
      eta_max_minutes: number | null;
    }[]) {
      const fee = Math.max(0, Number(z.fee ?? 0) || 0);
      const lo = pos(z.eta_min_minutes);
      const hi = pos(z.eta_max_minutes);
      const f = out[z.store_id];
      if (!f) {
        out[z.store_id] = { feeMin: fee, feeMax: fee, etaMin: lo, etaMax: hi };
        continue;
      }
      f.feeMin = Math.min(f.feeMin, fee);
      f.feeMax = Math.max(f.feeMax, fee);
      if (lo != null) f.etaMin = f.etaMin == null ? lo : Math.min(f.etaMin, lo);
      if (hi != null) f.etaMax = f.etaMax == null ? hi : Math.max(f.etaMax, hi);
    }
    return out;
  },
  ["discovery-zone-facts"],
  // 5 min, not 60 s: every merchant write busts the "stores" tag
  // (cache-actions.ts), so this only bounds staleness from other paths. At 60 s
  // these rollups were a quarter of all SSR requests (~6,100/day).
  { revalidate: 300, tags: ["stores"] },
);

/**
 * The batched, per-store half of a card's facts — catalogue, services and
 * prices, practitioners, delivery zones — for any list of stores.
 *
 * Three cached platform-wide rollups (one query each, shared by every page and
 * every visitor for a minute), then a lookup per id: never a query per card.
 * The row-level half (delivery/pickup switches, minimum, prep time, insurance)
 * comes off the stores row itself; callers merge the two.
 */
export async function cardRollups(
  ids: readonly string[],
): Promise<Record<string, SectorCardSource>> {
  if (!ids.length) return {};
  const [facts, providers, zones] = await Promise.all([
    fetchCatalogFacts(),
    fetchProviderCounts(),
    fetchZoneFacts(),
  ]);
  const out: Record<string, SectorCardSource> = {};
  for (const id of ids) {
    const f = facts[id];
    const z = zones[id];
    out[id] = {
      catalogCount: f?.catalogCount ?? 0,
      hasOffers: f?.hasOffers ?? false,
      sectionCount: f?.sectionCount ?? 0,
      providerCount: providers[id] ?? 0,
      serviceCount: f?.serviceCount ?? 0,
      serviceMinPrice: f?.serviceMinPrice ?? null,
      itemMinPrice: f?.itemMinPrice ?? null,
      deliveryFeeMin: z?.feeMin ?? null,
      deliveryFeeMax: z?.feeMax ?? null,
      deliveryEtaMin: z?.etaMin ?? null,
      deliveryEtaMax: z?.etaMax ?? null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

// Bounded so discovery never issues an unbounded query. This window holds OWNED
// stores only: it is the ceiling at which the post-filter-then-slice approach
// below stops being exact and the remaining predicates (open now) have to move
// into SQL. Unclaimed directory rows (0338) never enter it — there are thousands
// of them, so they are counted and paged by the database instead.
const DISCOVERY_FETCH_LIMIT = FETCH_BOUNDS.ownedDiscoveryStores;

type UnclaimedCensus = {
  total: number;
  bySector: Partial<Record<CategoryKey, number>>;
  byRegion: Partial<Record<RegionKey, number>>;
  withSpecialties: number;
};

/**
 * Unclaimed rows, counted rather than fetched: one HEAD request per sector and
 * per region, so the facets stay exact at any size and no row travels. Only the
 * first request runs while there are none.
 *
 * Its own cache and its own tag on purpose. Every merchant write busts "stores",
 * and recounting the directory for a price change would be two dozen queries for
 * a number that only moves when an import runs or a store is claimed. An hour is
 * how late a freshly imported batch can appear in the counts.
 */
const fetchUnclaimedCensus = unstable_cache(
  async (): Promise<UnclaimedCensus | null> => {
    const supabase = createPublicClient();
    const { count: total } = await supabase
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("deleted_at", null)
      .is("owner_id", null);
    if (!total) return null;
    const [sectors, places, specialties] = await Promise.all([
      Promise.all(
        categoryKeys.map(async (key) => {
          const { count } = await supabase
            .from("stores")
            .select("id, business_types!inner(slug)", { count: "exact", head: true })
            .eq("status", "active")
            .is("deleted_at", null)
            .is("owner_id", null)
            .eq("business_types.slug", key);
          return [key, count ?? 0] as const;
        }),
      ),
      Promise.all(
        regions.map(async (r) => {
          const { count } = await supabase
            .from("stores")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .is("deleted_at", null)
            .is("owner_id", null)
            .eq("region", r.key);
          return [r.key, count ?? 0] as const;
        }),
      ),
      supabase
        .from("stores")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .is("deleted_at", null)
        .is("owner_id", null)
        .not("specialties", "is", null),
    ]);
    return {
      total,
      bySector: Object.fromEntries(sectors.filter(([, n]) => n > 0)),
      byRegion: Object.fromEntries(places.filter(([, n]) => n > 0)),
      withSpecialties: specialties.count ?? 0,
    };
  },
  ["discovery-unclaimed-census-v1"],
  { revalidate: 3600, tags: ["stores-directory"] },
);

/**
 * What the marketplace actually holds, counted rather than assumed.
 *
 * Every filter and facet the buyer sees is derived from these numbers, so this
 * is the single place that decides whether a control exists. It is cached for a
 * minute: a chip appearing sixty seconds after a merchant is approved is fine;
 * counting thirteen rows on every render is not.
 */
export const getDiscoveryCoverage = unstable_cache(
  async (): Promise<DiscoveryCoverage> => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("stores")
      .select(
        "id, description, region, hours, is_verified, commercial_reg_verified, rating_count, specialties, accepts_delivery, accepts_pickup, business_types!inner(slug)",
      )
      .eq("status", "active")
      .is("deleted_at", null)
      .not("owner_id", "is", null)
      .limit(DISCOVERY_FETCH_LIMIT);
    warnIfTruncated(data, DISCOVERY_FETCH_LIMIT, "discovery coverage (owned stores)");

    const rows = (data ?? []) as unknown as {
      id: string;
      description: string | null;
      region: string | null;
      hours: unknown;
      is_verified: boolean | null;
      commercial_reg_verified: boolean | null;
      rating_count: number | null;
      specialties: string | null;
      accepts_delivery: boolean | null;
      accepts_pickup: boolean | null;
      business_types: { slug: string } | null;
    }[];
    const [facts, providers, census, showcaseIds] = await Promise.all([
      fetchCatalogFacts(),
      fetchProviderCounts(),
      fetchUnclaimedCensus(),
      getShowcaseStoreIds(),
    ]);
    if (!rows.length && !census) return EMPTY_COVERAGE;
    const showcase = new Set(showcaseIds);

    const c: DiscoveryCoverage = {
      ...EMPTY_COVERAGE,
      bySector: {},
      byGroup: {},
      byRegion: {},
      bySectorCounts: {},
      total: rows.length,
    };
    const by = c.bySectorCounts as Partial<Record<string, SectorCounts>>;
    const bump = <K extends string>(
      map: Partial<Record<K, number>>,
      key: K | undefined | null,
    ) => {
      if (key) map[key] = (map[key] ?? 0) + 1;
    };
    const filled = (v: string | null) => (v ?? "").trim().length > 0;

    for (const r of rows) {
      // Checked here too, and for a reason past the type: every reader of
      // bySector keys it by a known CategoryKey, so a row counted under its raw
      // unrecognised slug went into a bucket nothing ever reads. The store
      // still rendered — fetchStoreView and rowToStore above both land it on
      // `retail` — so the facet count disagreed with the facet's own listing.
      // Same fallback, so the census now says what the listing shows. The
      // select joins business_types!inner, so the slug is always present.
      const sector = toCategoryKey(r.business_types?.slug, `store ${r.id}`);
      bump(c.bySector, sector);
      bump(c.byGroup, categoryGroup[sector]);
      bump(c.byRegion, r.region as RegionKey | null);
      if (filled(r.description)) c.withDescription += 1;
      if (filled(r.specialties)) c.withSpecialties += 1;
      const f = facts[r.id];
      if ((f?.sectionCount ?? 0) > 0) c.withSections += 1;
      if ((providers[r.id] ?? 0) > 0) c.withProviders += 1;

      // The boolean-filter counts, marketplace-wide AND per sector, from one
      // list of predicates so the two censuses can never disagree.
      const sc = (by[sector] ??= { ...EMPTY_SECTOR_COUNTS });
      const flags: [keyof SectorCounts, boolean][] = [
        ["total", true],
        ["withHours", parseHours(r.hours) != null],
        ["rated", (r.rating_count ?? 0) > 0],
        ["verified", r.is_verified === true],
        ["registered", r.commercial_reg_verified === true],
        ["withCatalog", (f?.catalogCount ?? 0) > 0],
        ["withOffers", f?.hasOffers === true],
        // A showcase store keeps the column but takes no delivery order.
        ["withDelivery", r.accepts_delivery === true && !showcase.has(r.id)],
        ["withPickup", r.accepts_pickup === true && !showcase.has(r.id)],
        ["withPricedServices", f?.serviceMinPrice != null],
      ];
      for (const [k, on] of flags) {
        if (!on) continue;
        sc[k] += 1;
        if (k !== "total") c[k] += 1;
      }
    }

    // Directory rows join the facets and the totals — a sector with five
    // hundred listed pharmacies is not an empty sector — and nothing else: none
    // of them has a catalogue, a rating or a delivery term to be counted for.
    if (census) {
      c.total += census.total;
      c.unclaimed = census.total;
      c.withSpecialties += census.withSpecialties;
      for (const [key, n] of Object.entries(census.bySector) as [CategoryKey, number][]) {
        c.bySector[key] = (c.bySector[key] ?? 0) + n;
        const group = categoryGroup[key];
        if (group) c.byGroup[group] = (c.byGroup[group] ?? 0) + n;
        const sc = (by[key] ??= { ...EMPTY_SECTOR_COUNTS });
        sc.total += n;
      }
      for (const [key, n] of Object.entries(census.byRegion) as [RegionKey, number][]) {
        c.byRegion[key] = (c.byRegion[key] ?? 0) + n;
      }
    }
    return c;
  },
  // v3: owned rows only in the window, unclaimed from the census.
  ["discovery-coverage-v3"],
  // 5 min, not 60 s: every merchant write busts the "stores" tag
  // (cache-actions.ts), so this only bounds staleness from other paths. At 60 s
  // these rollups were a quarter of all SSR requests (~6,100/day).
  { revalidate: 300, tags: ["stores"] },
);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** PostgREST `or=` is a comma-separated list, so a comma or a parenthesis in the
 *  buyer's words would otherwise be read as syntax. `%` and `_` are ilike
 *  wildcards; a search for "50%" must not match everything. */
export function escapeForOr(term: string): string {
  return term.replace(/[%_]/g, (m) => `\\${m}`).replace(/[(),.:*]/g, " ").trim();
}

/**
 * The result set for a URL.
 *
 * Everything Postgres can express is expressed there — sector, group, region,
 * text, "has been reviewed", catalogue and offers (via an id set), and the sort.
 * "Open now" is the one predicate that cannot be: it is a jsonb week schedule
 * read against the current minute, so it is applied after the fetch, and the
 * page count is computed from the filtered array rather than from a SQL count
 * that would disagree with it.
 *
 * Owned stores always come first, on every sort. Unclaimed directory rows (0338)
 * follow, in the same pagination, read one screen at a time with their count
 * from the database: `total` stays exact and nothing is loaded that is not drawn.
 * A filter only an owned store can satisfy (reviews, catalogue, delivery, open
 * now) simply leaves them out, because no directory row has any of those.
 */
export async function getDiscoveryResults(
  q: DiscoveryQuery,
): Promise<DiscoveryResult> {
  const supabase = await createClient();
  const facts = await fetchCatalogFacts();

  const term = escapeForOr(q.q);
  // The constraints an owned store and a directory row answer alike. Applied to
  // three queries below, so it is one function rather than three copies that can
  // disagree about what the count is counting.
  const scoped = <Q,>(query: Q): Q => {
    let out = query as unknown as Scopable;
    if (q.sector) {
      out = out.eq("business_types.slug", q.sector);
    } else if (q.group) {
      out = out.in("business_types.slug", groupCategories(q.group));
    }
    if (q.region) out = out.eq("region", q.region);
    if (term) {
      out = out.or(
        `name.ilike.%${term}%,description.ilike.%${term}%,area.ilike.%${term}%`,
      );
    }
    return out as unknown as Q;
  };

  let query = scoped(
    supabase
      .from("stores")
      .select(STORE_SELECT)
      .eq("status", "active")
      .is("deleted_at", null)
      .not("owner_id", "is", null),
  );
  if (q.rated) query = query.gt("rating_count", 0);
  // The two fulfilment switches are plain columns: the store row IS the answer.
  if (q.delivers) query = query.eq("accepts_delivery", true);
  if (q.pickup) query = query.eq("accepts_pickup", true);

  // Catalogue-backed filters resolve to an id set first, so they stay in SQL
  // instead of becoming another post-filter that pagination has to apologise
  // for. Several at once intersect: every chosen predicate must hold. (This
  // used to read `hasOffers ? offers : catalog`, which silently dropped the
  // catalogue condition when both were on — harmless only because an offer
  // implies a catalogue row.)
  if (q.hasCatalog || q.hasOffers || q.hasPricedServices) {
    const ids = Object.entries(facts)
      .filter(
        ([, f]) =>
          (!q.hasCatalog || f.catalogCount > 0) &&
          (!q.hasOffers || f.hasOffers) &&
          (!q.hasPricedServices || f.serviceMinPrice != null),
      )
      .map(([id]) => id);
    if (!ids.length) return empty(q.page);
    query = query.in("id", ids);
  }

  if (q.sort === "topRated") {
    query = query
      .order("rating_avg", { ascending: false })
      .order("rating_count", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const [{ data }, showcaseIds] = await Promise.all([
    query.limit(DISCOVERY_FETCH_LIMIT),
    getShowcaseStoreIds(),
  ]);
  warnIfTruncated(data, DISCOVERY_FETCH_LIMIT, "discovery results (owned stores)");
  const showcase = new Set(showcaseIds);
  let list = ((data ?? []) as unknown as StoreRow[])
    .filter(isListable)
    .map((row) => {
      const s = rowToStore(row);
      return showcase.has(s.id) ? { ...s, showcase: true } : s;
    });

  // The columns stay on after a merchant switches to display-only; the promise
  // does not. Same reason the coverage counts leave these stores out.
  if (q.delivers || q.pickup) list = list.filter((s) => !s.showcase);

  // "Open now" is a claim about the clock, so it needs published hours: a
  // store with none is not listed here (its card shows no badge either).
  if (q.openNow) list = list.filter((s) => s.isOpen && s.hoursKnown);

  // Paid placement floats to the top of the default order only; asking for
  // "newest" or "top rated" and getting an advert first is a bait and switch.
  if (q.sort === "recommended") {
    list.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
  }

  // Every one of these needs something no directory row has.
  const directoryEligible = !(
    q.rated ||
    q.delivers ||
    q.pickup ||
    q.openNow ||
    q.hasCatalog ||
    q.hasOffers ||
    q.hasPricedServices
  );
  let unclaimedTotal = 0;
  if (directoryEligible) {
    const { count } = await scoped(
      supabase
        .from("stores")
        .select("id, business_types!inner(slug)", { count: "exact", head: true })
        .eq("status", "active")
        .is("deleted_at", null)
        .is("owner_id", null),
    );
    unclaimedTotal = count ?? 0;
  }

  const total = list.length + unclaimedTotal;
  const pageCount = Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE));
  const page = Math.min(Math.max(1, q.page), pageCount);
  const start = (page - 1) * DISCOVERY_PAGE_SIZE;
  const slice = list.slice(start, page * DISCOVERY_PAGE_SIZE);

  // What the owned stores leave of this screen, from the directory. The fullest
  // rows first: a logo, then a phone number; `id` makes the order total, which
  // is what makes `.range()` paging safe.
  const room = DISCOVERY_PAGE_SIZE - slice.length;
  if (directoryEligible && unclaimedTotal > 0 && room > 0) {
    const from = Math.max(0, start - list.length);
    const { data: rows } = await scoped(
      supabase
        .from("stores")
        .select(STORE_SELECT)
        .eq("status", "active")
        .is("deleted_at", null)
        .is("owner_id", null)
        .order("logo_url", { ascending: true, nullsFirst: false })
        .order("phone", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + room - 1),
    );
    slice.push(
      ...((rows ?? []) as unknown as StoreRow[]).filter(isListable).map(rowToStore),
    );
  }

  // Row facts (the stores columns) + the batched rollups, for this page only.
  const rollups = await cardRollups(slice.map((s) => s.id));
  const withFacts: DiscoveryStore[] = slice.map(({ rowFacts, ...s }) => ({
    ...s,
    facts: { ...rowFacts, ...rollups[s.id] },
  }));

  await Promise.all([
    attachLocations(withFacts),
    markFavorites(withFacts),
  ]);

  return { stores: withFacts, total, page, pageCount };
}

/** The part of a query builder the shared discovery constraints touch. */
type Scopable = {
  eq(column: string, value: string): Scopable;
  in(column: string, values: readonly string[]): Scopable;
  or(filters: string): Scopable;
};

function empty(page: number): DiscoveryResult {
  return { stores: [], total: 0, page: Math.max(1, page), pageCount: 1 };
}

/** Branch coordinates for the rendered page only — "near me" ranks a store by
 *  its closest branch, not by the address on the store row. */
async function attachLocations(list: DiscoveryStore[]): Promise<void> {
  if (!list.length) return;
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("store_locations")
    .select("id, store_id, name, area, lat, lng")
    .in(
      "store_id",
      list.map((s) => s.id),
    )
    .eq("is_active", true)
    .limit(FETCH_BOUNDS.storeLocations);
  warnIfTruncated(data, FETCH_BOUNDS.storeLocations, "store_locations (discovery page)");
  const byStore = new Map<string, NonNullable<Store["locations"]>>();
  for (const l of (data ?? []) as {
    id: string;
    store_id: string;
    name: string | null;
    area: string | null;
    lat: number | null;
    lng: number | null;
  }[]) {
    const arr = byStore.get(l.store_id) ?? [];
    arr.push({
      id: l.id,
      name: l.name,
      area: l.area,
      lat: l.lat != null ? Number(l.lat) : null,
      lng: l.lng != null ? Number(l.lng) : null,
    });
    byStore.set(l.store_id, arr);
  }
  for (const s of list) {
    const arr = byStore.get(s.id);
    if (arr) s.locations = arr;
  }
}

/** Which of these the viewer has saved. Uncached and per-user by definition, so
 *  it runs after everything cacheable. */
async function markFavorites(list: DiscoveryStore[]): Promise<void> {
  if (!list.length) return;
  // MP-041: ask about this page's stores, not about the viewer's whole follow
  // list. See followedAmong — a truncated follow list rendered a followed store
  // as un-followed, and the ceiling scaled with the user, not with the page.
  const ids = await followedAmong(list.map((s) => s.id));
  if (!ids) return;
  for (const s of list) s.favorited = ids.has(s.id);
}
