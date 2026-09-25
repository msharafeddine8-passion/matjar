import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public-client";
import type { Locale } from "@/i18n/config";
import { FETCH_BOUNDS, fetchAllPages, warnIfTruncated } from "./bounds";

export type MarketCategory = {
  id: string;
  slug: string;
  name: string;
};

export type ListingCard = {
  id: string;
  title: string;
  price: number | null;
  image: string | null;
  city: string | null;
  region: string | null;
  categoryName: string;
  storeId: string | null;
  storeName: string | null;
  isFeatured: boolean;
  status: string;
  createdAt: string;
  /** The moderator's reason on a rejected listing (0313). Only ever filled
   *  on the seller's own screen (getMyListings). */
  moderationNote?: string | null;
};

export type ListingDetail = ListingCard & {
  description: string | null;
  images: string[];
  views: number;
  savesCount: number;
  sellerId: string;
  isFavorited: boolean;
  // Merchant-listing contact so the buyer can act without hunting on the store.
  storeWhatsapp: string | null;
  storePhone: string | null;
  storeSlug: string | null;
};

type Row = {
  id: string;
  title: string;
  price: number | null;
  images: unknown;
  city: string | null;
  region: string | null;
  is_featured: boolean;
  status: string;
  created_at: string;
  store_id: string | null;
  seller_id: string;
  description?: string | null;
  views?: number;
  stores: {
    name: string;
    whatsapp?: string | null;
    phone?: string | null;
    slug?: string | null;
  } | null;
  market_categories: { name_ar: string; name_en: string } | null;
};

const catName = (
  c: { name_ar: string; name_en: string } | null,
  lang: Locale,
) => (c ? (lang === "ar" ? c.name_ar : c.name_en) : "");

const imagesOf = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function toCard(r: Row, lang: Locale): ListingCard {
  const imgs = imagesOf(r.images);
  return {
    id: r.id,
    title: r.title,
    price: r.price != null ? Number(r.price) : null,
    image: imgs[0] ?? null,
    city: r.city,
    region: r.region,
    categoryName: catName(r.market_categories, lang),
    storeId: r.store_id,
    storeName: r.stores?.name ?? null,
    isFeatured: r.is_featured,
    status: r.status,
    createdAt: r.created_at,
  };
}

// Market taxonomy (categories/regions/cities) is admin-managed, near-static, and
// read on every market page render. Cache the raw rows cross-request (1h) with the
// cookie-less client; the per-locale mapping stays outside the cache so both
// locales share one cached fetch. Tagged "market" so an admin edit can bust it.
const fetchMarketCategoriesRaw = unstable_cache(
  async () => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("market_categories")
      .select("id, slug, name_ar, name_en")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(FETCH_BOUNDS.referenceRows);
    warnIfTruncated(data, FETCH_BOUNDS.referenceRows, "market_categories");
    return (data ?? []) as {
      id: string;
      slug: string;
      name_ar: string;
      name_en: string;
    }[];
  },
  ["market-categories"],
  { revalidate: 3600, tags: ["market"] },
);

export async function getMarketCategories(
  lang: Locale,
): Promise<MarketCategory[]> {
  return (await fetchMarketCategoriesRaw()).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: lang === "ar" ? c.name_ar : c.name_en,
  }));
}

export type MarketRegion = { key: string; name: string };

const fetchMarketRegionsRaw = unstable_cache(
  async () => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("market_regions")
      .select("key, name_ar, name_en")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(FETCH_BOUNDS.referenceRows);
    warnIfTruncated(data, FETCH_BOUNDS.referenceRows, "market_regions");
    return (data ?? []) as { key: string; name_ar: string; name_en: string }[];
  },
  ["market-regions"],
  { revalidate: 3600, tags: ["market"] },
);

// Admin-managed region list (active only). Falls back to nothing if the table
// is empty — callers can default to the catalog regions.
export async function getMarketRegions(lang: Locale): Promise<MarketRegion[]> {
  return (await fetchMarketRegionsRaw()).map((r) => ({
    key: r.key,
    name: lang === "ar" ? r.name_ar : r.name_en,
  }));
}

