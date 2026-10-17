// Point-of-sale rules that do not need a database: how many of a product the
// ticket may hold, and what to tell the cashier when pos_record_sale refuses.

/** Clamp a ticket quantity to what is on the shelf. `stock` null = untracked
 *  (no ceiling). Never below 0; 0 means "take the line off the ticket". */
export function clampPosQty(qty: number, stock: number | null): number {
  const q = Math.max(0, Math.floor(qty));
  if (stock == null) return q;
  return Math.min(q, Math.max(0, Math.floor(stock)));
}

/** Whether the + button may add one more. */
export function canAddOne(qty: number, stock: number | null): boolean {
  return stock == null || qty < stock;
}

/** The ticket lines asking for more than the stock this screen last saw —
 *  the items to name when the till says "insufficient_stock". */
export function overStockNames(
  lines: readonly { product: { name: string; stock: number | null }; qty: number }[],
): string[] {
  return lines
    .filter((l) => l.product.stock != null && l.qty > l.product.stock)
    .map((l) => l.product.name);
}

export type PosErrorKind =
  | "insufficientStock"
  | "invalidDiscount"
  | "invalidQuantity"
  | "productGone";

/** pos_record_sale's refusals (raise exception text) as UI kinds. */
export function posErrorKind(message: string | null | undefined): PosErrorKind | null {
  const m = message ?? "";
  if (m.includes("insufficient_stock")) return "insufficientStock";
  if (m.includes("invalid discount")) return "invalidDiscount";
  if (m.includes("invalid quantity")) return "invalidQuantity";
  if (m.includes("product not found in this store")) return "productGone";
  return null;
}
