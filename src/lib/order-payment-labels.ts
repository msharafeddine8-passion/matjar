// What the database writes into order_payments, said in the merchant's words.
//
// Two writers put fixed strings in rows a human reads (0310):
//   method = 'بطاقة هدية · Gift card'   on every gift-card payment and refund
//   note   = 'order cancelled' | 'order rejected'   on the automatic refund
// Both were printed raw: an English merchant read Arabic, an Arabic merchant
// read "order cancelled". Anything else in those columns was typed by the
// merchant and is shown exactly as typed.

export const GIFT_CARD_METHOD = "بطاقة هدية · Gift card";

export type PaymentLabelDict = {
  giftCard: string;
  noteOrderCancelled: string;
  noteOrderRejected: string;
};

export function paymentMethodLabel(
  method: string | null | undefined,
  t: Pick<PaymentLabelDict, "giftCard">,
): string | null {
  const m = method?.trim();
  if (!m) return null;
  if (m === GIFT_CARD_METHOD) return t.giftCard;
  return m;
}

export function paymentNoteLabel(
  note: string | null | undefined,
  t: Pick<PaymentLabelDict, "noteOrderCancelled" | "noteOrderRejected">,
): string | null {
  const n = note?.trim();
  if (!n) return null;
  if (n === "order cancelled") return t.noteOrderCancelled;
  if (n === "order rejected") return t.noteOrderRejected;
  return n;
}

export type InvoicePaymentState = {
  /** cod: nothing recorded yet · paid: recorded ≥ total · partial: some ·
   *  refunded: everything recorded was given back. */
  kind: "cod" | "paid" | "partial" | "refunded";
  /** Distinct payment methods, translated, in the order first used. */
  methods: string[];
};

/**
 * The payment line on a receipt, from the order's own money ledger — instead
 * of always «الدفع عند الاستلام», which was false for an order paid by gift
 * card, by transfer, or already settled at the counter.
 */
export function invoicePaymentState(
  payments: readonly {
    kind: string;
    amount: number | string;
    method: string | null;
  }[],
  orderTotal: number,
  t: Pick<PaymentLabelDict, "giftCard">,
): InvoicePaymentState {
  const cents = (n: number | string) => Math.round(Number(n) * 100);
  let paid = 0;
  let refunded = 0;
  const methods: string[] = [];
  for (const p of payments) {
    if (p.kind === "refund") {
      refunded += cents(p.amount);
      continue;
    }
    if (p.kind !== "payment") continue;
    paid += cents(p.amount);
    const label = paymentMethodLabel(p.method, t);
    if (label && !methods.includes(label)) methods.push(label);
  }
  if (paid === 0) return { kind: "cod", methods: [] };
  const net = paid - refunded;
  if (net <= 0) return { kind: "refunded", methods };
  if (net >= cents(orderTotal)) return { kind: "paid", methods };
  return { kind: "partial", methods };
}
