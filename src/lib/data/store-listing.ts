import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public-client";
import { resolveListing, type ListingFacts } from "@/lib/listing";
import { FETCH_BOUNDS, warnIfTruncated } from "./bounds";
import { toPageKind, type PageKind } from "@/lib/page-kind";

export type { PageKind };

// The ONLY reader of the columns 0338 added (STORE_COLUMNS_ADDED_0338 — the
// grants test holds every other file to it).
//
// Column grants are why this is a separate query. Since 0314 a table-level
// SELECT no longer covers a new column, and one ungranted column fails the WHOLE
// select with 42501: adding `listing_mode` to the store view's main select would
// turn a missing grant into every storefront on the platform answering 404. Asked
// on their own, a refusal costs only this answer, and the fallback below is the
// truth for every store that exists until somebody flips the toggle: `owner_id`
// (anon-readable) still says who is unclaimed, and an owned store stays "full".
//
// Same caveat in the other direction: until the grant exists a merchant's
// showcase toggle would save, and the database would refuse orders, while this
// read still says "full". The grant ships before the toggle does.

export type StoreListing = ListingFacts & {
  dataSource: string | null;
  sourceUrl: string | null;
  /** 0342: print prices in lira. Only ever true for a showcase store — a full
   *  store's cart and checkout settle in USD. */
  pricesInLbp: boolean;
  /** The stored flag itself, for the owner's settings switch. */
  pricesInLbpSetting: boolean;
  pageKind: PageKind | null;
};

type ListingRow = {
  listing_mode: string | null;
  data_source: string | null;
  source_url: string | null;
  page_kind?: string | null;
};

export async function readStoreListing(
  supabase: SupabaseClient,
  storeId: string,
  ownerId: string | null,
): Promise<StoreListing> {
  // Two reads, not one: prices_in_lbp (0342) is asked on its own so a missing
  // grant costs only the lira display, never the showcase answer above it —
  // checkout.ts trusts that answer to keep a display-only store from taking
  // orders.
  const [{ data }, { data: lbpRow }] = await Promise.all([
    supabase
      .from("stores")
      .select("listing_mode, data_source, source_url")
      .eq("id", storeId)
      .maybeSingle(),
    supabase
      .from("stores")
      .select("prices_in_lbp")
      .eq("id", storeId)
      .maybeSingle(),
  ]);
  const row = data as unknown as ListingRow | null;
  const facts = resolveListing({ ownerId, listingMode: row?.listing_mode });
  const setting =
    (lbpRow as unknown as { prices_in_lbp: boolean | null } | null)?.prices_in_lbp === true;
  return {
    ...facts,
    dataSource: row?.data_source ?? null,
    sourceUrl: row?.source_url ?? null,
    pricesInLbp: facts.showcase && setting,
    pricesInLbpSetting: setting,
    pageKind: await readPageKind(supabase, storeId),
  };
}

// Its own query for the same reason as the rest of this file: a missing grant
// on page_kind (0344) then costs only this answer — the store renders full.
async function readPageKind(supabase: SupabaseClient, storeId: string): Promise<PageKind | null> {
  const { data } = await supabase
    .from("stores")
    .select("page_kind")
    .eq("id", storeId)
    .maybeSingle();
  return toPageKind((data as { page_kind?: string | null } | null)?.page_kind);
}

/** Owned stores that chose display-only, for the cards' facts line. An id list
 *  rather than a column on the listing select, for the reason at the top of this
 *  file. Small by nature, and an error reads as "none". */
export const getShowcaseStoreIds = unstable_cache(
  async (): Promise<string[]> => {
    const { data } = await createPublicClient()
      .from("stores")
      .select("id")
      .eq("listing_mode", "showcase")
      .not("owner_id", "is", null)
      .is("deleted_at", null)
      .limit(FETCH_BOUNDS.ownedShowcaseStores);
    warnIfTruncated(data, FETCH_BOUNDS.ownedShowcaseStores, "owned showcase ids");
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  },
  ["store-showcase-ids"],
  { revalidate: 300, tags: ["stores"] },
);

export type StoreContact = StoreListing & {
  storeName: string;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
};

/** What a product page needs to know about its store beyond the product view:
 *  whether it transacts at all, and how to reach it when it does not. */
export function getStoreContact(storeId: string): Promise<StoreContact | null> {
  return unstable_cache(
    async (): Promise<StoreContact | null> => {
      const supabase = createPublicClient();
      const { data } = await supabase
        .from("stores")
        .select("name, owner_id, phone, whatsapp, lat, lng")
        .eq("id", storeId)
        .maybeSingle();
      const row = data as unknown as {
        name: string;
        owner_id: string | null;
        phone: string | null;
        whatsapp: string | null;
        lat: number | string | null;
        lng: number | string | null;
      } | null;
      if (!row) return null;
      return {
        ...(await readStoreListing(supabase, storeId, row.owner_id)),
        storeName: row.name,
        phone: row.phone,
        whatsapp: row.whatsapp,
        lat: row.lat != null ? Number(row.lat) : null,
        lng: row.lng != null ? Number(row.lng) : null,
      };
    },
    ["store-contact", storeId],
    { revalidate: 300, tags: ["stores", `store:${storeId}`] },
  )();
}
