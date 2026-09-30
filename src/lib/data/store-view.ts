import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public-client";
import { toCategoryKey, type CategoryKey } from "@/lib/catalog";
import type { StorePlan } from "@/lib/plan-tiers";
import { FETCH_BOUNDS, fetchAllByIds, fetchAllPages, warnIfTruncated } from "./bounds";
import type { ServiceOption } from "@/lib/service-options";

type VariantRow = {
  id: string;
  product_id: string;
  label: string;
  price: number | string | null;
  duration_minutes: number | null;
  is_available: boolean | null;
  sort_order: number | null;
};

// The catalogue projection, named once so the row-shape contract has something
// to point at: every column here is read by the mapper at the bottom of
// fetchStoreView, and dropping one renders a blank field rather than failing.
//
// ADDING one is the dangerous direction, and it bit during this change. This
// list is a contract with the DEPLOYED DATABASE: PostgREST rejects the whole
// SELECT if a single column is unknown, `data` comes back null, fetchAllPages
// yields [], and the storefront renders "no products" — not an error, an empty
// shop. Selecting `sold_by, unit_measure, unit_amount` against a database
// without 0299 applied blanked ملحمة البركة's entire catalogue on a local build,
// and it would have done the same to every store on the platform.
//
// So: migration 0299 must be applied BEFORE this build ships. Same lesson as
// the revoke that was applied ahead of its deploy and took the reviews block
// off every store page, running the other way round.
const PRODUCT_COLUMNS =
  "id, name, name_en, brand, description_en, price, discount_price, image_url, attributes, flash_price, flash_start, flash_end, stock, section_id, item_kind, booking_allocation_mode, duration_minutes, buffer_minutes, capacity_per_slot, is_bundle, sold_by, unit_measure, unit_amount";

// The public store view: the store row + its active catalogue + sections. This
// is the heaviest, most-visited public read on the site (the store page is the
// top SEO surface), and it's identical for every anonymous visitor — so it's
// cached cross-request with the cookie-less anon client, exactly like the
// homepage's fetchActiveStores. Per-user pieces (follow state, reviews, saved
// addresses…) stay on the request-scoped client in the page and are never
// cached here.
export type StoreView = {
  name: string;
  slug?: string | null;
  accentColor?: string | null;
  storefrontLayout?: "grid" | "menu" | "showcase" | null;
  storefrontTheme?: string | null;
  category: CategoryKey;
  area: string | null;
  description: string | null;
  announcement?: string | null;
  /** Live on the platform — NOT opening hours. Read `hours` for open/closed. */
  isOpen: boolean;
  plan?: StorePlan;
  rating?: number;
  reviews?: number;
  logoUrl?: string | null;
  coverUrl?: string | null;
  /** Vertical focal point of the banner, 0-100. See stores.cover_position. */
  coverPosition?: number;
  hours?: unknown;
  bookingSlotMinutes?: number;
  /** Cancellation window in hours; 0 = cancel anytime. See 0189. */
  bookingCancelHours?: number;
  instagram?: string | null;
  facebook?: string | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  acceptsDelivery?: boolean;
  acceptsPickup?: boolean;
  minOrder?: number | null;
  prepTime?: string | null;
  paymentNote?: string | null;
  returnPolicy?: string | null;
  specialties?: string | null;
  insurance?: string | null;
  registered?: boolean;
  loyaltyRedemptionEnabled?: boolean;
  loyaltyPointsPerUnit?: number | null;
  lat?: number | null;
  lng?: number | null;
  isReal: boolean;
  sections: {
    id: string;
    name: string;
    nameEn: string | null;
    sortOrder: number;
  }[];
  products: {
    id?: string;
    name: string;
    nameEn?: string | null;
    brand?: string | null;
    descriptionEn?: string | null;
    price: number;
    discountPrice?: number | null;
    imageUrl?: string | null;
    attributes?: Record<string, string> | null;
    flashPrice?: number | null;
    flashStart?: string | null;
    flashEnd?: string | null;
    stock?: number | null;
    allocationMode?: string | null;
    durationMinutes?: number | null;
    bufferMinutes?: number | null;
    capacityPerSlot?: number | null;
    sectionId?: string | null;
    /** "product" = sold via cart, "service" = booked. A store may have both. */
    itemKind?: "product" | "service";
    /**
     * Has priced/stocked variants, so it cannot be quick-added from the grid —
     * the cart carries no variant and would sell it at the base price against
     * the wrong stock counter. The grid sends these to the product page.
     */
    hasVariants?: boolean;
    /** 0321: a SERVICE's priced options, available ones only, in the
     *  merchant's order. Absent on goods (their variants live on the product
     *  page picker) and on a service with a single price. */
    priceOptions?: ServiceOption[];
    isBundle?: boolean;
    includes?: { name: string; nameEn: string | null; quantity: number }[];
    /**
     * Sold by a measure rather than by the piece (0299). Null on every product
     * that predates it, which is all 63 of them in production today. `price`
     * still means the price of ONE orderable unit either way — these three only
     * say what one unit IS. See src/lib/unit-pricing.ts for why it has to work
     * that way and not by making the quantity fractional.
     */
    soldBy?: string | null;
    unitMeasure?: string | null;
    unitAmount?: number | null;
  }[];
  checkoutFields: {
    id: string;
    label: string;
    labelEn: string | null;
    fieldType: "text" | "textarea" | "select";
    options: string[];
    required: boolean;
  }[];
};

