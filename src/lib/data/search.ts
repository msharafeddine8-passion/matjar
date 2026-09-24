import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";
import { toCategoryKey, type CategoryKey, type Store } from "@/lib/catalog";
import type { OfferingKind } from "@/lib/offering";
import { searchStores } from "./stores";
import { getActiveListings, type ListingCard } from "./market";

export type ProductResult = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
  discountPrice: number | null;
  imageUrl: string | null;
  storeName: string;
  /** Resolver inputs (+ the service's duration) so a hit renders as what it
   *  is — the fuzzy RPC returns none of these, hence the second read below. */
  itemKind: OfferingKind;
  category: CategoryKey;
  durationMinutes: number | null;
};

/** The kind facts for a set of hits. One bounded IN-query on ids the RPC has
 *  already filtered to active/available rows of active stores, so it cannot
 *  widen the result set — it only says what each row IS. */
export async function offeringFactsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<
  Map<string, { itemKind: OfferingKind; category: CategoryKey; durationMinutes: number | null }>
> {
  const out = new Map<
    string,
    { itemKind: OfferingKind; category: CategoryKey; durationMinutes: number | null }
  >();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from("products")
    .select("id, item_kind, duration_minutes, stores(business_types(slug))")
    .in("id", ids)
    // One row per id at most; the IN list IS the bound (data-contracts.test
    // asks every select to state one).
    .limit(ids.length);
  for (const r of (data ?? []) as unknown as {
    id: string;
    item_kind: string | null;
    duration_minutes: number | null;
    stores: { business_types: { slug: string } | null } | null;
  }[]) {
    out.set(r.id, {
      itemKind: (r.item_kind ?? "product") as OfferingKind,
      category: toCategoryKey(r.stores?.business_types?.slug, `search ${r.id}`),
      durationMinutes:
        r.duration_minutes != null ? Number(r.duration_minutes) : null,
    });
  }
  return out;
}

export type SearchResults = {
  stores: Store[];
  products: ProductResult[];
  listings: ListingCard[];
};

async function searchProducts(q: string): Promise<ProductResult[]> {
  const term = q.trim();
  if (!term) return [];
  const supabase = await createClient();
  // Fuzzy product search (name + name_en, trigram + ILIKE) so close/misspelled
  // terms and English names surface. The RPC already filters to active/available
  // products of active stores and ranks by best match. See migration 0114.
  const { data } = await supabase.rpc("search_products_fuzzy", { p_q: term });

  const rows = (data ?? []) as {
    id: string;
    name: string;
    name_en: string | null;
    price: number;
    discount_price: number | null;
    image_url: string | null;
    store_name: string;
  }[];
  const facts = await offeringFactsFor(
    supabase,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const f = facts.get(r.id);
    return {
      id: r.id,
      name: r.name,
      nameEn: r.name_en,
      price: Number(r.price),
      discountPrice: r.discount_price != null ? Number(r.discount_price) : null,
      imageUrl: r.image_url,
      storeName: r.store_name ?? "",
      // A row the facts read could not see (RLS narrowed between the two
      // reads) renders as a plain product — the pre-existing behaviour.
      itemKind: f?.itemKind ?? "product",
      category: f?.category ?? "retail",
      durationMinutes: f?.durationMinutes ?? null,
    };
  });
}

// One query fan-out across the three public entities: stores, products, and
// Sunday Market listings. All name/title matches are trigram-indexed.
export async function searchAll(
  q: string,
  lang: Locale,
  region?: string,
): Promise<SearchResults> {
  const term = q.trim();
  if (!term) return { stores: [], products: [], listings: [] };
  const [stores, products, listings] = await Promise.all([
    searchStores(term, region),
    searchProducts(term),
    getActiveListings(
      lang,
      { q: term, region: region && region !== "all" ? region : undefined },
      24,
    ),
  ]);
  return { stores, products, listings };
}
