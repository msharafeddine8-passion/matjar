import { describe, it, expect } from "vitest";
import { categoryKeys, type CategoryKey } from "@/lib/catalog";
import {
  CARD_VARIANT,
  SLOT_FACTS,
  cardVariant,
  resolveSectorCard,
  storeCardSource,
  storeRowCardSource,
  type SectorCardFact,
  type SectorCardSource,
} from "@/lib/card-facts";

const keys = (facts: SectorCardFact[]) => facts.map((f) => f.key);
const get = <K extends SectorCardFact["key"]>(
  facts: SectorCardFact[],
  key: K,
) => facts.find((f) => f.key === key) as Extract<SectorCardFact, { key: K }> | undefined;

/** Every signal present at once — the ceiling each sector's order is cut from. */
const FULL: SectorCardSource = {
  openNow: true,
  ratingAvg: 4.5,
  ratingCount: 12,
  acceptsDelivery: true,
  acceptsPickup: true,
  deliveryFeeMin: 2,
  deliveryFeeMax: 4,
  deliveryEtaMin: 30,
  deliveryEtaMax: 45,
  minOrder: 10,
  prepTime: "20 دقيقة",
  serviceCount: 3,
  serviceMinPrice: 30,
  itemMinPrice: 5,
  catalogCount: 8,
  hasOffers: true,
  providerCount: 2,
  sectionCount: 3,
  area: "طرابلس",
  region: "north",
  insurance: "AXA, Bupa",
};

describe("every sector has a card variant", () => {
  it("maps all seventeen sectors onto five variants", () => {
    for (const c of categoryKeys) expect(CARD_VARIANT[c]).toBeTruthy();
    expect(new Set(Object.values(CARD_VARIANT)).size).toBe(5);
    expect(cardVariant("food")).toBe("food");
    expect(cardVariant("retail")).toBe("goods");
    expect(cardVariant("healthcare")).toBe("clinic");
    expect(cardVariant("beauty")).toBe("service");
    expect(cardVariant("realEstate")).toBe("listing");
    expect(cardVariant("automotive")).toBe("listing");
  });
});

describe("each sector reads its own decision fields, in its own order", () => {
  it("food leads with fulfilment and speed", () => {
    expect(keys(resolveSectorCard("food", FULL))).toEqual([
      "open",
      "rating",
      "location",
      "fulfilment",
      "deliveryEta",
      "deliveryFee",
      "prepTime",
      "minOrder",
      "offers",
      "catalog",
      "sections",
    ]);
  });

  it("retail leads with fulfilment, then fees, then range", () => {
    expect(keys(resolveSectorCard("retail", FULL))).toEqual([
      "open",
      "rating",
      "location",
      "fulfilment",
      "deliveryFee",
      "deliveryEta",
      "minOrder",
      "offers",
      "catalog",
      "sections",
    ]);
  });

  it("a clinic leads with where, then the visit price — never a delivery line", () => {
    const f = resolveSectorCard("healthcare", FULL);
    expect(keys(f)).toEqual([
      "open",
      "rating",
      "location",
      "startingPrice",
      "serviceCount",
      "providers",
      "insurance",
    ]);
    expect(keys(f)).not.toContain("fulfilment");
    expect(keys(f)).not.toContain("offers");
  });

  it("a services store says «starts from $X · N services»", () => {
    const f = resolveSectorCard("beauty", FULL);
    expect(keys(f)).toEqual([
      "open",
      "rating",
      "location",
      "startingPrice",
      "serviceCount",
      "providers",
      "offers",
    ]);
    expect(get(f, "startingPrice")).toEqual({ key: "startingPrice", amount: 30 });
    expect(get(f, "serviceCount")).toEqual({ key: "serviceCount", count: 3 });
  });

  it("a listing shows its count and entry price from any priced row", () => {
    const f = resolveSectorCard("realEstate", FULL);
    // Property never advertises "offers" — lib/discovery.ts CARD_FACTS is the
    // one source for the catalogue facts, and a flat is not on sale-by-percent.
    expect(keys(f)).toEqual([
      "open",
      "rating",
      "location",
      "catalog",
      "startingPrice",
    ]);
    expect(keys(resolveSectorCard("automotive", FULL))).toEqual([
      "open",
      "rating",
      "location",
      "catalog",
      "startingPrice",
      "offers",
    ]);
    // Listings price from the cheapest row of any kind, not the service floor.
    expect(get(f, "startingPrice")).toEqual({ key: "startingPrice", amount: 5 });
    expect(get(f, "catalog")).toMatchObject({ noun: "listings", count: 8 });
  });

  it("slot facts are the three the card draws outside the facts line", () => {
    expect([...SLOT_FACTS].sort()).toEqual(["location", "open", "rating"]);
  });
});

