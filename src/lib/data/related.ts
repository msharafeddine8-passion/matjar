import { createClient } from "@/lib/supabase/server";
import { toCategoryKey, type CategoryKey } from "@/lib/catalog";
import type { OfferingKind } from "@/lib/offering";
import { FETCH_BOUNDS, warnIfTruncated } from "./bounds";

/** A team member who can deliver a service (the `doctors` roster). */
export type ServiceProvider = {
  id: string;
  name: string;
  specialty: string | null;
  photo_url: string | null;
};

export type RelatedProduct = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
  discountPrice: number | null;
  imageUrl: string | null;
  storeName: string;
  /** The two resolver inputs plus the one fact a service card shows — so the
   *  card can ask `resolveOffering` instead of assuming it holds a product. */
  itemKind: OfferingKind;
  category: CategoryKey;
  durationMinutes: number | null;
};

/** The columns every related query selects. `item_kind` and the store's
 *  sector are what let a card in a "خدمات مشابهة" rail render as a service. */
const RELATED_COLUMNS =
  "id, name, name_en, price, discount_price, image_url, item_kind, duration_minutes";

type RelatedRow = {
  id: string;
  name: string;
  name_en: string | null;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  item_kind: string | null;
  duration_minutes: number | null;
  stores: { name: string; business_types?: { slug: string } | null } | null;
};

function mapRows(rows: RelatedRow[]): RelatedProduct[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameEn: r.name_en,
    price: Number(r.price),
    discountPrice: r.discount_price != null ? Number(r.discount_price) : null,
    imageUrl: r.image_url,
    storeName: r.stores?.name ?? "",
    itemKind: (r.item_kind ?? "product") as OfferingKind,
    category: toCategoryKey(r.stores?.business_types?.slug, `related ${r.id}`),
    durationMinutes:
      r.duration_minutes != null ? Number(r.duration_minutes) : null,
  }));
}

/** Products most frequently bought in the same order as this one. */
export async function getBoughtTogether(
  productId: string,
): Promise<RelatedProduct[]> {
  const supabase = await createClient();
  const { data: rpc } = await supabase.rpc("bought_together", {
    p_product_id: productId,
    p_limit: 4,
  });
  const ids = ((rpc ?? []) as { product_id: string }[]).map((r) => r.product_id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("products")
    .select(`${RELATED_COLUMNS}, stores(name, business_types(slug))`)
    .in("id", ids)
    .eq("status", "active")
    .eq("is_available", true)
    .is("deleted_at", null)
    // Already bounded upstream by the RPC's p_limit; explicit so the ceiling
    // is stated at the query rather than inferred from another file.
    .limit(FETCH_BOUNDS.productVariants);
  const mapped = mapRows((data ?? []) as unknown as RelatedRow[]);
  // Preserve the co-purchase frequency order.
  const order = new Map(ids.map((id, i) => [id, i]));
  return mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Other active offerings from the same store.
 *
 *  `kind` filters to the same `products.item_kind`, so a clinic's service page
 *  lists other services and a shop's product page lists other products —
 *  before, a dental cleaning could recommend a bottle of shampoo. Omitted =
 *  every kind (the pre-existing behaviour, kept for any caller that wants it). */
export async function getMoreFromStore(
  storeId: string,
  excludeId: string,
  limit = 6,
  kind?: OfferingKind,
): Promise<RelatedProduct[]> {
  const supabase = await createClient();
  let q = supabase
    .from("products")
    .select(`${RELATED_COLUMNS}, stores(name, business_types(slug))`)
    .eq("store_id", storeId)
    .eq("status", "active")
    .eq("is_available", true)
    .is("deleted_at", null)
    .neq("id", excludeId);
  if (kind) q = q.eq("item_kind", kind);
  const { data } = await q
    .order("created_at", { ascending: false })
    .limit(limit);
  return mapRows((data ?? []) as unknown as RelatedRow[]);
}

/** Active offerings of the same kind in the same sector, from other stores. */
export async function getSimilarProducts(
  category: CategoryKey,
  excludeStoreId: string,
  excludeId: string,
  limit = 6,
  kind?: OfferingKind,
): Promise<RelatedProduct[]> {
  const supabase = await createClient();
  const { data: bt } = await supabase
    .from("business_types")
    .select("id")
    .eq("slug", category)
    .limit(1)
    .maybeSingle();
  const btId = (bt as { id?: string } | null)?.id;
  if (!btId) return [];

  let q = supabase
    .from("products")
    .select(
      `${RELATED_COLUMNS}, store_id, stores!inner(name, status, business_type_id, business_types(slug))`,
    )
    .eq("status", "active")
    .eq("is_available", true)
    .is("deleted_at", null)
    .eq("stores.status", "active")
    .eq("stores.business_type_id", btId)
    .neq("id", excludeId)
    .neq("store_id", excludeStoreId);
  if (kind) q = q.eq("item_kind", kind);
  const { data } = await q
    .order("created_at", { ascending: false })
    .limit(limit);
  return mapRows((data ?? []) as unknown as RelatedRow[]);
}

/** Who on the store's team delivers this service.
 *
 *  `service_providers` maps a service to specific team members; NO row for the
 *  service means every member can deliver it — the same rule the booking engine
 *  itself applies. Returns [] when the store has no team, so the section simply
 *  does not render rather than showing an empty shell. Nothing here is invented:
 *  it is the roster the merchant entered. */
export async function getServiceProviders(
  storeId: string,
  productId: string,
): Promise<ServiceProvider[]> {
  const supabase = await createClient();
  const [{ data: team }, { data: links }] = await Promise.all([
    supabase
      .from("doctors")
      .select("id, name, specialty, photo_url")
      .eq("store_id", storeId)
      .order("sort_order", { ascending: true })
      .limit(FETCH_BOUNDS.allProviders),
    supabase
      .from("service_providers")
      .select("doctor_id")
      .eq("store_id", storeId)
      .eq("product_id", productId)
      .limit(FETCH_BOUNDS.allProviders),
  ]);
  warnIfTruncated(team, FETCH_BOUNDS.allProviders, `doctors (store ${storeId})`);
  warnIfTruncated(links, FETCH_BOUNDS.allProviders, `service_providers (store ${storeId})`);
  const roster = (team ?? []) as unknown as ServiceProvider[];
  const assigned = new Set(
    ((links ?? []) as { doctor_id: string }[]).map((r) => r.doctor_id),
  );
  if (assigned.size === 0) return roster;
  return roster.filter((d) => assigned.has(d.id));
}
