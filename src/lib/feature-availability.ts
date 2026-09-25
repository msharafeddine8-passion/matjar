// ===== Matjar — Public Feature Availability =====
//
// The one place that answers "may a public page say Matjar does this?".
//
// Before this file, every marketing surface carried its own hand-written list of
// what Matjar offers, and the lists disagreed with each other and with the
// product: /pricing sold bookings as a Pro upgrade while the bookings screen is
// open on every plan; it sold profit analytics as Business while the reports
// screen (profit block included) unlocks at Pro; it listed a "verified badge" as
// an included plan feature on all three tiers while /trust says the badge has
// never been awarded to anyone; /help quoted a $12/mo Pro plan that has not
// existed since PLAN_TIERS said $25; and one row — "mobile store unit" —
// described a product that does not exist in this repository at all.
//
// Two tables live here and every public claim is rendered from them:
//
//   CAPABILITIES — what a STOREFRONT can do (the customer-facing modules of
//                  modules-catalog.ts, plus the three engine-backed surfaces the
//                  sector registry does not name: leads, stays, tickets).
//                  Drives the per-sector capability cards on /merchants.
//
//   FEATURES     — what a PLAN buys (the /pricing matrix, the tier cards, the
//                  upgrade gate, the Business-OS band).
//
// Both carry a `state`, and only `live` may be rendered as something that works.
// `beta` and `soon` must render with their state visible (see ROADMAP) — never
// as a plain tick in a comparison table. src/lib/__tests__/feature-availability
// .test.ts fails the build if a page's claim list contains anything else.
//
// The plan floors are not typed in by hand either: every entry that is backed by
// an OS module names that module, and a test asserts the floor equals the
// module's enforced `minPlan` in OS_MODULE_META — which is itself a mirror of
// the `isPro()` / `isBusiness()` guard on the screen. A page therefore cannot
// advertise a tier the code does not enforce.
//
// (Prices are NOT here. plan-tiers.ts is and stays the single source of pricing;
// this file only ever reads PLAN_TIERS for the count cells.)

import { PLAN_ORDER, PLAN_RANK, PLAN_TIERS, type PlanKey } from "./plan-tiers";
import { categoryKeys, type CategoryKey } from "./catalog";
import type { FeatureModuleKey } from "./modules-catalog";
import { resolveStoreModules, type OsModuleKey } from "./sectors";
import { resolveStoreExperience, type StoreExperience } from "./store-experience";
// Type-only: erased at compile time, so the `server-only` marker inside
// get-dictionary never reaches a client bundle through this module.
import type { Dictionary } from "@/i18n/get-dictionary";

/** `live` — a working screen ships today and the claim may be stated plainly.
 *  `beta` — the mechanism ships but has not produced a real outcome yet.
 *  `soon` — no working screen. Never renderable as an included feature. */
export type FeatureState = "live" | "beta" | "soon";

/** The lowest plan on which something is available at all. "free" is the
 *  unsubscribed floor (see StorePlan in plan-tiers), so "free" means every
 *  store has it, paid or not. */
export type PlanFloor = "free" | PlanKey;

export const PLAN_FLOORS: PlanFloor[] = ["free", ...PLAN_ORDER];

// ---------------------------------------------------------------------------
// Storefront capabilities
// ---------------------------------------------------------------------------

/** Everything a storefront can offer a customer. The feature-module keys, plus
 *  the three surfaces that exist as engines but were never given a module key:
 *  the lead form (real estate / automotive), the stay engine (hospitality) and
 *  event ticketing. */
export type CapabilityKey = FeatureModuleKey | "leads" | "stays" | "tickets";

export type CapabilityEntry = {
  state: FeatureState;
  plan: PlanFloor;
  /** The merchant OS screen behind it, when one exists. Typed against the
   *  registry, so a capability cannot point at a screen that is not built. */
  osModule?: OsModuleKey;
  /** Where the customer sees it, for auditing this file against the product. */
  surface: string;
};

// Display order for a sector's capability chips: what the customer transacts
// with first, then the supporting material, then the always-on cross-cutting
// modules. Same idea as the profile section order in sectors.ts — the specific
// thing a business is chosen for leads, the generic follows.
export const CAPABILITY_ORDER: CapabilityKey[] = [
  "menu",
  "catalog",
  "listings",
  "orders",
  "delivery",
  "inventory",
  "pos",
  "appointments",
  "reservations",
  "timeslot",
  "classes",
  "courses",
  "memberships",
  "rentals",
  "stays",
  "tickets",
  "requests",
  "leads",
  "portfolio",
  "team",
  "verifications",
  "marketing",
  "reviews",
  "location",
  "media",
  "messaging",
];

