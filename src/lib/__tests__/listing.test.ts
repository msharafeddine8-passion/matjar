import { describe, expect, it } from "vitest";
import {
  directionsHref,
  directoryPageIndexable,
  isOpenStreetMapSource,
  resolveListing,
  safeSourceUrl,
} from "@/lib/listing";
import { resolveSectorCard, withoutTransactionFacts } from "@/lib/card-facts";
import { resolveBusinessProfile, type ProfileFacts } from "@/lib/profile-engine";
import { resolveOffering } from "@/lib/offering";
import { resolveStoreExperience } from "@/lib/store-experience";
import { resolveStoreModules } from "@/lib/sectors";
import { buildStoreMetadata, NOINDEX_FOLLOW } from "@/lib/seo-rules";
import { validateStorePublic } from "@/lib/data-quality";
import type { CategoryKey } from "@/lib/catalog";

describe("resolveListing", () => {
  it("owner_id decides unclaimed, and unclaimed implies showcase", () => {
    expect(resolveListing({ ownerId: null })).toEqual({
      unclaimed: true,
      showcase: true,
      listingMode: "showcase",
    });
    expect(resolveListing({ ownerId: null, listingMode: "full" }).showcase).toBe(true);
  });

  it("an owned store is full unless it chose otherwise, even if the read failed", () => {
    // listingMode undefined is what a refused column read looks like.
    expect(resolveListing({ ownerId: "u" }).listingMode).toBe("full");
    expect(resolveListing({ ownerId: "u", listingMode: "full" }).showcase).toBe(false);
    expect(resolveListing({ ownerId: "u", listingMode: "showcase" })).toEqual({
      unclaimed: false,
      showcase: true,
      listingMode: "showcase",
    });
  });
});

describe("directory page quality gate", () => {
  it("a way to reach or find the business makes it indexable; a name alone does not", () => {
    expect(directoryPageIndexable({})).toBe(false);
    expect(directoryPageIndexable({ phone: "  " })).toBe(false);
    for (const f of ["phone", "whatsapp", "website", "address"] as const) {
      expect(directoryPageIndexable({ [f]: "x" })).toBe(true);
    }
  });

  it("buildStoreMetadata: thin unclaimed is noindex, thick unclaimed is not, owned untouched", () => {
    const base = { name: "Shop", isReal: true, unclaimed: true };
    const thin = buildStoreMetadata({ lang: "ar", id: "u", store: base });
    expect(thin.robots).toEqual(NOINDEX_FOLLOW);
    const thick = buildStoreMetadata({
      lang: "ar",
      id: "u",
      store: { ...base, phone: "01 234567" },
    });
    expect(thick.robots).toBeUndefined();
    const owned = buildStoreMetadata({
      lang: "ar",
      id: "u",
      store: { name: "Shop", isReal: true },
    });
    expect(owned.robots).toBeUndefined();
  });

  it("an unclaimed page never promises it can be ordered from", () => {
    for (const lang of ["ar", "en"] as const) {
      const m = buildStoreMetadata({
        lang,
        id: "u",
        store: { name: "Shop", isReal: true, unclaimed: true },
      });
      expect(String(m.description)).not.toMatch(/اطلب|order/i);
    }
  });
});

describe("source links", () => {
  it("recognises OpenStreetMap by name or by URL", () => {
    expect(isOpenStreetMapSource("openstreetmap", null)).toBe(true);
    expect(isOpenStreetMapSource("osm", null)).toBe(true);
    expect(isOpenStreetMapSource(null, "https://www.openstreetmap.org/node/1")).toBe(true);
    expect(isOpenStreetMapSource("google", "https://example.com")).toBe(false);
  });

  it("only ever links out over http(s)", () => {
    expect(safeSourceUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl(null)).toBeNull();
  });

  it("directions need both coordinates; zero is a coordinate", () => {
    expect(directionsHref(33.8, 35.5)).toContain("destination=33.8,35.5");
    expect(directionsHref(0, 0)).toContain("destination=0,0");
    expect(directionsHref(33.8, null)).toBeNull();
  });
});