export type MarketCity = { id: string; region: string; name: string };

const fetchMarketCitiesRaw = unstable_cache(
  async () => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("market_cities")
      .select("id, region, name_ar, name_en")
      .eq("is_active", true)
      .order("region", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(FETCH_BOUNDS.referenceRows);
    warnIfTruncated(data, FETCH_BOUNDS.referenceRows, "market_cities");
    return (data ?? []) as {
      id: string;
      region: string;
      name_ar: string;
      name_en: string;
    }[];
  },
  ["market-cities"],
  { revalidate: 3600, tags: ["market"] },
);

// Admin-managed city list (active only), ordered by region then sort_order.
export async function getMarketCities(lang: Locale): Promise<MarketCity[]> {
  return (await fetchMarketCitiesRaw()).map((c) => ({
    id: c.id,
    region: c.region,
    name: lang === "ar" ? c.name_ar : c.name_en,
  }));
}

export type ListingFilters = {
  q?: string;
  category?: string; // slug
  region?: string;
  city?: string;
  priceMin?: number;
  priceMax?: number;
  datePosted?: "24h" | "7d" | "30d";
  sort?: "newest" | "oldest" | "cheapest" | "expensive";
};

const DATE_WINDOWS: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

const SELECT =
  "id, title, price, images, city, region, is_featured, status, created_at, store_id, seller_id, stores(name), market_categories(name_ar, name_en)";

