// What a checkout collects, computes and sends — for any store, from any page.
//
// ── Why this file exists ───────────────────────────────────────────────────
// Matjar had two checkouts. `store-products.tsx` (the store cart) collected a
// delivery zone, a coupon, a loyalty opt-in, the merchant's custom fields, a
// branch, change-for and delivery instructions, and could place a guest order.
// `product-order.tsx` (the buy box on a product page) collected none of those
// and hard-coded `p_coupon: null`, so which capabilities a customer got
// depended on which page they happened to be standing on. Migration 0229 had
// already stopped the server from UNDER-CHARGING in that case — it now raises
// `zone_required` / `below_store_minimum` instead — which turned a pricing hole
// into a dead end: on a store with delivery zones, the product page could not
// place an order at all.
//
// The fix is not to copy the cart's fields into the buy box. Two
// implementations that must agree is the condition that produced the bug, and
// a third caller (the WhatsApp order flow, a one-tap reorder, a native shell)
// will exist. So the decision — "what does a checkout for THIS store collect,
// what does it add up to, and what does it send" — lives here, once, and the
// surfaces differ only in what they put in the basket.
//
// ── What is NOT decided here ───────────────────────────────────────────────
// The server is authoritative and unchanged. `place_customer_order` /
// `place_guest_order` re-read every price from the catalogue, re-apply the
// coupon, re-cap the points and re-resolve the delivery fee, and this module
// deliberately mirrors that sequence rather than inventing one: the arithmetic
// runs through `computeTotals` in order-math.ts, which is pinned to the RPC by
// its own tests. Nothing here may change a total, a rounding rule, an order
// status or an RPC signature.

import { computeTotals, money, type OrderLine } from "@/lib/order-math";

// ── The basket ─────────────────────────────────────────────────────────────

/** One line as the RPC wants it. This is `p_items`' element shape verbatim,
 *  not a translation of it — the surfaces build these and the submit function
 *  passes them straight through, so there is no mapping layer to get wrong.
 *  `variant_id` / `addon_ids` / `note` are honoured by both RPCs (0194 for the
 *  signed-in path, 0194 + 0221 for the guest one). The store cart leaves them
 *  off because it quick-adds only variant-less products; the product page fills
 *  them in. */
export type CheckoutItem = {
  product_id: string;
  quantity: number;
  variant_id?: string | null;
  addon_ids?: string[];
  note?: string;
};

/** The same line as the customer reads it, on the "your order" summary. Kept
 *  separate from CheckoutItem because names and prices are display data the
 *  server does not trust and does not want. */
export type CheckoutLine = {
  /** React key + the id to drop when the server says this line is short. */
  id: string;
  name: string;
  quantity: number;
  /** Unit price actually charged: flash → discount → list, plus add-ons. */
  unitPrice: number;
};

export function linesToOrderLines(lines: CheckoutLine[]): OrderLine[] {
  return lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity }));
}

// ── The store's checkout capabilities ──────────────────────────────────────

/** A delivery zone as the checkout needs it (migration 0172). The fee shown is
 *  display only — `resolve_delivery_fee` recomputes it server-side. */
export type DeliveryZone = {
  id: string;
  name: string;
  nameEn?: string | null;
  fee: number;
  minOrder?: number | null;
  freeOver?: number | null;
  etaMin?: number | null;
  etaMax?: number | null;
};

/** A merchant-defined checkout question (migration 0180). */
export type CheckoutField = {
  id: string;
  label: string;
  labelEn: string | null;
  fieldType: "text" | "textarea" | "select";
  options: string[];
  required: boolean;
};

export type CheckoutBranch = {
  id: string;
  name: string | null;
  area: string | null;
  address: string | null;
};

/**
 * Everything a checkout needs to know about a store, independent of what is in
 * the basket. Assembled by `src/lib/data/checkout.ts` so the product page and
 * the store page are answering the same question from the same query rather
 * than each fetching the half its own form happened to render.
 */
export type StoreCheckout = {
  storeId: string;
  storeName: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  /** stores.min_order — enforced server-side since 0229; shown here so the
   *  customer learns about it before typing an address, not after. */
  minOrder: number | null;
  zones: DeliveryZone[];
  checkoutFields: CheckoutField[];
  branches: CheckoutBranch[];
  paymentNote: string | null;
  prepTime: string | null;
  whatsapp: string | null;
  /** Points the CURRENT customer holds at this store (0 for guests). */
  loyaltyPoints: number;
  /** stores.loyalty_points_per_unit, 0 when the store has not enabled it. */
  loyaltyPointsPerUnit: number;
  /** The store holds at least one spendable gift card (0310
   *  store_accepts_gift_cards), so the checkout offers the code field.
   *  Optional: absent (or false) before 0310 is applied. */
  acceptsGiftCards?: boolean;
};

