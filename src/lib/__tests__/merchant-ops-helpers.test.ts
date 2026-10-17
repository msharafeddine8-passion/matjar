import { describe, it, expect } from "vitest";
import {
  GIFT_CARD_METHOD,
  invoicePaymentState,
  paymentMethodLabel,
  paymentNoteLabel,
} from "@/lib/order-payment-labels";
import { dispatchErrorKey } from "@/lib/dispatch-errors";
import { canAddOne, clampPosQty, overStockNames, posErrorKind } from "@/lib/pos";
import { mergeCrmRows, normalizePhoneKey } from "@/lib/crm-merge";
import { formatMoneyAmount, formatUsd } from "@/lib/currency";
import { formatBeirutDateTime } from "@/lib/datetime";

const T = {
  giftCard: "Gift card",
  noteOrderCancelled: "Returned — order cancelled",
  noteOrderRejected: "Returned — order rejected",
};

describe("order payment labels", () => {
  it("translates the gift-card method and the automatic refund notes", () => {
    expect(paymentMethodLabel(GIFT_CARD_METHOD, T)).toBe("Gift card");
    expect(paymentNoteLabel("order cancelled", T)).toBe(T.noteOrderCancelled);
    expect(paymentNoteLabel("order rejected", T)).toBe(T.noteOrderRejected);
  });

  it("shows merchant-typed text as typed, and nothing for blanks", () => {
    expect(paymentMethodLabel("Whish", T)).toBe("Whish");
    expect(paymentNoteLabel("…1234", T)).toBe("…1234");
    expect(paymentMethodLabel("  ", T)).toBeNull();
    expect(paymentNoteLabel(null, T)).toBeNull();
  });

  it("derives the receipt's payment line from the ledger", () => {
    expect(invoicePaymentState([], 20, T)).toEqual({ kind: "cod", methods: [] });
    expect(
      invoicePaymentState(
        [{ kind: "payment", amount: 20, method: GIFT_CARD_METHOD }],
        20,
        T,
      ),
    ).toEqual({ kind: "paid", methods: ["Gift card"] });
    expect(
      invoicePaymentState(
        [
          { kind: "payment", amount: "5", method: GIFT_CARD_METHOD },
          { kind: "payment", amount: 5, method: "Cash" },
        ],
        20,
        T,
      ),
    ).toEqual({ kind: "partial", methods: ["Gift card", "Cash"] });
    expect(
      invoicePaymentState(
        [
          { kind: "payment", amount: 20, method: null },
          { kind: "refund", amount: 20, method: null },
        ],
        20,
        T,
      ).kind,
    ).toBe("refunded");
  });

  it("does not call 0.1 + 0.2 short of 0.3", () => {
    expect(
      invoicePaymentState(
        [
          { kind: "payment", amount: 0.1, method: null },
          { kind: "payment", amount: 0.2, method: null },
        ],
        0.3,
        T,
      ).kind,
    ).toBe("paid");
  });
});

describe("dispatchErrorKey", () => {
  it("maps every known request_delivery / update_delivery_status refusal", () => {
    expect(dispatchErrorKey("order not found")).toBe("errOrderNotFound");
    expect(dispatchErrorKey("delivery request not found")).toBe("errRequestNotFound");
    expect(dispatchErrorKey("not allowed")).toBe("errNotAllowed");
    expect(dispatchErrorKey("delivery dispatch requires the Pro plan")).toBe("errPlanRequired");
    expect(dispatchErrorKey("courier not available")).toBe("errCourierUnavailable");
    expect(dispatchErrorKey("this order already has an active delivery request")).toBe("errAlreadyActive");
    expect(dispatchErrorKey("could not allocate a tracking reference")).toBe("errTrackingRef");
    expect(dispatchErrorKey("this delivery is already completed")).toBe("errAlreadyDelivered");
    expect(dispatchErrorKey("this delivery was cancelled")).toBe("errAlreadyCancelled");
    expect(dispatchErrorKey("delivery status only moves forward")).toBe("errForwardOnly");
  });

  it("returns null for anything else", () => {
    expect(dispatchErrorKey("unknown status: bogus")).toBeNull();
    expect(dispatchErrorKey("")).toBeNull();
    expect(dispatchErrorKey(undefined)).toBeNull();
  });
});

