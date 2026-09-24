import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public-client";
import {
  categoryGroup,
  groupCategories,
  toCategoryKey,
  type RegionKey,
  type Store,
} from "@/lib/catalog";
import { isOpenNow, parseHours } from "@/lib/hours";
import type { StorePlan } from "@/lib/plan-tiers";
import { FETCH_BOUNDS, warnIfTruncated } from "./bounds";
import { followedAmong } from "./stores";
import { sanitizeDisplayName, validateStorePublic } from "@/lib/data-quality";
import {
  DISCOVERY_PAGE_SIZE,
  EMPTY_COVERAGE,
  type DiscoveryCoverage,
  type DiscoveryQuery,
  type StoreFactSource,
} from "@/lib/discovery";

// Server-side discovery: the query string IS the query.
//
// /explore used to hand the browser a two-hundred-row window and let it filter
// in memory, which meant a filtered view existed only inside one tab. It could
// not be linked, bookmarked, shared to WhatsApp — the way almost every Matjar
// link actually travels — or crawled, so none of the filtered pages could ever
// rank. This module is the /market pattern applied to stores: read the URL,
// query the database, render the answer.

export type DiscoveryStore = Store & { facts: StoreFactSource };

export type DiscoveryResult = {
  stores: DiscoveryStore[];
  /** Matches across all pages, after every filter. */
  total: number;
  page: number;
  pageCount: number;
};

// phone / whatsapp / service_area are selected for the data quality gate
// only (lib/data-quality.ts); the card renders none of them.
const STORE_SELECT =
  "id, name, description, area, region, phone, whatsapp, service_area, plan, is_verified, commercial_reg_verified, featured_until, logo_url, cover_url, cover_position, lat, lng, hours, rating_avg, rating_count, created_at, business_types!inner(slug)";

type StoreRow = {
  id: string;
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
      { sector: toCategoryKey(row.business_types?.slug) },
    ).level !== "blocked"
  );
}

function rowToStore(row: StoreRow): Store {
  const ratingAvg = row.rating_avg != null ? Number(row.rating_avg) : 0;
  // Render-only: the stored name keeps its stray whitespace, the card does not.
  const name = sanitizeDisplayName(row.name);
  return {
    id: row.id,
    name: { ar: name, en: name },
    area: { ar: row.area ?? "", en: row.area ?? "" },
    region: (row.region as RegionKey) ?? undefined,
    category: toCategoryKey(row.business_types?.slug, `store ${row.id}`),
    // A store that has not configured hours is never shown as closed — missing
    // data must not send a customer away.
    isOpen: isOpenNow(parseHours(row.hours), new Date()) ?? true,
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
        .select("store_id, in_offers, discount_price")
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
      (out[id] ??= { catalogCount: 0, hasOffers: false, sectionCount: 0 });
    for (const p of (products ?? []) as {
      store_id: string;
      in_offers: boolean | null;
      discount_price: number | null;
    }[]) {
      const f = get(p.store_id);
      f.catalogCount += 1;
      if (p.in_offers === true || p.discount_price != null) f.hasOffers = true;
    }
    for (const s of (sections ?? []) as { store_id: string }[]) {
      get(s.store_id).sectionCount += 1;
    }
    return out;
  },
  ["discovery-catalog-facts"],
  { revalidate: 60, tags: ["stores"] },
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
  { revalidate: 60, tags: ["stores"] },
);

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

