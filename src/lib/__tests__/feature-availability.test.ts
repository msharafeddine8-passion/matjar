import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { locales } from "@/i18n/config";
import { categoryKeys } from "@/lib/catalog";
import { ALL_MODULE_KEYS } from "@/lib/modules-catalog";
import { OS_MODULE_META, resolveStoreModules } from "@/lib/sectors";
import { resolveStoreExperience } from "@/lib/store-experience";
import { PLAN_ORDER, PLAN_TIERS } from "@/lib/plan-tiers";
import {
  ALL_FEATURE_IDS,
  CAPABILITIES,
  CAPABILITY_ORDER,
  FEATURES,
  OS_BAND,
  PLAN_HIGHLIGHTS,
  PRICING_MATRIX,
  ROADMAP,
  firstPlanColumn,
  isCapabilityLive,
  matrixCell,
  planHas,
  sectorCapabilities,
  type CapabilityKey,
  type FeatureId,
} from "@/lib/feature-availability";

// Marketing copy is the one part of the product nobody compiles. Every public
// page used to carry its own hand-written list of what Matjar offers, and the
// lists had quietly drifted apart from each other and from the code: bookings
// sold as a Pro upgrade while the bookings screen is open to everyone, profit
// analytics sold as Business while it unlocks at Pro, a "verified badge" ticked
// on all three tiers while /trust says it has never been awarded, and one row
// describing a product that does not exist in this repository.
//
// These tests are the compiler for that copy. Every list a page is allowed to
// render is declared in feature-availability.ts, and every one of them is
// checked here against the guards the merchant screens actually enforce.

// Every list a public surface may render, by the name a reader would recognise.
const RENDERED_AS_INCLUDED: Record<string, readonly FeatureId[]> = {
  "the /pricing comparison table": PRICING_MATRIX,
  "the Basic price card": PLAN_HIGHLIGHTS.basic,
  "the Pro price card": PLAN_HIGHLIGHTS.pro,
  "the Business price card": PLAN_HIGHLIGHTS.business,
  "the Business-OS band": OS_BAND,
};

describe("a page can only claim what the config marks live", () => {
  it("renders nothing as included unless it is live", () => {
    for (const [surface, ids] of Object.entries(RENDERED_AS_INCLUDED)) {
      for (const id of ids) {
        expect(
          FEATURES[id].state,
          `${surface} claims "${id}", which is "${FEATURES[id].state}" — a page may not present it as a working feature`,
        ).toBe("live");
      }
    }
  });

  it("keeps everything that is not live on the roadmap, and only there", () => {
    const notLive = ALL_FEATURE_IDS.filter((id) => FEATURES[id].state !== "live");
    expect([...ROADMAP].sort()).toEqual([...notLive].sort());
    for (const id of ROADMAP) {
      expect(FEATURES[id].state, `${id} is on the roadmap`).not.toBe("live");
    }
  });

  it("never lists the same feature twice on one surface", () => {
    for (const [surface, ids] of Object.entries(RENDERED_AS_INCLUDED)) {
      expect(new Set(ids).size, `${surface} repeats a row`).toBe(ids.length);
    }
  });
});

