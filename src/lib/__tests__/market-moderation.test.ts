import { describe, it, expect } from "vitest";
import {
  LISTING_LIFETIME_DAYS,
  MIN_PRICE_SAMPLES,
  REJECT_REASONS,
  buildQueue,
  categoryPriceStats,
  daysUntilExpiry,
  findDuplicates,
  hasContactInText,
  isRejectReason,
  moderationSignals,
  normalizeTitle,
  priceSignal,
  priorityScore,
  type ModerationContext,
  type ModerationListing,
} from "@/lib/market-moderation";

const NOW = new Date("2026-09-25T12:00:00Z");

function listing(over: Partial<ModerationListing> & { id: string }): ModerationListing {
  return {
    sellerId: "s1",
    title: "دراجة هوائية",
    description: null,
    price: 100,
    images: [`https://cdn/${over.id}.jpg`],
    categoryId: "bikes",
    status: "active",
    createdAt: "2026-09-20T10:00:00Z",
    ...over,
  };
}

function ctx(over: Partial<ModerationContext> = {}): ModerationContext {
  return {
    duplicates: new Map(),
    priceStats: new Map(),
    openReports: new Map(),
    now: NOW,
    ...over,
  };
}

describe("normalizeTitle", () => {
  it("treats Arabic letter variants, diacritics, tatweel and digits as the same words", () => {
    expect(normalizeTitle("آيفون ١٣  برو!!")).toBe(normalizeTitle("ايفون 13 برو"));
    expect(normalizeTitle("سيّارة للبيـــع")).toBe(normalizeTitle("سيارة للبيع"));
    expect(normalizeTitle("غرفة نوم مستعملة")).toBe(normalizeTitle("غرفه نوم مستعمله"));
  });
});

describe("findDuplicates", () => {
  it("flags the same seller posting the same title twice", () => {
    const d = findDuplicates([
      listing({ id: "a", title: "iPhone 13 Pro" }),
      listing({ id: "b", title: "iphone 13 pro!", status: "pending" }),
    ]);
    expect(d.get("a")).toEqual(["b"]);
    expect(d.get("b")).toEqual(["a"]);
  });

  it("does NOT flag different sellers who typed the same common title", () => {
    const d = findDuplicates([
      listing({ id: "a", title: "iPhone 13" }),
      listing({ id: "b", title: "iPhone 13", sellerId: "s2" }),
    ]);
    expect(d.size).toBe(0);
  });

  it("flags a photo URL reused across sellers (a copied listing)", () => {
    const d = findDuplicates([
      listing({ id: "a", images: ["https://cdn/x.jpg"] }),
      listing({ id: "b", sellerId: "s2", title: "other", images: ["https://cdn/x.jpg"] }),
    ]);
    expect(d.get("b")).toEqual(["a"]);
  });

  it("ignores sold / rejected / expired rows", () => {
    const d = findDuplicates([
      listing({ id: "a", title: "same" }),
      listing({ id: "b", title: "same", status: "sold" }),
      listing({ id: "c", title: "same", status: "rejected" }),
    ]);
    expect(d.size).toBe(0);
  });
});

describe("price signals", () => {
  const priced = (n: number, status = "active") =>
    Array.from({ length: n }, (_, i) =>
      listing({ id: `p${i}`, price: 100 + i, status, sellerId: `s${i}` }),
    );

  it("computes a median from approved (active/sold) priced rows only", () => {
    const stats = categoryPriceStats([
      ...priced(4),
      listing({ id: "x", price: 1, status: "pending" }),
      listing({ id: "y", price: null }),
      listing({ id: "z", price: 104, status: "sold" }),
    ]);
    expect(stats.get("bikes")).toEqual({ median: 102, samples: 5 });
  });

  it("stays silent until the category has enough samples", () => {
    const stats = categoryPriceStats(priced(MIN_PRICE_SAMPLES - 1));
    expect(priceSignal(1, stats.get("bikes"))).toBeNull();
  });

  it("flags far-below and far-above, and a missing price", () => {
    const stats = { median: 100, samples: 10 };
    expect(priceSignal(10, stats)).toBe("priceLow");
    expect(priceSignal(900, stats)).toBe("priceHigh");
    expect(priceSignal(60, stats)).toBeNull();
    expect(priceSignal(null, stats)).toBe("priceMissing");
    expect(priceSignal(0, stats)).toBe("priceMissing");
  });
});

