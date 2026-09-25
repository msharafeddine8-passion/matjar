import { describe, it, expect } from "vitest";
import { categoryKeys, categoryGroup, type CategoryKey } from "@/lib/catalog";
import {
  DEFAULT_QUERY,
  EMPTY_COVERAGE,
  EMPTY_SECTOR_COUNTS,
  activeFilterCount,
  scopedCounts,
  type SectorCounts,
  catalogNoun,
  clearedQuery,
  discoveryHref,
  discoveryParams,
  facetIsUseful,
  facetOptions,
  filterAvailability,
  groupBySector,
  groupOptions,
  isDefaultQuery,
  parseDiscoveryQuery,
  regionOptions,
  resolveCardFacts,
  resolveFilters,
  resolveSearchFields,
  scopeSectors,
  sectorDiscovery,
  sectorOptions,
  siblingSectors,
  withQuery,
  type DiscoveryCoverage,
  type DiscoveryQuery,
} from "@/lib/discovery";

// Matjar's live inventory on the day this was written, counted off the
// production database rather than imagined. Thirteen active stores, all of them
// in the north, spread across five of seventeen sectors; nobody verified, nobody
// commercially registered, one store with a discount, two with a review.
//
// It is here as a fixture because this is the shape the emptiness rule was
// written against: almost every control a marketplace normally offers is, at
// this inventory, a button that returns nothing. The assertions below are the
// spec for what the buyer is allowed to see.
const LIVE: DiscoveryCoverage = {
  total: 13,
  bySector: { retail: 7, healthcare: 2, services: 2, food: 1, professional: 1 },
  byGroup: { shopping: 7, health: 2, services: 3, food: 1 },
  byRegion: { north: 13 },
  withHours: 11,
  withCatalog: 10,
  withOffers: 1,
  rated: 2,
  verified: 0,
  registered: 0,
  withDescription: 13,
  withSpecialties: 0,
  withProviders: 0,
  withSections: 3,
  // Every store still carries the column defaults (delivery AND pickup on);
  // the two clinics are the stores with a priced service.
  withDelivery: 13,
  withPickup: 13,
  withPricedServices: 2,
};

/** A marketplace that has filled out — used to prove the suppressions above are
 *  data-driven and not hardcoded pessimism. */
const GROWN: DiscoveryCoverage = {
  total: 400,
  bySector: Object.fromEntries(categoryKeys.map((c) => [c, 20])),
  byGroup: { shopping: 60, health: 80, services: 60, food: 40, sports: 40, bookings: 40, realEstate: 20, automotive: 20, education: 20 },
  byRegion: { beirut: 120, mountLebanon: 100, north: 80, south: 60, bekaa: 40 },
  withHours: 380,
  withCatalog: 300,
  withOffers: 90,
  rated: 250,
  verified: 140,
  registered: 60,
  withDescription: 390,
  withSpecialties: 70,
  withProviders: 55,
  withSections: 120,
  withDelivery: 200,
  withPickup: 150,
  withPricedServices: 90,
};

describe("a filter is only offered when the data can back it", () => {
  it("suppresses every filter nothing backs", () => {
    // Nobody is verified and nobody is commercially registered, so both toggles
    // can only ever empty the screen.
    expect(filterAvailability("verified", LIVE)).toBe("empty");
    expect(filterAvailability("registered", LIVE)).toBe("empty");
  });

  it("suppresses a filter that everything passes, for the opposite reason", () => {
    // A control that narrows nothing is a control that appears broken. If every
    // store had a catalogue, "has items listed" would be a page reload.
    const all = { ...LIVE, withCatalog: LIVE.total };
    expect(filterAvailability("hasCatalog", all)).toBe("universal");
    // Ten of thirteen: it genuinely separates them.
    expect(filterAvailability("hasCatalog", LIVE)).toBe("offer");
  });

  it("keeps a request-dependent filter on data coverage, not on a snapshot", () => {
    // Eleven stores publish hours. How many are OPEN depends on the hour, so
    // "some but not all" is unknowable here — a control that vanished at night
    // and returned in the morning would be worse than one that sometimes finds
    // nothing. It stands on whether opening hours exist at all.
    expect(filterAvailability("openNow", LIVE)).toBe("offer");
    expect(filterAvailability("openNow", { ...LIVE, withHours: 13 })).toBe("offer");
    expect(filterAvailability("openNow", { ...LIVE, withHours: 0 })).toBe("empty");
  });

  it("offers nothing at all on an empty marketplace", () => {
    expect(resolveFilters(null, EMPTY_COVERAGE)).toEqual([]);
    expect(sectorOptions(EMPTY_COVERAGE)).toEqual([]);
  });
});

