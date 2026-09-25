import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public-client";
import {
  featuredStores,
  stores as demoStores,
  SHOW_DEMO_STORES,
  toCategoryKey,
  type RegionKey,
  type Store,
} from "@/lib/catalog";
import { isOpenNow, parseHours } from "@/lib/hours";
import type { StorePlan } from "@/lib/plan-tiers";
import {
  sanitizeDisplayName,
  validateStorePublic,
  type QualityLevel,
} from "@/lib/data-quality";
import { FETCH_BOUNDS, fetchAllByIds, warnIfTruncated } from "./bounds";
import { cardRollups, escapeForOr } from "./discovery";
import {
  storeRowCardSource,
  type CardStore,
  type SectorCardSource,
} from "@/lib/card-facts";

/** Demo/sample catalog rows use short ids; only these reach a uuid column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A store as the public listings return it: the card shape plus the data
 *  quality level (lib/data-quality.ts). `blocked` rows never reach a ranked
 *  list — every loader below drops them — so a consumer of these lists only
 *  ever sees `ok` or `incomplete`; the type keeps the third value so the
 *  same shape can describe a store fetched by id. */
export type ListedStore = Store & {
  quality: QualityLevel;
  /** Structured hours exist, so `isOpen` is a fact rather than the default. */
  hoursKnown: boolean;
  /** The sector-aware card's inputs (lib/card-facts.ts): the row's own
   *  columns always; the batched catalogue/zone rollups where the loader
   *  attached them. */
  facts: SectorCardSource;
};

/** The columns every listing query selects. `description`, `phone`,
 *  `whatsapp` and `service_area` ride along only so the quality gate can
 *  read them; the card renders none of them. The fulfilment / insurance
 *  columns feed the card's facts line. */
const LISTING_SELECT =
  "id, name, area, region, plan, is_verified, commercial_reg_verified, featured_until, logo_url, cover_url, cover_position, lat, lng, hours, rating_avg, rating_count, description, phone, whatsapp, service_area, accepts_delivery, accepts_pickup, min_order, prep_time, insurance, business_types(slug)";

// Maps a database store row into the shape the StoreCard expects.
function rowToStore(row: {
  id: string;
  name: string;
  area: string | null;
  region: string | null;
  description?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  service_area?: string | null;
  plan: StorePlan | null;
  is_verified: boolean | null;
  commercial_reg_verified: boolean | null;
  featured_until: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cover_position?: number | null;
  lat: number | null;
  lng: number | null;
  hours?: unknown;
  business_types: { slug: string } | null;
  rating_avg: number | null;
  rating_count: number | null;
  accepts_delivery?: boolean | null;
  accepts_pickup?: boolean | null;
  min_order?: number | string | null;
  prep_time?: string | null;
  insurance?: string | null;
}): ListedStore {
  // Real open/closed from structured hours; stores without configured hours
  // default to open (never scare customers away over missing data) — and
  // `hoursKnown` is false, so no card claims "open" on their behalf.
  const hours = parseHours(row.hours);
  const open = isOpenNow(hours, new Date());
  // Denormalized rating columns, kept current by the reviews trigger (migration
  // 0091). rating stays undefined at 0 reviews so the card hides the rating
  // block; reviews carries the raw count.
  const ratingAvg = row.rating_avg != null ? Number(row.rating_avg) : 0;
  const category = toCategoryKey(row.business_types?.slug, `store ${row.id}`);
  // Render-only clean-up: the stored name is untouched, the card just never
  // shows the trailing space one production store carries. The quality level
  // is computed from the row alone — no catalogue count here, so an empty
  // catalogue is reported by the admin roster and the merchant's checklist
  // rather than guessed at by a listing.
  const name = sanitizeDisplayName(row.name);
  const { level } = validateStorePublic(
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
    { sector: category },
  );
  return {
    id: row.id,
    name: { ar: name, en: name },
    area: { ar: row.area ?? "", en: row.area ?? "" },
    region: (row.region as RegionKey) ?? undefined,
    category,
    quality: level,
    hoursKnown: hours != null,
    facts: storeRowCardSource(row),
    isOpen: open ?? true,
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

/** The gate. A `blocked` store is dropped from every RANKED surface this file
 *  feeds (home rails, explore, search, the map) and from nothing else: its own
 *  page still answers its URL through store-view.ts, and the admin roster
 *  shows why it is held. Nothing on production is blocked today (see
 *  lib/data-quality.ts); this is what keeps the next unnamed, unreachable
 *  store out of the rails while the owner reviews it. */
function listable(list: ListedStore[]): ListedStore[] {
  return list.filter((s) => s.quality !== "blocked");
}

// Bounded so the explore/category pages never issue an unbounded query. The
// client still filters + sorts (incl. "near me", which needs coordinates in
// memory) within this window; beyond it, users rely on search. Raise or move
// to server-side pagination / PostGIS nearest-search when store count nears it.
const STORE_FETCH_LIMIT = 200;

// The active-store listing is public, identical for everyone, and the heaviest
// query behind the homepage / explore / category pages. Cache it cross-request
// (60s) with the cookie-less client so those pages don't re-run it per visitor.
// Per-user data (favourites) is layered on AFTER, uncached (see markFavorites).
// Tagged "stores" so a store create/edit could bust it immediately if wired.
const fetchActiveStores = unstable_cache(
  async (): Promise<ListedStore[]> => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("stores")
      .select(LISTING_SELECT)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(STORE_FETCH_LIMIT);
    const list = listable(
      ((data ?? []) as unknown as Parameters<typeof rowToStore>[0][]).map(
        rowToStore,
      ),
    );
    // Paid featured stores float to the top of the default listing (stable
    // otherwise — the pages re-sort for "near me"/rating when the user asks).
    list.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));

    await Promise.all([attachLocations(list), attachCardRollups(list)]);
    return list;
  },
  // v2: entries now carry hoursKnown + facts; an older cached entry has neither.
  ["active-stores-listing-v2"],
  { revalidate: 60, tags: ["stores"] },
);

