import type { LucideIcon } from "lucide-react";
import {
  UtensilsCrossed,
  ShoppingBag,
  Wrench,
  Stethoscope,
  Building2,
  Car,
  ClipboardList,
  CalendarCheck,
  Package,
  Users,
  BarChart3,
  Wallet,
  Ticket,
  UserCog,
  Fingerprint,
  CreditCard,
  Settings,
  Pencil,
  ListTodo,
  Boxes,
  Calculator,
  Handshake,
  ChefHat,
  FileText,
  MapPin,
  Zap,
  Megaphone,
  BadgeCheck,
  Blocks,
  LandPlot,
  Gem,
  CalendarRange,
  Scissors,
  Dumbbell,
  Trophy,
  GraduationCap,
  PartyPopper,
  BedDouble,
  Pill,
  PawPrint,
  Scale,
  HardHat,
  Sprout,
  Images,
  BookOpen,
  Inbox,
  NotebookPen,
} from "lucide-react";
import type { CategoryKey } from "./catalog";
import { categoryModule } from "./modules";
import { type FeatureModuleKey, withDependencies } from "./modules-catalog";

// ===== Matjar Business OS — Sector Registry =====
// One core platform, many sectors. Each business type is *configuration*, not
// code: which OS modules it gets, in what order, with what vocabulary and what
// visual identity. Adding a sector (or later, toggling modules per plan) means
// editing this file only — pages render from the registry.

export type OsModuleKey =
  | "orders"
  | "bookings"
  | "resources"
  | "memberships"
  | "classes"
  | "portfolio"
  | "courses"
  | "tools"
  | "requests"
  | "leads"
  | "units"
  | "stays"
  | "vehicles"
  | "rentals"
  | "tickets"
  | "members"
  | "items"
  | "doctors"
  | "customers"
  | "ledger"
  | "campaigns"
  | "staff"
  | "hr"
  | "automations"
  | "tasks"
  | "inventory"
  | "pos"
  | "suppliers"
  | "kitchen"
  | "reports"
  | "accounting"
  | "coupons"
  | "subscription"
  | "branches"
  | "verifications"
  | "modules"
  | "settings"
  | "edit";

export type OsGroupKey = "daily" | "people" | "money" | "store";

// Ordered groups of the OS home. Sector configs list module keys per group;
// rendering keeps this order so every dashboard feels familiar while showing
// only what that business actually needs.
export const OS_GROUPS: OsGroupKey[] = ["daily", "people", "money", "store"];

export const OS_MODULE_META: Record<
  OsModuleKey,
  {
    Icon: LucideIcon;
    path: string;
    ownerOnly?: boolean;
    perm?: "orders" | "bookings" | "products" | "customers";
    /** Minimum paid tier to open this module (stores below see a lock +
     *  upsell). Absent = available on every plan. */
    minPlan?: "pro" | "business";
  }