export const CAPABILITIES: Record<CapabilityKey, CapabilityEntry> = {
  menu: { state: "live", plan: "free", osModule: "items", surface: "storefront — sectioned menu" },
  catalog: { state: "live", plan: "free", osModule: "items", surface: "storefront — products/services grid" },
  listings: { state: "live", plan: "free", osModule: "items", surface: "storefront — attribute-rich listing grid" },
  orders: { state: "live", plan: "free", osModule: "orders", surface: "cart → order → tracking" },
  delivery: { state: "live", plan: "free", osModule: "orders", surface: "storefront — fulfilment block (zones, minimum, prep)" },
  inventory: { state: "live", plan: "business", osModule: "inventory", surface: "merchant — stock & low-stock" },
  pos: { state: "live", plan: "pro", osModule: "pos", surface: "merchant — point of sale" },

  appointments: { state: "live", plan: "free", osModule: "bookings", surface: "storefront — booking panel" },
  reservations: { state: "live", plan: "free", osModule: "bookings", surface: "storefront — reservation form" },
  timeslot: { state: "live", plan: "free", osModule: "resources", surface: "storefront — time-slot booking" },
  classes: { state: "live", plan: "free", osModule: "classes", surface: "storefront — class timetable" },
  memberships: { state: "live", plan: "free", osModule: "memberships", surface: "storefront — membership plans" },
  courses: { state: "live", plan: "free", osModule: "courses", surface: "storefront — course list" },
  // MJ-003 built the engine this key had been naming since the catalog was
  // written. Day-range vehicle rental (migration 0298): a fleet, a
  // [pickup, return) range, per-day pricing with a weekend rate, and a
  // btree_gist exclusion constraint that makes a double-booking impossible
  // rather than unlikely. Declared by the automotive and hospitality bundles;
  // only automotive RENDERS it (surfacesFor reads showRental, and hospitality
  // takes dates through the stay engine), which is why the bundle alone was
  // never a safe thing to advertise from.
  rentals: {
    state: "live",
    plan: "free",
    osModule: "rentals",
    surface: "storefront — date-range vehicle rental search",
  },

  requests: { state: "live", plan: "free", osModule: "requests", surface: "storefront — service request / quote form" },
  leads: { state: "live", plan: "free", osModule: "leads", surface: "storefront — viewing / test-drive / offer form" },
  stays: { state: "live", plan: "free", osModule: "stays", surface: "storefront — date-range stay search" },
  tickets: { state: "live", plan: "free", osModule: "tickets", surface: "storefront — event ticket purchase" },
  portfolio: { state: "live", plan: "free", osModule: "portfolio", surface: "storefront — work showcase" },

  team: { state: "live", plan: "pro", osModule: "doctors", surface: "storefront — providers & their services" },
  // The certificates a business uploads and the page shows. The "verified"
  // badge is a separate, stricter review — see the `verifiedBadge` FEATURE.
  verifications: { state: "live", plan: "free", osModule: "verifications", surface: "storefront — licences & certificates" },
  marketing: { state: "live", plan: "pro", osModule: "coupons", surface: "storefront — offers, coupons, loyalty points" },
  reviews: { state: "live", plan: "free", surface: "storefront — ratings, reviews & Q&A" },
  location: { state: "live", plan: "free", surface: "storefront — map pin, branches, distance" },
  media: { state: "live", plan: "free", surface: "storefront — gallery & cover" },
  messaging: { state: "live", plan: "free", surface: "/messages — customer ↔ business thread" },
};

/** Whether a capability may be stated as something that works today. */
export function isCapabilityLive(key: CapabilityKey): boolean {
  return CAPABILITIES[key].state === "live";
}

/** Whether the storefront actually SURFACES this capability for a sector.
 *
 *  A sector's `features` bundle is a statement of intent; store-experience.ts is
 *  what the page really renders, and the two disagree in four places. Real
 *  estate lists `appointments` but is held in directory-only mode, so no
 *  calendar ever appears. Automotive lists `requests`, but lead sectors route
 *  every inquiry through the lead form instead. Hospitality and events list
 *  `timeslot`, but both were moved onto their own engines and have hourly
 *  booking switched off. Reading the bundle alone would put four capabilities on
 *  the merchant page that no customer can use. */
function surfacesFor(key: CapabilityKey, exp: StoreExperience): boolean {
  switch (key) {
    case "appointments":
      return exp.showBooking;
    case "requests":
      return exp.showServiceRequest;
    case "timeslot":
    case "classes":
      return exp.allowResourceBooking;
    case "orders":
    case "delivery":
    case "pos":
    case "inventory":
      return exp.canOrderProducts;
    case "reservations":
    case "memberships":
      return !exp.directoryOnly;
    // Two sector bundles declare `rentals`; one has an engine. Hospitality
    // books its dates through the stay engine and renders no rental section at
    // all, so reading the bundle would put a capability on the hotel page that
    // no guest can use — the same class of drift this function exists for.
    case "rentals":
      return exp.showRental;
    default:
      return true;
  }
}

/** What this sector's storefront can genuinely do, in display order.
 *
 *  Derived, never written down: the sector's own module bundle from the registry
 *  (dependencies resolved), narrowed to what the experience resolver actually
 *  renders, narrowed again to what is `live`, plus the engine-backed surfaces
 *  the bundle has no key for. The merchant page therefore cannot drift from the
 *  product — adding a module to a sector adds it to the page, and taking a
 *  screen away takes the claim away. */