/** The viewer half — per-user, never cached with the store half. */
export type CheckoutViewer = {
  loggedIn: boolean;
  defaultAddress: string;
  savedAddresses: { label: string; value: string }[];
};

// ── What the customer chose ────────────────────────────────────────────────

export type Fulfillment = "delivery" | "pickup";

/** Every answer the shared form collects. One object so a new question is one
 *  field here and one control there, rather than five call sites. */
export type CheckoutChoices = {
  fulfillment: Fulfillment;
  zoneId: string;
  branchId: string;
  /** Coupon code the customer applied, uppercased. */
  couponCode: string | null;
  /** Discount `validate_coupon` previewed for it (0 for a guest, whose code is
   *  validated inside the RPC instead — see applyCoupon in the form). */
  couponDiscount: number;
  redeemLoyalty: boolean;
  /** Answers to the merchant's custom fields, keyed by field id. */
  customFieldAnswers: Record<string, string>;
};

export function initialChoices(store: StoreCheckout): CheckoutChoices {
  return {
    fulfillment: store.acceptsDelivery ? "delivery" : "pickup",
    zoneId: store.zones[0]?.id ?? "",
    branchId: store.branches[0]?.id ?? "",
    couponCode: null,
    couponDiscount: 0,
    redeemLoyalty: false,
    customFieldAnswers: {},
  };
}

export function fulfillmentOptions(store: StoreCheckout): Fulfillment[] {
  return (["delivery", "pickup"] as const).filter((o) =>
    o === "delivery" ? store.acceptsDelivery : store.acceptsPickup,
  );
}

export function canRedeemLoyalty(store: StoreCheckout): boolean {
  return store.loyaltyPoints > 0 && store.loyaltyPointsPerUnit > 0;
}

/** The zone the order would be delivered to, or null for a pickup order. */
export function selectedZone(
  store: StoreCheckout,
  choices: CheckoutChoices,
): DeliveryZone | null {
  if (choices.fulfillment !== "delivery") return null;
  return store.zones.find((z) => z.id === choices.zoneId) ?? null;
}

// ── The arithmetic ─────────────────────────────────────────────────────────

export type CheckoutTotals = {
  subtotal: number;
  couponDiscount: number;
  /** Currency value of the redeemed points, capped after the coupon. */
  pointsDiscount: number;
  /** Points that value consumes — what the ledger will be debited. */
  pointsUsed: number;
  deliveryFee: number;
  /** Goods total after both discounts, before delivery. This is `v_net` in the
   *  RPC, and it is the figure both the zone minimum and free-over compare
   *  against — not the subtotal and not the grand total. */
  net: number;
  /** What the customer pays. */
  grandTotal: number;
  /** Under stores.min_order. Compared against the SUBTOTAL, matching 0229:
   *  a merchant's "minimum order" means the value of the goods, not what was
   *  left to pay after a coupon. */
  belowStoreMinimum: boolean;
  /** Under the chosen zone's own minimum — compared against `net`, which is
   *  what resolve_delivery_fee is handed. */
  belowZoneMinimum: boolean;
  /** Neither minimum is met, so the RPC would refuse. */
  blocked: boolean;
};

/**
 * Points → currency, the way the RPC does it: the whole balance converted at
 * the store's rate, rounded to cents, then capped at what is still owed after
 * the coupon. Display only — `place_customer_order` recomputes and re-caps it
 * against the ledger balance inside an advisory lock.
 */
function pointsValue(
  store: StoreCheckout,
  redeem: boolean,
  afterCoupon: number,
): { discount: number; used: number } {
  if (!redeem || !canRedeemLoyalty(store)) return { discount: 0, used: 0 };
  const discount = Math.min(
    money(store.loyaltyPoints / store.loyaltyPointsPerUnit),
    afterCoupon,
  );
  return { discount, used: Math.round(discount * store.loyaltyPointsPerUnit) };
}

/**
 * The delivery fee preview, mirroring `resolve_delivery_fee` (0172 + 0229).
 * Free-over and the zone minimum are both compared against the post-discount
 * net, exactly as the function does.
 */
function zoneFee(zone: DeliveryZone | null, net: number): number {
  if (!zone) return 0;
  if (zone.freeOver != null && net >= zone.freeOver) return 0;
  return zone.fee;
}

/**
 * The one place a checkout total is computed on the client.
 *
 * Order of operations is the RPC's: subtotal → minus coupon → minus points
 * (capped at what is left) → resolve the delivery fee against THAT → add it.
 * The arithmetic itself is `computeTotals`, which order-math.test.ts pins to
 * the server's behaviour; this function only decides what to feed it.
 */