describe("contact in text", () => {
  it.each([
    "call 03 123 456",
    "واتساب 70123456",
    "+961 3 123 456",
    "00961 71 234 567",
    "٠٣١٢٣٤٥٦ اتصل",
    "see wa.me/96170000000",
    "https://example.com/deal",
  ])("flags %s", (text) => {
    expect(hasContactInText(text)).toBe(true);
  });

  it.each(["iPhone 13 Pro 256GB", "سعر 150$ قابل للتفاوض", "model 2019, 120000 km", ""])(
    "does not flag %s",
    (text) => {
      expect(hasContactInText(text)).toBe(false);
    },
  );
});

describe("moderationSignals + queue", () => {
  it("collects every signal a listing carries", () => {
    const l = listing({
      id: "a",
      categoryId: null,
      images: [],
      price: null,
      description: "كلمني 76 123 456",
    });
    const s = moderationSignals(
      l,
      ctx({
        openReports: new Map([["a", 2]]),
        duplicates: new Map([["a", ["b"]]]),
        sellers: new Map([
          [
            "s1",
            {
              memberSince: "2026-09-24T00:00:00Z",
              isActive: false,
              listingsTotal: 5,
              listingsLive: 1,
              listingsRejected: 3,
              listingsRemoved: 0,
              reportsOpen: 2,
              reportsTotal: 2,
            },
          ],
        ]),
      }),
    );
    expect(s).toEqual(
      expect.arrayContaining([
        "reported",
        "duplicate",
        "priceMissing",
        "noCategory",
        "noImages",
        "contactInText",
        "sellerSuspended",
        "sellerRejections",
        "newSeller",
      ]),
    );
  });

  it("without seller history (pre-0313) there are simply no seller signals", () => {
    const s = moderationSignals(listing({ id: "a" }), ctx());
    expect(s).toEqual([]);
  });

  it("queues every pending listing, and live ones only with a meaningful signal", () => {
    const q = buildQueue(
      [
        listing({ id: "pending", status: "pending" }),
        listing({ id: "clean", status: "active" }),
        listing({ id: "nophoto", status: "active", images: [], price: null }),
        listing({ id: "reported", status: "active" }),
        listing({ id: "sold", status: "sold" }),
      ],
      ctx({ openReports: new Map([["reported", 1]]) }),
    );
    expect(q.map((i) => i.listing.id).sort()).toEqual(["pending", "reported"]);
  });

  it("orders by priority: reports and more reports first", () => {
    const q = buildQueue(
      [
        listing({ id: "pending", status: "pending" }),
        listing({ id: "once", status: "active" }),
        listing({ id: "thrice", status: "active" }),
      ],
      ctx({ openReports: new Map([["once", 1], ["thrice", 3]]) }),
    );
    expect(q.map((i) => i.listing.id)).toEqual(["thrice", "once", "pending"]);
    expect(priorityScore([], "pending")).toBeGreaterThan(priorityScore([], "active"));
  });

  it("never proposes an action — the queue only orders", () => {
    const q = buildQueue([listing({ id: "a", status: "pending" })], ctx());
    expect(Object.keys(q[0]).sort()).toEqual(
      ["duplicateOf", "listing", "reports", "score", "signals"].sort(),
    );
  });
});

describe("expiry + reasons", () => {
  it("counts down the 60-day window the nightly sweep enforces", () => {
    expect(LISTING_LIFETIME_DAYS).toBe(60);
    expect(daysUntilExpiry("2026-09-25T00:00:00Z", NOW)).toBe(60);
    expect(daysUntilExpiry("2026-08-01T00:00:00Z", NOW)).toBe(5);
    expect(daysUntilExpiry("2026-01-01T00:00:00Z", NOW)).toBe(0);
  });

  it("reject reasons are a closed set the dictionary covers", async () => {
    const ar = (await import("@/i18n/dictionaries/ar.json")).default as {
      moderation: { rejectReasons: Record<string, string>; signals: Record<string, string> };
    };
    const en = (await import("@/i18n/dictionaries/en.json")).default as typeof ar;
    for (const k of REJECT_REASONS) {
      expect(isRejectReason(k)).toBe(true);
      expect(ar.moderation.rejectReasons[k]).toBeTruthy();
      expect(en.moderation.rejectReasons[k]).toBeTruthy();
    }
    expect(isRejectReason("delete it")).toBe(false);
    for (const k of Object.keys(ar.moderation.signals)) {
      expect(en.moderation.signals[k]).toBeTruthy();
    }
  });
});