export function sectorCapabilities(category: CategoryKey): CapabilityKey[] {
  const modules = resolveStoreModules(category);
  const exp = resolveStoreExperience({ category, enabledModules: modules });
  const out: CapabilityKey[] = [];

  const add = (key: CapabilityKey) => {
    if (!isCapabilityLive(key)) return;
    if (!out.includes(key)) out.push(key);
  };

  for (const key of CAPABILITY_ORDER) {
    if (!modules.has(key as FeatureModuleKey)) continue;
    if (!surfacesFor(key, exp)) continue;
    add(key);
  }

  // Engines the resolver switches on that no module key names.
  if (exp.showLeadForm) add("leads");
  if (exp.showStay) add("stays");
  if (exp.showTickets) add("tickets");

  return out.sort(
    (a, b) => CAPABILITY_ORDER.indexOf(a) - CAPABILITY_ORDER.indexOf(b),
  );
}

/** The inquiry kinds a sector's lead form offers, for sectors that have one.
 *  Re-exported through this module so the merchant page has a single import for
 *  "what can this sector's storefront do". */
export { leadKinds } from "./store-experience";

// ---------------------------------------------------------------------------
// Plan features
// ---------------------------------------------------------------------------

export type FeatureId =
  // Included on every store, paid or not
  | "storePage"
  | "discovery"
  | "products"
  | "whatsappOrders"
  | "dualCurrency"
  | "bookings"
  | "messaging"
  | "reviews"
  | "documents"
  | "moduleManager"
  | "qrLink"
  | "academy"
  | "staffSeats"
  | "support"
  | "commission"
  | "debtLedger"
  | "whatsappActions"
  // Pro
  | "onboarding"
  | "staffAccounts"
  | "pos"
  | "reports"
  | "profitAnalytics"
  | "customers"
  | "coupons"
  | "team"
  | "tasks"
  | "tools"
  | "courierDispatch"
  | "homeFeatured"
  | "googleFeed"
  // Business
  | "branches"
  | "inventory"
  | "kitchen"
  | "suppliers"
  | "accounting"
  | "automations"
  | "campaigns"
  | "hr"
  // Not live
  | "verifiedBadge"
  | "rentals"
  | "onlinePayment"
  | "nativeApp";

/** How a matrix row prints its per-plan cell. Anything other than "gate" reads
 *  its numbers straight out of PLAN_TIERS, so the comparison table can never
 *  contradict the price cards. */
export type CellKind = "gate" | "products" | "staff" | "support" | "commission";

export type FeatureEntry = {
  state: FeatureState;
  plan: PlanFloor;
  /** The OS screen that implements it. When set, a test asserts `plan` equals
   *  that module's enforced minPlan — a claimed tier is a checked tier. */
  osModule?: OsModuleKey;
  /** Storefront capabilities this claim covers. A claim is never allowed to be
   *  more available than the weakest capability under it. */
  covers?: CapabilityKey[];
  cell?: CellKind;
  /** Where to look in the repo to confirm this entry. Kept because the whole
   *  point of the file is that a reader can check it, not trust it. */
  evidence: string;
  /** Dictionary paths for a feature whose words live in its own namespace
   *  rather than under `pricing.features` / `features.desc`. Such a feature is
   *  not a /pricing row (see PricedFeatureId) until it is given a
   *  `pricing.features` label as well. */
  copy?: { label: string; description: string };
};

/** Features that carry their own dictionary copy (`FeatureEntry.copy`) and so
 *  have no `pricing.features` label. Kept out of the lists the price surfaces
 *  render straight from `dict.pricing.features[id]`, so the compiler refuses a
 *  pricing row that would print `undefined`. */
export type OwnCopyFeatureId = "googleFeed" | "debtLedger" | "whatsappActions";

/** The features a price card, the /pricing table or the upgrade prompt may
 *  list — every one of them labelled under `pricing.features`. */
export type PricedFeatureId = Exclude<FeatureId, OwnCopyFeatureId>;