// Attaches the active branch locations of each store (one query, scoped to
// just these ids). "Near me" ranks a store by its closest branch and the map
// draws a pin per branch, so the listing needs every branch's coordinates —
// not only the primary lat/lng copied onto the store row.
async function attachLocations(list: Store[]): Promise<void> {
  if (!list.length) return;
  // Cookie-less: this runs inside the cached fetchActiveStores (unstable_cache
  // can't read request cookies) and branch locations are public data.
  const supabase = createPublicClient();
  const ids = list.map((s) => s.id);
  const { data: locs } = await supabase
    .from("store_locations")
    .select("id, store_id, name, area, lat, lng")
    .in("store_id", ids)
    .eq("is_active", true)
    .limit(FETCH_BOUNDS.storeLocations);
  warnIfTruncated(locs, FETCH_BOUNDS.storeLocations, "store_locations (store listing)");
  const byStore = new Map<string, NonNullable<Store["locations"]>>();
  (
    (locs ?? []) as {
      id: string;
      store_id: string;
      name: string | null;
      area: string | null;
      lat: number | null;
      lng: number | null;
    }[]
  ).forEach((l) => {
    const arr = byStore.get(l.store_id) ?? [];
    arr.push({
      id: l.id,
      name: l.name,
      area: l.area,
      lat: l.lat != null ? Number(l.lat) : null,
      lng: l.lng != null ? Number(l.lng) : null,
    });
    byStore.set(l.store_id, arr);
  });
  list.forEach((s) => {
    const arr = byStore.get(s.id);
    if (arr) s.locations = arr;
  });
}

// Merges the batched card rollups (catalogue, services and prices, delivery
// zones — lib/data/discovery.ts cardRollups) into each store's row facts.
// Cached platform-wide rollups looked up by id: no query per card.
async function attachCardRollups(list: ListedStore[]): Promise<void> {
  const rollups = await cardRollups(list.map((s) => s.id));
  for (const s of list) s.facts = { ...s.facts, ...rollups[s.id] };
}

// Marks which stores the current user has saved (followed).
async function markFavorites<T extends Store>(list: T[]): Promise<T[]> {
  const ids = await followedAmong(list.map((s) => s.id));
  if (ids) list.forEach((s) => (s.favorited = ids.has(s.id)));
  return list;
}

/**
 * MP-041. Which of `storeIds` the signed-in viewer follows — `null` when there
 * is no viewer, so the caller leaves `favorited` alone rather than clearing it.
 *
 * This read used to fetch the viewer's ENTIRE follow list and test the page
 * against it, which made the follow count the thing that had to stay under a
 * thousand. Truncating it did not merely hide rows: a store the user follows
 * came back absent and rendered as un-followed — a heart that silently forgets,
 * which reads as a bug in following rather than in fetching, and which a
 * re-follow would then hit a duplicate-key on.
 *
 * Asking only about the ids on the page removes that ceiling instead of raising
 * it. The answer is now bounded by what is being rendered (at most a couple of
 * hundred cards), so no follow count can ever truncate it. Chunked because the
 * `.in()` filter travels in the URL.
 */
