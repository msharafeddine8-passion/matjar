import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";
import { toCategoryKey, type CategoryKey, type Store } from "@/lib/catalog";
import type { OfferingKind } from "@/lib/offering";
import {
  listingSearchTerms,
  parseSearchIntent,
  planStoreSearch,
  productSearchTerms,
  type SearchIntent,
} from "@/lib/search-intent";
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
  /** What the query was understood to mean (lib/search-intent.ts). */
  intent: SearchIntent | null;
};

type FuzzyRow = {
  id: string;
  name: string;
  name_en: string | null;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  store_name: string;
};

/** Products for up to three terms (productSearchTerms: the query as typed,
 *  its residual, a one-word stem), merged in term order and de-duplicated —
 *  «المطاعم» also asks the RPC for «مطاعم». */
async function searchProducts(terms: string[]): Promise<ProductResult[]> {
  const list = terms.map((t) => t.trim()).filter(Boolean);
  if (!list.length) return [];
  const supabase = await createClient();
  // Fuzzy product search (name + name_en, trigram + ILIKE) so close/misspelled
  // terms and English names surface. The RPC already filters to active/available
  // products of active stores and ranks by best match. See migration 0114.
  const answers = await Promise.all(
    list.map((term) => supabase.rpc("search_products_fuzzy", { p_q: term })),
  );
  const seen = new Set<string>();
  const rows: FuzzyRow[] = [];
  for (const { data } of answers) {
    for (const r of (data ?? []) as FuzzyRow[]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
  }
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

/** Sunday-Market listings for each term (null = the section's latest, when
 *  the query was the section's own name), merged and capped. */
async function searchListings(
  lang: Locale,
  terms: (string | null)[],
  region: string | undefined,
): Promise<ListingCard[]> {
  const answers = await Promise.all(
    terms.map((t) =>
      getActiveListings(lang, { q: t ?? undefined, region }, 24),
    ),
  );
  const seen = new Set<string>();
  const out: ListingCard[] = [];
  for (const list of answers) {
    for (const l of list) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
    }
  }
  return out.slice(0, 24);
}

// One query fan-out across the three public entities: stores, products, and
// Sunday Market listings. All name/title matches are trigram-indexed.
//
// Search v2: the query is read for intent first (sector, section, trade,
// specialty, place — lib/search-intent.ts) and each entity is searched with
// what that reading adds. An explicit ?region= from the URL still wins over a
// place named in the words.
export async function searchAll(
  q: string,
  lang: Locale,
  region?: string,
): Promise<SearchResults> {
  const term = q.trim();
  if (!term) return { stores: [], products: [], listings: [], intent: null };
  const intent = parseSearchIntent(term);
  const explicitRegion = region && region !== "all" ? region : undefined;
  const [stores, products, listings] = await Promise.all([
    searchStores(term, region, planStoreSearch(intent)),
    searchProducts(productSearchTerms(intent)),
    // Only the URL region narrows listings: most listings leave region empty,
    // and a place inferred from the words must not hide them.
    searchListings(lang, listingSearchTerms(intent), explicitRegion),
  ]);
  return { stores, products, listings, intent };
}
