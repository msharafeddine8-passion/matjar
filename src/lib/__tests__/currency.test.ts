import { describe, it, expect } from "vitest";
import { formatUsd, formatLbp, formatLbpPrice } from "@/lib/currency";

describe("formatUsd", () => {
  it("formats small amounts without a separator", () => {
    expect(formatUsd(50)).toBe("$50");
    expect(formatUsd(999)).toBe("$999");
  });
  it("adds a thousands separator at >= 1000", () => {
    expect(formatUsd(1000)).toBe("$1,000");
    expect(formatUsd(165000)).toBe("$165,000");
  });
  it("handles zero", () => {
    expect(formatUsd(0)).toBe("$0");
  });
  it("is unchanged when opts is absent or cents is falsy", () => {
    expect(formatUsd(1234.5, {})).toBe("$1,234.5");
    expect(formatUsd(1234.5, { cents: false })).toBe(formatUsd(1234.5));
  });
});

describe("formatUsd with { cents: true }", () => {
  // Pins the exact strings the invoice / POS / supplier / merchant-dashboard
  // screens have always rendered. These five surfaces each carried their own
  // copy of this arithmetic (MP-061); the option replaced the copies, so any
  // drift here is a visible change to a merchant's money screen.
  it("rounds to at most two decimals", () => {
    expect(formatUsd(1234.5678, { cents: true })).toBe("$1,234.57");
    expect(formatUsd(7.399999, { cents: true })).toBe("$7.4");
    expect(formatUsd(0.005, { cents: true })).toBe("$0.01");
  });
  it("drops trailing zeros, as the copies it replaced did", () => {
    expect(formatUsd(12.5, { cents: true })).toBe("$12.5");
    expect(formatUsd(12.0, { cents: true })).toBe("$12");
    expect(formatUsd(0, { cents: true })).toBe("$0");
  });
  it("groups thousands", () => {
    expect(formatUsd(1000, { cents: true })).toBe("$1,000");
    expect(formatUsd(1_000_000, { cents: true })).toBe("$1,000,000");
  });
  it("no longer differs from the default, because the default rounds too", () => {
    // This assertion used to require that >2dp amounts DIVERGE between the two
    // forms, and called that divergence "the point". It was the bug: the
    // default branch interpolated the raw float, rendering 1234.5678 as
    // "$1,234.5678" and a real computed cart total as "$22.169999999999998".
    // Rounding moved into the default branch, so the two now agree everywhere.
    //
    // Inverted rather than deleted, so that reintroducing the unrounded default
    // fails here as well as in the float-artifact test below.
    for (const v of [0, 5, 50, 999, 1000, 165000, 7.5, 1234.5678, 7.39 * 3]) {
      expect(formatUsd(v, { cents: true })).toBe(formatUsd(v));
    }
    // `cents` is near-redundant as a result. Kept because ~19 call sites pass
    // it and it still marks the surfaces that settle real money — not because
    // it changes the output.
  });
});

describe("formatLbp", () => {
  it("returns an approximate LBP string in Arabic", () => {
    expect(formatLbp(10, 89000, "ar")).toBe("≈ 890,000 ل.ل.");
  });
  it("uses the LBP label in English", () => {
    expect(formatLbp(10, 89000, "en")).toBe("≈ 890,000 LBP");
  });
  it("returns empty string when the rate is missing or amount non-positive", () => {
    expect(formatLbp(10, 0, "ar")).toBe("");
    expect(formatLbp(0, 89000, "ar")).toBe("");
    expect(formatLbp(-5, 89000, "ar")).toBe("");
  });
  it("rounds to the nearest whole LBP", () => {
    expect(formatLbp(1.5, 89000, "en")).toBe("≈ 133,500 LBP");
  });
});

describe("a computed total never leaks a float artifact", () => {
  // The bug this guards: formatUsd's non-cents branch interpolated the raw
  // number, so a real butcher's cart rendered 7.39 x 3 as
  // "$22.169999999999998" — on the cart line, the sticky bar, the checkout
  // button, and the WhatsApp order message sent to the merchant.
  it("rounds a multiplied price to cents", () => {
    expect(formatUsd(7.39 * 3)).toBe("$22.17");
    expect(formatUsd(7.6 * 3)).toBe("$22.8");
    expect(formatUsd(7.8 * 7)).toBe("$54.6");
  });

  it("leaves every catalogue price exactly as it rendered before", () => {
    // These are the real prices on the two busiest live stores. If any of them
    // moves, the fix has overreached.
    expect(formatUsd(50)).toBe("$50");
    expect(formatUsd(4.99)).toBe("$4.99");
    expect(formatUsd(7.39)).toBe("$7.39");
    expect(formatUsd(12.5)).toBe("$12.5");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(1000)).toBe("$1,000");
    expect(formatUsd(165000)).toBe("$165,000");
  });

  it("still differs from {cents:true} only in grouping below 1000", () => {
    expect(formatUsd(999.994)).toBe("$999.99");
    expect(formatUsd(999.994, { cents: true })).toBe("$999.99");
  });
});

describe("formatLbpPrice (0342)", () => {
  it("gives back the lira price a cent-rounded USD price came from", () => {
    // The Al-Meer menu at 89,700: each lira price stored as round(lbp / rate, 2).
    for (const lbp of [50_000, 80_000, 100_000, 300_000]) {
      const usd = Math.round((lbp / 89_700) * 100) / 100;
      expect(formatLbpPrice(usd, 89_700, "ar")).toBe(
        `${lbp.toLocaleString("en-US")} ل.ل.`,
      );
    }
  });
  it("labels English as LBP", () => {
    expect(formatLbpPrice(0.89, 89_700, "en")).toBe("80,000 LBP");
  });
  it("returns empty without a rate or a price, so callers fall back to USD", () => {
    expect(formatLbpPrice(1, 0, "ar")).toBe("");
    expect(formatLbpPrice(0, 89_700, "ar")).toBe("");
  });
});
