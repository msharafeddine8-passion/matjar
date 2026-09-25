import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public-client";
import { FETCH_BOUNDS, warnIfTruncated } from "./bounds";
import { regions } from "@/lib/catalog";
import type { Locale } from "@/i18n/config";
import type {
  CheckoutBranch,
  CheckoutField,
  CheckoutViewer,
  DeliveryZone,
  StoreCheckout,
} from "@/lib/checkout";

// The store half of a checkout, read once and shared by every surface that can
// place an order for that store.
//
// Before MJ-024 this did not exist as a question anyone asked. The store page
// fetched delivery zones inline and took the custom checkout fields off
// `StoreView`; the product page fetched neither, because its buy box had no
// control that needed them — which is exactly how the two surfaces came to
// offer different checkouts. Reading the store's checkout capabilities in one
// place means a surface can no longer be missing a capability by accident: it
// is missing a control, which is visible.
//
// Everything here is public and identical for every visitor, so it is cached
// cross-request on the cookie-less anon client and tagged `store:<id>` — the
// same tag the storefront edit path already busts. The per-customer half
// (loyalty balance, saved addresses) is NOT here; it stays on the
// request-scoped client in the page and is folded in by `withLoyalty` below.

/** Everything except the signed-in customer's own point balance. */
export type StoreCheckoutContext = Omit<StoreCheckout, "loyaltyPoints"> & {
  /** stores.loyalty_redemption_enabled — the page only bothers reading a
   *  balance when the merchant opted in. */
  loyaltyRedemptionEnabled: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ZoneRow = {
  id: string;
  name: string;
  name_en: string | null;
  fee: number;
  min_order: number | null;
  free_over: number | null;
  eta_min_minutes: number | null;
  eta_max_minutes: number | null;
};

async function fetchStoreCheckout(
  supabase: SupabaseClient,
  storeId: string,
): Promise<StoreCheckoutContext | null> {
  const { data } = await supabase
    .from("stores")
    .select(
      "name, whatsapp, accepts_delivery, accepts_pickup, min_order, prep_time, payment_note, loyalty_redemption_enabled, loyalty_points_per_unit",
    )
    .eq("id", storeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;

  const [{ data: zoneRows }, { data: cfields }, { data: locs }, giftRes] =
    await Promise.all([
      supabase
        .from("store_delivery_zones")
        .select(
          "id, name, name_en, fee, min_order, free_over, eta_min_minutes, eta_max_minutes",
        )
        .eq("store_id", storeId)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(FETCH_BOUNDS.storeDeliveryZones),
      supabase
        .from("store_checkout_fields")
        .select("id, label, label_en, field_type, options, required")
        .eq("store_id", storeId)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.storeCheckoutFields),
      supabase
        .from("store_locations")
        .select("id, name, address, area")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .limit(FETCH_BOUNDS.storeLocations),
      // 0310. Before it is applied the RPC does not exist, the call errors,
      // and the checkout simply shows no gift-card field.
      supabase.rpc("store_accepts_gift_cards", { p_store_id: storeId }),
    ]);
  // A dropped zone or a dropped required field would place an order the
  // merchant cannot fulfil, so a short read must not pass quietly.
  warnIfTruncated(
    cfields,
    FETCH_BOUNDS.storeCheckoutFields,
    `store_checkout_fields (store ${storeId})`,
  );
  warnIfTruncated(
    locs,
    FETCH_BOUNDS.storeLocations,
    `store_locations (store ${storeId})`,
  );
  warnIfTruncated(
    zoneRows,
    FETCH_BOUNDS.storeDeliveryZones,
    `store_delivery_zones (store ${storeId})`,
  );

  const zones: DeliveryZone[] = ((zoneRows ?? []) as ZoneRow[]).map((z) => ({
    id: z.id,
    name: z.name,
    nameEn: z.name_en,
    fee: Number(z.fee),
    minOrder: z.min_order != null ? Number(z.min_order) : null,
    freeOver: z.free_over != null ? Number(z.free_over) : null,
    etaMin: z.eta_min_minutes,
    etaMax: z.eta_max_minutes,
  }));

  const checkoutFields: CheckoutField[] = (
    (cfields ?? []) as unknown as {
      id: string;
      label: string;
      label_en: string | null;
      field_type: "text" | "textarea" | "select";
      options: string[] | null;
      required: boolean;
    }[]
  ).map((f) => ({
    id: f.id,
    label: f.label,
    labelEn: f.label_en,
    fieldType: f.field_type,
    options: Array.isArray(f.options) ? f.options : [],
    required: f.required,
  }));

  const branches: CheckoutBranch[] = (
    (locs ?? []) as unknown as {
      id: string;
      name: string | null;
      address: string | null;
      area: string | null;
    }[]
  ).map((b) => ({
    id: b.id,
    name: b.name,
    area: b.area,
    address: b.address,
  }));

  return {
    storeId,
    storeName: (data.name as string) ?? "",
    whatsapp: (data.whatsapp as string | null) ?? null,
    acceptsDelivery: (data.accepts_delivery as boolean | null) ?? true,
    acceptsPickup: (data.accepts_pickup as boolean | null) ?? true,
    minOrder: data.min_order != null ? Number(data.min_order) : null,
    prepTime: (data.prep_time as string | null) ?? null,
    paymentNote: (data.payment_note as string | null) ?? null,
    loyaltyRedemptionEnabled:
      (data.loyalty_redemption_enabled as boolean | null) ?? false,
    loyaltyPointsPerUnit:
      data.loyalty_points_per_unit != null
        ? Number(data.loyalty_points_per_unit)
        : 0,
    acceptsGiftCards: !giftRes.error && giftRes.data === true,
    zones,
    checkoutFields,
    branches,
  };
}

/** Cached public read. Returns null for a store id that is not visible to anon
 *  — the caller then simply renders no checkout, which is the correct answer
 *  for a store nobody may order from. */
export function getStoreCheckoutContext(
  storeId: string,
): Promise<StoreCheckoutContext | null> {
  if (!UUID_RE.test(storeId)) return Promise.resolve(null);
  return unstable_cache(
    () => fetchStoreCheckout(createPublicClient(), storeId),
    ["store-checkout", storeId],
    { revalidate: 300, tags: ["stores", `store:${storeId}`] },
  )();
}

/**
 * The viewer half of a checkout: are they signed in, and which addresses have
 * they saved. Both order pages formatted this themselves from the same six
 * `addresses` columns, and differently — the store page read the whole list
 * (default first) while the product page read exactly one row with
 * `.maybeSingle()`, so the saved-address picker existed on one route and not
 * the other. One reading now, used by both.
 *
 * A guest gets an empty viewer; guest checkout has nothing saved to prefill.
 */
export async function getCheckoutViewer(
  supabase: SupabaseClient,
  userId: string | null,
  lang: Locale,
): Promise<CheckoutViewer> {
  if (!userId) {
    return { loggedIn: false, defaultAddress: "", savedAddresses: [] };
  }
  const { data: addrs } = await supabase
    .from("addresses")
    .select("label, region, city, street, building, floor, details, is_default")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(FETCH_BOUNDS.customerAddresses);

  const savedAddresses: { label: string; value: string }[] = [];
  let defaultAddress = "";
  for (const addr of addrs ?? []) {
    const regionName =
      regions.find((r) => r.key === addr.region)?.name[lang] ??
      (addr.region as string | null) ??
      "";
    const value = [
      addr.street,
      addr.building,
      addr.floor,
      addr.city,
      regionName,
      addr.details,
    ]
      .filter(Boolean)
      .join("، ");
    if (!value) continue;
    savedAddresses.push({
      label: (addr.label as string | null)?.trim() || value,
      value,
    });
    if (addr.is_default && !defaultAddress) defaultAddress = value;
  }
  // Fall back to the first saved address if none is flagged default.
  if (!defaultAddress && savedAddresses.length > 0) {
    defaultAddress = savedAddresses[0].value;
  }
  return { loggedIn: true, defaultAddress, savedAddresses };
}

/**
 * Fold in the signed-in customer's point balance to get the full
 * `StoreCheckout` the form consumes. Split out because the balance is
 * per-user and must never enter the cross-request cache above.
 *
 * `my_loyalty_by_store` returns only stores with a positive balance, so a
 * missing row is a genuine zero and the redemption control simply does not
 * render.
 */
export async function withLoyaltyBalance(
  ctx: StoreCheckoutContext,
  supabase: SupabaseClient,
  signedIn: boolean,
): Promise<StoreCheckout> {
  let loyaltyPoints = 0;
  if (signedIn && ctx.loyaltyRedemptionEnabled) {
    const { data } = await supabase.rpc("my_loyalty_by_store");
    const row = ((data ?? []) as { store_id: string; balance: number }[]).find(
      (r) => r.store_id === ctx.storeId,
    );
    loyaltyPoints = row ? Number(row.balance) : 0;
  }
  const { loyaltyRedemptionEnabled: _enabled, ...rest } = ctx;
  void _enabled;
  return { ...rest, loyaltyPoints };
}
