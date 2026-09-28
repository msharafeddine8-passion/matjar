import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public-client";
import { beirutYmd } from "@/lib/quick-panel";

export type OfferProduct = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
  discountPrice: number | null;
  imageUrl: string | null;
  storeId: string;
  storeName: string;
  off: number; // discount percentage (0 when merchant-flagged without a discount)
};

function toOffer(r: {
  id: string;
  name: string;
  name_en: string | null;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  store_id: string;
  stores: { name: string } | null;
}): OfferProduct {
  const price = Number(r.price);
  const discountPrice = r.discount_price != null ? Number(r.discount_price) : null;
  return {
    id: r.id,
    name: r.name,
    nameEn: r.name_en,
    price,
    discountPrice,
    imageUrl: r.image_url,
    storeId: r.store_id,
    storeName: r.stores?.name ?? "",
    off:
      discountPrice != null && price > 0
        ? Math.round((1 - discountPrice / price) * 100)
        : 0,
  };
}

// These three reads are public, identical for every visitor, and back hot routes
// (home Deal/Offers rails, /offers, /clearance). Cached cross-request with the
// cookie-less client so they don't re-hit Postgres per view. Tagged "products"
// so a product create/edit busts them alongside the store/product caches.

// Deal of the Day — the single product flagged for today (drives the home countdown).
export const getDailyDeal = unstable_cache(
  async (): Promise<OfferProduct | null> => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("products")
      .select(
        "id, name, name_en, price, discount_price, image_url, store_id, stores(name)",
      )
      .eq("status", "active")
      .eq("is_available", true)
      .is("deleted_at", null)
      // Beirut's date: toISOString() is UTC, a day behind until 03:00 here.
      .eq("deal_date", beirutYmd(new Date()))
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return toOffer(data as unknown as Parameters<typeof toOffer>[0]);
  },
  ["daily-deal"],
  { revalidate: 120, tags: ["products"] },
);

// Active offers: products with a discount OR merchant-flagged "in_offers".
export const getOffers = unstable_cache(
  async (limit = 60): Promise<OfferProduct[]> => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("products")
      .select(
        "id, name, name_en, price, discount_price, image_url, store_id, in_offers, stores(name)",
      )
      .eq("status", "active")
      .eq("is_available", true)
      .is("deleted_at", null)
      .or("discount_price.not.is.null,in_offers.eq.true")
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as unknown as Parameters<typeof toOffer>[0][])
      .map(toOffer)
      // Drop invalid discounts (>= price) but keep merchant-flagged ones.
      .filter((p) => p.discountPrice == null || p.discountPrice < p.price)
      .sort((a, b) => b.off - a.off);
  },
  ["offers"],
  { revalidate: 120, tags: ["products"] },
);

// Products the merchant flagged for clearance (التصفية).
export const getClearance = unstable_cache(
  async (limit = 60): Promise<OfferProduct[]> => {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("products")
      .select(
        "id, name, name_en, price, discount_price, image_url, store_id, stores(name)",
      )
      .eq("status", "active")
      .eq("is_available", true)
      .is("deleted_at", null)
      .eq("in_clearance", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as unknown as Parameters<typeof toOffer>[0][]).map(
      toOffer,
    );
  },
  ["clearance"],
  { revalidate: 120, tags: ["products"] },
);