export const FEATURES: Record<FeatureId, FeatureEntry> = {
  // ── Every store ──────────────────────────────────────────────────────────
  storePage: {
    state: "live",
    plan: "free",
    covers: ["media", "location"],
    evidence: "app/[lang]/(site)/store/[id]/page.tsx",
  },
  discovery: {
    state: "live",
    plan: "free",
    evidence: "app/[lang]/(site)/{explore,search,map,category}",
  },
  products: {
    state: "live",
    plan: "free",
    osModule: "items",
    covers: ["catalog", "menu", "listings"],
    cell: "products",
    evidence: "merchant/[storeId]/items + planProductLimit()",
  },
  whatsappOrders: {
    state: "live",
    plan: "free",
    osModule: "orders",
    covers: ["orders", "delivery"],
    evidence: "merchant/[storeId]/orders (ungated) + lib/whatsapp.ts",
  },
  dualCurrency: {
    state: "live",
    plan: "free",
    evidence: "lib/currency.ts formatLbp + settings USD/LBP rate",
  },
  // Sold as a Pro upgrade on /pricing for as long as the page has existed. The
  // bookings screen carries no plan guard and OS_MODULE_META gives it no
  // minPlan, so every store — including one that never paid — has had bookings
  // all along.
  bookings: {
    state: "live",
    plan: "free",
    osModule: "bookings",
    covers: ["appointments", "reservations", "timeslot", "classes"],
    evidence: "merchant/[storeId]/bookings — no plan guard",
  },
  // Was sold from Pro while it did not exist. MJ-003 shipped it (migration
  // 0298) and it is the SAME engine as the hotel stay, which carries no plan
  // guard — so it carries none either. Pricing the identical code differently
  // because the sector is spelled "automotive" would be a gate with nothing
  // behind it, and both automotive stores in production are on the free plan,
  // so a Pro gate would have meant the sector's one transaction shipped to
  // nobody.
  rentals: {
    state: "live",
    plan: "free",
    osModule: "rentals",
    covers: ["rentals"],
    evidence: "merchant/[storeId]/{rentals,vehicles} — no plan guard; migration 0298",
  },
  messaging: {
    state: "live",
    plan: "free",
    covers: ["messaging"],
    evidence: "app/[lang]/(site)/messages + rpc my_conversations",
  },
  reviews: {
    state: "live",
    plan: "free",
    covers: ["reviews"],
    evidence: "components/store/store-reviews",
  },
  documents: {
    state: "live",
    plan: "free",
    osModule: "verifications",
    covers: ["verifications"],
    evidence: "merchant/[storeId]/verifications → storefront certificates block",
  },
  moduleManager: {
    state: "live",
    plan: "free",
    osModule: "modules",
    evidence: "merchant/[storeId]/modules",
  },
  qrLink: {
    state: "live",
    plan: "free",
    evidence: "app/s/[code]/route.ts + qrcode",
  },
  academy: {
    state: "live",
    plan: "free",
    evidence: "app/[lang]/(site)/hub/academy",
  },
  staffSeats: {
    state: "live",
    plan: "free",
    cell: "staff",
    evidence: "planStaffLimit() — owner is seat #1 on every plan",
  },
  support: {
    state: "live",
    plan: "free",
    cell: "support",
    evidence: "app/[lang]/(site)/contact + WhatsApp",
  },
  commission: {
    state: "live",
    plan: "free",
    cell: "commission",
    evidence: "no commission is taken anywhere in the order path",
  },
  // دفتر الدين — the customer credit book. Free on every plan on purpose: it is
  // the reason a shop that still keeps a paper notebook opens Matjar at all.
  // Deliberately NOT behind the Pro `customers` module: the screen carries no
  // plan guard, OS_MODULE_META.ledger has no minPlan, and migration 0307 puts
  // no plan check in the database. Zero recurring cost — reminders are wa.me
  // links, statements are a server-rendered page printed by the browser.
  debtLedger: {
    state: "live",
    plan: "free",
    osModule: "ledger",
    evidence:
      "merchant/[storeId]/ledger — no plan guard; staff need the `customers` permission; migrations 0211 + 0307",
    copy: { label: "ledger.feature.label", description: "ledger.feature.desc" },
  },

  // One-tap WhatsApp actions for the merchant: confirm an order, send a status
  // update, ask for a review, chase an abandoned cart, confirm or remind a
  // booking, remind a debt — each a pre-filled wa.me link the merchant sends
  // from their own phone. Zero recurring cost: no WhatsApp Business API, no
  // SMS. On every plan: no screen or button carries a plan guard, and 0309 has
  // no plan check. Staff need the permission of the area (orders / bookings /
  // customers); message wording is editable by the owner.
  whatsappActions: {
    state: "live",
    plan: "free",
    evidence:
      "lib/wa-templates.ts + components/wa-actions — orders list, bookings, ledger, merchant/[storeId]/abandoned-carts, settings/whatsapp; migration 0309",
    copy: { label: "waActions.feature.label", description: "waActions.feature.desc" },
  },

  // ── Pro ──────────────────────────────────────────────────────────────────
  onboarding: {
    state: "live",
    plan: "pro",
    evidence: "human service, not a screen — kept because it is a real promise",
  },
  staffAccounts: {
    state: "live",
    plan: "pro",
    osModule: "staff",
    evidence: "merchant/[storeId]/staff — isPro guard",
  },
  pos: {
    state: "live",
    plan: "pro",
    osModule: "pos",
    covers: ["pos"],
    evidence: "merchant/[storeId]/pos — isPro guard",
  },
  reports: {
    state: "live",
    plan: "pro",
    osModule: "reports",
    evidence: "merchant/[storeId]/reports — isPro guard",
  },
  // Sold as Business-only. It is a block on the reports screen, and that screen
  // opens at Pro.
  profitAnalytics: {
    state: "live",
    plan: "pro",
    osModule: "reports",
    evidence: "merchant/[storeId]/reports — profit/COGS/margin block, isPro guard",
  },
  customers: {
    state: "live",
    plan: "pro",
    osModule: "customers",
    evidence: "merchant/[storeId]/customers — isPro guard",
  },
  coupons: {
    state: "live",
    plan: "pro",
    osModule: "coupons",
    covers: ["marketing"],
    evidence: "merchant/[storeId]/coupons + loyalty panel — isPro guard",
  },
  team: {
    state: "live",
    plan: "pro",
    osModule: "doctors",
    covers: ["team"],
    evidence: "merchant/[storeId]/doctors — isPro guard",
  },
  tasks: {
    state: "live",
    plan: "pro",
    osModule: "tasks",
    evidence: "merchant/[storeId]/tasks — isPro guard",
  },
  tools: {
    state: "live",
    plan: "pro",
    osModule: "tools",
    evidence: "merchant/[storeId]/tools — isPro guard",
  },
  // A Pro-only control inside the orders screen rather than a screen of its own,
  // so it has no osModule to check the floor against.
  courierDispatch: {
    state: "live",
    plan: "pro",
    evidence: "merchant/[storeId]/orders — hasPlan(plan,'pro') gates dispatch; request_delivery() re-checks server-side",
  },
  // Was sold as "featured placement in category". Category and /explore listings
  // sort on the admin `featured_until` flag and ignore the plan entirely; the
  // only plan-driven placement is the paid strip on the home page.
  homeFeatured: {
    state: "live",
    plan: "pro",
    evidence: "lib/data/stores.ts getFeaturedStores — plan.in.(pro,business)",
  },
  // The per-store product feed for Google's free listings (and Meta catalogs).
  // Zero recurring cost: the merchant connects it in their own Merchant
  // Center. The route re-checks the effective plan on every render, so the
  // floor below is the floor the code enforces, not just the one it claims.
  googleFeed: {
    state: "live",
    plan: "pro",
    evidence:
      "app/feeds/[slug]/google.xml/route.ts — feedServes() → feedPlanAllowed(); merchant/[storeId]/google-feed gates on hasPlan(…,'pro')",
    copy: { label: "googleFeed.featureLabel", description: "googleFeed.featureDesc" },
  },

  // ── Business ─────────────────────────────────────────────────────────────
  branches: {
    state: "live",
    plan: "business",
    osModule: "branches",
    evidence: "merchant/[storeId]/branches — isBusiness guard",
  },
  inventory: {
    state: "live",
    plan: "business",
    osModule: "inventory",
    covers: ["inventory"],
    evidence: "merchant/[storeId]/inventory — isBusiness guard",
  },
  kitchen: {
    state: "live",
    plan: "business",
    osModule: "kitchen",
    evidence: "merchant/[storeId]/kitchen — isBusiness guard",
  },
  suppliers: {
    state: "live",
    plan: "business",
    osModule: "suppliers",
    evidence: "merchant/[storeId]/suppliers — isBusiness guard",
  },
  accounting: {
    state: "live",
    plan: "business",
    osModule: "accounting",
    evidence: "merchant/[storeId]/accounting — isBusiness guard",
  },
  automations: {
    state: "live",
    plan: "business",
    osModule: "automations",
    evidence: "merchant/[storeId]/automations — isBusiness guard",
  },
  campaigns: {
    state: "live",
    plan: "business",
    osModule: "campaigns",
    evidence: "merchant/[storeId]/campaigns — isBusiness guard",
  },
  hr: {
    state: "live",
    plan: "business",
    osModule: "hr",
    evidence: "merchant/[storeId]/hr + attendance + /clock — isBusiness guard",
  },

  // ── Not live. Never renderable as an included feature. ────────────────────
  // The pipeline is real — a business uploads its documents, an admin reviews
  // them and can award the badge — but no store has ever been awarded it, and
  // paying for a plan does not award it. /pricing used to tick it on all three
  // tiers, which read as "pay and you are verified". It stays out of the plan
  // matrix until a real business has passed the review.
  verifiedBadge: {
    state: "beta",
    plan: "free",
    evidence: "admin/stores is_verified toggle; zero stores verified in production",
  },
  onlinePayment: {
    state: "soon",
    plan: "free",
    evidence: "no payment provider anywhere in the repo; the payments module is a manual ledger",
  },
  nativeApp: {
    state: "soon",
    plan: "free",
    evidence: "MOBILE_APP.md — Capacitor shell exists, not submitted to either store",
  },
};

