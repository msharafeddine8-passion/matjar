import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import { locales } from "@/i18n/config";
import { categoryKeys } from "@/lib/catalog";
import { MODULE_CATALOG, ALL_MODULE_KEYS } from "@/lib/modules-catalog";
import { PLAN_ORDER } from "@/lib/plan-tiers";
import { resolveStoreModules } from "@/lib/sectors";
import { resolveStoreExperience } from "@/lib/store-experience";
import {
  ALL_FEATURE_KEYS,
  CAPABILITIES,
  CAPABILITY_ORDER,
  FEATURES,
  FEATURE_REGISTRY,
  FEATURE_STATUSES,
  ROADMAP,
  STATUS_OF_STATE,
  dictPath,
  featureCopy,
  featurePlanFloor,
  featureStatus,
  sectorPendingCapabilities,
  type CapabilityKey,
  type FeatureId,
} from "@/lib/feature-availability";

// Feature availability has ONE source: src/lib/feature-availability.ts. This
// file is the guard on the other half of that sentence — that nothing else in
// the UI decides, or spells, whether a feature exists.
//
// Part A validates the unified registry: every entry has a status from the
// public vocabulary, its label and description resolve in BOTH dictionaries,
// its plans are real plans, its sectors are real sectors, and the six keys
// that live in both underlying tables agree with themselves.
//
// Part B scans the component and page source for a hand-written "قريباً" /
// "Soon" / "coming soon". Every one of those that ever shipped was a
// contradiction waiting to happen — the footer said the app was coming while
// the roadmap said "not built", the storefront promised a flat in a shopping
// basket "soon" for a sector whose bundle has no cart. The word now comes from
// featureCopy() and nowhere else.

const ROOT = process.cwd();

const dict = (locale: string) =>
  JSON.parse(
    readFileSync(join(ROOT, "src/i18n/dictionaries", `${locale}.json`), "utf8"),
  ) as Parameters<typeof dictPath>[0];

describe("the unified feature registry is well-formed", () => {
  it("covers every capability and every plan feature, once", () => {
    const expected = new Set<string>([
      ...CAPABILITY_ORDER,
      ...(Object.keys(FEATURES) as FeatureId[]),
    ]);
    expect(new Set(ALL_FEATURE_KEYS)).toEqual(expected);
    for (const key of ALL_FEATURE_KEYS) {
      expect(FEATURE_REGISTRY[key].feature_key).toBe(key);
    }
  });

  it("gives every entry a status from the public vocabulary", () => {
    for (const key of ALL_FEATURE_KEYS) {
      expect(
        FEATURE_STATUSES,
        `"${key}" has status "${FEATURE_REGISTRY[key].status}"`,
      ).toContain(FEATURE_REGISTRY[key].status);
    }
    // The internal three states all map somewhere public.
    expect(STATUS_OF_STATE.live).toBe("available");
    expect(STATUS_OF_STATE.beta).toBe("beta");
    expect(STATUS_OF_STATE.soon).toBe("coming_soon");
  });

  it("resolves every label and description in both dictionaries", () => {
    for (const locale of locales) {
      const d = dict(locale);
      for (const key of ALL_FEATURE_KEYS) {
        const rec = FEATURE_REGISTRY[key];
        expect(
          dictPath(d, rec.label),
          `${locale}.json has no string at ${rec.label} (label of "${key}")`,
        ).toBeTruthy();
        expect(
          dictPath(d, rec.description),
          `${locale}.json has no string at ${rec.description} (description of "${key}")`,
        ).toBeTruthy();
      }
      // And the five status words themselves.
      for (const status of FEATURE_STATUSES) {
        expect(
          featureCopy(status, d),
          `${locale}.json has no features.status.${status}`,
        ).toBeTruthy();
      }
    }
  });

  it("names only real plans and real sectors", () => {
    for (const key of ALL_FEATURE_KEYS) {
      const rec = FEATURE_REGISTRY[key];
      for (const plan of rec.eligible_plans) {
        expect(PLAN_ORDER, `"${key}" lists plan "${plan}"`).toContain(plan);
      }
      for (const sector of rec.eligible_sectors) {
        expect(categoryKeys, `"${key}" lists sector "${sector}"`).toContain(sector);
      }
      // A plan list is a suffix of the tier order: once included, never
      // dropped on a higher tier.
      const idx = rec.eligible_plans.map((p) => PLAN_ORDER.indexOf(p));
      expect(idx, `"${key}" skips a tier`).toEqual(
        PLAN_ORDER.slice(PLAN_ORDER.length - idx.length).map((p) => PLAN_ORDER.indexOf(p)),
      );
    }
  });

  it("keeps the keys shared by both tables in agreement", () => {
    const shared = CAPABILITY_ORDER.filter((k) => k in FEATURES) as (CapabilityKey & FeatureId)[];
    expect(shared.length).toBeGreaterThan(0);
    for (const key of shared) {
      expect(CAPABILITIES[key].state, `"${key}" state differs between tables`).toBe(
        FEATURES[key].state,
      );
      expect(CAPABILITIES[key].plan, `"${key}" plan floor differs between tables`).toBe(
        FEATURES[key].plan,
      );
    }
  });

  it("keeps the module catalog's tier equal to the registry's plan floor", () => {
    // The module manager used to lock on MODULE_CATALOG.tier, which said "pro"
    // for inventory (a Business screen) and for classes (no guard at all).
    for (const key of ALL_MODULE_KEYS) {
      expect(
        MODULE_CATALOG[key].tier,
        `MODULE_CATALOG.${key}.tier disagrees with the registry's plan floor`,
      ).toBe(featurePlanFloor(key));
    }
  });
});

