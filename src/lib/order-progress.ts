/**
 * The canonical order journey, and the compact form of it used on cards.
 *
 * These flows were already written down once, inline in `order-timeline.tsx`
 * (migration 0173). Adding a second copy here for the orders list is how the
 * two drift: the same repo already learned this with a basket total, and the
 * comment there is blunt about it — two places that add up a basket are two
 * places that can disagree about it. So the flow lives here and the timeline
 * imports it.
 *
 * Writing the copy is also what caught a real bug. The first version of this
 * file left `ready` out of the delivery flow, on the assumption that a delivery
 * goes straight from `preparing` to `out_for_delivery`. It does not: an order
 * is made ready, and *then* a driver takes it. A delivery order sitting at
 * `ready` would have rendered no track at all — the progress bar vanishing at
 * exactly the moment the customer's food was ready. The timeline had it right
 * since 0173.
 *
 * `pending` is a step of the journey but not of the compact bar. It is the
 * state before the merchant has looked, and on a card it gets its own line
 * ("بانتظار تأكيد المتجر") — a filled dot there would imply the shop has agreed
 * to something it has not yet seen.
 */

export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled"
  | "rejected";

export type Fulfillment = "delivery" | "pickup";

/**
 * The full journey, including `pending`. `fulfillment` is an enum of exactly
 * `delivery | pickup` and the two do not share an end: only a delivery is ever
 * `out_for_delivery`, so a pickup customer is never shown a van that is not
 * coming.
 */
export const ORDER_FLOW: Record<Fulfillment, readonly OrderStatus[]> = {
  delivery: [
    "pending",
    "accepted",
    "preparing",
    "ready",
    "out_for_delivery",
    "completed",
  ],
  pickup: ["pending", "accepted", "preparing", "ready", "completed"],
};

/** The journey minus `pending` — what the compact bar draws. */
const COMPACT: Record<Fulfillment, readonly OrderStatus[]> = {
  delivery: ORDER_FLOW.delivery.filter((s) => s !== "pending"),
  pickup: ORDER_FLOW.pickup.filter((s) => s !== "pending"),
};

export type OrderProgress = {
  /** Steps complete, counting the one in progress. 0 before acceptance. */
  reached: number;
  total: number;
  /** The step the order is standing on, for the one-line readout. */
  current: OrderStatus | null;
};

/**
 * `cancelled` and `rejected` end the story, and a track with a dead end drawn
 * on it reads as "still on its way" — so they get no track and the caller falls
 * back to the status pill, which says the true thing.
 */
export function orderProgress(
  status: OrderStatus,
  fulfillment: Fulfillment,
): OrderProgress | null {
  if (status === "cancelled" || status === "rejected") return null;
  const track = COMPACT[fulfillment];
  if (status === "pending") {
    return { reached: 0, total: track.length, current: null };
  }
  const idx = track.indexOf(status);
  // A status that cannot belong to this fulfilment method — a pickup marked
  // out_for_delivery — is a data question, not a rendering one. Show the honest
  // pill rather than a track that contradicts it.
  if (idx < 0) return null;
  return { reached: idx + 1, total: track.length, current: status };
}

/** Whether to show the "waiting for the shop to confirm" line instead. */
export function isAwaitingMerchant(status: OrderStatus): boolean {
  return status === "pending";
}

/**
 * How much of the bar to fill. The step in progress counts as half: "قيد
 * التحضير" means that step is happening, not that it is finished, and a bar
 * that fills completely on the step you are standing on tells the customer the
 * order is done when it is not.
 */
export function progressPercent(p: OrderProgress): number {
  if (p.reached === 0) return 0;
  const complete = p.reached - 1;
  const atLast = p.reached === p.total;
  return Math.round(((complete + (atLast ? 1 : 0.5)) / p.total) * 100);
}

// ---------------------------------------------------------------------------
// What a merchant may move an order to
// ---------------------------------------------------------------------------

/** The statuses an order never leaves: `completed` since 0246, `cancelled` and
 *  `rejected` since 0333 (stock, loyalty and the gift card were already given
 *  back — reopening one re-awarded points and drove stock negative). */
const FINAL_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "cancelled",
  "rejected",
]);

export function isFinalOrderStatus(status: string): boolean {
  return FINAL_ORDER_STATUSES.has(status);
}

/**
 * The statuses the merchant's status control offers, current one first.
 *
 * - A final status offers nothing: the control renders read-only.
 * - Otherwise every LATER step of the order's own journey — skipping ahead is
 *   fine (a walk-in pickup can go straight to completed), going back is not —
 *   plus the two exits, cancelled and rejected.
 * - A pickup order is never offered out_for_delivery: no van is coming.
 * - Legacy data (a pickup already sitting at out_for_delivery) can still move
 *   forward to completed rather than being stuck.
 */
export function nextOrderStatuses(
  status: string,
  fulfillment: string,
): OrderStatus[] {
  if (isFinalOrderStatus(status)) return [];
  const flow =
    fulfillment === "pickup" ? ORDER_FLOW.pickup : ORDER_FLOW.delivery;
  const idx = flow.indexOf(status as OrderStatus);
  if (idx >= 0) return [...flow.slice(idx), "cancelled", "rejected"];
  if (status === "out_for_delivery") {
    return ["out_for_delivery", "completed", "cancelled", "rejected"];
  }
  // An unknown status: the only safe moves are the exits.
  return ["cancelled", "rejected"];
}

/** The database's refusal codes for moving a finished order, as UI kinds. */
export function orderStatusErrorKind(
  message: string | null | undefined,
): "closed" | "completed" | null {
  const m = message ?? "";
  if (m.includes("order_closed_is_final")) return "closed";
  if (m.includes("order_completed_is_final")) return "completed";
  return null;
}
