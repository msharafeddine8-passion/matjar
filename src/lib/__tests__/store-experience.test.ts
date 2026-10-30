import { describe, it, expect } from "vitest";
import {
  resolveStoreExperience,
  isDirectoryOnlySector,
  isOrderSurface,
  leadKinds,
} from "../store-experience";
import { sectorDefaultModules } from "../sectors";
import type { CategoryKey } from "../catalog";
import type { FeatureModuleKey } from "../modules-catalog";

// Resolve using a sector's own default module bundle (what a fresh store gets).
function resolveDefault(category: CategoryKey) {
  const enabledModules = new Set<FeatureModuleKey>(
    sectorDefaultModules(category),
  );
  return resolveStoreExperience({ category, enabledModules });
}

describe("resolveStoreExperience", () => {
  it("commerce sectors get the order surface", () => {
    for (const c of ["retail", "food", "pharmacy", "farm"] as CategoryKey[]) {
      const x = resolveDefault(c);
      expect(x.status).toBe("active");
      expect(x.itemSurface).toBe("order");
      expect(x.showBooking).toBe(false);
      expect(x.directoryOnly).toBe(false);
    }
  });

  it("appointment sectors surface the booking engine (fixes the drift)", () => {
    // These declare the `appointments` module but were previously excluded from
    // the hardcoded {services, healthcare, realEstate} gate.
    for (const c of [
      "healthcare",
      "beauty",
      "petCare",
      "professional",
    ] as CategoryKey[]) {
      const x = resolveDefault(c);
      expect(x.status).toBe("active");
      expect(x.showBooking).toBe(true);
      expect(x.itemSurface).toBe("appointment");
    }
  });

  it("request sectors surface the service-request form", () => {
    // These declare the `requests` module. contractors + professional
    // previously got NO public form (hardcoded to services/healthcare) — fixed.
    for (const c of [
      "services",
      "professional",
      "contractors",
    ] as CategoryKey[]) {
      expect(resolveDefault(c).showServiceRequest).toBe(true);
    }
    // healthcare declares `appointments`, not `requests` → it gets the
    // appointment engine, not the generic request form (was drift before).
    expect(resolveDefault("healthcare").showServiceRequest).toBe(false);
    expect(resolveDefault("healthcare").showBooking).toBe(true);
  });

  it("hospitality uses the stay engine, not directory-only or hourly", () => {
    const x = resolveDefault("hospitality");
    expect(x.showStay).toBe(true);
    expect(x.directoryOnly).toBe(false);
    expect(x.allowResourceBooking).toBe(false); // no hourly room booking
    expect(x.showBooking).toBe(false);
    expect(isDirectoryOnlySector("hospitality")).toBe(false);
    // other sectors don't show stay
    expect(resolveDefault("retail").showStay).toBe(false);
    expect(resolveDefault("realEstate").showStay).toBe(false);
  });

  it("directory-only sectors never expose a wrong transaction", () => {
    // Real estate still has no engine of its own: a viewing is a lead, and a
    // property is neither ordered nor booked by the hour.
    for (const c of ["realEstate"] as CategoryKey[]) {
      const x = resolveDefault(c);
      expect(x.status).toBe("directory_only");
      expect(x.directoryOnly).toBe(true);
      expect(x.itemSurface).toBe("catalog");
      expect(x.showBooking).toBe(false); // no clinic-style property booking
      expect(x.allowResourceBooking).toBe(false); // no hourly property booking
      expect(x.showTickets).toBe(false);
      expect(x.showRental).toBe(false);
    }
    expect(isDirectoryOnlySector("realEstate")).toBe(true);
    expect(isDirectoryOnlySector("retail")).toBe(false);
  });

  it("automotive left directory-only when the rental engine shipped (MJ-003)", () => {
    // The go-live decision, stated as an assertion rather than as a comment on
    // a Set. Automotive was held in directory-only mode because the only
    // transaction on offer was a cart and cash on delivery for a car. Migration
    // 0298 gave it a real one, so the hold came off.
    const x = resolveDefault("automotive");
    expect(x.status).toBe("active");
    expect(x.directoryOnly).toBe(false);
    expect(isDirectoryOnlySector("automotive")).toBe(false);
    expect(x.showRental).toBe(true);

    // …and the half that did NOT go live stayed shut. Renting a car is built;
    // SELLING one is not, so there is still no cart and buying is still a lead.
    expect(x.canOrderProducts).toBe(false);
    expect(isOrderSurface("automotive")).toBe(false);
    expect(x.itemSurface).toBe("catalog");
    expect(x.showLeadForm).toBe(true);
    // The rental engine is a DAY RANGE. It must not drag the hourly-slot
    // booker or the clinic calendar along with it.
    expect(x.allowResourceBooking).toBe(false);
    expect(x.showBooking).toBe(false);
    expect(x.showStay).toBe(false);
    expect(x.showTickets).toBe(false);
  });

  it("no other sector renders the rental engine", () => {
    // hospitality DECLARES the `rentals` module in its bundle and has never had
    // a rental surface — it takes dates through the stay engine. The bundle is
    // an intention; this resolver is what the page really draws.
    for (const c of [
      "hospitality",
      "retail",
      "realEstate",
      "sportsCourts",
      "events",
    ] as CategoryKey[]) {
      expect(resolveDefault(c).showRental, `${c} shows a rental`).toBe(false);
    }
  });

  it("events use the ticket engine, not directory-only or hourly slots", () => {
    const x = resolveDefault("events");
    expect(x.status).toBe("active");
    expect(x.showTickets).toBe(true);
    expect(x.directoryOnly).toBe(false);
    expect(x.itemSurface).toBe("catalog");
    expect(x.allowResourceBooking).toBe(false); // no hourly venue slots
    expect(x.showBooking).toBe(false);
    expect(isDirectoryOnlySector("events")).toBe(false);
    // other sectors don't show tickets
    expect(resolveDefault("retail").showTickets).toBe(false);
    expect(resolveDefault("hospitality").showTickets).toBe(false);
  });

  it("lead sectors surface the lead form with the right kinds", () => {
    for (const c of ["realEstate", "automotive"] as CategoryKey[]) {
      expect(resolveDefault(c).showLeadForm).toBe(true);
    }
    // non-lead sectors never show it
    for (const c of ["retail", "healthcare", "hospitality", "food"] as CategoryKey[]) {
      expect(resolveDefault(c).showLeadForm).toBe(false);
    }
    expect(leadKinds("realEstate")).toContain("viewing");
    expect(leadKinds("automotive")).toContain("test_drive");
    expect(leadKinds("retail")).toEqual(["contact"]);
  });

  it("automotive uses leads as its single inquiry channel (no service-request form)", () => {
    // Lead sectors consolidate to the lead form; the generic service-request
    // form is suppressed so car inquiries don't split across two inboxes. This
    // survived automotive leaving directory-only — the rental engine is a
    // transaction, not an inquiry channel, so it does not reopen the second
    // inbox.
    const x = resolveDefault("automotive");
    expect(x.showServiceRequest).toBe(false);
    expect(x.showLeadForm).toBe(true);
    // ...and the cart/order surface is gone.
    expect(isOrderSurface("automotive")).toBe(false);
  });

  it("sportsCourts stays active so hourly court booking still works", () => {
    const x = resolveDefault("sportsCourts");
    expect(x.status).toBe("active");
    expect(x.allowResourceBooking).toBe(true);
  });

  it("isOrderSurface is true only for non-directory commerce sectors", () => {
    expect(isOrderSurface("retail")).toBe(true);
    expect(isOrderSurface("food")).toBe(true);
    expect(isOrderSurface("automotive")).toBe(false); // directory-only
    expect(isOrderSurface("healthcare")).toBe(false); // booking kind
  });

  it("disabling the appointments module drops the booking surface", () => {
    const x = resolveStoreExperience({
      category: "beauty",
      enabledModules: new Set<FeatureModuleKey>(["catalog", "reviews"]),
    });
    expect(x.showBooking).toBe(false);
  });
});

