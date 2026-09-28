import { describe, expect, it } from "vitest";
import {
  GIFT_CODE_ALPHABET,
  beirutToday,
  formatGiftAmount,
  formatGiftCode,
  generateGiftCode,
  giftAmountIssue,
  giftCardPath,
  giftCardReport,
  giftCardStatus,
  giftErrorKey,
  isValidGiftCode,
  maskGiftCode,
  normalizeGiftCode,
  planRedemption,
} from "@/lib/gift-cards";

describe("code alphabet and generation", () => {
  it("32 characters, none of the look-alikes 0 O 1 I", () => {
    expect(GIFT_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(GIFT_CODE_ALPHABET).size).toBe(32);
    for (const bad of ["0", "O", "1", "I"]) expect(GIFT_CODE_ALPHABET).not.toContain(bad);
  });

  it("12 characters, each byte masked to 5 bits (uniform: 32 divides 256)", () => {
    const code = generateGiftCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(code).toHaveLength(12);
    expect(isValidGiftCode(code)).toBe(true);
    // byte 0 -> index 0, byte 37 -> 37 & 31 = 5, byte 255 -> 31
    expect(generateGiftCode(() => new Uint8Array(12).fill(0))).toBe("222222222222");
    expect(generateGiftCode(() => new Uint8Array(12).fill(255))).toBe("ZZZZZZZZZZZZ");
    expect(generateGiftCode(() => new Uint8Array(12).fill(37))[0]).toBe(GIFT_CODE_ALPHABET[5]);
  });

  it("the default generator uses the platform CSPRNG and yields valid codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateGiftCode();
      expect(isValidGiftCode(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
  });
});

describe("typing a code", () => {
  it("normalises spaces, dashes and case", () => {
    expect(normalizeGiftCode(" abcd-efgh jkmn ")).toBe("ABCDEFGHJKMN");
    expect(isValidGiftCode("abcd-efgh-jkmn")).toBe(true);
  });
  it("refuses look-alikes and wrong lengths rather than guessing", () => {
    expect(isValidGiftCode("ABCD-EFGH-JKM0")).toBe(false);
    expect(isValidGiftCode("ABCD-EFGH-JKMO")).toBe(false);
    expect(isValidGiftCode("ABCD-EFGH-JKM")).toBe(false);
    expect(isValidGiftCode("")).toBe(false);
  });
  it("prints in groups of four and masks to the last four", () => {
    expect(formatGiftCode("abcdefghjkmn")).toBe("ABCD-EFGH-JKMN");
    expect(maskGiftCode("ABCD-EFGH-JKMN")).toBe("…JKMN");
  });
});

describe("issuing amounts", () => {
  it("USD up to $10,000 in cents", () => {
    expect(giftAmountIssue(50, "USD")).toBeNull();
    expect(giftAmountIssue(12.5, "USD")).toBeNull();
    expect(giftAmountIssue(0, "USD")).toBe("invalid");
    expect(giftAmountIssue(10_001, "USD")).toBe("tooLarge");
    expect(giftAmountIssue(1.234, "USD")).toBe("tooManyDecimals");
  });
  it("LBP in whole pounds", () => {
    expect(giftAmountIssue(900_000, "LBP")).toBeNull();
    expect(giftAmountIssue(1000.5, "LBP")).toBe("fractionalLbp");
    expect(giftAmountIssue(2_000_000_000, "LBP")).toBe("tooLarge");
  });
  it("formats in the card's own currency", () => {
    expect(formatGiftAmount(900000, "LBP", "ar")).toBe("900,000 ل.ل.");
    expect(formatGiftAmount(900000, "LBP", "en")).toBe("900,000 LBP");
    expect(formatGiftAmount(12.5, "USD", "ar")).toBe("$12.5");
  });
});

describe("planRedemption — mirrors gift_card_debit() in 0310", () => {
  it("USD card, partial: spends the whole balance, the rest stays due", () => {
    expect(planRedemption({ currency: "USD", balance: 11, dueUsd: 12, fxRate: 89500 })).toEqual({
      ok: true, cardAmount: 11, usdAmount: 11, cardBalanceAfter: 0, dueAfterUsd: 1,
    });
  });
  it("USD card, full: pays exactly what is due and keeps the remainder", () => {
    expect(planRedemption({ currency: "USD", balance: 41, dueUsd: 30, fxRate: null })).toEqual({
      ok: true, cardAmount: 30, usdAmount: 30, cardBalanceAfter: 11, dueAfterUsd: 0,
    });
  });
  it("LBP card, partial: whole pounds at the ORDER's rate, dollars truncated to the cent", () => {
    // $20 at 89,500 = 1,790,000 LBP due; a 900,000 card covers 10.0558… -> $10.05
    expect(planRedemption({ currency: "LBP", balance: 900_000, dueUsd: 20, fxRate: 89_500 })).toEqual({
      ok: true, cardAmount: 900_000, usdAmount: 10.05, cardBalanceAfter: 0, dueAfterUsd: 9.95,
    });
  });
  it("LBP card, full: pays the due exactly, debiting round(due × rate) pounds", () => {
    expect(planRedemption({ currency: "LBP", balance: 5_000_000, dueUsd: 20, fxRate: 89_500 })).toEqual({
      ok: true, cardAmount: 1_790_000, usdAmount: 20, cardBalanceAfter: 3_210_000, dueAfterUsd: 0,
    });
  });
  it("the same card at a different snapshot debits a different number of pounds — the rate is the order's", () => {
    const a = planRedemption({ currency: "LBP", balance: 5_000_000, dueUsd: 10, fxRate: 89_500 });
    const b = planRedemption({ currency: "LBP", balance: 5_000_000, dueUsd: 10, fxRate: 90_000 });
    expect(a.ok && a.cardAmount).toBe(895_000);
    expect(b.ok && b.cardAmount).toBe(900_000);
  });
  it("refusals", () => {
    expect(planRedemption({ currency: "LBP", balance: 100_000, dueUsd: 5, fxRate: null })).toEqual({ ok: false, reason: "no_rate" });
    expect(planRedemption({ currency: "USD", balance: 0, dueUsd: 5, fxRate: null })).toEqual({ ok: false, reason: "card_empty" });
    expect(planRedemption({ currency: "USD", balance: 10, dueUsd: 0, fxRate: null })).toEqual({ ok: false, reason: "nothing_due" });
    // 500 LBP at 89,500 is under a cent: nothing is taken from the card.
    expect(planRedemption({ currency: "LBP", balance: 500, dueUsd: 5, fxRate: 89_500 })).toEqual({ ok: false, reason: "nothing_due" });
  });
});

describe("status and liability", () => {
  const today = "2026-09-25";
  const cards = [
    { currency: "USD" as const, initial_amount: 50, balance: 39, status: "active" as const, expires_on: null },
    { currency: "USD" as const, initial_amount: 20, balance: 20, status: "void" as const, expires_on: null },
    { currency: "USD" as const, initial_amount: 15, balance: 15, status: "active" as const, expires_on: "2026-09-24" },
    { currency: "USD" as const, initial_amount: 40, balance: 0, status: "active" as const, expires_on: "2026-09-25" },
    { currency: "LBP" as const, initial_amount: "900000", balance: "0", status: "active" as const, expires_on: null },
    { currency: "LBP" as const, initial_amount: 100000, balance: 100000, status: "active" as const, expires_on: null },
  ];

  it("a card is good THROUGH its expiry day", () => {
    expect(giftCardStatus({ status: "active", expires_on: today, balance: 5 }, today)).toBe("active");
    expect(giftCardStatus({ status: "active", expires_on: "2026-09-24", balance: 5 }, today)).toBe("expired");
    expect(giftCardStatus({ status: "void", expires_on: null, balance: 5 }, today)).toBe("void");
    expect(giftCardStatus({ status: "active", expires_on: null, balance: 0 }, today)).toBe("spent");
  });

  it("issued / redeemed / outstanding per currency, never summed across", () => {
    const [usd, lbp] = giftCardReport(cards, today);
    expect(usd).toEqual({
      currency: "USD", issuedCount: 4, issued: 125, redeemed: 51, outstanding: 39, expired: 15, voided: 20,
    });
    expect(lbp).toEqual({
      currency: "LBP", issuedCount: 2, issued: 1_000_000, redeemed: 900_000, outstanding: 100_000, expired: 0, voided: 0,
    });
  });

  it("an empty store reports nothing rather than zero rows of both currencies", () => {
    expect(giftCardReport([], today)).toEqual([]);
  });

  it("today is Beirut's calendar day, not UTC's", () => {
    // 22:30 UTC on the 24th is already the 25th in Beirut (UTC+3).
    expect(beirutToday(new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-25");
  });
});

describe("error mapping and links", () => {
  it("maps RPC errors to dictionary keys", () => {
    expect(giftErrorKey("card_not_found")).toBe("notFound");
    expect(giftErrorKey("card_void")).toBe("void");
    expect(giftErrorKey("card_expired")).toBe("expired");
    expect(giftErrorKey("card_empty")).toBe("empty");
    expect(giftErrorKey("nothing_due")).toBe("nothingDue");
    expect(giftErrorKey("no_rate")).toBe("noRate");
    expect(giftErrorKey("order_not_open")).toBe("orderClosed");
    expect(giftErrorKey("plan_required")).toBe("planRequired");
    expect(giftErrorKey("not allowed")).toBe("notAllowed");
    expect(giftErrorKey("Could not find the function public.redeem_gift_card_order")).toBe("setupPending");
    expect(giftErrorKey(null)).toBe("generic");
  });
  it("the public page path", () => {
    expect(giftCardPath("en", "tok")).toBe("/en/gift/tok");
  });
});