// Client-agnostic fetch + map. `supabase` may be the anon public client (for the
// cached path) or the request-scoped server client (for the owner/admin fallback
// below). RLS decides visibility either way; the query itself is identical.
async function fetchStoreView(
  supabase: SupabaseClient,
  id: string,
): Promise<StoreView | null> {
  const { data } = await supabase
    .from("stores")
    .select(
      "name, slug, description, announcement, storefront_theme, area, status, plan, logo_url, cover_url, cover_position, phone, whatsapp, hours, booking_slot_minutes, booking_cancel_hours, instagram, facebook, website, accepts_delivery, accepts_pickup, min_order, prep_time, payment_note, return_policy, specialties, insurance, commercial_reg_verified, loyalty_redemption_enabled, loyalty_points_per_unit, accent_color, storefront_layout, lat, lng, business_types(slug)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;

  const bt = data.business_types as unknown as { slug: string } | null;
  // MP-040. The storefront renders this whole array, so a catalogue that stops
  // at PostgREST's 1000-row default is a store quietly missing stock — the one
  // failure nobody thinks to check for. Same select, same filters, same order;
  // only the number of round trips changes. `sort_order` is not unique, so the
  // id tiebreaker is what makes `.range()` paging safe: without a total order
  // the database may place two equal-sort_order rows either way round and a row
  // can land on both pages or on neither.
  type ProductRow = Record<string, unknown> & { id: string };
  const prods = await fetchAllPages<ProductRow>(
    (from, to) =>
      supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("store_id", id)
        .eq("status", "active")
        .eq("is_available", true)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: ProductRow[] | null }>,
    FETCH_BOUNDS.storeProducts,
    `products (store ${id})`,
  );
  // Bundle contents ("includes: 2× X, 1× Y") for any bundle products, with the
  // component name pulled through the FK so hidden components still show.
  const bundleIds = prods
    .filter((p) => p.is_bundle)
    .map((p) => p.id as string);
  const includesByBundle: Record<
    string,
    { name: string; nameEn: string | null; quantity: number }[]
  > = {};
  if (bundleIds.length) {
    // Chunked as well as paged: the bundle-id list now scales with the whole
    // catalogue, and an `.in()` filter rides in the URL.
    type BundleItemRow = {
      bundle_id: string;
      quantity: number;
      products: { name: string; name_en: string | null } | null;
    };
    const bItems = await fetchAllByIds<BundleItemRow>(
      bundleIds,
      (chunk, from, to) =>
        supabase
          .from("bundle_items")
          .select("bundle_id, quantity, sort_order, products(name, name_en)")
          .in("bundle_id", chunk)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: BundleItemRow[] | null;
        }>,
      FETCH_BOUNDS.storeBundleItems,
      `bundle_items (store ${id})`,
    );
    for (const it of bItems) {
      if (!it.products) continue;
      (includesByBundle[it.bundle_id] ??= []).push({
        name: it.products.name,
        nameEn: it.products.name_en,
        quantity: it.quantity,
      });
    }
  }
  // Which products carry variants. The storefront cart is keyed by product id
  // alone, so it has nowhere to put a variant: quick-adding one of these would
  // charge the base price and decrement products.stock, while the real price
  // and the real stock both live on the variant row. The grid uses this to send
  // those products to their own page instead, where the picker exists.
  const variantProductIds = new Set<string>();
  const serviceIds = new Set(
    prods.filter((p) => p.item_kind === "service").map((p) => p.id as string),
  );
  const optionRows: Record<string, VariantRow[]> = {};
  const priceOptionsByService: Record<string, ServiceOption[]> = {};
  if (prods.length) {
    // Truncation here is the expensive one: a product whose variant rows fell
    // past the ceiling looks variant-less, so the grid offers quick-add and
    // charges the base price instead of routing to the picker. Money, not
    // cosmetics — so this one is both chunked (the id list is the whole
    // catalogue) and paged (a store has several variants per product).
    const vars = await fetchAllByIds<VariantRow>(
      prods.map((p) => p.id as string),
      (chunk, from, to) =>
        supabase
          .from("product_variants")
          .select("id, product_id, label, price, duration_minutes, is_available, sort_order")
          .in("product_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: VariantRow[] | null;
        }>,
      FETCH_BOUNDS.storeVariants,
      `product_variants (store ${id})`,
    );
    for (const v of vars) {
      variantProductIds.add(v.product_id);
      // 0321: the same rows are a service's price options.
      if (serviceIds.has(v.product_id) && v.is_available !== false) {
        (optionRows[v.product_id] ??= []).push(v);
      }
    }
    for (const [pid, rows] of Object.entries(optionRows)) {
      priceOptionsByService[pid] = rows
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((r) => ({
          id: r.id,
          label: r.label,
          price: r.price != null ? Number(r.price) : null,
          durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
        }));
    }
  }

  // Storefront sections: the store groups its catalog into named sections
  // (menu groups / collections / service groups). None → flat list.
  const { data: sects } = await supabase
    .from("store_sections")
    .select("id, name, name_en, sort_order")
    .eq("store_id", id)
    .order("sort_order", { ascending: true })
    .limit(FETCH_BOUNDS.storeSections);
  warnIfTruncated(sects, FETCH_BOUNDS.storeSections, `store_sections (store ${id})`);
  // Merchant-defined custom checkout fields (active only), shown at checkout.
  const { data: cfields } = await supabase
    .from("store_checkout_fields")
    .select("id, label, label_en, field_type, options, required")
    .eq("store_id", id)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .limit(FETCH_BOUNDS.storeCheckoutFields);
  warnIfTruncated(cfields, FETCH_BOUNDS.storeCheckoutFields, `store_checkout_fields (store ${id})`);

  return {
    name: data.name as string,
    slug: (data.slug as string | null) ?? null,
    accentColor: (data.accent_color as string | null) ?? null,
    storefrontLayout:
      (data.storefront_layout as "grid" | "menu" | "showcase" | null) ?? null,
    storefrontTheme: (data.storefront_theme as string | null) ?? null,
    // Checked, not asserted. `bt.slug` is a string an admin typed into the
    // business-types screen; the storefront, the offering pages and every
    // module lookup key off it. The bare `as CategoryKey` here let an
    // unrecognised slug travel on as if it were a sector, so each registry read
    // downstream returned undefined and the failure surfaced far from its
    // cause. Same fallback as before — `retail` — now narrowed and reported.
    category: toCategoryKey(bt?.slug, `store ${id}`),
    area: (data.area as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    announcement: (data.announcement as string | null) ?? null,
    isOpen: data.status === "active",
    plan: (data.plan as StorePlan | null) ?? "free",
    logoUrl: (data.logo_url as string | null) ?? null,
    coverUrl: (data.cover_url as string | null) ?? null,
    coverPosition: Number(data.cover_position ?? 50),
    hours: data.hours as unknown,
    bookingSlotMinutes: (data.booking_slot_minutes as number | null) ?? 30,
    bookingCancelHours: (data.booking_cancel_hours as number | null) ?? 0,
    instagram: (data.instagram as string | null) ?? null,
    facebook: (data.facebook as string | null) ?? null,
    website: (data.website as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    whatsapp: (data.whatsapp as string | null) ?? null,
    acceptsDelivery: (data.accepts_delivery as boolean | null) ?? true,
    acceptsPickup: (data.accepts_pickup as boolean | null) ?? true,
    minOrder: data.min_order != null ? Number(data.min_order) : null,
    prepTime: (data.prep_time as string | null) ?? null,
    paymentNote: (data.payment_note as string | null) ?? null,
    returnPolicy: (data.return_policy as string | null) ?? null,
    specialties: (data.specialties as string | null) ?? null,
    insurance: (data.insurance as string | null) ?? null,
    registered: (data.commercial_reg_verified as boolean | null) ?? false,
    loyaltyRedemptionEnabled:
      (data.loyalty_redemption_enabled as boolean | null) ?? false,
    loyaltyPointsPerUnit:
      data.loyalty_points_per_unit != null
        ? Number(data.loyalty_points_per_unit)
        : null,
    lat: data.lat != null ? Number(data.lat) : null,
    lng: data.lng != null ? Number(data.lng) : null,
    isReal: true,
    sections: (sects ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      nameEn: (s.name_en as string | null) ?? null,
      sortOrder: (s.sort_order as number | null) ?? 0,
    })),
    checkoutFields: ((cfields ?? []) as unknown as {
      id: string;
      label: string;
      label_en: string | null;
      field_type: "text" | "textarea" | "select";
      options: string[] | null;
      required: boolean;
    }[]).map((f) => ({
      id: f.id,
      label: f.label,
      labelEn: f.label_en,
      fieldType: f.field_type,
      options: Array.isArray(f.options) ? f.options : [],
      required: f.required,
    })),
    products: prods.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      nameEn: (p.name_en as string | null) ?? null,
      brand: (p.brand as string | null) ?? null,
      descriptionEn: (p.description_en as string | null) ?? null,
      price: Number(p.price),
      discountPrice: p.discount_price != null ? Number(p.discount_price) : null,
      imageUrl: (p.image_url as string | null) ?? null,
      attributes: (p.attributes as Record<string, string> | null) ?? null,
      flashPrice: p.flash_price != null ? Number(p.flash_price) : null,
      flashStart: (p.flash_start as string | null) ?? null,
      flashEnd: (p.flash_end as string | null) ?? null,
      stock: p.stock != null ? Number(p.stock) : null,
      allocationMode: (p.booking_allocation_mode as string | null) ?? null,
      durationMinutes: p.duration_minutes != null ? Number(p.duration_minutes) : null,
      bufferMinutes: p.buffer_minutes != null ? Number(p.buffer_minutes) : 0,
      capacityPerSlot: p.capacity_per_slot != null ? Number(p.capacity_per_slot) : null,
      sectionId: (p.section_id as string | null) ?? null,
      itemKind: ((p.item_kind as string | null) ?? "product") as "product" | "service",
      isBundle: (p.is_bundle as boolean | null) ?? false,
      soldBy: (p.sold_by as string | null) ?? null,
      unitMeasure: (p.unit_measure as string | null) ?? null,
      unitAmount: p.unit_amount != null ? Number(p.unit_amount) : null,
      hasVariants: variantProductIds.has(p.id as string),
      priceOptions: priceOptionsByService[p.id as string],
      includes: includesByBundle[p.id as string] ?? undefined,
    })),
  };
}

// Cached public read: anon client, so RLS returns the store only when it's
// active + not deleted — the exact set that's safe to share across visitors.
// Tagged store:<id> (targeted bust on edit) plus the shared "stores" tag.
export function getPublicStoreView(id: string): Promise<StoreView | null> {
  return unstable_cache(
    () => fetchStoreView(createPublicClient(), id),
    ["store-view", id],
    { revalidate: 300, tags: ["stores", `store:${id}`] },
  )();
}

// Uncached fallback on the request-scoped client, used only when the cached
// public read returns null — i.e. an owner or admin previewing a store that
// isn't publicly visible yet (draft/pending). Their RLS grant makes it visible;
// it must never be cached because visibility here is per-user.
export function getOwnedStoreView(
  supabase: SupabaseClient,
  id: string,
): Promise<StoreView | null> {
  return fetchStoreView(supabase, id);
}
