// ===== Matjar Business OS — Feature Module Catalog =====
// The heart of the multi-sector platform. A "feature module" is a capability a
// business can switch on (menu, appointments, court booking, verifications…).
// A SECTOR is just a default bundle of these modules (see sectors.ts), and a
// STORE can toggle them within its plan (see the store_modules table, added in
// a later phase). Every downstream surface — the merchant dashboard, the public
// profile, the create form, the search filters — renders from the set of
// enabled modules, so a new sector is configuration, not new code.
//
// This file is intentionally the single source of truth for WHAT a module is
// and HOW modules relate (tier + dependencies). The per-surface wiring
// (widgets / public sections / form fields / filters) hangs off these keys and
// is added module-by-module in the phases that follow — so parallel work can
// build one module without touching another.

export type FeatureModuleKey =
  // Commerce
  | "catalog" // products grid + cart-ready items
  | "menu" // sectioned menu (food)
  | "orders" // cart + checkout + order tracking (the money path)
  | "inventory" // stock tracking + low-stock
  | "delivery" // couriers / zones / delivery info
  | "pos" // in-store point of sale
  // Scheduling family (see BOOKING_MODULES)
  | "appointments" // single-resource calendar booking (clinic/beauty/pro)
  | "timeslot" // multi-resource time-slot booking (courts/rooms/rentals)
  | "classes" // scheduled sessions with capacity (gyms/group courses)
  | "reservations" // table reservations (restaurants)
  | "memberships" // recurring subscriptions (gym/club/school)
  | "rentals" // rent-by-period (cars/equipment/gear) — a business model, not a sector
  // Services & listings
  | "requests" // service requests + quotes
  | "listings" // attribute-rich listings (real-estate/car/rental)
  | "portfolio" // freelancer work showcase + gigs
  | "courses" // courses + tutors + enrollment (education)
  // Cross-cutting (most sectors)
  | "team" // public team / doctors / trainers
  | "reviews" // ratings + reviews + Q&A
  | "verifications" // certificates & licenses (+ earned "verified" badge)
  | "location" // map pin + branches + nearby + distance
  | "marketing" // offers / coupons / loyalty
  | "messaging" // customer ↔ business chat
  | "media"; // gallery + cover + video

// The plan floor a module's MERCHANT SCREEN is gated at. Mirrors the enforced
// `minPlan` in OS_MODULE_META / the plan floor in feature-availability.ts, and
// src/lib/__tests__/feature-availability-ssot.test.ts fails if the two drift:
// this field used to say inventory was "pro" while the inventory screen locks
// at Business, and classes/memberships/courses "pro" while their screens carry
// no plan guard at all — so the module manager locked a free-plan gym out of
// the classes it could already run.
export type ModuleTier = "free" | "pro" | "business";

export type FeatureModuleDef = {
  key: FeatureModuleKey;
  /** dict key under `os.modules.*` for the human label (wired when rendered). */
  labelKey: string;
  tier: ModuleTier;
  /** Modules that must also be on for this one to make sense. */
  dependsOn?: FeatureModuleKey[];
  /** Modules that can't be on at the same time (e.g. one primary sales flow). */
  conflictsWith?: FeatureModuleKey[];
};

// The catalog. Order here is the canonical display order in the module manager.
export const MODULE_CATALOG: Record<FeatureModuleKey, FeatureModuleDef> = {
  catalog: { key: "catalog", labelKey: "catalog", tier: "free" },
  menu: { key: "menu", labelKey: "menu", tier: "free" },
  orders: { key: "orders", labelKey: "orders", tier: "free" },
  inventory: { key: "inventory", labelKey: "inventory", tier: "business", dependsOn: ["catalog"] },
  delivery: { key: "delivery", labelKey: "delivery", tier: "free", dependsOn: ["orders"] },
  pos: { key: "pos", labelKey: "pos", tier: "pro", dependsOn: ["catalog"] },

  appointments: { key: "appointments", labelKey: "appointments", tier: "free" },
  timeslot: { key: "timeslot", labelKey: "timeslot", tier: "free" },
  classes: { key: "classes", labelKey: "classes", tier: "free" },
  reservations: { key: "reservations", labelKey: "reservations", tier: "free" },
  memberships: { key: "memberships", labelKey: "memberships", tier: "free" },
  // Was `tier: "pro", dependsOn: ["timeslot"]` for as long as it named nothing.
  // Both parts were wrong once MJ-003 built it (migration 0298): the engine is
  // a DAY RANGE with an exclusion constraint, not a grid of hourly slots, so
  // switching rentals on used to drag in the hourly booker it is an
  // alternative to; and it is the same engine hospitality gets free, so it is
  // free here.
  rentals: { key: "rentals", labelKey: "rentals", tier: "free" },

  requests: { key: "requests", labelKey: "requests", tier: "free" },
  listings: { key: "listings", labelKey: "listings", tier: "free" },
  portfolio: { key: "portfolio", labelKey: "portfolio", tier: "free" },
  courses: { key: "courses", labelKey: "courses", tier: "free" },

  // The storefront team page is fed by merchant/[storeId]/doctors, which is an
  // isPro screen — so the toggle locks where the screen locks.
  team: { key: "team", labelKey: "team", tier: "pro" },
  reviews: { key: "reviews", labelKey: "reviews", tier: "free" },
  verifications: { key: "verifications", labelKey: "verifications", tier: "free" },
  location: { key: "location", labelKey: "location", tier: "free" },
  marketing: { key: "marketing", labelKey: "marketing", tier: "pro" },
  messaging: { key: "messaging", labelKey: "messaging", tier: "free" },
  media: { key: "media", labelKey: "media", tier: "free" },
};

export const ALL_MODULE_KEYS = Object.keys(MODULE_CATALOG) as FeatureModuleKey[];

// The scheduling family — one of these is a sector's "how do customers book"
// primitive. Kept together so we never rebuild booking per sector.
export const BOOKING_MODULES: FeatureModuleKey[] = [
  "appointments",
  "timeslot",
  "classes",
  "reservations",
];

export function isProModule(key: FeatureModuleKey): boolean {
  return MODULE_CATALOG[key].tier === "pro";
}

// Given a desired set, pull in any missing dependencies so the resolved set is
// always internally consistent (e.g. enabling `delivery` implies `orders`).
export function withDependencies(
  keys: Iterable<FeatureModuleKey>,
): Set<FeatureModuleKey> {
  const out = new Set<FeatureModuleKey>();
  const add = (k: FeatureModuleKey) => {
    if (out.has(k)) return;
    out.add(k);
    for (const dep of MODULE_CATALOG[k].dependsOn ?? []) add(dep);
  };
  for (const k of keys) add(k);
  return out;
}
