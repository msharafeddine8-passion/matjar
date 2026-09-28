import { describe, it, expect } from "vitest";
import type { CategoryKey } from "@/lib/catalog";
import { categoryKeys } from "@/lib/catalog";
import { resolveStoreModules, resolveProfileOrder, DEFAULT_PROFILE_ORDER } from "@/lib/sectors";
import { resolveStoreExperience } from "@/lib/store-experience";
import type { FeatureModuleKey } from "@/lib/modules-catalog";
import {
  bookingEnabled,
  orderingEnabled,
  profileKind,
  resolveBusinessProfile,
  resolveProfile,
  resolveProfileSummary,
  reviewVerification,
  sortReviews,
  summarizeReviews,
  SUMMARY_MIN_ROWS,
  type ProfileFacts,
  type ProfileReview,
  type SummaryFacts,
} from "@/lib/profile-engine";
import ar from "@/i18n/dictionaries/ar.json";
import en from "@/i18n/dictionaries/en.json";

// Facts for a store with NOTHING recorded beyond what a fresh sign-up has.
// Every test starts here and adds only the facts it is about, so a module that
// appears did so because of that fact and nothing else.
function facts(
  category: CategoryKey,
  over: Partial<ProfileFacts> = {},
  modules?: Partial<Record<FeatureModuleKey, boolean>>,
): ProfileFacts {
  const enabledModules = resolveStoreModules(category, modules);
  const experience = resolveStoreExperience({ category, enabledModules });
  return {
    isReal: true,
    enabledModules,
    experience,
    hasAnnouncement: false,
    goods: 0,
    services: 0,
    checkoutAvailable: true,
    goodsTransact: true,
    branches: 0,
    mapPins: 0,
    hasWeekHours: false,
    fulfilment: {
      acceptsDelivery: false,
      acceptsPickup: false,
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
    loyaltyRegistered: false,
    hasContactNumber: false,
    ...over,
  };
}

function summaryFacts(over: Partial<SummaryFacts> = {}): SummaryFacts {
  return {
    team: [],
    services: [],
    specialtiesText: null,
    insurance: null,
    openNow: null,
    today: null,
    area: null,
    branches: 0,
    signals: [],
    reviewCount: 0,
    rating: null,
    fulfilled: 0,
    verifiedDocuments: 0,
    present: {},
    ...over,
  };
}

describe("profile kinds (pilot sectors)", () => {
  it("maps the four pilots and leaves everything else generic", () => {
    expect(profileKind("retail")).toBe("retail");
    expect(profileKind("food")).toBe("restaurant");
    expect(profileKind("healthcare")).toBe("healthcare");
    expect(profileKind("services")).toBe("services");
    expect(profileKind("contractors")).toBe("services");
    expect(profileKind("hospitality")).toBe("generic");
  });

  it("never loses a module from the sector order (loyalty and summary included)", () => {
    for (const c of categoryKeys) {
      expect([...resolveProfileOrder(c)].sort()).toEqual([...DEFAULT_PROFILE_ORDER].sort());
    }
    expect(DEFAULT_PROFILE_ORDER).toContain("summary");
    expect(DEFAULT_PROFILE_ORDER).toContain("loyalty");
  });
});

describe("per-sector composition", () => {
  it("retail: catalogue straight after identity, then fulfilment, then reviews", () => {
    const p = resolveBusinessProfile(
      "retail",
      facts("retail", {
        goods: 3,
        fulfilment: { ...facts("retail").fulfilment, acceptsDelivery: true },
        mapPins: 1,
        hasWeekHours: true,
        reviews: { listed: 1, viewerCanReview: false },
      }),
    );
    expect(p.kind).toBe("retail");
    expect(p.modules).toEqual([
      "hero",
      "header",
      "catalog",
      "delivery",
      "reviews",
      "location",
      "hours",
    ]);
    expect(p.hasSummary).toBe(false);
  });

  it("restaurant: delivery terms, then the menu", () => {
    const p = resolveBusinessProfile(
      "food",
      facts("food", {
        goods: 3,
        fulfilment: { ...facts("food").fulfilment, acceptsPickup: true },
        hasWeekHours: true,
      }),
    );
    expect(p.modules.slice(0, 4)).toEqual(["hero", "header", "delivery", "catalog"]);
    // Food carries table reservations by default — a real engine, so present.
    expect(p.modules).toContain("reservations");
  });

  it("healthcare: summary, people, services, then the visit terms", () => {
    const f = facts("healthcare", {
      services: 3,
      doctors: 6,
      hasWeekHours: true,
      summaryRows: 4,
      healthcare: { ...facts("healthcare").healthcare, pricedServices: 3, timedServices: 3 },
      reviews: { listed: 1, viewerCanReview: false },
    });
    const p = resolveBusinessProfile("healthcare", f);
    expect(p.kind).toBe("healthcare");
    // healthcareInfo is absent: its only facts here (price-from, visit length)
    // are already in the summary and on every service row.
    expect(p.modules).toEqual([
      "hero",
      "header",
      "summary",
      "doctors",
      "catalog",
      "hours",
      "reviews",
    ]);
    // A fact the summary does not carry brings the visit-terms card back.
    const withCancel = resolveBusinessProfile("healthcare", {
      ...f,
      healthcare: { ...f.healthcare, cancelHours: 24 },
    });
    expect(withCancel.modules.indexOf("healthcareInfo")).toBe(
      withCancel.modules.indexOf("catalog") + 1,
    );
    // …and without a summary, price/duration alone still earn it.
    const noSummary = resolveBusinessProfile("healthcare", { ...f, summaryRows: 0 });
    expect(noSummary.present.healthcareInfo).toBe(true);
  });

  it("services: request form leads, portfolio and catalogue follow when they exist", () => {
    const p = resolveBusinessProfile(
      "services",
      facts("services", { portfolio: 4, services: 2, hasWeekHours: true }),
    );
    const i = (k: string) => p.modules.indexOf(k as never);
    expect(i("serviceRequest")).toBeGreaterThan(-1);
    expect(i("serviceRequest")).toBeLessThan(i("portfolio"));
    expect(i("portfolio")).toBeLessThan(i("catalog"));
  });
});

describe("empty modules are omitted, never drawn as placeholders", () => {
  it("a store with no catalogue gets no catalogue section (was: dashed «no products» box)", () => {
    for (const c of ["retail", "food", "healthcare", "services"] as CategoryKey[]) {
      const p = resolveBusinessProfile(c, facts(c));
      expect(p.present.catalog, c).toBe(false);
      expect(p.omitted, c).toContain("catalog");
    }
  });

  it("the demo catalogue still renders (it always has rows)", () => {
    expect(resolveBusinessProfile("retail", facts("retail", { isReal: false })).present.catalog).toBe(true);
  });

  it("reviews: omitted when there is nothing to read and the viewer cannot write one", () => {
    expect(resolveBusinessProfile("retail", facts("retail")).present.reviews).toBe(false);
    expect(
      resolveBusinessProfile(
        "retail",
        facts("retail", { reviews: { listed: 0, viewerCanReview: true } }),
      ).present.reviews,
    ).toBe(true);
    expect(
      resolveBusinessProfile(
        "retail",
        facts("retail", { reviews: { listed: 2, viewerCanReview: false } }),
      ).present.reviews,
    ).toBe(true);
  });

  it("reviews honour the store's own module switch", () => {
    const p = resolveBusinessProfile(
      "retail",
      facts("retail", { reviews: { listed: 2, viewerCanReview: false } }, { reviews: false }),
    );
    expect(p.present.reviews).toBe(false);
  });

  it("empty roster, portfolio, hours, map, verifications: all omitted", () => {
    const p = resolveBusinessProfile("healthcare", facts("healthcare"));
    for (const k of ["doctors", "portfolio", "hours", "location", "verifications", "healthcareInfo", "summary"] as const) {
      expect(p.present[k], k).toBe(false);
    }
  });

  it("the loyalty slot renders nothing until a component is registered", () => {
    expect(resolveBusinessProfile("retail", facts("retail")).present.loyalty).toBe(false);
    expect(
      resolveBusinessProfile("retail", facts("retail", { loyaltyRegistered: true })).present.loyalty,
    ).toBe(true);
    // …and never on a demo store.
    expect(
      resolveBusinessProfile("retail", facts("retail", { loyaltyRegistered: true, isReal: false }))
        .present.loyalty,
    ).toBe(false);
  });

  it("a single-row summary is not worth its space; two rows are", () => {
    expect(
      resolveBusinessProfile("healthcare", facts("healthcare", { summaryRows: 1 })).present.summary,
    ).toBe(false);
    expect(
      resolveBusinessProfile(
        "healthcare",
        facts("healthcare", { summaryRows: SUMMARY_MIN_ROWS }),
      ).present.summary,
    ).toBe(true);
    // Retail and restaurant never get one: their header already says it.
    expect(
      resolveBusinessProfile("retail", facts("retail", { summaryRows: 6 })).present.summary,
    ).toBe(false);
    expect(
      resolveBusinessProfile("food", facts("food", { summaryRows: 6 })).present.summary,
    ).toBe(false);
  });
});

describe("primary action — «اطلب الآن» only where ordering is actually enabled", () => {
  it("a restaurant with items, the orders module and a checkout says orderNow", () => {
    const f = facts("food", { goods: 3 });
    expect(orderingEnabled(f)).toBe(true);
    expect(resolveBusinessProfile("food", f).primaryCta).toEqual({
      action: "orderNow",
      targetId: "offerings",
      outbound: false,
    });
  });

  it("…and never when any link in the chain is missing", () => {
    const cases: [string, ProfileFacts][] = [
      ["no items", facts("food", { goods: 0, hasContactNumber: true })],
      // `delivery` depends on `orders`, so switching orders off means both.
      [
        "orders module off",
        facts("food", { goods: 3, hasContactNumber: true }, { orders: false, delivery: false }),
      ],
      ["no checkout", facts("food", { goods: 3, checkoutAvailable: false, hasContactNumber: true })],
      ["goods do not transact", facts("food", { goods: 3, goodsTransact: false, hasContactNumber: true })],
      ["demo store", facts("food", { goods: 3, isReal: false })],
    ];
    for (const [why, f] of cases) {
      const cta = resolveBusinessProfile("food", f).primaryCta;
      expect(cta?.action, why).not.toBe("orderNow");
    }
  });

  it("a shop says add-to-cart, not orderNow", () => {
    expect(resolveBusinessProfile("retail", facts("retail", { goods: 2 })).primaryCta?.action).toBe(
      "addToCart",
    );
  });

  it("a clinic books only when the engine has services in it", () => {
    expect(bookingEnabled(facts("healthcare", { services: 3 }))).toBe(true);
    expect(
      resolveBusinessProfile("healthcare", facts("healthcare", { services: 3 })).primaryCta?.action,
    ).toBe("bookAppointment");
    const none = resolveBusinessProfile("healthcare", facts("healthcare", { hasContactNumber: true }));
    expect(none.primaryCta).toEqual({ action: "contactStore", targetId: null, outbound: true });
  });

  it("a trade with no catalogue scrolls to its request form", () => {
    expect(resolveBusinessProfile("services", facts("services")).primaryCta).toEqual({
      action: "contactStore",
      targetId: "sec-serviceRequest",
      outbound: false,
    });
  });

  it("no engine, no form, no dialable number → no primary action at all", () => {
    expect(resolveBusinessProfile("retail", facts("retail")).primaryCta).toBeNull();
  });
});

describe("healthcare summary lists only facts that exist", () => {
  it("nothing recorded → no rows", () => {
    expect(resolveProfileSummary(summaryFacts())).toEqual([]);
  });

  it("no roster → no WHO row (the store name is not a doctor)", () => {
    const rows = resolveProfileSummary(
      summaryFacts({ services: [{ name: "كشفية", price: 0, minutes: null }] }),
    );
    expect(rows.map((r) => r.key)).toEqual(["what"]);
  });

  it("unpriced services → no HOW MUCH row, never $0", () => {
    const rows = resolveProfileSummary(
      summaryFacts({ services: [{ name: "A", price: 0, minutes: null }] }),
    );
    expect(rows.find((r) => r.key === "howMuch")).toBeUndefined();
  });

  it("no admin-reviewed signal, no review, no fulfilled order → no WHY TRUST row", () => {
    const rows = resolveProfileSummary(summaryFacts({ area: "طرابلس", openNow: true }));
    expect(rows.find((r) => r.key === "whyTrust")).toBeUndefined();
  });

  it("the Dennieh-shaped clinic: six rows' worth of facts, in order, links only to real sections", () => {
    const rows = resolveProfileSummary(
      summaryFacts({
        team: [
          { specialty: "نسائية" },
          { specialty: "عيون" },
          { specialty: "مسالك" },
          { specialty: "رئة" },
          { specialty: "جلد" },
          { specialty: null },
        ],
        services: [
          { name: "تحاليل", price: 50, minutes: 20 },
          { name: "ايكو", price: 60, minutes: 30 },
          { name: "أشعة", price: 90, minutes: 30 },
        ],
        openNow: false,
        today: { open: "09:00", close: "00:00" },
        area: "الضنية",
        reviewCount: 1,
        rating: 5,
        present: { doctors: true, catalog: true, hours: true, reviews: true },
      }),
    );
    expect(rows.map((r) => r.key)).toEqual(["who", "what", "when", "where", "howMuch", "whyTrust"]);
    const who = rows[0];
    if (who.key !== "who") throw new Error();
    expect(who.count).toBe(6);
    expect(who.specialties).toEqual(["نسائية", "عيون", "مسالك"]);
    expect(who.more).toBe(2);
    const what = rows[1];
    if (what.key !== "what") throw new Error();
    expect([what.minMinutes, what.maxMinutes]).toEqual([20, 30]);
    expect(what.targetId).toBe("offerings");
    const how = rows[4];
    if (how.key !== "howMuch") throw new Error();
    expect([how.min, how.max]).toEqual([50, 90]);
    // No map on the page → the WHERE row links nowhere rather than to a void.
    const where = rows[3];
    if (where.key !== "where") throw new Error();
    expect(where.targetId).toBeNull();
    const trust = rows[5];
    if (trust.key !== "whyTrust") throw new Error();
    expect(trust.signals).toEqual([]);
    expect(trust.rating).toBe(5);
  });

  it("a rating with no reviews behind it is not a trust fact", () => {
    const rows = resolveProfileSummary(summaryFacts({ rating: 5, reviewCount: 0 }));
    expect(rows).toEqual([]);
  });

  it("resolveProfile wires the rows into the module decision", () => {
    const rest: Omit<ProfileFacts, "summaryRows"> = facts("healthcare", {
      services: 3,
      hasWeekHours: true,
    });
    const { profile, summaryRows } = resolveProfile(
      "healthcare",
      rest,
      summaryFacts({
        services: [{ name: "A", price: 10, minutes: 15 }],
        openNow: true,
        today: { open: "09:00", close: "17:00" },
      }),
    );
    expect(summaryRows.map((r) => r.key)).toEqual(["what", "when", "howMuch"]);
    expect(profile.present.summary).toBe(true);
    // The WHEN row links to the hours section because it is present.
    expect(summaryRows.find((r) => r.key === "when")?.targetId).toBe("sec-hours");

    // Retail never computes one, whatever facts arrive.
    const shop = resolveProfile(
      "retail",
      facts("retail"),
      summaryFacts({ area: "x", openNow: true }),
    );
    expect(shop.summaryRows).toEqual([]);
    expect(shop.profile.present.summary).toBe(false);
  });
});

describe("Reviews 2.0 — verification labelling", () => {
  it("a store review is never labelled verified, whatever it claims", () => {
    expect(reviewVerification({ source: "store" })).toBe("unconfirmed");
    expect(reviewVerification({ source: "store", verified: true })).toBe("unconfirmed");
  });

  it("a product review is ordered-on-Matjar only when the derived flag is exactly true", () => {
    expect(reviewVerification({ source: "product", verified: true })).toBe("orderedOnMatjar");
    expect(reviewVerification({ source: "product", verified: false })).toBe("unconfirmed");
    expect(reviewVerification({ source: "product", verified: null })).toBe("unconfirmed");
    expect(reviewVerification({ source: "product" })).toBe("unconfirmed");
  });

  const r = (over: Partial<ProfileReview>): ProfileReview => ({
    id: "x",
    source: "store",
    rating: 5,
    comment: null,
    authorName: null,
    createdAt: null,
    reply: null,
    replyAt: null,
    subject: null,
    verification: "unconfirmed",
    ...over,
  });

  it("a mixed list is never summarised as all verified", () => {
    const list = [
      r({ id: "a", rating: 5 }),
      r({ id: "b", rating: 3 }),
      r({ id: "c", source: "product", verification: "orderedOnMatjar", rating: 4 }),
      r({ id: "d", source: "product", verification: "unconfirmed", rating: 2 }),
    ];
    const s = summarizeReviews(list);
    expect(s.storeCount).toBe(2);
    expect(s.storeAverage).toBe(4);
    expect(s.itemCount).toBe(2);
    expect(s.orderedCount).toBe(1);
    expect(s.orderedCount).toBeLessThan(list.length);
  });

  it("sorts newest first and puts undated reviews last", () => {
    const out = sortReviews([
      r({ id: "old", createdAt: "2026-07-22T12:06:48Z" }),
      r({ id: "none", createdAt: null }),
      r({ id: "new", createdAt: "2026-08-11T11:38:46Z" }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["new", "old", "none"]);
  });
});

describe("profile copy exists in both locales", () => {
  it("every key the engine's UI reads is present in ar and en", () => {
    const need = {
      cta: ["orderNow"],
      tabs: ["loyalty"],
      summary: ["title", "who", "what", "when", "where", "howMuch", "whyTrust", "teamCount", "servicesCount", "more", "duration", "today", "closedToday", "branches", "priceFrom", "priceRange", "insurance", "rating", "documents", "details"],
      reviews: ["summaryStore", "summaryItems", "storeReview", "about", "ordered", "orderedTitle", "legend", "firstReview", "stars", "anonymous"],
    } as const;
    for (const [locale, d] of Object.entries({ ar, en })) {
      const p = (d as unknown as { profile: Record<string, Record<string, string>> }).profile;
      for (const [group, keys] of Object.entries(need)) {
        for (const k of keys) {
          expect(p?.[group]?.[k], `${locale}.profile.${group}.${k}`).toBeTruthy();
        }
      }
    }
  });

  it("Arabic copy uses Western digits only", () => {
    const s = JSON.stringify((ar as unknown as { profile: unknown }).profile);
    expect(/[٠-٩]/.test(s)).toBe(false);
  });
});
