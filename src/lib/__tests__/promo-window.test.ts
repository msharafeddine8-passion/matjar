import { describe, expect, it } from "vitest";
import {
  PLAN_TIERS,
  PROMO_END,
  annualPrice,
  promoState,
} from "@/lib/plan-tiers";

// The annual launch promo runs to the end of 2026, Beirut time. These pin the
// exact edges so a future edit to PROMO_END (or its offset) is caught: Lebanon
// is on EET (+02:00) in December, so the last second is 23:59:59+02:00 — a
// +03:00 offset would end the offer an hour early.

describe("annual promo window", () => {
  it("ends at the last second of 2026 in Beirut", () => {
    expect(new Date(PROMO_END).toISOString()).toBe("2026-12-31T21:59:59.000Z");
  });

  it("is running on the day it was re-opened", () => {
    expect(promoState(new Date("2026-10-17T12:00:00+03:00")).active).toBe(true);
  });

  it("is still running at 23:30 on 31 December, Beirut", () => {
    const s = promoState(new Date("2026-12-31T23:30:00+02:00"));
    expect(s.active).toBe(true);
    expect(s.daysLeft).toBe(1);
  });

  it("is over one second after midnight on 1 January, Beirut", () => {
    const s = promoState(new Date("2027-01-01T00:00:01+02:00"));
    expect(s.active).toBe(false);
    expect(s.daysLeft).toBe(0);
  });

  it("charges the promo annual price inside the window and standard after", () => {
    const inside = promoState(new Date("2026-11-15T10:00:00+02:00")).active;
    const after = promoState(new Date("2027-01-02T10:00:00+02:00")).active;
    expect(annualPrice(PLAN_TIERS.pro, inside)).toBe(PLAN_TIERS.pro.annualPromo);
    expect(annualPrice(PLAN_TIERS.pro, after)).toBe(
      PLAN_TIERS.pro.annualStandard,
    );
  });
});