// Bounded so discovery never issues an unbounded query. Matjar has thirteen
// active stores; this is the ceiling at which the post-filter-then-slice
// approach below stops being exact and the remaining predicates (open now) have
// to move into SQL.
const DISCOVERY_FETCH_LIMIT = 200;

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
        "id, description, region, hours, is_verified, commercial_reg_verified, rating_count, specialties, business_types!inner(slug)",
      )
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(DISCOVERY_FETCH_LIMIT);

    const rows = (data ?? []) as unknown as {
      id: string;
      description: string | null;
      region: string | null;
      hours: unknown;
      is_verified: boolean | null;
      commercial_reg_verified: boolean | null;
      rating_count: number | null;
      specialties: string | null;
      business_types: { slug: string } | null;
    }[];
    if (!rows.length) return EMPTY_COVERAGE;

    const [facts, providers] = await Promise.all([
      fetchCatalogFacts(),
      fetchProviderCounts(),
    ]);

    const c: DiscoveryCoverage = {
      ...EMPTY_COVERAGE,
      bySector: {},
      byGroup: {},
      byRegion: {},
      total: rows.length,
    };
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
      if (parseHours(r.hours)) c.withHours += 1;
      if (filled(r.description)) c.withDescription += 1;
      if (filled(r.specialties)) c.withSpecialties += 1;
      if ((r.rating_count ?? 0) > 0) c.rated += 1;
      if (r.is_verified) c.verified += 1;
      if (r.commercial_reg_verified) c.registered += 1;
      const f = facts[r.id];
      if ((f?.catalogCount ?? 0) > 0) c.withCatalog += 1;
      if (f?.hasOffers) c.withOffers += 1;
      if ((f?.sectionCount ?? 0) > 0) c.withSections += 1;
      if ((providers[r.id] ?? 0) > 0) c.withProviders += 1;
    }
    return c;
  },
  ["discovery-coverage"],
  { revalidate: 60, tags: ["stores"] },
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
 */
export async function getDiscoveryResults(
  q: DiscoveryQuery,
): Promise<DiscoveryResult> {
  const supabase = await createClient();
  const [facts, providers] = await Promise.all([
    fetchCatalogFacts(),
    fetchProviderCounts(),
  ]);

  let query = supabase
    .from("stores")
    .select(STORE_SELECT)
    .eq("status", "active")
    .is("deleted_at", null);

  if (q.sector) {
    query = query.eq("business_types.slug", q.sector);
  } else if (q.group) {
    query = query.in("business_types.slug", groupCategories(q.group));
  }
  if (q.region) query = query.eq("region", q.region);
  if (q.rated) query = query.gt("rating_count", 0);

  // Catalogue-backed filters resolve to an id set first, so they stay in SQL
  // instead of becoming another post-filter that pagination has to apologise for.
  if (q.hasCatalog || q.hasOffers) {
    const ids = Object.entries(facts)
      .filter(([, f]) =>
        q.hasOffers ? f.hasOffers : f.catalogCount > 0,
      )
      .map(([id]) => id);
    if (!ids.length) return empty(q.page);
    query = query.in("id", ids);
  }

  const term = escapeForOr(q.q);
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,description.ilike.%${term}%,area.ilike.%${term}%`,
    );
  }

  if (q.sort === "topRated") {
    query = query
      .order("rating_avg", { ascending: false })
      .order("rating_count", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data } = await query.limit(DISCOVERY_FETCH_LIMIT);
  let list = ((data ?? []) as unknown as StoreRow[])
    .filter(isListable)
    .map(rowToStore);

  if (q.openNow) list = list.filter((s) => s.isOpen);

  // Paid placement floats to the top of the default order only; asking for
  // "newest" or "top rated" and getting an advert first is a bait and switch.
  if (q.sort === "recommended") {
    list.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
  }

  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE));
  const page = Math.min(Math.max(1, q.page), pageCount);
  const slice = list.slice(
    (page - 1) * DISCOVERY_PAGE_SIZE,
    page * DISCOVERY_PAGE_SIZE,
  );

  const withFacts: DiscoveryStore[] = slice.map((s) => ({
    ...s,
    facts: {
      catalogCount: facts[s.id]?.catalogCount ?? 0,
      hasOffers: facts[s.id]?.hasOffers ?? false,
      sectionCount: facts[s.id]?.sectionCount ?? 0,
      providerCount: providers[s.id] ?? 0,
    },
  }));

  await Promise.all([
    attachLocations(withFacts),
    markFavorites(withFacts),
  ]);

  return { stores: withFacts, total, page, pageCount };
}

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