describe("a claimed plan is a plan the code enforces", () => {
  // The failure this prevents is the one that hurts a paying merchant most:
  // being sold a tier for a feature the next tier down already has, or paying
  // for a tier and finding the screen still locked. OS_MODULE_META.minPlan is
  // the value the merchant layout and every module screen gate on, so it is the
  // only defensible source for a price-page column.
  it("matches every feature's plan floor to the module's enforced minPlan", () => {
    for (const id of ALL_FEATURE_IDS) {
      const { osModule, plan } = FEATURES[id];
      if (!osModule) continue;
      const enforced = OS_MODULE_META[osModule].minPlan ?? "free";
      expect(
        plan,
        `"${id}" is sold from ${plan} but merchant/[storeId]/${OS_MODULE_META[osModule].path} is gated at ${enforced}`,
      ).toBe(enforced);
    }
  });

  it("matches every capability's plan floor to the same source", () => {
    for (const key of CAPABILITY_ORDER) {
      const { osModule, plan } = CAPABILITIES[key];
      if (!osModule) continue;
      expect(
        plan,
        `capability "${key}" claims ${plan} but its screen is gated at ${OS_MODULE_META[osModule].minPlan ?? "free"}`,
      ).toBe(OS_MODULE_META[osModule].minPlan ?? "free");
    }
  });

  it("never sells a bundle on better terms than the weakest thing in it", () => {
    // "Bookings" covers four scheduling capabilities. If one of them regresses
    // to `soon` or moves to a higher tier, the bundle claim has to move with it.
    const rank = { free: 0, basic: 1, pro: 2, business: 3 } as const;
    for (const id of ALL_FEATURE_IDS) {
      for (const cap of FEATURES[id].covers ?? []) {
        const capability = CAPABILITIES[cap];
        if (FEATURES[id].state === "live") {
          expect(
            capability.state,
            `"${id}" is live but covers "${cap}", which is ${capability.state}`,
          ).toBe("live");
        }
        expect(
          rank[FEATURES[id].plan],
          `"${id}" is sold from ${FEATURES[id].plan} but covers "${cap}", which needs ${capability.plan}`,
        ).toBeGreaterThanOrEqual(rank[capability.plan]);
      }
    }
  });

  it("puts each price-card bullet on the tier it actually belongs to", () => {
    for (const plan of PLAN_ORDER) {
      for (const id of PLAN_HIGHLIGHTS[plan]) {
        // Counts (products, staff) legitimately appear on all three cards
        // because the number differs per tier; everything else must be new.
        if (FEATURES[id].cell) continue;
        expect(
          firstPlanColumn(id),
          `the ${plan} card promises "${id}", which first appears on ${firstPlanColumn(id)}`,
        ).toBe(plan);
      }
    }
  });
});

describe("the plan matrix agrees with plan-tiers", () => {
  it("reads its counts out of PLAN_TIERS rather than restating them", () => {
    for (const plan of PLAN_ORDER) {
      expect(matrixCell("products", plan)).toEqual({
        kind: "count",
        value: PLAN_TIERS[plan].products,
      });
      expect(matrixCell("staffSeats", plan)).toEqual({
        kind: "count",
        value: PLAN_TIERS[plan].staff,
      });
    }
  });

  it("includes a feature on every tier above its floor and none below", () => {
    for (const id of PRICING_MATRIX) {
      if (FEATURES[id].cell) continue;
      let seenIncluded = false;
      for (const plan of PLAN_ORDER) {
        const included = planHas(plan, id);
        if (included) seenIncluded = true;
        // Once included, a feature can never disappear from a higher tier —
        // the defect that made a Business store lose the home-page placement
        // its Pro competitor had.
        else
          expect(
            seenIncluded,
            `"${id}" is included below ${plan} but excluded on it`,
          ).toBe(false);
        expect(matrixCell(id, plan).kind).toBe(included ? "included" : "excluded");
      }
      expect(seenIncluded, `"${id}" is on no plan at all`).toBe(true);
    }
  });

  it("gives every plan a support level and a zero commission", () => {
    for (const plan of PLAN_ORDER) {
      expect(matrixCell("commission", plan)).toEqual({ kind: "text", token: "zero" });
      expect(matrixCell("support", plan).kind).toBe("text");
    }
  });
});