describe("POS helpers", () => {
  it("caps a ticket quantity at the stock, untracked stock has no cap", () => {
    expect(clampPosQty(5, 3)).toBe(3);
    expect(clampPosQty(2, 3)).toBe(2);
    expect(clampPosQty(-1, 3)).toBe(0);
    expect(clampPosQty(99, null)).toBe(99);
    expect(canAddOne(3, 3)).toBe(false);
    expect(canAddOne(2, 3)).toBe(true);
    expect(canAddOne(1000, null)).toBe(true);
  });

  it("names the lines that ask for more than the shelf holds", () => {
    expect(
      overStockNames([
        { product: { name: "Bread", stock: 2 }, qty: 3 },
        { product: { name: "Milk", stock: null }, qty: 30 },
        { product: { name: "Eggs", stock: 12 }, qty: 12 },
      ]),
    ).toEqual(["Bread"]);
  });

  it("maps pos_record_sale refusals", () => {
    expect(posErrorKind("insufficient_stock")).toBe("insufficientStock");
    expect(posErrorKind("invalid discount")).toBe("invalidDiscount");
    expect(posErrorKind("invalid quantity")).toBe("invalidQuantity");
    expect(posErrorKind("product not found in this store")).toBe("productGone");
    expect(posErrorKind("forbidden")).toBeNull();
  });
});

describe("CRM merge", () => {
  it("treats every spelling of one Lebanese number as one key", () => {
    const k = normalizePhoneKey("03 123456");
    expect(k).toBe("9613123456");
    expect(normalizePhoneKey("+9613123456")).toBe(k);
    expect(normalizePhoneKey("03123456")).toBe(k);
    expect(normalizePhoneKey("")).toBeNull();
    expect(normalizePhoneKey("12")).toBe("12");
  });

  it("folds rows sharing a phone or an account, summing counts and spend", () => {
    const merged = mergeCrmRows([
      { name: "Rami", phone: "03 123456", count: 2, total: 10.1, customerId: null, lastOrder: "2026-10-01" },
      { name: null, phone: "+9613123456", count: 1, total: 0.2, customerId: "u1", lastOrder: "2026-10-05" },
      { name: null, phone: "70 111222", count: 1, total: 0, customerId: "u1", lastOrder: "2026-09-01" },
      { name: "Other", phone: "71 999888", count: 1, total: 5, customerId: null, lastOrder: null },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      name: "Rami",
      count: 4,
      total: 10.3,
      customerId: "u1",
      lastOrder: "2026-10-05",
    });
  });

  it("folds rows with no phone and no account into one walk-in", () => {
    const merged = mergeCrmRows([
      { name: null, phone: null, count: 1, total: 1, customerId: null, lastOrder: null },
      { name: null, phone: "", count: 1, total: 1, customerId: null, lastOrder: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(2);
  });
});

describe("money and dates", () => {
  it("prints fixed two-decimal receipts", () => {
    expect(formatUsd(12.5, { fixed: true })).toBe("$12.50");
    expect(formatUsd(1234, { fixed: true })).toBe("$1,234.00");
    expect(formatUsd(22.169999999999998, { fixed: true })).toBe("$22.17");
  });

  it("formats an amount in its own currency, grouped, per language", () => {
    expect(formatMoneyAmount(1500000.4, "LBP", "ar")).toBe("1,500,000 ل.ل.");
    expect(formatMoneyAmount(1500000, "LBP", "en")).toBe("1,500,000 LBP");
    expect(formatMoneyAmount(1250, "USD", "en")).toBe("$1,250.00");
  });

  it("prints instants in Beirut with Western digits", () => {
    // 18:05 UTC on 28 Sep 2026 is 21:05 in Beirut (UTC+3, summer time).
    const iso = "2026-09-28T18:05:00Z";
    const ar = formatBeirutDateTime(iso, "ar", "time");
    expect(ar).toMatch(/[0-9]/);
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(formatBeirutDateTime(iso, "en", "time")).toBe("21:05");
    expect(formatBeirutDateTime(iso, "en", "long")).toContain("2026");
    expect(formatBeirutDateTime("not a date", "en")).toBe("");
    expect(formatBeirutDateTime(null, "en")).toBe("");
  });
});