export async function getActiveListings(
  lang: Locale,
  filters: ListingFilters = {},
  limit = 60,
  offset = 0,
): Promise<ListingCard[]> {
  const supabase = await createClient();
  let query = supabase.from("listings").select(SELECT).eq("status", "active");

  if (filters.category) {
    const { data: cat } = await supabase
      .from("market_categories")
      .select("id")
      .eq("slug", filters.category)
      .maybeSingle();
    const catId = (cat as { id?: string } | null)?.id;
    if (catId) query = query.eq("category_id", catId);
    else return [];
  }
  if (filters.q?.trim()) query = query.ilike("title", `%${filters.q.trim()}%`);
  if (filters.region) query = query.eq("region", filters.region);
  if (filters.city?.trim()) query = query.ilike("city", `%${filters.city.trim()}%`);
  if (filters.priceMin != null) query = query.gte("price", filters.priceMin);
  if (filters.priceMax != null) query = query.lte("price", filters.priceMax);
  if (filters.datePosted && DATE_WINDOWS[filters.datePosted]) {
    const cutoff = new Date(
      Date.now() - DATE_WINDOWS[filters.datePosted] * 24 * 60 * 60 * 1000,
    ).toISOString();
    query = query.gte("created_at", cutoff);
  }

  // Featured listings float to the top of the first page.
  query = query.order("is_featured", { ascending: false });
  switch (filters.sort) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "cheapest":
      query = query.order("price", { ascending: true, nullsFirst: false });
      break;
    case "expensive":
      query = query.order("price", { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data } = await query.range(offset, offset + limit - 1);
  return ((data ?? []) as unknown as Row[]).map((r) => toCard(r, lang));
}

// The public listing row (the heavy join) minus the two request-scoped counts.
// savesCount / isFavorited are computed per-request below because
// listing_favorites is RLS-scoped to the caller's own rows — they can't be
// shared across visitors, so only the row itself is cached.
type PublicListing = Omit<ListingDetail, "isFavorited" | "savesCount">;

// Client-agnostic fetch + map for the listing row. `supabase` is the anon
// public client on the cached path, or the request-scoped client on the seller
// draft-preview fallback. RLS decides visibility; the query is identical.
async function fetchListingRow(
  supabase: SupabaseClient,
  id: string,
  lang: Locale,
): Promise<PublicListing | null> {
  const { data } = await supabase
    .from("listings")
    .select(
      "id, title, price, images, city, region, is_featured, status, created_at, store_id, seller_id, stores(name, whatsapp, phone, slug), market_categories(name_ar, name_en), description, views",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Row;
  return {
    ...toCard(r, lang),
    description: r.description ?? null,
    images: imagesOf(r.images),
    views: r.views ?? 0,
    sellerId: r.seller_id,
    storeWhatsapp: r.stores?.whatsapp ?? null,
    storePhone: r.stores?.phone ?? null,
    storeSlug: r.stores?.slug ?? null,
  };
}

// Cached public listing row: anon client → RLS returns active/sold/expired
// listings (the publicly visible set). Tagged listing:<id> for targeted bust.
function getPublicListingRow(
  id: string,
  lang: Locale,
): Promise<PublicListing | null> {
  return unstable_cache(
    () => fetchListingRow(createPublicClient(), id, lang),
    ["listing-view", id, lang],
    { revalidate: 120, tags: ["listings", `listing:${id}`] },
  )();
}

export async function getListingById(
  id: string,
  lang: Locale,
  currentUserId: string | null,
): Promise<ListingDetail | null> {
  // Common case: cached, cookie-less row.
  let row = await getPublicListingRow(id, lang);
  if (!row) {
    // Seller previewing a not-yet-public listing → request-scoped client sees
    // it via RLS. Uncached (per-user visibility).
    row = await fetchListingRow(await createClient(), id, lang);
    if (!row) return null;
  }

  // Per-request/per-user counts on the request-scoped client — identical to the
  // original behavior (listing_favorites is RLS-scoped to the caller).
  const supabase = await createClient();
  const [{ count }, favRes] = await Promise.all([
    supabase
      .from("listing_favorites")
      .select("listing_id", { count: "exact", head: true })
      .eq("listing_id", id),
    currentUserId
      ? supabase
          .from("listing_favorites")
          .select("listing_id")
          .eq("listing_id", id)
          .eq("user_id", currentUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...row,
    savesCount: count ?? 0,
    isFavorited: Boolean((favRes as { data: unknown }).data),
  };
}

export async function getMyListings(
  userId: string,
  lang: Locale,
): Promise<ListingCard[]> {
  const supabase = await createClient();
  // MP-041. Newest-first, so a seller past the ceiling lost their OLDEST
  // listings from this screen — the ones they are least likely to notice
  // missing. Paged now: same select, same filter, same order, more round trips.
  // `created_at` is not unique (a bulk import stamps a whole batch identically),
  // so the id tiebreaker is what keeps `.range()` from dropping or repeating a
  // row at a page boundary.
  const rows = await fetchAllPages<Row>(
    (from, to) =>
      supabase
        .from("listings")
        .select(SELECT)
        .eq("seller_id", userId)
        // A listing the seller (or a moderator) removed is gone from their
        // screen. Since 0313 a seller's delete is a soft delete, so the row
        // survives for the moderation record — not for this list.
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null }>,
    FETCH_BOUNDS.myListings,
    `listings (seller ${userId})`,
  );
  const cards = rows.map((r) => toCard(r, lang));

  // Why a listing was rejected, in the moderator's words (0313). A separate,
  // tolerant read: before 0313 is applied the column does not exist, the
  // query errors, and the screen simply shows no reason.
  const rejected = cards.filter((c) => c.status === "rejected").map((c) => c.id);
  if (rejected.length) {
    const { data: notes, error } = await supabase
      .from("listings")
      .select("id, moderation_note")
      .in("id", rejected.slice(0, 200))
      .limit(200);
    if (!error && notes) {
      const byId = new Map(
        (notes as { id: string; moderation_note: string | null }[]).map((n) => [
          n.id,
          n.moderation_note,
        ]),
      );
      for (const c of cards) {
        if (byId.has(c.id)) c.moderationNote = byId.get(c.id) ?? null;
      }
    }
  }
  return cards;
}
