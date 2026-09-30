import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public-client";
import { toCategoryKey, type CategoryKey } from "@/lib/catalog";
import { FETCH_BOUNDS, warnIfTruncated } from "./bounds";
import type {
  Variant,
  AddOn,
  ModifierGroup,
} from "@/components/product-order";

// The public product view: the product row + its store context + variants +
// add-ons. Identical for every anonymous visitor, so it's cached cross-request
// with the cookie-less anon client. Per-user pieces (wishlist, saved address,
// reviews, "is store owner"…) stay on the request-scoped client in the page.
export type ProductView = {
  id: string;
  storeId: string;
  storeName: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  /** How long before an appointment the customer may still cancel/reschedule.
   *  0/null = the merchant never set one, so the service page shows no policy
   *  rather than inventing a window. */
  bookingCancelHours: number | null;
  category: CategoryKey;
  /** product = cart, service = booked. Decides this page CTA. */
  itemKind: "product" | "service";
  durationMinutes: number | null;
  name: string;
  nameEn: string | null;
  brand: string | null;
  description: string | null;
  descriptionEn: string | null;
  price: number;
  discountPrice: number | null;
  flashPrice: number | null;
  flashStart: string | null;
  flashEnd: string | null;
  stock: number | null;
  images: string[];
  attributes: Record<string, string> | null;
  variants: Variant[];
  addons: AddOn[];
  modifierGroups: ModifierGroup[];
  isBundle: boolean;
  includes: { name: string; nameEn: string | null; quantity: number }[];
};

// Client-agnostic fetch + map. `supabase` is the anon public client on the
// cached path, or the request-scoped server client on the owner/staff fallback.
// RLS decides visibility; the query is identical either way.
async function fetchProductView(
  supabase: SupabaseClient,
  id: string,
): Promise<ProductView | null> {
  const { data } = await supabase
    .from("products")
    .select(
      "id, store_id, name, name_en, brand, description, description_en, price, discount_price, flash_price, flash_start, flash_end, image_url, gallery, stock, attributes, is_bundle, item_kind, duration_minutes, stores(name, accepts_delivery, accepts_pickup, booking_cancel_hours, business_types(slug))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;

  const store = data.stores as unknown as {
    name: string;
    accepts_delivery: boolean | null;
    accepts_pickup: boolean | null;
    booking_cancel_hours: number | null;
    business_types: { slug: string } | null;
  } | null;

  const [{ data: variants }, { data: addons }, { data: modGroups }] =
    await Promise.all([
      supabase
        .from("product_variants")
        .select("id, label, price, stock, is_available, color, size, duration_minutes")
        .eq("product_id", id)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.productVariants),
      supabase
        .from("product_options")
        .select("id, name, price, group_id")
        .eq("product_id", id)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.productOptions),
      supabase
        .from("product_modifier_groups")
        .select("id, name, name_en, required, min_select, max_select")
        .eq("product_id", id)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.productModifierGroups),
    ]);
  // A picker that silently drops variants would quote the wrong price.
  warnIfTruncated(variants, FETCH_BOUNDS.productVariants, `product_variants (product ${id})`);
  warnIfTruncated(addons, FETCH_BOUNDS.productOptions, `product_options (product ${id})`);
  warnIfTruncated(modGroups, FETCH_BOUNDS.productModifierGroups, `product_modifier_groups (product ${id})`);

  // Bundle contents for the "what's inside" list on the detail page.
  const isBundle = (data.is_bundle as boolean | null) ?? false;
  let includes: { name: string; nameEn: string | null; quantity: number }[] = [];
  if (isBundle) {
    const { data: bItems } = await supabase
      .from("bundle_items")
      .select("quantity, sort_order, products(name, name_en)")
      .eq("bundle_id", id)
      .order("sort_order", { ascending: true })
      .limit(FETCH_BOUNDS.bundleItems);
    warnIfTruncated(bItems, FETCH_BOUNDS.bundleItems, `bundle_items (bundle ${id})`);
    includes = ((bItems ?? []) as unknown as {
      quantity: number;
      products: { name: string; name_en: string | null } | null;
    }[])
      .filter((it) => it.products)
      .map((it) => ({
        name: it.products!.name,
        nameEn: it.products!.name_en,
        quantity: it.quantity,
      }));
  }

  const gallery = Array.isArray(data.gallery) ? (data.gallery as string[]) : [];
  const images = [data.image_url as string | null, ...gallery].filter(
    Boolean,
  ) as string[];

  return {
    id: data.id as string,
    storeId: data.store_id as string,
    storeName: store?.name ?? "",
    acceptsDelivery: store?.accepts_delivery ?? true,
    acceptsPickup: store?.accepts_pickup ?? true,
    bookingCancelHours:
      store?.booking_cancel_hours != null
        ? Number(store.booking_cancel_hours)
        : null,
    category: toCategoryKey(
      store?.business_types?.slug,
      `store ${data.store_id as string}`,
    ),
    itemKind: ((data.item_kind as string | null) ?? "product") as "product" | "service",
    durationMinutes: data.duration_minutes != null ? Number(data.duration_minutes) : null,
    name: data.name as string,
    nameEn: (data.name_en as string | null) ?? null,
    brand: (data.brand as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    descriptionEn: (data.description_en as string | null) ?? null,
    price: Number(data.price),
    discountPrice:
      data.discount_price != null ? Number(data.discount_price) : null,
    flashPrice: data.flash_price != null ? Number(data.flash_price) : null,
    flashStart: (data.flash_start as string | null) ?? null,
    flashEnd: (data.flash_end as string | null) ?? null,
    stock: data.stock != null ? Number(data.stock) : null,
    images,
    attributes: (data.attributes as Record<string, string> | null) ?? null,
    variants: (variants ?? []).map((v) => ({
      id: v.id as string,
      label: v.label as string,
      price: v.price != null ? Number(v.price) : null,
      stock: v.stock != null ? Number(v.stock) : null,
      is_available: v.is_available as boolean,
      color: (v.color as string | null) ?? null,
      size: (v.size as string | null) ?? null,
      durationMinutes: v.duration_minutes != null ? Number(v.duration_minutes) : null,
    })),
    addons: (addons ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      price: Number(a.price),
      groupId: (a.group_id as string | null) ?? null,
    })),
    modifierGroups: (modGroups ?? []).map((g) => ({
      id: g.id as string,
      name: g.name as string,
      nameEn: (g.name_en as string | null) ?? null,
      required: g.required as boolean,
      minSelect: Number(g.min_select) || 0,
      maxSelect: g.max_select != null ? Number(g.max_select) : null,
    })),
    isBundle,
    includes,
  };
}

// Cached public read: anon client, so RLS returns the product only when it and
// its store are active — the set that's safe to share across visitors. Tagged
// product:<id> (targeted bust on edit) plus the shared "products" tag.
export function getPublicProductView(id: string): Promise<ProductView | null> {
  return unstable_cache(
    () => fetchProductView(createPublicClient(), id),
    ["product-view", id],
    { revalidate: 300, tags: ["products", `product:${id}`] },
  )();
}

// Uncached fallback on the request-scoped client, used only when the cached
// public read returns null — an owner/staff previewing a not-yet-public product.
// Never cached: visibility here is per-user.
export function getOwnedProductView(
  supabase: SupabaseClient,
  id: string,
): Promise<ProductView | null> {
  return fetchProductView(supabase, id);
}