export function checkoutTotals(
  store: StoreCheckout,
  choices: CheckoutChoices,
  lines: CheckoutLine[],
): CheckoutTotals {
  const orderLines = linesToOrderLines(lines);
  const couponDiscount = Math.max(0, choices.couponDiscount);

  // Pass 1: discounts only, to learn the net the fee is resolved against.
  const afterCoupon = computeTotals({ lines: orderLines, couponDiscount });
  const points = pointsValue(store, choices.redeemLoyalty, afterCoupon.net);
  const discounted = computeTotals({
    lines: orderLines,
    couponDiscount,
    pointsDiscount: points.discount,
  });

  // Pass 2: the fee that net earns, folded back in — the same two-step the RPC
  // makes when it calls resolve_delivery_fee with v_net.
  const zone = selectedZone(store, choices);
  const deliveryFee = zoneFee(zone, discounted.net);
  const final = computeTotals({
    lines: orderLines,
    couponDiscount,
    pointsDiscount: points.discount,
    deliveryFee,
  });

  const belowStoreMinimum =
    store.minOrder != null && final.subtotal < store.minOrder;
  const belowZoneMinimum =
    zone?.minOrder != null && discounted.net < zone.minOrder;

  return {
    subtotal: final.subtotal,
    couponDiscount,
    pointsDiscount: points.discount,
    pointsUsed: points.used,
    deliveryFee: final.deliveryFee,
    net: discounted.net,
    grandTotal: final.total,
    belowStoreMinimum,
    belowZoneMinimum,
    blocked: belowStoreMinimum || belowZoneMinimum,
  };
}

// ── What blocks the button before the server is asked ──────────────────────

/** A reason the confirm button must not be tapped yet, or null. Returned as a
 *  discriminator rather than a message so the caller owns the wording. */
export type CheckoutBlock =
  | { kind: "belowStoreMinimum"; amount: number }
  | { kind: "belowZoneMinimum"; amount: number }
  | { kind: "zoneRequired" }
  | { kind: "missingField"; label: string }
  | { kind: "emptyCart" };

/**
 * Everything the client can know is wrong before it asks the server. This is
 * courtesy, not enforcement: 0229 moved the zone and the store minimum into
 * the database precisely because a disabled button protects nobody with a
 * crafted request. Each case here has a matching `raise exception` there.
 */
export function checkoutBlock(
  store: StoreCheckout,
  choices: CheckoutChoices,
  lines: CheckoutLine[],
  totals: CheckoutTotals,
  labelOf: (f: CheckoutField) => string,
): CheckoutBlock | null {
  if (lines.length === 0) return { kind: "emptyCart" };
  if (totals.belowStoreMinimum && store.minOrder != null)
    return { kind: "belowStoreMinimum", amount: store.minOrder };
  if (
    choices.fulfillment === "delivery" &&
    store.zones.length > 0 &&
    !selectedZone(store, choices)
  )
    return { kind: "zoneRequired" };
  const zone = selectedZone(store, choices);
  if (totals.belowZoneMinimum && zone?.minOrder != null)
    return { kind: "belowZoneMinimum", amount: zone.minOrder };
  for (const f of store.checkoutFields) {
    if (f.required && !(choices.customFieldAnswers[f.id] ?? "").trim())
      return { kind: "missingField", label: labelOf(f) };
  }
  return null;
}

// ── What gets sent ─────────────────────────────────────────────────────────

/** The contact details the form's uncontrolled inputs hold. */
export type CheckoutContact = {
  name: string;
  phone: string;
  address: string;
  note: string;
  deliveryInstructions: string;
};

export type OrderParams = Record<string, unknown>;

/**
 * Build the RPC arguments. Both surfaces call this, so a parameter cannot be
 * present on one path and quietly absent on the other — which is the exact
 * shape MJ-024 took (`p_coupon: null` hard-coded in the buy box, every zone /
 * loyalty / custom-field parameter simply never passed).
 *
 * The signed-in and guest calls differ in three real ways, all of them the
 * server's: the guest RPC takes a customer name, has no `p_redeem_points` (the
 * loyalty ledger is keyed to an account), and validates its coupon internally
 * because `validate_coupon` is locked to authenticated callers.
 */