export const ALL_FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export function isFeatureLive(id: FeatureId): boolean {
  return FEATURES[id].state === "live";
}

// ---------------------------------------------------------------------------
// What each public surface is allowed to render
// ---------------------------------------------------------------------------

/** The /pricing comparison table, in row order. Free-floor rows first, then
 *  what Pro adds, then Business — the order a merchant reads the page in. */
export const PRICING_MATRIX: PricedFeatureId[] = [
  "storePage",
  "discovery",
  "products",
  "whatsappOrders",
  "dualCurrency",
  "bookings",
  "rentals",
  "messaging",
  "reviews",
  "documents",
  "qrLink",
  "moduleManager",
  "academy",
  "staffSeats",
  "onboarding",
  "staffAccounts",
  "pos",
  "reports",
  "profitAnalytics",
  "customers",
  "coupons",
  "team",
  "tasks",
  "tools",
  "courierDispatch",
  "homeFeatured",
  "branches",
  "inventory",
  "kitchen",
  "suppliers",
  "accounting",
  "automations",
  "campaigns",
  "hr",
  "support",
  "commission",
];

/** The bullets on each price card: the marquee rows for that tier only. Every
 *  id must be `live` and must sit at that tier's floor, both asserted in tests,
 *  so a card can never promise what the matrix denies. */