> = {
  orders: { Icon: ClipboardList, path: "orders", perm: "orders" },
  bookings: { Icon: CalendarCheck, path: "bookings", perm: "bookings" },
  resources: { Icon: LandPlot, path: "resources", perm: "bookings" },
  memberships: { Icon: Gem, path: "memberships", ownerOnly: true },
  classes: { Icon: CalendarRange, path: "classes", perm: "bookings" },
  portfolio: { Icon: Images, path: "portfolio", perm: "products" },
  courses: { Icon: BookOpen, path: "courses", perm: "products" },
  tools: { Icon: Wrench, path: "tools", minPlan: "pro" },
  requests: { Icon: FileText, path: "requests", perm: "bookings" },
  leads: { Icon: Inbox, path: "leads", perm: "orders" },
  units: { Icon: BedDouble, path: "units", perm: "products" },
  stays: { Icon: CalendarRange, path: "stays", perm: "bookings" },
  // The rental engine's two screens (0298). Same shape as units/stays and the
  // same permissions: the fleet is stock (`products`), a rental is a booking.
  // No minPlan — the identical date-range engine is free for a hotel, and
  // charging a car business for the same code because its sector is spelled
  // differently would be a pricing decision dressed up as a feature gate.
  vehicles: { Icon: Car, path: "vehicles", perm: "products" },
  rentals: { Icon: CalendarRange, path: "rentals", perm: "bookings" },
  tickets: { Icon: Ticket, path: "tickets", perm: "products" },
  members: { Icon: Users, path: "members", perm: "orders" },
  items: { Icon: Package, path: "items", perm: "products" },
  doctors: { Icon: Stethoscope, path: "doctors", perm: "bookings", minPlan: "pro" },
  customers: { Icon: Users, path: "customers", perm: "orders", minPlan: "pro" },
  // دفتر الدين. No minPlan: free on every plan (FEATURES.debtLedger). Gated on
  // the `customers` staff permission — the exact key the database has used for
  // customer_transactions and store_customers since 0211 — so the nav shows it
  // to precisely the staff the RLS lets read it. The owner always sees it.
  ledger: { Icon: NotebookPen, path: "ledger", perm: "customers" },
  campaigns: { Icon: Megaphone, path: "campaigns", perm: "orders", minPlan: "business" },
  staff: { Icon: UserCog, path: "staff", ownerOnly: true, minPlan: "pro" },
  // Owner-only regardless of plan tier: this screen shows every salary in the
  // shop, and no existing staff permission means "may see what everyone earns".
  hr: { Icon: Fingerprint, path: "hr", ownerOnly: true, minPlan: "business" },
  automations: { Icon: Zap, path: "automations", perm: "orders", minPlan: "business" },
  tasks: { Icon: ListTodo, path: "tasks", minPlan: "pro" },
  inventory: { Icon: Boxes, path: "inventory", perm: "products", minPlan: "business" },
  pos: { Icon: Calculator, path: "pos", perm: "orders", minPlan: "pro" },
  suppliers: { Icon: Handshake, path: "suppliers", perm: "orders", minPlan: "business" },
  kitchen: { Icon: ChefHat, path: "kitchen", perm: "orders", minPlan: "business" },
  reports: { Icon: BarChart3, path: "reports", perm: "orders", minPlan: "pro" },
  accounting: { Icon: Wallet, path: "accounting", perm: "orders", minPlan: "business" },
  coupons: { Icon: Ticket, path: "coupons", ownerOnly: true, minPlan: "pro" },
  subscription: { Icon: CreditCard, path: "subscription", ownerOnly: true },
  branches: { Icon: MapPin, path: "branches", ownerOnly: true, minPlan: "business" },
  verifications: { Icon: BadgeCheck, path: "verifications", ownerOnly: true },
  modules: { Icon: Blocks, path: "modules", ownerOnly: true },
  settings: { Icon: Settings, path: "settings", ownerOnly: true },
  edit: { Icon: Pencil, path: "edit", ownerOnly: true },
};

export type SectorConfig = {
  /** Sector identity icon (hero, empty states). */
  Icon: LucideIcon;
  /** Tailwind classes tinting the OS-home hero per sector. Tokens only — the
   *  slot comes from SECTOR_TINT in ./catalog, which is the one source of truth
   *  for a sector's colour; keep these in step with it. Raw palette shades here
   *  are what used to leave the hero wash stuck in its light-theme colour. */
  heroTint: string;
  /** Tailwind classes for the sector icon badge: `bg-tint-N-soft text-tint-N`.
   *  That pair clears 4.5:1 in both themes, so it is safe under the small text
   *  pill on the OS home as well as under an icon. */
  iconTint: string;
  /** dict.os.nouns.* key — what this sector calls its customers. */
  customersNoun: "customers" | "patients" | "clients" | "leads";
  /** Default feature-module bundle (see modules-catalog.ts). Drives the public
   *  profile, create form, and search filters — not just the dashboard. */
  features: FeatureModuleKey[];
  /** OS modules per group, in display order. */
  modules: Record<OsGroupKey, OsModuleKey[]>;
};

// `ledger` (دفتر الدين — what customers owe the shop) leads the money group in
// every sector: it is the one money screen that is free on every plan, so on a
// free store it is the first unlocked row rather than one buried under locks.
const MONEY: OsModuleKey[] = ["ledger", "accounting", "reports", "coupons", "subscription"];
const STORE: OsModuleKey[] = ["tools", "branches", "verifications", "modules", "edit", "settings"];
// Real estate has no goods suppliers; every other sector tracks supplier debts.
const MONEY_WITH_SUPPLIERS: OsModuleKey[] = [
  "ledger",
  "accounting",
  "suppliers",
  "reports",
  "coupons",
  "subscription",
];