describe("showcase and unclaimed stores (0338)", () => {
  const every: CategoryKey[] = [
    "retail", "food", "pharmacy", "farm", "healthcare", "beauty", "petCare",
    "professional", "services", "contractors", "fitness", "sportsCourts",
    "education", "events", "hospitality", "realEstate", "automotive",
  ];
  const modules = (c: CategoryKey) =>
    new Set<FeatureModuleKey>(sectorDefaultModules(c));

  it("a showcase store has no transaction surface in any sector", () => {
    for (const category of every) {
      const x = resolveStoreExperience({
        category,
        enabledModules: modules(category),
        listingMode: "showcase",
      });
      expect(x.showcase).toBe(true);
      expect(x.itemSurface).toBe("catalog");
      expect(x.showBooking).toBe(false);
      expect(x.canOrderProducts).toBe(false);
      expect(x.showStay).toBe(false);
      expect(x.showRental).toBe(false);
      expect(x.showTickets).toBe(false);
      expect(x.allowResourceBooking).toBe(false);
    }
  });

  it("an owned showcase keeps its enquiry channel, and only one of the two", () => {
    const realEstate = resolveStoreExperience({
      category: "realEstate",
      enabledModules: modules("realEstate"),
      listingMode: "showcase",
    });
    expect(realEstate.showLeadForm).toBe(true);
    expect(realEstate.showServiceRequest).toBe(false);
    const trade = resolveStoreExperience({
      category: "contractors",
      enabledModules: new Set<FeatureModuleKey>(["requests"]),
      listingMode: "showcase",
    });
    expect(trade.showServiceRequest).toBe(true);
    expect(trade.showLeadForm).toBe(false);
  });

  it("unclaimed implies showcase and drops every form that writes to the store", () => {
    for (const category of every) {
      const x = resolveStoreExperience({
        category,
        enabledModules: modules(category),
        unclaimed: true,
        listingMode: "full", // the row can only say showcase; the flag still wins
      });
      expect(x.unclaimed).toBe(true);
      expect(x.showcase).toBe(true);
      expect(x.itemSurface).toBe("catalog");
      expect(x.showServiceRequest).toBe(false);
      expect(x.showLeadForm).toBe(false);
    }
  });

  it("the default is unchanged: omitted and 'full' resolve the same", () => {
    for (const category of every) {
      const enabledModules = modules(category);
      const base = resolveStoreExperience({ category, enabledModules });
      expect(base.showcase).toBe(false);
      expect(base.unclaimed).toBe(false);
      expect(
        resolveStoreExperience({ category, enabledModules, listingMode: "full" }),
      ).toEqual(base);
    }
  });
});