describe("discovery cards", () => {
  // The fulfilment columns default to TRUE, so an import carries them on.
  const row = {
    acceptsDelivery: true,
    acceptsPickup: true,
    minOrder: 5,
    prepTime: "20",
    deliveryFeeMin: 1,
    deliveryFeeMax: 2,
    ratingAvg: 4.5,
    ratingCount: 3,
    catalogCount: 4,
  };

  it("a showcase card keeps its rating and catalogue, drops every delivery chip", () => {
    const keys = resolveSectorCard("food", withoutTransactionFacts(row, false)).map((f) => f.key);
    expect(keys).toContain("rating");
    expect(keys).not.toContain("fulfilment");
  });

  it("an unclaimed card shows no rating at all", () => {
    const keys = resolveSectorCard("food", withoutTransactionFacts(row, true)).map((f) => f.key);
    expect(keys).not.toContain("rating");
    expect(keys).not.toContain("fulfilment");
  });
});

describe("data quality on a directory row", () => {
  const input = { name: "Real Shop", category: "retail", area: "Tripoli" };
  it("a missing phone blocks an owned store but only flags a directory row", () => {
    expect(validateStorePublic(input, { sector: "retail" }).level).toBe("blocked");
    expect(validateStorePublic(input, { sector: "retail", directory: true }).level).toBe("incomplete");
  });
  it("a placeholder name still blocks a directory row", () => {
    expect(
      validateStorePublic({ ...input, name: "test" }, { sector: "retail", directory: true }).level,
    ).toBe("blocked");
  });
});

describe("offering on a showcase store", () => {
  it("every row's action is contact, with no basket and no stock badge", () => {
    for (const itemKind of ["product", "service"] as const) {
      const o = resolveOffering({ category: "retail", itemKind, showcase: true });
      expect(o.cta).toBe("contactStore");
      expect(o.transacts).toBe(false);
      expect(o.addableToCart).toBe(false);
      expect(o.showsStock).toBe(false);
      expect(o.showsQuantity).toBe(false);
    }
  });
});

describe("profile engine", () => {
  function facts(
    category: CategoryKey,
    args: { listingMode?: "showcase"; unclaimed?: boolean },
    over: Partial<ProfileFacts> = {},
  ): ProfileFacts {
    const enabledModules = resolveStoreModules(category);
    return {
      isReal: true,
      enabledModules,
      experience: resolveStoreExperience({ category, enabledModules, ...args }),
      hasAnnouncement: false,
      goods: 3,
      services: 2,
      checkoutAvailable: false,
      goodsTransact: true,
      branches: 0,
      mapPins: 0,
      hasWeekHours: false,
      fulfilment: {
        acceptsDelivery: true,
        acceptsPickup: true,
        minOrder: 0,
        hasPrepTime: false,
        hasPaymentNote: false,
        zones: 0,
        couriers: 0,
      },
      rentalVehicles: 0,
      ticketTypes: 0,
      resources: 0,
      membershipPlans: 0,
      classes: 0,
      courses: 0,
      portfolio: 0,
      healthcare: {
        hasSpecialties: false,
        hasInsurance: false,
        cancelHours: 0,
        pricedServices: 0,
        timedServices: 0,
      },
      doctors: 0,
      verifications: 0,
      reviews: { listed: 0, viewerCanReview: false },
      summaryRows: 0,
      loyaltyRegistered: true,
      hasContactNumber: true,
      ...over,
    };
  }

  it("a showcase store's sticky action is contact, on every kind of sector", () => {
    for (const category of ["food", "retail", "healthcare", "beauty"] as CategoryKey[]) {
      const p = resolveBusinessProfile(category, facts(category, { listingMode: "showcase" }));
      expect(p.transacts).toBe(false);
      expect(p.primaryCta?.action).toBe("contactStore");
      expect(p.present.delivery).toBe(false);
      expect(p.present.reservations).toBe(false);
      expect(p.present.loyalty).toBe(false);
      expect(p.present.catalog).toBe(true); // prices still show
    }
  });

  it("an unclaimed store shows no reviews or documents, even if rows existed", () => {
    const p = resolveBusinessProfile(
      "retail",
      facts("retail", { unclaimed: true }, {
        reviews: { listed: 4, viewerCanReview: true },
        verifications: 2,
      }),
    );
    expect(p.present.reviews).toBe(false);
    expect(p.present.verifications).toBe(false);
    expect(p.present.serviceRequest).toBe(false);
    expect(p.present.leadForm).toBe(false);
  });

  it("no number means no sticky action at all on an unclaimed page", () => {
    const p = resolveBusinessProfile(
      "retail",
      facts("retail", { unclaimed: true }, { goods: 0, services: 0, hasContactNumber: false }),
    );
    expect(p.primaryCta).toBeNull();
  });
});
