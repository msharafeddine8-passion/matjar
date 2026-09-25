import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRAM,
  cardProgress,
  displayPhoneKey,
  isCardToken,
  loyaltyCardPath,
  memberWaNumber,
  pointsForPurchase,
  programFromRow,
  programIssue,
  rewardCost,
  rewardLabel,
  stampsForPurchase,
  type LoyaltyProgram,
} from "@/lib/loyalty";
import { phoneKey } from "@/lib/wa-templates";

const stamps = (over: Partial<LoyaltyProgram> = {}): LoyaltyProgram => ({
  ...DEFAULT_PROGRAM,
  kind: "stamps",
  stampsRequired: 5,
  ...over,
});

describe("stampsForPurchase — mirrors loyalty_earn() in 0310", () => {
  const lines = [
    { productId: "coffee", sectionId: "drinks", quantity: 2 },
    { productId: "cake", sectionId: null, quantity: 1 },
  ];

  it("'order' scope: one stamp per purchase, none for a zero total", () => {
    expect(stampsForPurchase(stamps({ stampScope: "order" }), 11, lines)).toBe(1);
    expect(stampsForPurchase(stamps({ stampScope: "order" }), 0, lines)).toBe(0);
  });

  it("'product' scope counts only units of that product", () => {
    expect(stampsForPurchase(stamps({ stampScope: "product", scopeProductId: "coffee" }), 11, lines)).toBe(2);
    expect(stampsForPurchase(stamps({ stampScope: "product", scopeProductId: "tea" }), 11, lines)).toBe(0);
  });

  it("'section' scope counts units of any product in the section", () => {
    expect(stampsForPurchase(stamps({ stampScope: "section", scopeSectionId: "drinks" }), 11, lines)).toBe(2);
  });

  it("a scope whose product was deleted (id null) earns nothing rather than everything", () => {
    expect(stampsForPurchase(stamps({ stampScope: "product", scopeProductId: null }), 11, [
      { productId: null, sectionId: null, quantity: 4 },
    ])).toBe(0);
  });

  it("caps one purchase at five cards' worth", () => {
    expect(stampsForPurchase(stamps({ stampScope: "product", scopeProductId: "coffee" }), 999, [
      { productId: "coffee", sectionId: null, quantity: 999 },
    ])).toBe(25);
  });
});

describe("pointsForPurchase", () => {
  it("1 per whole dollar by default — the rule every store had before 0310", () => {
    expect(pointsForPurchase(10.7)).toBe(10);
    expect(pointsForPurchase(0.99)).toBe(0);
  });
  it("X per whole dollar with a program", () => {
    expect(pointsForPurchase(10.7, 3)).toBe(30);
    expect(pointsForPurchase(20, 3)).toBe(60);
  });
  it("never negative, never NaN", () => {
    expect(pointsForPurchase(-5, 3)).toBe(0);
    expect(pointsForPurchase(Number.NaN, 3)).toBe(0);
  });
});

describe("cardProgress", () => {
  it("fills toward the next reward", () => {
    expect(cardProgress(3, 5)).toEqual({ current: 3, perCard: 5, rewardsReady: 0, toNext: 2, ratio: 0.6 });
  });
  it("shows a FULL card while a reward is waiting", () => {
    expect(cardProgress(5, 5)).toMatchObject({ current: 5, rewardsReady: 1, toNext: 0, ratio: 1 });
    expect(cardProgress(12, 5)).toMatchObject({ current: 5, rewardsReady: 2 });
  });
  it("points use the threshold as the card size", () => {
    expect(cardProgress(250, 100)).toMatchObject({ rewardsReady: 2 });
    expect(cardProgress(40, 100)).toMatchObject({ toNext: 60 });
  });
  it("a negative or fractional balance is read as whole and never below zero", () => {
    expect(cardProgress(-2, 5)).toMatchObject({ current: 0, rewardsReady: 0, toNext: 5 });
    expect(cardProgress(2.9, 5)).toMatchObject({ current: 2 });
  });
});

describe("programFromRow / programIssue", () => {
  it("reads a row, and null for anything that is not a program", () => {
    expect(programFromRow(null)).toBeNull();
    expect(programFromRow({ kind: "nonsense" })).toBeNull();
    const p = programFromRow({ kind: "points", points_per_usd: "3", redeem_threshold: 100, stamp_scope: "weird" });
    expect(p).toMatchObject({ kind: "points", pointsPerUsd: 3, redeemThreshold: 100, stampScope: "order" });
  });
  it("refuses what the database would refuse", () => {
    expect(programIssue(stamps({ stampsRequired: 1 }))).toBe("stampsRange");
    expect(programIssue(stamps({ stampsRequired: 51 }))).toBe("stampsRange");
    expect(programIssue(stamps({ stampScope: "product", scopeProductId: null }))).toBe("scopeProductMissing");
    expect(programIssue(stamps({ stampScope: "section", scopeSectionId: null }))).toBe("scopeSectionMissing");
    expect(programIssue({ ...DEFAULT_PROGRAM, kind: "points", pointsPerUsd: 0 })).toBe("rateRange");
    expect(programIssue({ ...DEFAULT_PROGRAM, kind: "points", redeemThreshold: 0 })).toBe("thresholdRange");
    expect(programIssue(stamps({ rewardLabel: "x".repeat(121) }))).toBe("rewardTooLong");
    expect(programIssue(stamps())).toBeNull();
  });
  it("reward cost and wording", () => {
    expect(rewardCost(stamps({ stampsRequired: 9 }))).toBe(9);
    expect(rewardCost({ ...DEFAULT_PROGRAM, kind: "points", redeemThreshold: 250 })).toBe(250);
    expect(rewardLabel({ rewardLabel: "قهوة مجانية", rewardLabelEn: null }, "en")).toBe("قهوة مجانية");
    expect(rewardLabel({ rewardLabel: "قهوة مجانية", rewardLabelEn: "Free coffee" }, "en")).toBe("Free coffee");
    expect(rewardLabel({ rewardLabel: " ", rewardLabelEn: null }, "ar")).toBeNull();
  });
});

describe("phone identity — the TS twin of wa_phone_key", () => {
  it("every way of typing one Lebanese number is one member", () => {
    const keys = ["03 123 456", "3123456", "+961 3 123 456", "00961 3 123 456", "+961 03 123 456"].map(phoneKey);
    expect(new Set(keys)).toEqual(new Set(["3123456"]));
  });
  it("the stored key turns back into a wa.me number", () => {
    expect(memberWaNumber("3123456")).toBe("9613123456");
    expect(memberWaNumber("70111222")).toBe("96170111222");
    expect(memberWaNumber(null)).toBeNull();
  });
  it("staff see the key in local form", () => {
    expect(displayPhoneKey("3123456")).toBe("03 123 456");
    expect(displayPhoneKey("70111222")).toBe("70 111 222");
  });
});

describe("card links", () => {
  it("accepts only the 0310 token shape", () => {
    expect(isCardToken("AY4rucFDHWkN1l0trqF6yv7m")).toBe(true);
    expect(isCardToken("short")).toBe(false);
    expect(isCardToken("x' or 1=1 --xxxxxxxxxxxxxxx")).toBe(false);
    expect(loyaltyCardPath("ar", "AY4rucFDHWkN1l0trqF6yv7m")).toBe("/ar/loyalty/AY4rucFDHWkN1l0trqF6yv7m");
  });
});
