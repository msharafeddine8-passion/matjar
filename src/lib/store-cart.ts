/**
 * The per-store basket, `matjar-cart-<storeId>` in localStorage: a map of
 * productId -> quantity. The store page's grid (store-products.tsx) owns the
 * full checkout; this module is the one shared definition of the key and the
 * shape so the product page's «أضف إلى السلة» and the store page's sticky bar
 * read and write the SAME basket instead of three hand-rolled copies.
 *
 * Writes broadcast `CART_EVENT` on window so a component on the same page
 * (the sticky CTA) can react; other tabs get the native `storage` event.
 */
export type CartMap = Record<string, number>;

export const CART_EVENT = "matjar-cart-change";

export function cartKey(storeId: string): string {
  return `matjar-cart-${storeId}`;
}

/** Parse a stored basket, dropping anything that is not a positive count. */
export function parseCart(raw: string | null | undefined): CartMap {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: CartMap = {};
    for (const [id, qty] of Object.entries(data as Record<string, unknown>)) {
      if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
        out[id] = Math.floor(qty);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Total units in a basket. */
export function cartCount(cart: CartMap): number {
  return Object.values(cart).reduce((s, q) => s + q, 0);
}

/** Add `qty` of a product, capped at `max` when the shelf count is known. */
export function addToCartMap(
  cart: CartMap,
  productId: string,
  qty: number,
  max?: number | null,
): CartMap {
  const next = { ...cart };
  let q = (next[productId] ?? 0) + Math.max(1, Math.floor(qty));
  if (max != null && max >= 0) q = Math.min(q, max);
  if (q > 0) next[productId] = q;
  else delete next[productId];
  return next;
}

/**
 * Whether a product can go into the store basket as it stands. The basket is
 * productId -> quantity and nothing else, so a product with variants, add-ons
 * or modifier groups cannot be represented there — dropping the customer's
 * size or extras on the way in would be worse than a separate order. Those
 * keep the single-item «اطلب الآن» checkout on the product page.
 */
export function cartCanCarry(p: {
  variants: number;
  addons: number;
  modifierGroups: number;
}): boolean {
  return p.variants === 0 && p.addons === 0 && p.modifierGroups === 0;
}

export function readCart(storeId: string): CartMap {
  try {
    return parseCart(localStorage.getItem(cartKey(storeId)));
  } catch {
    return {};
  }
}

export function writeCart(storeId: string, cart: CartMap): void {
  try {
    if (Object.keys(cart).length) {
      localStorage.setItem(cartKey(storeId), JSON.stringify(cart));
    } else {
      localStorage.removeItem(cartKey(storeId));
    }
  } catch {
    /* private mode / blocked storage: the basket just won't persist */
  }
  notifyCartChange(storeId);
}

export function notifyCartChange(storeId: string): void {
  try {
    window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { storeId } }));
  } catch {
    /* ignore */
  }
}