export const PLAN_HIGHLIGHTS: Record<PlanKey, PricedFeatureId[]> = {
  basic: [
    "storePage",
    "discovery",
    "products",
    "whatsappOrders",
    "bookings",
    "dualCurrency",
    "messaging",
    "documents",
    "support",
  ],
  pro: [
    "products",
    "onboarding",
    "staffAccounts",
    "pos",
    "reports",
    "profitAnalytics",
    "customers",
    "coupons",
    "team",
    "tools",
    "homeFeatured",
  ],
  business: [
    "products",
    "branches",
    "inventory",
    "kitchen",
    "suppliers",
    "accounting",
    "automations",
    "campaigns",
    "hr",
  ],
};

/** Everything that is NOT live, rendered with its state showing. A page may
 *  print these only through a surface that shows the badge. `as const` so the
 *  per-item explanation in the dictionary is keyed by exactly these ids and no
 *  live feature can be given a "why it isn't here yet" note. */
export const ROADMAP = [
  "verifiedBadge",
  "onlinePayment",
  "nativeApp",
] as const satisfies readonly FeatureId[];

export type RoadmapId = (typeof ROADMAP)[number];

/** The Business-OS band on the home and merchant pages. `as const` so the six
 *  card blurbs in the dictionary are keyed by exactly these ids. */
export const OS_BAND = [
  "whatsappOrders",
  "bookings",
  "customers",
  "reports",
  "inventory",
  "tools",
] as const satisfies readonly FeatureId[];

export type OsBandId = (typeof OS_BAND)[number];

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

export type MatrixCell =
  | { kind: "included" }
  | { kind: "excluded" }
  | { kind: "count"; value: number | null }
  | { kind: "text"; token: "chat" | "priority" | "manager" | "zero" };

export function floorRank(plan: PlanFloor): number {
  return PLAN_RANK[plan] ?? 0;
}

/** Whether a plan includes a feature at all. */
export function planHas(plan: PlanKey, id: FeatureId): boolean {
  return PLAN_RANK[plan] >= floorRank(FEATURES[id].plan);
}

export function matrixCell(id: FeatureId, plan: PlanKey): MatrixCell {
  const entry = FEATURES[id];
  switch (entry.cell) {
    case "products":
      return { kind: "count", value: PLAN_TIERS[plan].products };
    case "staff":
      return { kind: "count", value: PLAN_TIERS[plan].staff };
    case "support":
      return {
        kind: "text",
        token: plan === "business" ? "manager" : plan === "pro" ? "priority" : "chat",
      };
    case "commission":
      return { kind: "text", token: "zero" };
    default:
      return planHas(plan, id) ? { kind: "included" } : { kind: "excluded" };
  }
}

/** The tier a feature first appears on, as a matrix column (the "free" floor is
 *  not a column — an unsubscribed store keeps these, and Basic includes them). */
export function firstPlanColumn(id: FeatureId): PlanKey {
  const floor = FEATURES[id].plan;
  return floor === "free" ? "basic" : floor;
}

// ---------------------------------------------------------------------------
// The unified registry — one answer to "is this available?", one word for it
// ---------------------------------------------------------------------------
//
// The two tables above answer two different questions (what a storefront does,
// what a plan buys) and every page reads the one it needs. What they did NOT
// give the rest of the codebase was a single call that takes a feature, a
// plan and a sector and says what to print — so the footer typed "قريباً" by
// hand for the app badges, the storefront carried a fixed "booking and direct
// purchase coming soon" note for every directory-only sector regardless of
// what that sector's bundle actually promises, the academy wrote its own
// "soon", and the module manager labelled inventory "Pro" from a tier field
// that nothing enforces while the inventory screen itself is gated at
// Business. Four spellings of availability, four ways to contradict /pricing.
//
// FEATURE_REGISTRY is DERIVED from CAPABILITIES + FEATURES (never a third
// hand-written list), `featureStatus()` resolves an entry for a plan and a
// sector, and `featureCopy()` returns the one dictionary word for the result.
// Nothing under src/components or src/app may spell "قريباً" / "Soon" itself
// again — src/lib/__tests__/feature-availability-ssot.test.ts scans for it.