export const sectorConfig: Record<CategoryKey, SectorConfig> = {
  food: {
    Icon: UtensilsCrossed,
    features: ["menu", "orders", "delivery", "reservations", "reviews", "location", "media", "messaging"],
    heroTint: "from-tint-2-soft via-tint-2-soft/40 to-transparent",
    iconTint: "bg-tint-2-soft text-tint-2",
    customersNoun: "customers",
    modules: {
      daily: ["orders", "bookings", "kitchen", "pos", "items", "inventory", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  retail: {
    Icon: ShoppingBag,
    features: ["catalog", "orders", "inventory", "delivery", "reviews", "location", "marketing", "messaging", "media"],
    heroTint: "from-tint-6-soft via-tint-6-soft/40 to-transparent",
    iconTint: "bg-tint-6-soft text-tint-6",
    customersNoun: "customers",
    modules: {
      daily: ["orders", "pos", "items", "inventory", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  services: {
    Icon: Wrench,
    features: ["requests", "portfolio", "reviews", "verifications", "location", "messaging", "media"],
    heroTint: "from-tint-7-soft via-tint-7-soft/40 to-transparent",
    iconTint: "bg-tint-7-soft text-tint-7",
    customersNoun: "clients",
    modules: {
      daily: ["requests", "bookings", "portfolio", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  healthcare: {
    Icon: Stethoscope,
    features: ["appointments", "team", "verifications", "reviews", "location", "messaging", "media"],
    heroTint: "from-tint-4-soft via-tint-4-soft/40 to-transparent",
    iconTint: "bg-tint-4-soft text-tint-4",
    customersNoun: "patients",
    modules: {
      daily: ["requests", "bookings", "doctors", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  realEstate: {
    Icon: Building2,
    features: ["listings", "appointments", "reviews", "location", "media", "messaging"],
    heroTint: "from-tint-3-soft via-tint-3-soft/40 to-transparent",
    iconTint: "bg-tint-3-soft text-tint-3",
    customersNoun: "leads",
    modules: {
      daily: ["leads", "bookings", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY,
      store: STORE,
    },
  },
  automotive: {
    Icon: Car,
    features: ["listings", "requests", "rentals", "reviews", "location", "media", "messaging"],
    heroTint: "from-tint-3-soft via-tint-3-soft/40 to-transparent",
    iconTint: "bg-tint-3-soft text-tint-3",
    customersNoun: "leads",
    modules: {
      // Two transactions, and only one of them is a sale. RENTALS + VEHICLES
      // are the day-range engine from 0298 (a fleet, and the bookings against
      // it). LEADS is still the single inquiry channel for BUYING a car —
      // viewing / test-drive / offer — because no vehicle-sale engine exists.
      // Still no "orders" (a car does not go in a basket, so the screen would
      // always be empty) and still no separate "requests" inbox beside leads.
      daily: ["rentals", "vehicles", "leads", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  beauty: {
    Icon: Scissors,
    features: ["appointments", "catalog", "team", "reviews", "media", "location", "messaging"],
    heroTint: "from-tint-4-soft via-tint-4-soft/40 to-transparent",
    iconTint: "bg-tint-4-soft text-tint-4",
    customersNoun: "clients",
    modules: {
      daily: ["bookings", "doctors", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  fitness: {
    Icon: Dumbbell,
    features: ["memberships", "classes", "team", "reviews", "location", "media", "messaging"],
    heroTint: "from-tint-5-soft via-tint-5-soft/40 to-transparent",
    iconTint: "bg-tint-5-soft text-tint-5",
    customersNoun: "customers",
    modules: {
      daily: ["bookings", "doctors", "memberships", "classes", "members", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY,
      store: STORE,
    },
  },
  sportsCourts: {
    Icon: Trophy,
    features: ["timeslot", "memberships", "reviews", "location", "media", "messaging"],
    heroTint: "from-tint-5-soft via-tint-5-soft/40 to-transparent",
    iconTint: "bg-tint-5-soft text-tint-5",
    customersNoun: "customers",
    modules: {
      daily: ["bookings", "resources", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY,
      store: STORE,
    },
  },
  education: {
    Icon: GraduationCap,
    features: ["courses", "team", "memberships", "reviews", "verifications", "messaging", "media"],
    heroTint: "from-tint-5-soft via-tint-5-soft/40 to-transparent",
    iconTint: "bg-tint-5-soft text-tint-5",
    customersNoun: "clients",
    modules: {
      daily: ["bookings", "doctors", "courses", "memberships", "members", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY,
      store: STORE,
    },
  },
  events: {
    Icon: PartyPopper,
    features: ["timeslot", "catalog", "media", "reviews", "location", "messaging"],
    heroTint: "from-tint-1-soft via-tint-1-soft/40 to-transparent",
    iconTint: "bg-tint-1-soft text-tint-1",
    customersNoun: "clients",
    modules: {
      daily: ["tickets", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY,
      store: STORE,
    },
  },
  hospitality: {
    Icon: BedDouble,
    features: ["timeslot", "rentals", "catalog", "media", "reviews", "location", "messaging"],
    heroTint: "from-tint-1-soft via-tint-1-soft/40 to-transparent",
    iconTint: "bg-tint-1-soft text-tint-1",
    customersNoun: "customers",
    modules: {
      daily: ["stays", "units", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  // MJ-009. A pharmacy sells stock off a shelf; a lab sells an appointment with
  // preparation instructions and a result that arrives later. They are one
  // sector here, and this bundle is the pharmacy's: cart, stock, POS, no
  // scheduling module at all. A lab filed here can only list a blood test as a
  // catalogue row with a quantity selector.
  //
  // The split is right and production is the cheapest it will ever be for it —
  // ZERO stores sit under `pharmacy` today, so nothing would be stranded. It is
  // NOT done here because a new CategoryKey is not local to this file: two
  // exhaustive `Record<CategoryKey, …>` registries live in src/lib/discovery.ts
  // (`sectorDiscovery`, `CARD_FACTS`) and one in src/components/category-icon.tsx,
  // and a key added without them fails `tsc`. A sector that half-exists is worse
  // than the conflation, so the whole add belongs in one change that owns those
  // files too.
  //
  // What IS fixed meanwhile: the sector no longer advertises itself to labs (the
  // business_types row and dict.catalog.pharmacy said "Pharmacies & labs"; see
  // migration 0300), the registry's own sample data no longer prices a lab test
  // like a box of medicine, and a service row in a sector with no `appointments`
  // module stops promising a booking it cannot honour (offering.ts). A lab today
  // belongs under `healthcare`, which already books appointments and carries
  // verifications.
  pharmacy: {
    Icon: Pill,
    features: ["catalog", "orders", "verifications", "location", "reviews", "messaging"],
    heroTint: "from-tint-4-soft via-tint-4-soft/40 to-transparent",
    iconTint: "bg-tint-4-soft text-tint-4",
    customersNoun: "customers",
    modules: {
      daily: ["orders", "pos", "items", "inventory", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  petCare: {
    Icon: PawPrint,
    features: ["appointments", "catalog", "team", "reviews", "location", "messaging", "media"],
    heroTint: "from-tint-4-soft via-tint-4-soft/40 to-transparent",
    iconTint: "bg-tint-4-soft text-tint-4",
    customersNoun: "clients",
    modules: {
      daily: ["bookings", "doctors", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  professional: {
    Icon: Scale,
    features: ["appointments", "requests", "verifications", "team", "reviews", "messaging"],
    heroTint: "from-tint-7-soft via-tint-7-soft/40 to-transparent",
    iconTint: "bg-tint-7-soft text-tint-7",
    customersNoun: "clients",
    modules: {
      daily: ["requests", "bookings", "doctors", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY,
      store: STORE,
    },
  },
  contractors: {
    Icon: HardHat,
    features: ["requests", "portfolio", "verifications", "reviews", "location", "messaging", "media"],
    heroTint: "from-tint-7-soft via-tint-7-soft/40 to-transparent",
    iconTint: "bg-tint-7-soft text-tint-7",
    customersNoun: "clients",
    modules: {
      daily: ["requests", "portfolio", "items", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
  farm: {
    Icon: Sprout,
    features: ["catalog", "orders", "delivery", "reviews", "location", "media"],
    heroTint: "from-tint-6-soft via-tint-6-soft/40 to-transparent",
    iconTint: "bg-tint-6-soft text-tint-6",
    customersNoun: "customers",
    modules: {
      daily: ["orders", "items", "inventory", "tasks"],
      people: ["customers", "campaigns", "automations", "staff", "hr"],
      money: MONEY_WITH_SUPPLIERS,
      store: STORE,
    },
  },
};

/** Convenience: full sector config + legacy flow config in one lookup. */
export function getSector(category: CategoryKey) {
  return { ...sectorConfig[category], flow: categoryModule[category] };
}

/** The sector's default feature bundle. */
export function sectorDefaultModules(category: CategoryKey): FeatureModuleKey[] {
  return sectorConfig[category].features;
}

/** A sector's primary "core" setup entity — the first thing that sector must
 *  create before it can transact — when it differs from plain products. Drives
 *  a sector-aware onboarding step so a hotel is told to add a unit and an events
 *  organizer to add ticket types, instead of the generic "add products" nudge.
 *  Sectors whose core IS products/services return null (the generic step fits).
 */
export function sectorPrimarySetup(
  category: CategoryKey,
): {
  table: string;
  module: OsModuleKey;
  labelKey: "units" | "tickets" | "vehicles";
} | null {
  if (category === "hospitality")
    return { table: "accommodation_units", module: "units", labelKey: "units" };
  if (category === "events")
    return { table: "event_ticket_types", module: "tickets", labelKey: "tickets" };
  // Same reasoning as the hotel: an automotive store cannot take a rental
  // until there is a car to rent, so "add your first vehicle" is the honest
  // first step rather than the generic "add products" nudge.
  if (category === "automotive")
    return { table: "rental_vehicles", module: "vehicles", labelKey: "vehicles" };
  return null;
}

// ===== The team module's per-sector identity =====
//
// The roster module is keyed `doctors` because its table, its route and its RPCs
// are called that, and renaming those is a migration this file has no business
// forcing. What the merchant and the customer SEE is a different question, and
// it leaked: every sector that has a team — a salon, a gym, a school, a vet, a
// law firm — rendered its people under a stethoscope and one shared word,
// because the storage key was being used as the label.
//
// So the key stays and the presentation moves here. The Record is exhaustive
// over CategoryKey deliberately: a sector added later without deciding what it
// calls its people fails `tsc`, rather than shipping as "doctors". Sectors with
// no team in their default bundle still need an entry — `team` is a per-store
// toggle (resolveStoreModules), so any of them can turn one on.
export type TeamLabelKey =
  | "doctors"
  | "stylists"
  | "trainers"
  | "teachers"
  | "vets"
  | "consultants"
  | "technicians"
  | "crew"
  | "chefs"
  | "agents"
  | "sales"
  | "organizers"
  | "hotelStaff"
  | "pharmacists"
  | "team";

export type SectorTeamMeta = {
  /** Glyph for the roster — sidebar, phone tab bar, and the storefront's
   *  fallback avatar when a provider uploaded no photo. */
  Icon: LucideIcon;
  /** dict key under `os.team.*`. Present in both locales or `tsc` fails. */
  labelKey: TeamLabelKey;
};

export const SECTOR_TEAM_META: Record<CategoryKey, SectorTeamMeta> = {
  food: { Icon: ChefHat, labelKey: "chefs" },
  retail: { Icon: Users, labelKey: "team" },
  services: { Icon: Wrench, labelKey: "technicians" },
  healthcare: { Icon: Stethoscope, labelKey: "doctors" },
  realEstate: { Icon: Building2, labelKey: "agents" },
  automotive: { Icon: Car, labelKey: "sales" },
  beauty: { Icon: Scissors, labelKey: "stylists" },
  fitness: { Icon: Dumbbell, labelKey: "trainers" },
  sportsCourts: { Icon: Trophy, labelKey: "trainers" },
  education: { Icon: GraduationCap, labelKey: "teachers" },
  events: { Icon: PartyPopper, labelKey: "organizers" },
  hospitality: { Icon: BedDouble, labelKey: "hotelStaff" },
  pharmacy: { Icon: Pill, labelKey: "pharmacists" },
  petCare: { Icon: PawPrint, labelKey: "vets" },
  professional: { Icon: Scale, labelKey: "consultants" },
  contractors: { Icon: HardHat, labelKey: "crew" },
  farm: { Icon: Sprout, labelKey: "team" },
};

/** What this sector calls its roster, and the glyph that stands for it.
 *
 *  Falls back to the neutral "team" entry for an unknown category rather than
 *  throwing: a store row whose business_type slug has drifted should render a
 *  plain team page, not a 500. */
export function sectorTeamMeta(category: CategoryKey): SectorTeamMeta {
  return SECTOR_TEAM_META[category] ?? { Icon: Users, labelKey: "team" };
}

/** Whether this store has a roster of service providers (a "team") — clinics,
 *  salons, gyms, schools, pet care, professional services. Drives the provider
 *  (team) module + booking provider picker across sectors.
 *
 *  Accepts the RESOLVED module set. Reading sector defaults directly meant a
 *  store that switched `team` off still advertised a team, and one that switched
 *  it on was told it had none — the only module whose per-store override was
 *  silently ignored. The category-only form is kept for callers that have no
 *  store in hand (the create form, sector docs). */
export function sectorHasTeam(
  category: CategoryKey,
  modules?: Set<FeatureModuleKey>,
): boolean {
  if (modules) return modules.has("team");
  return sectorConfig[category]?.features.includes("team") ?? false;
}

// ===== Public profile composition =====
//
// The registry ordered modules for the MERCHANT dashboard and said nothing about
// the customer-facing page, so all of it rendered in one hardcoded JSX sequence —
// identical for all 17 sectors. A clinic listed its doctors at position 19, below
// the product grid; a salon's portfolio sat below everything it was there to
// sell. The sections were sector-aware. Their ORDER never was.
export type ProfileSectionKey =
  | "announcement"
  | "hero"
  | "header"
  | "branches"
  | "delivery"
  | "location"
  | "hours"
  | "serviceRequest"
  | "leadForm"
  | "stay"
  | "rental"
  | "tickets"
  | "resources"
  | "memberships"
  | "classes"
  | "reservations"
  | "courses"
  | "portfolio"
  | "catalog"
  | "healthcareInfo"
  | "doctors"
  | "verifications"
  // Phase 3 (profile engine, src/lib/profile-engine.ts). `summary` is the
  // at-a-glance WHO / WHAT / WHEN / WHERE / HOW MUCH / WHY TRUST block; it
  // renders only for the sectors the engine gives one and only with at least
  // two real facts. `loyalty` is a slot: it renders nothing until a component
  // is registered for it (src/components/store/profile-module-registry.ts).
  | "summary"
  | "loyalty"
  | "reviews";

/** Exactly the order the page rendered before this existed, so any sector
 *  without an explicit composition keeps rendering as it did. The two keys
 *  added since (`summary`, `loyalty`) render nothing unless the profile
 *  engine finds content for them, so their default slots change no page. */
export const DEFAULT_PROFILE_ORDER: ProfileSectionKey[] = [
  "announcement",
  "hero",
  "header",
  "summary",
  "branches",
  "delivery",
  "location",
  "hours",
  "serviceRequest",
  "leadForm",
  "stay",
  "rental",
  "tickets",
  "resources",
  "memberships",
  "classes",
  "reservations",
  "courses",
  "portfolio",
  "catalog",
  "healthcareInfo",
  "doctors",
  "verifications",
  "loyalty",
  "reviews",
];

// The lead of every page is fixed — identity is not a sector preference. What
// moves is whatever the customer actually came for.
const LEAD: ProfileSectionKey[] = ["announcement", "hero", "header"];

const PROFILE_ORDER: Partial<Record<CategoryKey, ProfileSectionKey[]>> = {
  // You choose a clinic by its doctors, and its credentials are the trust
  // signal. Both used to sit below the product grid.
  //
  // Phase 3: the summary answers WHO / WHAT / WHEN / WHERE / HOW MUCH / WHY
  // TRUST in one block straight under the name — including "open right now,
  // and today's hours", which is why `hours` no longer has to sit above the
  // booking engine to answer that. The page then follows the same questions in
  // depth: the people, the services (and the calendar), the visit terms, the
  // week, the map, the credentials, the reviews.
  healthcare: [...LEAD, "summary", "doctors", "catalog", "healthcareInfo",
    "hours", "location", "branches", "verifications", "loyalty", "reviews",
    "reservations", "delivery"],
  // The work is the pitch: evidence first, price list second.
  beauty: [...LEAD, "portfolio", "catalog", "doctors", "memberships",
    "reservations", "hours", "reviews", "location", "branches", "delivery",
    "verifications"],
  // Nobody browses a restaurant's amenities. They read the menu — but only
  // after learning whether the food can reach them at all, which is what the
  // fulfillment strip above it answers.
  food: [...LEAD, "delivery", "catalog", "reservations", "hours", "loyalty",
    "reviews", "location", "branches"],
  // A stay begins with dates, not with a description.
  hospitality: [...LEAD, "stay", "catalog", "location", "hours", "reviews",
    "branches", "verifications"],
  // Listing marketplaces: the enquiry IS the transaction, so it belongs beside
  // the listing rather than at the foot of the page.
  realEstate: [...LEAD, "catalog", "leadForm", "location", "hours",
    "verifications", "reviews"],
  // A car business now has two things to offer and they are not equal. The
  // rental engine is a transaction that completes on the page, so it leads;
  // the listing grid and the buying enquiry follow it, in that order, because
  // "which car, then who do I talk to" is how someone shopping for a car reads.
  automotive: [...LEAD, "rental", "catalog", "leadForm", "location", "hours",
    "verifications", "reviews"],
  // The timetable is the product; memberships are how it gets paid for.
  fitness: [...LEAD, "classes", "resources", "memberships", "catalog", "doctors",
    "hours", "reviews", "location", "branches"],
  education: [...LEAD, "courses", "classes", "doctors", "catalog", "hours",
    "reviews", "location", "branches"],
  events: [...LEAD, "tickets", "catalog", "location", "hours", "reviews"],
  sportsCourts: [...LEAD, "resources", "classes", "memberships", "catalog",
    "hours", "reviews", "location", "branches"],
  // Trades sell evidence of work and trust before they sell a price.
  contractors: [...LEAD, "summary", "portfolio", "serviceRequest", "verifications", "catalog",
    "hours", "reviews", "location"],
  professional: [...LEAD, "summary", "serviceRequest", "doctors", "verifications", "portfolio",
    "catalog", "hours", "reviews", "location"],
  services: [...LEAD, "summary", "serviceRequest", "portfolio", "catalog",
    "doctors", "hours", "verifications", "loyalty", "reviews", "location",
    "branches"],
  petCare: [...LEAD, "catalog", "doctors", "reservations", "stay", "hours",
    "reviews", "location", "branches"],
  // The goods sectors had no composition of their own, so they inherited a
  // default in which the catalogue sits eighteenth — below branches, delivery,
  // the map, the opening hours and nine sections that render nothing for a shop.
  // Somebody who opens a shop's page came to see what it sells. This is the same
  // defect the clinic had, and it survived longer only because retail is the
  // fallback everything else was measured against.
  retail: [...LEAD, "catalog", "delivery", "loyalty", "reviews", "location",
    "hours", "branches", "verifications"],
  pharmacy: [...LEAD, "catalog", "delivery", "reviews", "location", "hours",
    "branches", "verifications"],
  farm: [...LEAD, "catalog", "delivery", "reviews", "location", "hours",
    "branches", "verifications"],
};

/** The section order for a sector's public profile.
 *
 *  Any key a composition omits is appended in default order rather than dropped.
 *  The failure mode of hand-written orderings is silent deletion — a storefront
 *  losing its reviews because somebody editing this file forgot to list them —
 *  and appending the remainder makes that impossible by construction. */
export function resolveProfileOrder(category: CategoryKey): ProfileSectionKey[] {
  const chosen = PROFILE_ORDER[category];
  if (!chosen) return DEFAULT_PROFILE_ORDER;
  const seen = new Set(chosen);
  return [...chosen, ...DEFAULT_PROFILE_ORDER.filter((k) => !seen.has(k))];
}

/** Effective enabled modules for a store: sector defaults + per-store toggles,
 *  with dependencies pulled in so the set is always internally consistent.
 *  `overrides` come from the store_modules table (added in a later phase). */
export function resolveStoreModules(
  category: CategoryKey,
  overrides?: Partial<Record<FeatureModuleKey, boolean>>,
): Set<FeatureModuleKey> {
  const base = new Set<FeatureModuleKey>(sectorDefaultModules(category));
  if (overrides) {
    for (const key of Object.keys(overrides) as FeatureModuleKey[]) {
      if (overrides[key]) base.add(key);
      else base.delete(key);
    }
  }
  return withDependencies(base);
}