describe("facets need a real choice, not a label", () => {
  it("drops options with no store behind them", () => {
    expect(sectorOptions(LIVE).map((o) => o.key)).toEqual([
      "food",
      "retail",
      "services",
      "healthcare",
      "professional",
    ]);
    // The twelve empty sectors never reach the buyer.
    expect(sectorOptions(LIVE)).toHaveLength(5);
  });

  it("hides a facet whose options collapse to one", () => {
    // Every store is in the north. Five region chips of which four are dead ends
    // is the single loudest "this site is broken" signal available; one chip that
    // selects everything is merely pointless.
    expect(regionOptions(LIVE).map((o) => o.key)).toEqual(["north"]);
    expect(facetIsUseful(regionOptions(LIVE))).toBe(false);
    expect(resolveFilters(null, LIVE)).not.toContain("region");

    // The same code offers it the moment a second region has a store.
    expect(facetIsUseful(regionOptions(GROWN))).toBe(true);
    expect(resolveFilters(null, GROWN)).toContain("region");
  });

  it("counts each option so the UI never has to guess", () => {
    expect(facetOptions({ a: 3, b: 0, c: 1 }, ["a", "b", "c"] as const)).toEqual([
      { key: "a", count: 3 },
      { key: "c", count: 1 },
    ]);
  });

  it("keeps the group facet while four groups have stores", () => {
    expect(groupOptions(LIVE).map((o) => o.key)).toEqual([
      "shopping",
      "food",
      "services",
      "health",
    ]);
    expect(resolveFilters(null, LIVE)).toContain("group");
  });
});