describe("no fact without data — one case per fact", () => {
  const without = (patch: Partial<SectorCardSource>) => ({ ...FULL, ...patch });
  const has = (c: CategoryKey, s: SectorCardSource, k: SectorCardFact["key"]) =>
    keys(resolveSectorCard(c, s)).includes(k);

  it("open: nothing when hours are unknown", () => {
    expect(has("retail", without({ openNow: null }), "open")).toBe(false);
    expect(has("retail", without({ openNow: undefined }), "open")).toBe(false);
    // Closed IS data.
    expect(get(resolveSectorCard("retail", without({ openNow: false })), "open")).toEqual({
      key: "open",
      open: false,
    });
  });

  it("rating: nothing below one review or at a zero average", () => {
    expect(has("food", without({ ratingCount: 0 }), "rating")).toBe(false);
    expect(has("food", without({ ratingCount: null }), "rating")).toBe(false);
    expect(has("food", without({ ratingAvg: 0 }), "rating")).toBe(false);
    expect(has("food", without({ ratingAvg: null }), "rating")).toBe(false);
  });

  it("location: nothing when both area and region are blank", () => {
    expect(has("healthcare", without({ area: "   ", region: null }), "location")).toBe(false);
    // Region alone is enough — the card names the region.
    expect(get(resolveSectorCard("healthcare", without({ area: "" })), "location")).toEqual({
      key: "location",
      area: null,
      region: "north",
    });
  });

  it("fulfilment: nothing when neither switch is on, and only the true halves", () => {
    expect(
      has("retail", without({ acceptsDelivery: false, acceptsPickup: false }), "fulfilment"),
    ).toBe(false);
    expect(
      has("retail", without({ acceptsDelivery: null, acceptsPickup: null }), "fulfilment"),
    ).toBe(false);
    expect(
      get(resolveSectorCard("retail", without({ acceptsPickup: false })), "fulfilment"),
    ).toEqual({ key: "fulfilment", delivery: true, pickup: false });
  });

  it("deliveryFee: nothing without a zone, nor when the store does not deliver", () => {
    expect(
      has("food", without({ deliveryFeeMin: null, deliveryFeeMax: null }), "deliveryFee"),
    ).toBe(false);
    expect(has("food", without({ acceptsDelivery: false }), "deliveryFee")).toBe(false);
    // A zone priced at zero is a real, free delivery.
    expect(
      get(resolveSectorCard("food", without({ deliveryFeeMin: 0, deliveryFeeMax: 0 })), "deliveryFee"),
    ).toEqual({ key: "deliveryFee", min: 0, max: 0 });
  });

  it("deliveryEta: nothing without a zone ETA, nor when the store does not deliver", () => {
    expect(
      has("food", without({ deliveryEtaMin: null, deliveryEtaMax: null }), "deliveryEta"),
    ).toBe(false);
    expect(has("food", without({ deliveryEtaMin: 0, deliveryEtaMax: 0 }), "deliveryEta")).toBe(false);
    expect(has("food", without({ acceptsDelivery: false }), "deliveryEta")).toBe(false);
    // One end is still an honest single figure.
    expect(
      get(resolveSectorCard("food", without({ deliveryEtaMin: null })), "deliveryEta"),
    ).toEqual({ key: "deliveryEta", min: 45, max: 45 });
  });

  it("minOrder: nothing when unset or zero", () => {
    expect(has("retail", without({ minOrder: null }), "minOrder")).toBe(false);
    expect(has("retail", without({ minOrder: 0 }), "minOrder")).toBe(false);
  });

  it("prepTime: nothing when blank", () => {
    expect(has("food", without({ prepTime: null }), "prepTime")).toBe(false);
    expect(has("food", without({ prepTime: "  " }), "prepTime")).toBe(false);
  });

  it("startingPrice: nothing without a priced service — a product price is never a visit fee", () => {
    expect(has("healthcare", without({ serviceMinPrice: null }), "startingPrice")).toBe(false);
    expect(has("healthcare", without({ serviceMinPrice: 0 }), "startingPrice")).toBe(false);
    // itemMinPrice is set in FULL, and must not leak into a service card.
    expect(
      has("beauty", without({ serviceMinPrice: null, itemMinPrice: 7 }), "startingPrice"),
    ).toBe(false);
    expect(has("realEstate", without({ itemMinPrice: null }), "startingPrice")).toBe(false);
  });

  it("serviceCount: nothing at zero services — the catalogue count stands in", () => {
    const f = resolveSectorCard(
      "beauty",
      without({ serviceCount: 0, serviceMinPrice: null }),
    );
    expect(keys(f)).not.toContain("serviceCount");
    // The live perfume shop filed under beauty: its rows are goods, so they
    // are counted as products, not passed off as "8 services".
    expect(get(f, "catalog")).toMatchObject({ noun: "products", count: 8 });
    // Without the rollup (service count unknown) the sector's word stands.
    const unknown = resolveSectorCard("beauty", {
      catalogCount: 8,
      serviceCount: undefined,
    });
    expect(get(unknown, "catalog")).toMatchObject({ noun: "services" });
  });

  it("catalog: not repeated beside a service count on a services card", () => {
    expect(has("services", FULL, "catalog")).toBe(false);
    expect(has("services", without({ serviceCount: 0 }), "catalog")).toBe(true);
    expect(has("retail", without({ catalogCount: 0 }), "catalog")).toBe(false);
  });

  it("insurance: nothing when blank, and only on a clinic", () => {
    expect(has("healthcare", without({ insurance: null }), "insurance")).toBe(false);
    expect(has("healthcare", without({ insurance: " " }), "insurance")).toBe(false);
    expect(has("retail", FULL, "insurance")).toBe(false);
  });

  it("offers / providers / sections keep their existing rules", () => {
    expect(has("retail", without({ hasOffers: false }), "offers")).toBe(false);
    expect(has("healthcare", without({ providerCount: 0 }), "providers")).toBe(false);
    expect(has("retail", without({ sectionCount: 1 }), "sections")).toBe(false);
  });

  it("an empty source yields nothing at all, for every sector", () => {
    for (const c of categoryKeys) expect(resolveSectorCard(c, {})).toEqual([]);
  });
});