describe("sector capabilities come from the registry, not from copy", () => {
  it("covers every sector and never claims a capability the storefront hides", () => {
    for (const category of categoryKeys) {
      const caps = sectorCapabilities(category);
      expect(caps.length, `${category} advertises nothing at all`).toBeGreaterThan(0);
      expect(new Set(caps).size, `${category} repeats a capability`).toBe(caps.length);
      for (const cap of caps) {
        expect(
          CAPABILITIES[cap].state,
          `${category} claims "${cap}", which is ${CAPABILITIES[cap].state}`,
        ).toBe("live");
      }
    }
  });

  it("never claims a capability outside the sector's own module bundle", () => {
    // The whole point of driving the page off sectors.ts: a claim has to come
    // from a module the sector is actually configured with (or from one of the
    // three engines the resolver switches on itself).
    const engines: CapabilityKey[] = ["leads", "stays", "tickets"];
    for (const category of categoryKeys) {
      const modules = resolveStoreModules(category);
      for (const cap of sectorCapabilities(category)) {
        if (engines.includes(cap)) continue;
        expect(
          modules.has(cap as never),
          `${category} claims "${cap}", which is not in its bundle`,
        ).toBe(true);
      }
    }
  });

  it("drops the four capabilities the experience resolver overrides", () => {
    // Each of these is declared by the sector's bundle in sectors.ts and then
    // switched off by store-experience.ts. Reading the bundle alone would put
    // all four on the merchant page as if a customer could use them.
    // Real estate no longer declares appointments at all (2026-09-29), so it
    // is out of both the bundle and the capabilities.
    expect(resolveStoreModules("realEstate").has("appointments")).toBe(false);
    expect(sectorCapabilities("realEstate")).not.toContain("appointments");

    expect(resolveStoreModules("automotive").has("requests")).toBe(true);
    expect(sectorCapabilities("automotive")).not.toContain("requests");

    expect(resolveStoreModules("hospitality").has("timeslot")).toBe(true);
    expect(sectorCapabilities("hospitality")).not.toContain("timeslot");

    expect(resolveStoreModules("events").has("timeslot")).toBe(true);
    expect(sectorCapabilities("events")).not.toContain("timeslot");
  });

  it("never sells a cart to a directory-only sector", () => {
    for (const category of categoryKeys) {
      const exp = resolveStoreExperience({
        category,
        enabledModules: resolveStoreModules(category),
      });
      if (!exp.directoryOnly) continue;
      for (const cap of ["orders", "delivery", "pos", "inventory"] as const) {
        expect(
          sectorCapabilities(category),
          `${category} is directory-only and cannot take an order`,
        ).not.toContain(cap);
      }
    }
  });

  it("gives the engine-backed sectors their engine", () => {
    expect(sectorCapabilities("hospitality")).toContain("stays");
    expect(sectorCapabilities("events")).toContain("tickets");
    expect(sectorCapabilities("realEstate")).toContain("leads");
    expect(sectorCapabilities("automotive")).toContain("leads");
  });

  it("states the specific thing each sector is chosen for, first", () => {
    // The complaint this page existed to answer was that it said nothing a
    // restaurant owner could recognise. These are the claims that make it
    // specific, asserted so a registry edit cannot quietly flatten them again.
    const has = (c: Parameters<typeof sectorCapabilities>[0], k: CapabilityKey) =>
      sectorCapabilities(c).includes(k);

    expect(has("food", "menu")).toBe(true);
    expect(has("food", "orders")).toBe(true);
    expect(has("food", "delivery")).toBe(true);
    expect(has("food", "reservations")).toBe(true);

    expect(has("healthcare", "appointments")).toBe(true);
    expect(has("healthcare", "team")).toBe(true);

    expect(has("retail", "catalog")).toBe(true);
    expect(has("retail", "orders")).toBe(true);
    expect(has("retail", "inventory")).toBe(true);

    expect(has("realEstate", "listings")).toBe(true);
    expect(has("realEstate", "leads")).toBe(true);

    expect(has("sportsCourts", "timeslot")).toBe(true);
    expect(has("fitness", "classes")).toBe(true);
    expect(has("education", "courses")).toBe(true);
    expect(has("contractors", "portfolio")).toBe(true);
  });

  it("advertises rentals only where the engine actually renders", () => {
    // This test used to read "never advertises rentals, which no sector can
    // render" — `rentals` was the one capability in the catalog with no code
    // behind it. MJ-003 built it (migration 0298), so the claim flipped. What
    // did NOT flip is the reason the old test existed: the capability is
    // declared by TWO sector bundles and implemented for ONE of them.
    // Hospitality lists `rentals` and takes its dates through the stay engine,
    // so reading the bundle would put a rental chip on every hotel page.
    expect(isCapabilityLive("rentals")).toBe(true);

    const renders = categoryKeys.filter((c) =>
      sectorCapabilities(c).includes("rentals"),
    );
    expect(renders).toEqual(["automotive"]);
    expect(sectorCapabilities("hospitality")).not.toContain("rentals");
  });
});