describe("resolveFilters — intent intersected with live data", () => {
  it("renders exactly the filters Matjar can honour today", () => {
    // The whole point, stated as a single expectation: at this inventory the
    // buyer is offered group, sector, open-now, offers, catalogue, priced
    // services and rated — and nothing else. Region, verified and registered
    // are suppressed as empty; delivery and pickup as universal (every store
    // still has both switched on, so neither narrows anything).
    expect(resolveFilters(null, LIVE)).toEqual([
      "group",
      "sector",
      "openNow",
      "hasOffers",
      "hasCatalog",
      "hasPricedServices",
      "rated",
    ]);
  });

  it("never contributes a filter from a sector with no stores", () => {
    // realEstate asks for "registered" and nothing else does at this inventory.
    // It has zero stores, so that toggle must not appear on /explore.
    expect(sectorDiscovery.realEstate.filters).toContain("registered");
    expect(LIVE.bySector.realEstate ?? 0).toBe(0);
    expect(resolveFilters(null, LIVE)).not.toContain("registered");
  });

  it("scopes to the sectors that exist when asked for the whole marketplace", () => {
    expect(scopeSectors(null, LIVE)).toEqual([
      "food",
      "retail",
      "services",
      "healthcare",
      "professional",
    ]);
  });

  it("drops the sector and group facets on a page already pinned to a sector", () => {
    const pinned = resolveFilters(["retail"], LIVE);
    expect(pinned).not.toContain("sector");
    expect(pinned).not.toContain("group");
    expect(pinned).toContain("hasOffers");
  });

  it("gives a pinned sector only the filters that sector asked for", () => {
    // healthcare never asks for "has offers" — a clinic does not discount.
    expect(sectorDiscovery.healthcare.filters).not.toContain("hasOffers");
    expect(resolveFilters(["healthcare"], LIVE)).not.toContain("hasOffers");
    expect(resolveFilters(["retail"], LIVE)).toContain("hasOffers");
  });

  it("returns filters in one stable order regardless of scope", () => {
    for (const scope of [null, ["retail"], ["healthcare"], ["food", "retail"]] as (
      | CategoryKey[]
      | null
    )[]) {
      const got = resolveFilters(scope, GROWN);
      expect([...got].sort()).toEqual([...new Set(got)].sort());
      const order = resolveFilters(null, GROWN);
      const positions = got.map((k) => order.indexOf(k)).filter((i) => i >= 0);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("offers no filter at all on a sector with no merchant yet", () => {
    // /category/automotive exists — the grid links to it, somebody will follow
    // one — but it holds nothing. Every control on it, including "open now",
    // returns zero, so the page shows the empty state and no controls rather
    // than six buttons that all do the same nothing.
    expect(LIVE.bySector.automotive ?? 0).toBe(0);
    expect(resolveFilters(["automotive"], LIVE)).toEqual([]);
    // The same sector, once it has stores, gets its full set back.
    expect(resolveFilters(["automotive"], GROWN).length).toBeGreaterThan(0);
  });

  it("unlocks the suppressed filters as inventory arrives", () => {
    const grown = resolveFilters(null, GROWN);
    expect(grown).toContain("region");
    expect(grown).toContain("verified");
    expect(grown).toContain("registered");
  });
});

describe("search fields", () => {
  it("never searches a field no store has filled", () => {
    // No clinic has written a specialty and no practitioner rows exist, so
    // healthcare's two most sector-specific fields are silently unavailable —
    // matching them would be a permanent, invisible miss.
    expect(sectorDiscovery.healthcare.search).toContain("specialties");
    expect(sectorDiscovery.healthcare.search).toContain("providerName");
    const fields = resolveSearchFields(["healthcare"], LIVE);
    expect(fields).not.toContain("specialties");
    expect(fields).not.toContain("providerName");
    expect(fields).toEqual(["storeName", "storeDescription", "catalogItem"]);
  });

  it("keeps a field every store fills, unlike a filter", () => {
    // All thirteen have a description. As a FILTER that would be a no-op; as a
    // search field it still tells one store from another.
    expect(LIVE.withDescription).toBe(LIVE.total);
    expect(resolveSearchFields(null, LIVE)).toContain("storeDescription");
  });

  it("searches sections only where a merchant has organised a catalogue", () => {
    expect(resolveSearchFields(["retail"], LIVE)).toContain("sectionName");
    expect(resolveSearchFields(["retail"], { ...LIVE, withSections: 0 })).not.toContain(
      "sectionName",
    );
  });

  it("always keeps the store name, even with nothing else to go on", () => {
    expect(resolveSearchFields(null, { ...EMPTY_COVERAGE, total: 1, bySector: { retail: 1 } })).toEqual([
      "storeName",
    ]);
  });
});

describe("sibling sectors on a category page", () => {
  it("links only to sectors that have a store", () => {
    // Shopping is retail + farm; farm is empty, so a retail page offers no
    // sideways link rather than a link to an empty page.
    expect(categoryGroup.farm).toBe("shopping");
    expect(siblingSectors("retail", LIVE)).toEqual([]);
    // Services and professional share a group and both have stores.
    expect(siblingSectors("services", LIVE)).toEqual(["professional"]);
    expect(siblingSectors("professional", LIVE)).toEqual(["services"]);
  });

  it("never links a sector to itself", () => {
    for (const c of categoryKeys) {
      expect(siblingSectors(c, GROWN)).not.toContain(c);
    }
  });
});

describe("result-card facts are per sector and never invented", () => {
  it("gives every sector a catalogue noun", () => {
    for (const c of categoryKeys) expect(catalogNoun(c)).toBeTruthy();
  });

  it("calls the same table by the name the sector uses", () => {
    expect(catalogNoun("retail")).toBe("products");
    expect(catalogNoun("food")).toBe("menu");
    expect(catalogNoun("healthcare")).toBe("services");
    expect(catalogNoun("hospitality")).toBe("units");
    expect(catalogNoun("education")).toBe("courses");
  });

  it("surfaces different decision fields for a clinic, a restaurant and a shop", () => {
    const clinic = resolveCardFacts("healthcare", {
      catalogCount: 3,
      providerCount: 4,
      hasOffers: true,
      sectionCount: 5,
    });
    const restaurant = resolveCardFacts("food", {
      catalogCount: 3,
      providerCount: 4,
      hasOffers: true,
      sectionCount: 5,
    });
    const shop = resolveCardFacts("retail", {
      catalogCount: 3,
      providerCount: 4,
      hasOffers: true,
      sectionCount: 5,
    });

    // A clinic leads with who works there and never advertises a discount.
    expect(clinic.map((f) => f.key)).toEqual(["providers", "catalog"]);
    // A restaurant leads with the offer, then the menu and its sections.
    expect(restaurant.map((f) => f.key)).toEqual(["offers", "catalog", "sections"]);
    expect(shop.map((f) => f.key)).toEqual(["offers", "catalog", "sections"]);
    // Same table, different word.
    expect(clinic.find((f) => f.key === "catalog")).toMatchObject({ noun: "services" });
    expect(restaurant.find((f) => f.key === "catalog")).toMatchObject({ noun: "menu" });
    expect(shop.find((f) => f.key === "catalog")).toMatchObject({ noun: "products" });
  });

  it("omits every field with no data behind it", () => {
    // The live case: no practitioner rows exist anywhere, so a clinic card shows
    // its services and nothing else.
    expect(resolveCardFacts("healthcare", { catalogCount: 3, providerCount: 0 })).toEqual([
      { key: "catalog", noun: "services", count: 3 },
    ]);
    expect(resolveCardFacts("retail", {})).toEqual([]);
    expect(
      resolveCardFacts("retail", {
        catalogCount: null,
        hasOffers: null,
        sectionCount: null,
      }),
    ).toEqual([]);
    // A zero is data, and the data says "nothing to show" — not "show a zero".
    expect(resolveCardFacts("retail", { catalogCount: 0 })).toEqual([]);
    expect(resolveCardFacts("retail", { hasOffers: false })).toEqual([]);
  });

  it("does not call a single unnamed group a set of sections", () => {
    expect(resolveCardFacts("retail", { sectionCount: 1 })).toEqual([]);
    expect(resolveCardFacts("retail", { sectionCount: 2 })).toEqual([
      { key: "sections", count: 2 },
    ]);
  });
});

describe("URL state — a filtered view has to be an address", () => {
  const sample: DiscoveryQuery = {
    q: "  قهوة  ",
    group: "shopping",
    sector: "retail",
    region: "north",
    openNow: true,
    hasCatalog: false,
    hasOffers: true,
    rated: false,
    verified: false,
    registered: false,
    delivers: false,
    pickup: false,
    hasPricedServices: false,
    sort: "topRated",
    page: 3,
  };

  it("round-trips every field through the query string", () => {
    const back = parseDiscoveryQuery(
      Object.fromEntries(discoveryParams(sample).entries()),
    );
    expect(back).toEqual({ ...sample, q: "قهوة" });
  });

  it("writes no parameter for a default, so one view has one URL", () => {
    expect(discoveryParams(DEFAULT_QUERY).toString()).toBe("");
    expect(discoveryHref("/ar/explore", DEFAULT_QUERY)).toBe("/ar/explore");
    // sort=recommended and page=1 are defaults and must never be serialised.
    expect(
      discoveryParams({ ...DEFAULT_QUERY, sort: "recommended", page: 1 }).toString(),
    ).toBe("");
  });

  it("reads a hand-written or hostile link without breaking", () => {
    const q = parseDiscoveryQuery({
      region: "narnia",
      sector: "'; drop table stores; --",
      group: ["shopping", "food"],
      open: "true",
      offers: "0",
      sort: "cheapest",
      page: "-4",
      q: ["hello"],
    });
    expect(q.region).toBeNull();
    expect(q.sector).toBeNull();
    // Repeated params take the first value rather than becoming an array.
    expect(q.group).toBe("shopping");
    expect(q.q).toBe("hello");
    expect(q.openNow).toBe(true);
    expect(q.hasOffers).toBe(false);
    expect(q.sort).toBe("recommended");
    expect(q.page).toBe(1);
  });

  it("reads an absent query string as the default view", () => {
    expect(parseDiscoveryQuery({})).toEqual(DEFAULT_QUERY);
  });

  it("caps a pasted search term instead of passing it to the database", () => {
    expect(parseDiscoveryQuery({ q: "x".repeat(5000) }).q).toHaveLength(100);
  });

  it("returns to page one whenever the filter changes", () => {
    const onPage4 = { ...DEFAULT_QUERY, page: 4 };
    expect(withQuery(onPage4, { region: "north" }).page).toBe(1);
    expect(withQuery(onPage4, { sort: "newest" }).page).toBe(1);
    // Paging itself is the one change that keeps the page.
    expect(withQuery(onPage4, { page: 5 }).page).toBe(5);
  });

  it("counts filters, not sort or pagination", () => {
    expect(activeFilterCount(DEFAULT_QUERY)).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_QUERY, sort: "newest", page: 9, q: "x" }),
    ).toBe(0);
    expect(activeFilterCount(sample)).toBe(5);
  });

  it("does not report a category page's own sector as a chosen filter", () => {
    // On /category/services the sector is the ROUTE, not something the buyer
    // picked, so the phone's filter button must not show a 1 beside it with a
    // "clear" link that ejects them from the page they asked for. The pages
    // build their links from a query with the pinned sector removed; this is
    // that same removal, stated as an expectation.
    const onCategoryPage = { ...DEFAULT_QUERY, sector: "services" as const };
    expect(activeFilterCount(onCategoryPage)).toBe(1);
    expect(activeFilterCount({ ...onCategoryPage, sector: null })).toBe(0);
  });

  it("clearing keeps the typed words, and the sector when the page is that sector", () => {
    const cleared = clearedQuery(sample);
    expect(cleared.q).toBe(sample.q);
    expect(cleared.sector).toBeNull();
    expect(cleared.region).toBeNull();
    expect(cleared.openNow).toBe(false);
    // A category page must not eject the buyer from the category.
    expect(clearedQuery(sample, { sector: true }).sector).toBe("retail");
  });
});