/** The public vocabulary of availability.
 *  `available`   — works today, may be stated plainly.
 *  `beta`        — the mechanism ships but has not produced a real outcome yet.
 *  `coming_soon` — planned and named, no working screen (or no engine for
 *                  this sector yet).
 *  `internal`    — exists for staff/admin only; never advertised.
 *  `disabled`    — not offered here: the plan is below the floor, or the
 *                  sector does not carry it. */
export type FeatureStatus =
  | "available"
  | "beta"
  | "coming_soon"
  | "internal"
  | "disabled";

export const FEATURE_STATUSES: readonly FeatureStatus[] = [
  "available",
  "beta",
  "coming_soon",
  "internal",
  "disabled",
];

/** The internal three-state `FeatureState` mapped onto the public vocabulary.
 *  Kept as a mapping rather than a migration so every existing consumer of
 *  `state` keeps compiling. */
export const STATUS_OF_STATE: Record<FeatureState, FeatureStatus> = {
  live: "available",
  beta: "beta",
  soon: "coming_soon",
};

/** Every key the registry answers for: the storefront capabilities and the
 *  plan features. Six ids exist in both tables (pos, inventory, team, rentals,
 *  messaging, reviews); the tests assert those pairs agree, so a shared key
 *  has one truth. */
export type FeatureKey = CapabilityKey | FeatureId;

export type FeatureRecord = {
  feature_key: FeatureKey;
  /** Base status, before a plan or sector is applied. */
  status: FeatureStatus;
  /** Which of the three paid tiers include it (derived from the plan floor).
   *  A "free" floor means all three — and an unsubscribed store too, which
   *  `featureStatus({ plan: "free" })` answers. */
  eligible_plans: PlanKey[];
  /** The sectors whose storefront genuinely surfaces it. Plan features that
   *  are not tied to a storefront module (reports, staff accounts…) list every
   *  sector. */
  eligible_sectors: CategoryKey[];
  /** Dictionary path of the human label, e.g. "pricing.features.pos". */
  label: string;
  /** Dictionary path of the one-line description, e.g. "features.desc.pos". */
  description: string;
  /** Where the entry came from, so an auditor knows which table to read. */
  source: "feature" | "capability";
};

function plansFrom(floor: PlanFloor): PlanKey[] {
  return PLAN_ORDER.filter((p) => PLAN_RANK[p] >= floorRank(floor));
}

function isCapabilityKey(key: FeatureKey): key is CapabilityKey {
  return key in CAPABILITIES;
}

function isFeatureId(key: FeatureKey): key is FeatureId {
  return key in FEATURES;
}

// Which sectors surface each capability — computed once from the same
// function the merchant page renders its sector cards from.
const CAPABILITY_SECTORS: Record<CapabilityKey, CategoryKey[]> = (() => {
  const out = {} as Record<CapabilityKey, CategoryKey[]>;
  for (const key of CAPABILITY_ORDER) out[key] = [];
  for (const sector of categoryKeys) {
    for (const cap of sectorCapabilities(sector)) out[cap].push(sector);
  }
  return out;
})();