describe("what production shows today", () => {
  // Both clinics: 3 services each, from $30 / $50, hours published, no zones,
  // no insurance written, delivery/pickup on by default.
  it("a live clinic: place, visit price, service count — nothing invented", () => {
    const f = resolveSectorCard("healthcare", {
      openNow: true,
      ratingAvg: null,
      ratingCount: 0,
      acceptsDelivery: true,
      acceptsPickup: true,
      catalogCount: 3,
      serviceCount: 3,
      serviceMinPrice: 30,
      itemMinPrice: 30,
      area: "طرابلس اشارة الميتين",
      region: "north",
      insurance: null,
    });
    expect(keys(f)).toEqual(["open", "location", "startingPrice", "serviceCount"]);
  });

  it("a live grocery: fulfilment and range, no fee or time it never set", () => {
    const f = resolveSectorCard("retail", {
      openNow: false,
      acceptsDelivery: true,
      acceptsPickup: true,
      minOrder: null,
      prepTime: null,
      catalogCount: 11,
      area: "طرابلس",
      region: "north",
    });
    expect(keys(f)).toEqual(["open", "location", "fulfilment", "catalog"]);
  });
});

describe("source builders", () => {
  it("only turns isOpen into a fact when hours are known", () => {
    const base = {
      isOpen: true,
      rating: undefined,
      reviews: 0,
      area: { ar: "طرابلس", en: "Tripoli" },
      region: "north" as const,
    };
    expect(storeCardSource(base, "ar").openNow).toBeNull();
    expect(storeCardSource({ ...base, hoursKnown: false }, "ar").openNow).toBeNull();
    expect(storeCardSource({ ...base, hoursKnown: true }, "ar").openNow).toBe(true);
    expect(storeCardSource(base, "en").area).toBe("Tripoli");
  });

  it("reads the stores row without inventing defaults", () => {
    expect(storeRowCardSource({})).toEqual({
      acceptsDelivery: null,
      acceptsPickup: null,
      minOrder: null,
      prepTime: null,
      insurance: null,
    });
    // PostgREST returns numeric as a string.
    expect(storeRowCardSource({ min_order: "12.50" }).minOrder).toBe(12.5);
    expect(storeRowCardSource({ min_order: "" }).minOrder).toBeNull();
  });
});