describe("browse blocks belong on the arrival screen and nowhere else", () => {
  it("recognises the untouched view", () => {
    expect(isDefaultQuery(DEFAULT_QUERY)).toBe(true);
    // Sort is not a narrowing: re-ordering the same set is still arrival.
    expect(isDefaultQuery({ ...DEFAULT_QUERY, sort: "newest" })).toBe(true);
    // Whitespace is not a question.
    expect(isDefaultQuery({ ...DEFAULT_QUERY, q: "   " })).toBe(true);
  });

  it("does not mistake somebody who has asked something for an arrival", () => {
    expect(isDefaultQuery({ ...DEFAULT_QUERY, q: "شاورما" })).toBe(false);
    expect(isDefaultQuery({ ...DEFAULT_QUERY, openNow: true })).toBe(false);
    expect(isDefaultQuery({ ...DEFAULT_QUERY, sector: "food" })).toBe(false);
    // Page two of anything is a continuation, not an arrival.
    expect(isDefaultQuery({ ...DEFAULT_QUERY, page: 2 })).toBe(false);
  });
});

describe("result headings are read off the results", () => {
  const rows = [
    { id: "a", category: "food" as CategoryKey },
    { id: "b", category: "retail" as CategoryKey },
    { id: "c", category: "food" as CategoryKey },
  ];

  it("gives every sector present exactly one group, in registry order", () => {
    const groups = groupBySector(rows);
    expect(groups.map((g) => g.sector)).toEqual(
      categoryKeys.filter((c) => c === "retail" || c === "food"),
    );
    expect(groups.find((g) => g.sector === "food")?.items).toHaveLength(2);
    expect(groups.find((g) => g.sector === "retail")?.items).toHaveLength(1);
  });

  it("never produces a heading with nothing under it", () => {
    // The whole point: fifteen of seventeen sectors return nothing for a given
    // search, and none of them may show up as an empty "مطاعم" heading.
    for (const g of groupBySector(rows))
      expect(g.items.length).toBeGreaterThan(0);
    expect(groupBySector([])).toEqual([]);
  });

  it("loses nothing", () => {
    expect(groupBySector(rows).reduce((n, g) => n + g.items.length, 0)).toBe(
      rows.length,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — data-backed fulfilment and price filters
// ---------------------------------------------------------------------------

/** Production on 2026-09-24, per sector: 17 active stores, every one still on
 *  the delivery/pickup column defaults, three with a priced service (the two
 *  clinics and one services store). Counted off the live database. */
const sc = (p: Partial<SectorCounts>): SectorCounts => ({
  ...EMPTY_SECTOR_COUNTS,
  ...p,
});
const PROD: DiscoveryCoverage = {
  ...EMPTY_COVERAGE,
  total: 17,
  bySector: { retail: 9, healthcare: 2, services: 3, food: 1, beauty: 1, professional: 1 },
  byGroup: { shopping: 9, health: 3, services: 4, food: 1 },
  byRegion: { north: 16 },
  withHours: 14,
  withCatalog: 11,
  withOffers: 1,
  rated: 2,
  withDescription: 17,
  withSections: 3,
  withDelivery: 17,
  withPickup: 17,
  withPricedServices: 3,
  bySectorCounts: {
    retail: sc({ total: 9, withHours: 8, withCatalog: 6, withOffers: 1, rated: 1, withDelivery: 9, withPickup: 9 }),
    healthcare: sc({ total: 2, withHours: 2, withCatalog: 2, rated: 1, withDelivery: 2, withPickup: 2, withPricedServices: 2 }),
    services: sc({ total: 3, withHours: 2, withCatalog: 1, withDelivery: 3, withPickup: 3, withPricedServices: 1 }),
    food: sc({ total: 1, withHours: 1, withCatalog: 1, withDelivery: 1, withPickup: 1 }),
    beauty: sc({ total: 1, withHours: 1, withCatalog: 1, withDelivery: 1, withPickup: 1 }),
    professional: sc({ total: 1, withDelivery: 1, withPickup: 1 }),
  },
};

describe("delivery and pickup filters stand on the store's own switches", () => {
  it("are hidden while every store still has both on — they would narrow nothing", () => {
    expect(filterAvailability("delivers", PROD)).toBe("universal");
    expect(filterAvailability("pickup", PROD)).toBe("universal");
    expect(resolveFilters(null, PROD)).not.toContain("delivers");
    expect(resolveFilters(["food"], PROD)).not.toContain("pickup");
  });

  it("appear the moment one store switches one off", () => {
    const one = {
      ...PROD,
      withPickup: 16,
      bySectorCounts: {
        ...PROD.bySectorCounts,
        retail: sc({ ...PROD.bySectorCounts!.retail, withPickup: 8 }),
      },
    };
    expect(filterAvailability("pickup", one)).toBe("offer");
    expect(resolveFilters(null, one)).toContain("pickup");
    expect(resolveFilters(["retail"], one)).toContain("pickup");
    // …but not on a sector whose own stores all still offer it.
    expect(resolveFilters(["food"], one)).not.toContain("pickup");
  });

  it("are empty, not offered, when nobody does it", () => {
    expect(filterAvailability("delivers", { ...PROD, withDelivery: 0 })).toBe("empty");
  });

  it("are only ever asked for by sectors that sell goods", () => {
    for (const s of ["retail", "farm", "pharmacy", "food"] as CategoryKey[]) {
      expect(sectorDiscovery[s].filters).toContain("delivers");
      expect(sectorDiscovery[s].filters).toContain("pickup");
    }
    for (const s of ["healthcare", "services", "beauty", "realEstate"] as CategoryKey[]) {
      expect(sectorDiscovery[s].filters).not.toContain("delivers");
      expect(sectorDiscovery[s].filters).not.toContain("pickup");
    }
  });
});

describe("the priced-services filter", () => {
  it("is offered marketplace-wide: 3 of 17 stores publish a service price", () => {
    expect(filterAvailability("hasPricedServices", PROD)).toBe("offer");
    expect(resolveFilters(null, PROD)).toContain("hasPricedServices");
  });

  it("is judged against the pinned sector's own stores, not the marketplace", () => {
    // Both clinics are priced: on the clinic page the chip would return the
    // same two stores — a reload, not a filter.
    expect(filterAvailability("hasPricedServices", PROD, ["healthcare"])).toBe("universal");
    expect(resolveFilters(["healthcare"], PROD)).not.toContain("hasPricedServices");
    // One of three services stores is priced: a real narrowing.
    expect(resolveFilters(["services"], PROD)).toContain("hasPricedServices");
    // The beauty store sells perfume, no services: the chip could only empty
    // the page.
    expect(filterAvailability("hasPricedServices", PROD, ["beauty"])).toBe("empty");
    expect(resolveFilters(["beauty"], PROD)).not.toContain("hasPricedServices");
  });

  it("is never asked for by goods or listing sectors", () => {
    for (const s of ["retail", "food", "farm", "pharmacy", "realEstate", "automotive"] as CategoryKey[])
      expect(sectorDiscovery[s].filters).not.toContain("hasPricedServices");
  });
});

describe("scoped counts", () => {
  it("fall back to the marketplace census without a per-sector breakdown", () => {
    expect(scopedCounts(["retail"], LIVE)).toBe(LIVE);
    expect(scopedCounts(null, PROD)).toBe(PROD);
  });

  it("sum only the sectors in scope", () => {
    const s = scopedCounts(["healthcare", "services"], PROD);
    expect(s.total).toBe(5);
    expect(s.withPricedServices).toBe(3);
    expect(s.withHours).toBe(4);
    // Facets are untouched — they are read from the marketplace-wide maps.
    expect(s.bySector).toBe(PROD.bySector);
  });

  it("scope an existing filter too: offers on retail is 1 of 9, still a partition", () => {
    expect(filterAvailability("hasOffers", PROD, ["retail"])).toBe("offer");
    expect(filterAvailability("hasOffers", PROD, ["food"])).toBe("empty");
  });
});

describe("the new filters in the URL", () => {
  it("parse from their short spellings", () => {
    const q = parseDiscoveryQuery({ delivery: "1", pickup: "true", priced: "1" });
    expect(q.delivers).toBe(true);
    expect(q.pickup).toBe(true);
    expect(q.hasPricedServices).toBe(true);
    expect(parseDiscoveryQuery({ delivery: "yes" }).delivers).toBe(false);
  });

  it("round-trip and count as filters", () => {
    const q = { ...DEFAULT_QUERY, delivers: true, hasPricedServices: true };
    expect(discoveryParams(q).toString()).toBe("delivery=1&priced=1");
    expect(parseDiscoveryQuery(Object.fromEntries(discoveryParams(q)))).toEqual(q);
    expect(activeFilterCount(q)).toBe(2);
    expect(isDefaultQuery(q)).toBe(false);
  });

  it("are cleared with everything else", () => {
    const cleared = clearedQuery({ ...DEFAULT_QUERY, pickup: true, hasPricedServices: true });
    expect(cleared.pickup).toBe(false);
    expect(cleared.hasPricedServices).toBe(false);
  });
});