function sectorsForFeature(id: FeatureId): CategoryKey[] {
  const covers = FEATURES[id].covers;
  if (!covers || covers.length === 0) return [...categoryKeys];
  const set = new Set<CategoryKey>();
  for (const cap of covers) for (const s of CAPABILITY_SECTORS[cap]) set.add(s);
  return categoryKeys.filter((s) => set.has(s));
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureRecord> = (() => {
  const out = {} as Record<FeatureKey, FeatureRecord>;
  // Plan features first: where a key is in both tables the marketing label
  // (pricing.features.*) is the one the public pages already use for it.
  for (const id of ALL_FEATURE_IDS) {
    const entry = FEATURES[id];
    out[id] = {
      feature_key: id,
      status: STATUS_OF_STATE[entry.state],
      eligible_plans: plansFrom(entry.plan),
      eligible_sectors: sectorsForFeature(id),
      label: entry.copy?.label ?? `pricing.features.${id}`,
      description: entry.copy?.description ?? `features.desc.${id}`,
      source: "feature",
    };
  }
  for (const key of CAPABILITY_ORDER) {
    if (key in out) continue;
    const entry = CAPABILITIES[key];
    out[key] = {
      feature_key: key,
      status: STATUS_OF_STATE[entry.state],
      eligible_plans: plansFrom(entry.plan),
      eligible_sectors: CAPABILITY_SECTORS[key],
      label: `os.modules.labels.${key}`,
      description: `features.desc.${key}`,
      source: "capability",
    };
  }
  return out;
})();

export const ALL_FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[];

/** Why `featureStatus` answered what it did.
 *  `state`          — the entry's own status, nothing narrowed it.
 *  `plan`           — the plan asked about is below the feature's floor.
 *  `sector`         — the sector's bundle does not carry it at all.
 *  `sector_pending` — the sector's bundle declares it but the sector is held
 *                     in directory-only mode until its engine ships — the one
 *                     case where "coming soon" is the honest word.
 *  `sector_routed`  — the bundle declares it but the storefront routes that
 *                     need through another engine (a hotel's hourly slots are
 *                     replaced by the stay engine). Not coming; superseded. */
export type FeatureReason =
  | "state"
  | "plan"
  | "sector"
  | "sector_pending"
  | "sector_routed";

export type FeatureResolution = {
  status: FeatureStatus;
  /** Dictionary path — resolve with `dictPath(dict, label)`. */
  label: string;
  description: string;
  reason: FeatureReason;
};

/** Whether a sector's own module bundle (or the resolver's engine list)
 *  declares this capability — the statement of intent, before the storefront
 *  resolver decides what really renders. */
function sectorIntends(cap: CapabilityKey, sector: CategoryKey): boolean {
  if (cap === "leads" || cap === "stays" || cap === "tickets") {
    return CAPABILITY_SECTORS[cap].includes(sector);
  }
  return resolveStoreModules(sector).has(cap);
}

function directoryOnly(sector: CategoryKey): boolean {
  return resolveStoreExperience({
    category: sector,
    enabledModules: resolveStoreModules(sector),
  }).directoryOnly;
}

/** The capabilities a key stands for, for sector narrowing. */
function capabilitiesOf(key: FeatureKey): CapabilityKey[] {
  if (isFeatureId(key)) return FEATURES[key].covers ?? [];
  return isCapabilityKey(key) ? [key] : [];
}

/**
 * The one public answer. Resolves a feature for an optional plan and sector:
 *
 *   featureStatus("pos")                        → available (base)
 *   featureStatus("pos", { plan: "free" })      → disabled, reason "plan"
 *   featureStatus("appointments",
 *                 { sector: "realEstate" })     → coming_soon, reason "sector_pending"
 *   featureStatus("timeslot",
 *                 { sector: "hospitality" })    → disabled, reason "sector_routed"
 *   featureStatus("nativeApp")                  → coming_soon, reason "state"
 *
 * A feature that is not live to begin with stays that way whatever the plan or
 * sector — a Business store does not make online payment exist.
 */
export function featureStatus(
  key: FeatureKey,
  opts: { plan?: PlanFloor; sector?: CategoryKey } = {},
): FeatureResolution {
  const rec = FEATURE_REGISTRY[key];
  const base: FeatureResolution = {
    status: rec.status,
    label: rec.label,
    description: rec.description,
    reason: "state",
  };
  if (rec.status !== "available" && rec.status !== "beta") return base;

  if (opts.sector && !rec.eligible_sectors.includes(opts.sector)) {
    const caps = capabilitiesOf(key);
    const intended = caps.some((c) => sectorIntends(c, opts.sector as CategoryKey));
    if (!intended) return { ...base, status: "disabled", reason: "sector" };
    return directoryOnly(opts.sector)
      ? { ...base, status: "coming_soon", reason: "sector_pending" }
      : { ...base, status: "disabled", reason: "sector_routed" };
  }

  if (opts.plan !== undefined) {
    const floor = isFeatureId(key) ? FEATURES[key].plan : CAPABILITIES[key as CapabilityKey].plan;
    if (floorRank(opts.plan) < floorRank(floor)) {
      return { ...base, status: "disabled", reason: "plan" };
    }
  }

  return base;
}

/** The capabilities a sector's bundle promises that its storefront cannot
 *  deliver yet — the honest content of a "coming soon" note on that sector's
 *  store page. Empty for every sector that is not held in directory-only mode,
 *  so the note cannot render where nothing is pending. */
export function sectorPendingCapabilities(sector: CategoryKey): CapabilityKey[] {
  return CAPABILITY_ORDER.filter(
    (cap) => featureStatus(cap, { sector }).reason === "sector_pending",
  );
}

/** The lowest plan a feature needs, as the registry knows it — for surfaces
 *  (the module manager) that lock a toggle rather than print a matrix. */
export function featurePlanFloor(key: FeatureKey): PlanFloor {
  return isFeatureId(key) ? FEATURES[key].plan : CAPABILITIES[key as CapabilityKey].plan;
}

/** Resolve a dotted dictionary path ("features.desc.pos") to its string, or
 *  null when the path is missing — so a page can fall back rather than print
 *  "undefined". */
export function dictPath(dict: Dictionary, path: string): string | null {
  const value = path
    .split(".")
    .reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], dict);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The ONE canonical word for a status, from the dictionary: متاح / تجريبي /
 *  قريباً / غير متاح. Every badge, chip and note that names availability
 *  prints this and nothing else. */
export function featureCopy(status: FeatureStatus, dict: Dictionary): string {
  return dict.features.status[status];
}

/** The label a page prints for a feature — the same string /pricing or the
 *  module manager already uses for it. */
export function featureLabel(key: FeatureKey, dict: Dictionary): string {
  return dictPath(dict, FEATURE_REGISTRY[key].label) ?? key;
}

/** The one-line description behind a label. */
export function featureDescription(key: FeatureKey, dict: Dictionary): string {
  return dictPath(dict, FEATURE_REGISTRY[key].description) ?? "";
}