export async function followedAmong(
  storeIds: readonly string[],
): Promise<Set<string> | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Demo/sample stores carry non-UUID ids ("1", "2"…). They can never be
  // followed — follows.store_id is a FK to stores — but handing one to a uuid
  // filter is a 400, and a 400 here would blank out EVERY heart on the page.
  const real = storeIds.filter((id) => UUID_RE.test(id));
  if (!real.length) return new Set();
  const rows = await fetchAllByIds<{ store_id: string }>(
    real,
    (chunk, from, to) =>
      supabase
        .from("follows")
        .select("store_id")
        .eq("user_id", user.id)
        .in("store_id", chunk)
        .order("store_id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: { store_id: string }[] | null;
      }>,
    // follows has a (user_id, store_id) unique key, so this query returns at
    // most one row per id asked about. +1 keeps the ceiling strictly
    // unreachable: at `real.length` a user who follows every store on the page
    // — perfectly normal — would trip the truncation alarm.
    real.length + 1,
    `follows (user ${user.id})`,
  );
  return new Set(rows.map((f) => f.store_id));
}

// Real active stores, optionally padded with demo samples so listings aren't
// empty before the platform fills up.
export async function getStoresForListing(): Promise<CardStore[]> {
  // fetchActiveStores is cached (shared across requests), and markFavorites
  // mutates `favorited` per user — so shallow-clone first to never write a
  // viewer's favourites onto the shared cached objects. (Demo stores are
  // module-level statics; clone them for the same reason.)
  const real = (await fetchActiveStores()).map((s) => ({ ...s }));
  if (!SHOW_DEMO_STORES) return markFavorites(real);
  const realIds = new Set(real.map((s) => s.id));
  return markFavorites<CardStore>([
    ...real,
    ...demoStores.filter((s) => !realIds.has(s.id)).map((s) => ({ ...s })),
  ]);
}