export function buildOrderParams({
  store,
  choices,
  items,
  contact,
  changeFor,
  guest,
  idempotencyKey,
  customFields,
  extraCustomFields,
}: {
  store: StoreCheckout;
  choices: CheckoutChoices;
  items: CheckoutItem[];
  contact: CheckoutContact;
  /** Note the customer wants change for, or null. */
  changeFor: number | null;
  guest: boolean;
  idempotencyKey: string | null;
  /** Merchant fields keyed by their customer-facing label. */
  customFields: Record<string, string>;
  /** Surface-specific extras that ride inside p_custom_fields — today only the
   *  product page's `scheduled_for` (0194 reads it from there). */
  extraCustomFields?: Record<string, string>;
}): { rpc: "place_customer_order" | "place_guest_order"; params: OrderParams } {
  const delivery = choices.fulfillment === "delivery";
  // A single-branch store never asks, and null lets the server pick its primary
  // location — the same default both surfaces already relied on.
  const locationId = store.branches.length > 1 ? choices.branchId : null;
  const zone = selectedZone(store, choices);

  const common = {
    p_store_id: store.storeId,
    p_phone: contact.phone,
    p_address: delivery ? contact.address : "",
    p_fulfillment: choices.fulfillment,
    p_note: contact.note,
    p_coupon: choices.couponCode,
    p_items: items,
    p_location_id: locationId,
    p_zone_id: zone?.id ?? null,
    p_change_for: delivery ? changeFor : null,
    p_delivery_instructions: delivery ? contact.deliveryInstructions : "",
    p_idempotency_key: idempotencyKey || null,
    p_custom_fields: { ...customFields, ...(extraCustomFields ?? {}) },
  };

  if (guest) {
    return {
      rpc: "place_guest_order",
      params: { ...common, p_customer_name: contact.name },
    };
  }
  return {
    rpc: "place_customer_order",
    params: {
      ...common,
      // Send the whole balance: the server caps it to the order total and
      // consumes only the points that discount is worth. 0 redeems nothing.
      p_redeem_points:
        choices.redeemLoyalty && canRedeemLoyalty(store)
          ? store.loyaltyPoints
          : 0,
    },
  };
}

/**
 * One key per checkout ATTEMPT — minted when the customer enters the checkout,
 * not when the form mounts and not per submit. A double-tap or a flaky-4G retry
 * of the same attempt collapses to a single order server-side; a customer who
 * backs out, changes the basket and comes back gets a new key, so the RPC's
 * idempotency branch cannot hand them the earlier order for a basket they no
 * longer have.
 */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Math.random());
}

/** `p_change_for` is collected separately from the rest because it is a number
 *  parsed out of a pill group, and only ever applies to a delivery order. */
export function changeForValue(
  choices: CheckoutChoices,
  changeChoice: string,
  changeCustom: string,
): number | null {
  if (choices.fulfillment !== "delivery" || changeChoice === "none") return null;
  if (changeChoice === "custom") {
    const n = Number(changeCustom);
    return n > 0 ? n : null;
  }
  return Number(changeChoice);
}

// ── What came back ─────────────────────────────────────────────────────────

/**
 * The failure the server reported, as a stable key. Both surfaces used to map
 * these inline and each knew a different subset: the buy box had no
 * `rate_limited` or `modifier_*` case, and the cart's GUEST branch had no
 * `zone_required` case, so the same refusal read as "something went wrong" on
 * one path and said what to do on the other.
 *
 * `insufficient_stock` carries the product name the trigger names (0-arg form
 * when it does not), so the caller can point at the line.
 */
export type CheckoutFailure =
  | { kind: "outOfStock"; productName: string | null }
  | { kind: "couponAlreadyUsed" }
  | { kind: "belowStoreMinimum" }
  | { kind: "zoneRequired" }
  | { kind: "belowZoneMinimum" }
  | { kind: "badZone" }
  | { kind: "modifierRequired" }
  | { kind: "rateLimited" }
  | { kind: "notAuthenticated" }
  | { kind: "generic" };

/**
 * Classify an RPC error message. A NULL order id with no error is also a
 * failure and must be classified as one — `place_customer_order`'s idempotency
 * branch re-selects the existing row and returns whatever that finds, so a lost
 * race returns NULL with no error at all. Reading only `error` turned that into
 * a confirmation screen for an order that was never placed.
 */
export function classifyFailure(message: string | null): CheckoutFailure {
  const msg = message ?? "";
  if (msg.includes("insufficient_stock")) {
    const name = msg.split("insufficient_stock:")[1]?.split(/["\n]/)[0]?.trim();
    return { kind: "outOfStock", productName: name || null };
  }
  if (msg.includes("coupon_already_used")) return { kind: "couponAlreadyUsed" };
  if (msg.includes("below_store_minimum")) return { kind: "belowStoreMinimum" };
  if (msg.includes("zone_required")) return { kind: "zoneRequired" };
  if (msg.includes("below_zone_minimum")) return { kind: "belowZoneMinimum" };
  if (msg.includes("bad_zone")) return { kind: "badZone" };
  if (msg.includes("modifier_")) return { kind: "modifierRequired" };
  if (msg.includes("rate_limited")) return { kind: "rateLimited" };
  if (msg.includes("not_authenticated")) return { kind: "notAuthenticated" };
  return { kind: "generic" };
}
