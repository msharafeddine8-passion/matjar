import { describe, expect, it } from "vitest";
import {
  PLAN_TIERS,
  PROMO_END,
  addPlanPeriod,
  annualPrice,
  planCharge,
} from "@/lib/plan-tiers";

describe("planCharge", () => {
  const inPromo = new Date("2026-10-17T12:00:00+03:00");
  const afterPromo = new Date(new Date(PROMO_END).getTime() + 1000);

  it("defaults a monthly payment to the tier's monthly price", () => {
    for (const tier of ["basic", "pro", "business"] as const) {
      expect(planCharge(tier, "monthly", inPromo)).toBe(PLAN_TIERS[tier].monthly);
    }
  });

  it("uses the promo annual price inside the window and standard after it", () => {
    for (const tier of ["basic", "pro", "business"] as const) {
      expect(planCharge(tier, "yearly", inPromo)).toBe(annualPrice(PLAN_TIERS[tier], true));
      expect(planCharge(tier, "yearly", afterPromo)).toBe(PLAN_TIERS[tier].annualStandard);
    }
  });
});

describe("addPlanPeriod", () => {
  it("adds one calendar month", () => {
    const end = addPlanPeriod(new Date(2026, 9, 17, 10, 0), "monthly");
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 10, 17]);
  });

  it("clamps month-end instead of rolling into the next month", () => {
    const end = addPlanPeriod(new Date(2027, 0, 31), "monthly");
    expect([end.getMonth(), end.getDate()]).toEqual([1, 28]);
  });

  it("adds one year, clamping 29 February", () => {
    const end = addPlanPeriod(new Date(2028, 1, 29), "yearly");
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2029, 1, 28]);
    const plain = addPlanPeriod(new Date(2026, 9, 17), "yearly");
    expect([plain.getFullYear(), plain.getMonth(), plain.getDate()]).toEqual([2027, 9, 17]);
  });

  it("does not mutate its input", () => {
    const from = new Date(2026, 9, 17);
    addPlanPeriod(from, "monthly");
    expect(from.getMonth()).toBe(9);
  });
});