// Store search for the unified search page.
//
// This matched the name column alone, while /explore matched name, description
// AND area through the same UI. The consequence was that searching a CITY found
// nothing: 12 of 15 live stores carry "طرابلس" in their area and not one of them
// has it in its name, so the single most likely thing a Lebanese customer types
// returned an empty page — while the same word on /explore returned twelve.
//
// Now the same three columns, and the escaper is shared rather than copied:
// PostgREST reads an or= filter as a comma-separated list, so a comma or
// parenthesis in
// the buyer's words would be parsed as syntax, and %/_ are ilike wildcards — a
// search for "50%" must not match every store. Two copies of that rule is how
// the two paths drifted apart in the first place.
//
// Search v2 (P1-SEARCH-01): `plan` is what lib/search-intent.ts understood of
// the query. Without it the function behaves as before (one ILIKE of the whole
// term, now also over `specialties`). With it, up to three bounded reads run
// in parallel — the text match over every understood word and its stems, the
// stores of the understood sector(s) whether or not their text says the word
// («مطاعم» → the restaurant that never writes «مطعم»), and the clinics whose
// doctors carry the understood specialty — and rankStores() merges, filters by
// the understood region and orders them. The quality gate is unchanged: every
// row still goes through rowToStore + listable, so a blocked store never ranks.
// The pure half is imported lazily so this file's module graph is untouched.
export async function searchStores(
  q: string,
  region?: string,
  plan?: import("@/lib/search-intent").StoreSearchPlan,
): Promise<Store[]> {
  const term = q.trim();
  if (!term) return [];
  const supabase = await createClient();
  const si = await import("@/lib/search-intent");
  const p = plan ?? si.planStoreSearch(si.parseSearchIntent(term));
  const explicitRegion = region && region !== "all" ? region : null;
  // One window for every read. The platform has a few dozen stores; the bound
  // is what keeps a broad sector pull from becoming an unbounded select.
  const SEARCH_WINDOW = 60;
  const SELECT = `${LISTING_SELECT}, specialties`;
  type Row = Parameters<typeof rowToStore>[0] & { specialties?: string | null };

  const orClause = si.storeTextOrClause(p);
  const doctorClause = si.doctorSpecialtyOrClause(p);

  let textQuery = supabase
    .from("stores")
    .select(SELECT)
    .eq("status", "active")
    .is("deleted_at", null)
    .or(
      orClause ||
        `name.ilike.%${escapeForOr(term)}%,description.ilike.%${escapeForOr(term)}%,area.ilike.%${escapeForOr(term)}%`,
    );
  if (explicitRegion) textQuery = textQuery.eq("region", explicitRegion);

  let sectorQuery = supabase
    .from("stores")
    .select(SELECT.replace("business_types(slug)", "business_types!inner(slug)"))
    .eq("status", "active")
    .is("deleted_at", null)
    .in("business_types.slug", p.sectors);
  if (explicitRegion) sectorQuery = sectorQuery.eq("region", explicitRegion);

  const regionQuery = supabase
    .from("stores")
    .select(SELECT)
    .eq("status", "active")
    .is("deleted_at", null)
    .eq("region", explicitRegion ?? p.region ?? "");

  const [text, sector, place, doctors] = await Promise.all([
    textQuery.limit(SEARCH_WINDOW),
    p.sectors.length ? sectorQuery.limit(SEARCH_WINDOW) : null,
    p.pullRegion && (explicitRegion ?? p.region)
      ? regionQuery.limit(SEARCH_WINDOW)
      : null,
    doctorClause
      ? supabase.from("doctors").select("store_id").or(doctorClause).limit(100)
      : null,
  ]);

  // Clinics named by a doctor's specialty but not already in hand.
  const doctorIds = new Set(
    ((doctors?.data ?? []) as { store_id: string }[]).map((d) => d.store_id),
  );
  const rows = new Map<string, Row>();
  for (const r of [
    ...((text.data ?? []) as unknown as Row[]),
    ...((sector?.data ?? []) as unknown as Row[]),
    ...((place?.data ?? []) as unknown as Row[]),
  ]) {
    rows.set(r.id, r);
  }
  const missing = [...doctorIds].filter((id) => !rows.has(id) && UUID_RE.test(id));
  if (missing.length) {
    let idQuery = supabase
      .from("stores")
      .select(SELECT)
      .eq("status", "active")
      .is("deleted_at", null)
      .in("id", missing);
    if (explicitRegion) idQuery = idQuery.eq("region", explicitRegion);
    const { data } = await idQuery.limit(missing.length);
    for (const r of (data ?? []) as unknown as Row[]) rows.set(r.id, r);
  }

  const listed = listable([...rows.values()].map(rowToStore));
  const byId = new Map([...rows.values()].map((r) => [r.id, r]));
  const ranked = si.rankStores(
    listed.map((s) => {
      const r = byId.get(s.id)!;
      return {
        store: s,
        id: s.id,
        name: r.name,
        description: r.description ?? null,
        area: r.area,
        specialties: r.specialties ?? null,
        region: r.region,
        sector: s.category,
        rating: s.rating,
        reviews: s.reviews,
      };
    }),
    p,
    doctorIds,
  );
  // Same batched facts the explore grid gets, so a store reads the same on a
  // search card as it does everywhere else.
  const top = ranked.slice(0, 24).map((x) => x.store);
  await attachCardRollups(top);
  return markFavorites(top);
}

// Homepage "featured" strip = PAYING stores only: a paid plan, or a store an
// admin flagged featured (featured_until in the future). Free stores never
// appear here — the strip is a paid placement. Dedicated limit-bound query (was
// reusing the 200-store listing + all-reviews path just to slice 4).
//
// The plan test was `plan.eq.pro`, which matches the string "pro" and nothing
// else, so a Business store — the most expensive plan there is — was excluded
// from the placement its Pro competitor received. /pricing has always sold this
// as included on both tiers (feature-availability.ts `homeFeatured`), so the
// query was the thing that was wrong.
export async function getFeaturedStores(limit = 4): Promise<CardStore[]> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("stores")
    .select(LISTING_SELECT)
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`plan.in.(pro,business),featured_until.gt.${nowIso}`)
    .limit(limit);
  const real = listable(
    ((data ?? []) as unknown as Parameters<typeof rowToStore>[0][]).map(
      rowToStore,
    ),
  );
  // Featured (paid placement) floats above plain Pro.
  real.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
  await attachCardRollups(real);
  if (!SHOW_DEMO_STORES) return markFavorites(real.slice(0, limit));
  const realIds = new Set(real.map((s) => s.id));
  return markFavorites<CardStore>(
    [...real, ...featuredStores.filter((s) => !realIds.has(s.id))].slice(
      0,
      limit,
    ),
  );
}