// The config only governs the pages that read it. The moment somebody drops a
// hand-written list of features back into a dictionary — which is exactly how
// every contradiction here got in — the pages can start claiming things again
// without a single test noticing. So the removed lists are named and kept out.
describe("the dictionaries hold no hand-written claim lists", () => {
  const dict = (locale: string) =>
    JSON.parse(
      readFileSync(join(process.cwd(), "src/i18n/dictionaries", `${locale}.json`), "utf8"),
    ) as Record<string, Record<string, unknown>>;

  // Path → what it used to assert that was wrong.
  const BANNED: Record<string, string> = {
    "pricing.matrix": "ticked a verified badge on all three tiers and sold a 'mobile store unit' that does not exist",
    "pricing.tiers.basic.features": "hand-written tier bullets",
    "pricing.tiers.pro.features": "sold bookings and category placement that Pro does not gate or grant",
    "pricing.tiers.business.features": "sold profit analytics as Business when it unlocks at Pro",
    "pricing.compareRows": "a stale free-vs-Pro table promising unlimited products and a verified Pro badge",
    "pricing.proFeatures": "same, in list form",
    "pricing.freeFeatures": "same, in list form",
    "pricing.yearlyNote": "a hardcoded $150 that plan-tiers is the source of",
    "os.pro.benefits": "the upgrade gate's benefit list — unlimited products, Business screens sold as Pro, a verified badge",
    "os.pro.perMonth": "a hardcoded $15 that contradicted PLAN_TIERS.pro",
    "os.pro.perYear": "a hardcoded $150 that contradicted PLAN_TIERS.pro",
    "businessOs.cards": "six untracked cards with a `soon` flag nobody maintained",
    "merchantsPage.sectors": "six sector names, hardcoded, while the registry has seventeen",
  };

  it("keeps every replaced list out of both locales", () => {
    for (const locale of locales) {
      const d = dict(locale);
      for (const [path, why] of Object.entries(BANNED)) {
        const value = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], d);
        expect(value, `${locale}.json still has ${path} — ${why}`).toBeUndefined();
      }
    }
  });

  it("labels every feature and capability the pages can render", () => {
    for (const locale of locales) {
      const d = dict(locale);
      const features = (d.pricing as { features: Record<string, string> }).features;
      const notes = (d.pricing as { featureNotes: Record<string, string> }).featureNotes;
      const modules = (
        (d.os as { modules: { labels: Record<string, string> } }).modules
      ).labels;

      // A feature with its own `copy` paths is labelled in its own namespace;
      // feature-availability-ssot.test.ts resolves those paths in both files.
      for (const id of ALL_FEATURE_IDS.filter((f) => !FEATURES[f].copy))
        expect(features[id], `${locale}.json has no label for feature "${id}"`).toBeTruthy();
      for (const key of CAPABILITY_ORDER)
        expect(modules[key], `${locale}.json has no label for capability "${key}"`).toBeTruthy();

      // A "why it isn't here yet" note belongs to a roadmap item and nothing
      // else — a live feature with one reads as an apology for a working screen.
      expect(Object.keys(notes).sort()).toEqual([...ROADMAP].sort());
    }
  });
});

describe("the config stays complete", () => {
  it("has an entry for every feature module in the catalog", () => {
    for (const key of ALL_MODULE_KEYS) {
      expect(CAPABILITIES[key], `no availability entry for module "${key}"`).toBeDefined();
      expect(CAPABILITY_ORDER, `module "${key}" has no display position`).toContain(key);
    }
    expect(new Set(CAPABILITY_ORDER).size).toBe(CAPABILITY_ORDER.length);
    expect(CAPABILITY_ORDER.length).toBe(Object.keys(CAPABILITIES).length);
  });

  it("gives every entry evidence a reader can check", () => {
    for (const id of ALL_FEATURE_IDS) {
      expect(FEATURES[id].evidence.length, `"${id}" has no evidence`).toBeGreaterThan(10);
    }
  });
});