describe("featureStatus resolves plan and sector honestly", () => {
  it("returns the base status with no context", () => {
    expect(featureStatus("pos").status).toBe("available");
    expect(featureStatus("nativeApp")).toMatchObject({
      status: "coming_soon",
      reason: "state",
    });
    expect(featureStatus("onlinePayment").status).toBe("coming_soon");
    expect(featureStatus("verifiedBadge").status).toBe("beta");
  });

  it("disables a feature below its plan floor and nowhere else", () => {
    expect(featureStatus("pos", { plan: "free" })).toMatchObject({
      status: "disabled",
      reason: "plan",
    });
    expect(featureStatus("pos", { plan: "basic" }).status).toBe("disabled");
    expect(featureStatus("pos", { plan: "pro" }).status).toBe("available");
    expect(featureStatus("pos", { plan: "business" }).status).toBe("available");
    expect(featureStatus("inventory", { plan: "pro" })).toMatchObject({
      status: "disabled",
      reason: "plan",
    });
    expect(featureStatus("inventory", { plan: "business" }).status).toBe("available");
    expect(featureStatus("bookings", { plan: "free" }).status).toBe("available");
  });

  it("never makes a not-live feature available through a plan or sector", () => {
    for (const id of ROADMAP) {
      for (const plan of PLAN_ORDER) {
        expect(featureStatus(id, { plan }).status).not.toBe("available");
      }
      for (const sector of categoryKeys) {
        expect(featureStatus(id, { sector }).status).not.toBe("available");
      }
    }
  });

  it("says coming_soon only for a directory-only sector's own pending bundle", () => {
    // Real estate declares appointments and is held in directory-only mode.
    expect(featureStatus("appointments", { sector: "realEstate" })).toMatchObject({
      status: "coming_soon",
      reason: "sector_pending",
    });
    // …but it never had a cart, so a cart is not "coming", it is not offered.
    expect(featureStatus("orders", { sector: "realEstate" })).toMatchObject({
      status: "disabled",
      reason: "sector",
    });
    // A hotel's hourly slots are superseded by the stay engine — not pending.
    expect(featureStatus("timeslot", { sector: "hospitality" })).toMatchObject({
      status: "disabled",
      reason: "sector_routed",
    });
    // A sector that carries the capability answers plainly.
    expect(featureStatus("appointments", { sector: "healthcare" }).status).toBe("available");
    expect(featureStatus("stays", { sector: "hospitality" }).status).toBe("available");
  });

  it("reports pending capabilities for directory-only sectors only", () => {
    for (const sector of categoryKeys) {
      const exp = resolveStoreExperience({
        category: sector,
        enabledModules: resolveStoreModules(sector),
      });
      const pending = sectorPendingCapabilities(sector);
      if (!exp.directoryOnly) {
        expect(pending, `${sector} is live but reports pending capabilities`).toEqual([]);
      } else {
        expect(pending.length, `${sector} is directory-only but has nothing pending`).toBeGreaterThan(0);
        for (const cap of pending) {
          expect(
            resolveStoreModules(sector).has(cap as never),
            `${sector} reports "${cap}" pending but its bundle never declared it`,
          ).toBe(true);
        }
      }
    }
    expect(sectorPendingCapabilities("realEstate")).toEqual(["appointments"]);
  });
});

// ---------------------------------------------------------------------------
// Part B — no hand-written availability words in the UI source
// ---------------------------------------------------------------------------

const SCAN_DIRS = ["src/components", "src/app", "src/content", "src/lib"];

// The registry (where the word is defined) and the tests (which quote it).
const ALLOW = new Set<string>([
  "src/lib/feature-availability.ts",
  "src/lib/__tests__/feature-availability-ssot.test.ts",
]);

const FORBIDDEN = [
  // Arabic "soon": with either tanween order, and the bare spelling not
  // followed by another Arabic letter (so قريبة / قريبين "near" pass).
  /قريباً|قريبًا|قريبا(?![؀-ۿ])/,
  /coming soon/i,
  // The bare English badge, capitalised as a label. Lowercase prose ("as
  // soon as") is not a status word.
  /\bSoon\b/,
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

/** Strip block comments, JSX comments and full-line `//` comments. A `//`
 *  inside a string (a URL) is kept because only lines that START with `//`
 *  are dropped. Comments may describe the old copy; the source may not ship
 *  it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.replace(/\s\/\/(?!.*["'`]).*$/, ""))
    .join("\n");
}

describe("no component or page spells availability by hand", () => {
  it("finds no hand-written قريباً / Soon / coming soon outside the registry", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (ALLOW.has(rel)) continue;
        const code = stripComments(readFileSync(file, "utf8"));
        code.split("\n").forEach((line, i) => {
          for (const re of FORBIDDEN) {
            if (re.test(line)) {
              offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
              break;
            }
          }
        });
      }
    }
    expect(
      offenders,
      `hand-written availability copy — use featureCopy(featureStatus(key).status, dict):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
