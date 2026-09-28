import type { CategoryKey } from "./catalog";
import type { FeatureModuleKey } from "./modules-catalog";
import type { StoreExperience } from "./store-experience";
import type { TrustKind } from "./trust";
import { resolveProfileOrder, type ProfileSectionKey } from "./sectors";

// ===== Business Profile Engine 2.0 =====
//
// The store page used to decide three things inline, in one 1,100-line file:
// which section exists (a `present` map of hand-mirrored null tests), which
// action the page leads with (a nested ternary), and — nowhere at all — which
// sections were empty shells. Two of those shells shipped to real customers: a
// dashed «ما في منتجات» box on every store with no catalogue, and «لسا ما في
// تقييمات» on fifteen of seventeen live stores.
//
// This module is the one place those decisions are made, as pure functions of
// facts the page has already fetched:
//
//   resolveBusinessProfile(sector, facts)  → which modules render, in what
//       order, which were omitted for lack of data, and the primary action.
//   resolveProfileSummary(facts)           → the WHO / WHAT / WHEN / WHERE /
//       HOW MUCH / WHY TRUST rows, each present only when its fact exists.
//   reviewVerification(review)             → what a review may claim about the
//       transaction behind it.
//
// ORDER still comes from the sector registry (`resolveProfileOrder` in
// sectors.ts) so there is one composition per sector, not two. What the engine
// adds is PRESENCE: a module with nothing real to show is omitted, never drawn
// as a placeholder. No I/O and no dictionary here, so every rule is unit-tested
// (src/lib/__tests__/profile-engine.test.ts).

/** Every module a profile can carry. The names are the page's section keys. */
export type ProfileModuleKey = ProfileSectionKey;

/** The profile family a sector is composed as. The four pilots get their own
 *  rules; every other sector keeps the generic composition. */
export type ProfileKind =
  | "retail"
  | "restaurant"
  | "healthcare"
  | "services"
  | "generic";

const KIND: Partial<Record<CategoryKey, ProfileKind>> = {
  retail: "retail",
  pharmacy: "retail",
  farm: "retail",
  food: "restaurant",
  healthcare: "healthcare",
  // "Crafts / services": a trade is chosen on evidence and trust before price.
  services: "services",
  contractors: "services",
  professional: "services",
};

export function profileKind(category: CategoryKey): ProfileKind {
  return KIND[category] ?? "generic";
}

/** Profile kinds that lead with the at-a-glance summary block. Retail and
 *  restaurant do not: their header (rating, open now, area) plus the delivery
 *  strip already answer the same questions, and a second card saying it again
 *  would push the menu / shelf further down. */
const SUMMARY_KINDS: ReadonlySet<ProfileKind> = new Set<ProfileKind>([
  "healthcare",
  "services",
]);

/** A summary with one row repeats the header; it earns its space at two. */
export const SUMMARY_MIN_ROWS = 2;

// ── Facts ───────────────────────────────────────────────────────────────────

/** Everything the engine needs, as counts and booleans the page already has.
 *  Nothing here is fetched by the engine and nothing is inferred by it. */
export type ProfileFacts = {
  /** A real database store (not the demo catalogue). */
  isReal: boolean;
  enabledModules: ReadonlySet<FeatureModuleKey>;
  experience: Pick<
    StoreExperience,
    | "itemSurface"
    | "showBooking"
    | "canOrderProducts"
    | "showServiceRequest"
    | "showLeadForm"
    | "showStay"
    | "showRental"
    | "showTickets"
    | "allowResourceBooking"
    | "directoryOnly"
  >;
  hasAnnouncement: boolean;
  /** Active catalogue rows by kind. */
  goods: number;
  services: number;
  /** getStoreCheckoutContext() returned a checkout — the order RPC can run. */
  checkoutAvailable: boolean;
  /** The offering resolver says goods on this sector transact (cart path). */
  goodsTransact: boolean;
  branches: number;
  mapPins: number;
  hasWeekHours: boolean;
  fulfilment: {
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    minOrder: number;
    hasPrepTime: boolean;
    hasPaymentNote: boolean;
    zones: number;
    couriers: number;
  };
  rentalVehicles: number;
  ticketTypes: number;
  resources: number;
  membershipPlans: number;
  classes: number;
  courses: number;
  portfolio: number;
  healthcare: {
    hasSpecialties: boolean;
    hasInsurance: boolean;
    cancelHours: number;
    pricedServices: number;
    timedServices: number;
  };
  doctors: number;
  /** Non-rejected store_verifications rows. */
  verifications: number;
  reviews: {
    /** Reviews the page will list (store + product reviews). */
    listed: number;
    /** A signed-in viewer who may write one (has a review already, or has a
     *  completed order/booking with the store). */
    viewerCanReview: boolean;
  };
  /** Summary rows resolveProfileSummary() produced (0 when not computed). */
  summaryRows: number;
  /** A component is registered for the loyalty slot. */
  loyaltyRegistered: boolean;
  /** A dialable WhatsApp / phone number (waNumber() survived). */
  hasContactNumber: boolean;
};

// ── Primary action ──────────────────────────────────────────────────────────

export type PrimaryAction =
  | "orderNow" // restaurant with a working order path — «اطلب الآن»
  | "addToCart" // goods with a working order path
  | "bookAppointment" // appointment engine with services in it
  | "contactStore"; // request / enquiry form, or WhatsApp as a last resort

export type PrimaryCta = {
  action: PrimaryAction;
  /** Scroll target on the page, or null for the outbound WhatsApp action. */
  targetId: string | null;
  /** True when the action leaves the page (wa.me). */
  outbound: boolean;
};

export type ResolvedProfile = {
  kind: ProfileKind;
  /** The full sector order (sectors.ts), before presence filtering. */
  order: ProfileModuleKey[];
  /** Modules that render, in order. `announcement` and `hero` are included
   *  when present; the page draws those two full-bleed. */
  modules: ProfileModuleKey[];
  present: Record<ProfileModuleKey, boolean>;
  /** Modules in the order that were withheld because they had no content. */
  omitted: ProfileModuleKey[];
  /** Whether this profile kind carries the at-a-glance summary at all. */
  hasSummary: boolean;
  /** The one action the page leads with, or null when nothing can be done
   *  from it (no engine, no form, no number). */
  primaryCta: PrimaryCta | null;
  /** The page can take an order or a booking right here. */
  transacts: boolean;
};

/** Whether ordering is ACTUALLY enabled — the only condition under which a
 *  restaurant may say «اطلب الآن». Every clause is a thing that has to be true
 *  for the order to reach the kitchen: the orders module is on, the catalogue
 *  renders as an order surface, there is something to order, the sector's
 *  goods transact, and a checkout could be assembled. */
export function orderingEnabled(f: ProfileFacts): boolean {
  return (
    f.isReal &&
    f.enabledModules.has("orders") &&
    f.experience.itemSurface === "order" &&
    f.experience.canOrderProducts &&
    f.goodsTransact &&
    f.checkoutAvailable &&
    f.goods > 0
  );
}

/** Booking is enabled: the appointment engine renders with services in it. */
export function bookingEnabled(f: ProfileFacts): boolean {
  return (
    f.isReal &&
    f.experience.itemSurface === "appointment" &&
    f.experience.showBooking &&
    f.services > 0
  );
}

/** How many rows the catalogue section lists as its primary content — the
 *  same split StoreProductsSection renders: services on an appointment
 *  surface, goods on an order surface, and EVERY row on a browse-only catalogue
 *  surface (a trade's service list is its catalogue; counting only goods there
 *  is what drew «no products» above a list of services). */
export function catalogPrimaryCount(
  f: Pick<ProfileFacts, "experience" | "goods" | "services">,
): number {
  const s = f.experience.itemSurface;
  return s === "appointment" ? f.services : s === "order" ? f.goods : f.goods + f.services;
}

function presence(
  f: ProfileFacts,
  kind: ProfileKind,
): Record<ProfileModuleKey, boolean> {
  const x = f.experience;
  const catalogPrimary = catalogPrimaryCount(f);
  // The goods cart a booking store may also carry (StoreProductsSection).
  const goodsCart =
    x.itemSurface === "appointment" &&
    x.canOrderProducts &&
    f.goods > 0 &&
    f.checkoutAvailable;
  const d = f.fulfilment;
  const h = f.healthcare;
  const summary =
    f.isReal && SUMMARY_KINDS.has(kind) && f.summaryRows >= SUMMARY_MIN_ROWS;
  return {
    announcement: f.isReal && f.hasAnnouncement,
    hero: true,
    header: true,
    summary,
    branches: f.branches > 1,
    // Mirrors StoreFulfillment's own null test.
    delivery:
      f.isReal &&
      f.enabledModules.has("orders") &&
      (d.acceptsDelivery ||
        d.acceptsPickup ||
        d.minOrder > 0 ||
        d.hasPrepTime ||
        d.hasPaymentNote ||
        d.zones > 0 ||
        d.couriers > 0),
    location: f.mapPins > 0 && f.enabledModules.has("location"),
    hours: f.hasWeekHours,
    serviceRequest: f.isReal && x.showServiceRequest,
    leadForm: f.isReal && x.showLeadForm,
    stay: f.isReal && x.showStay,
    rental: f.isReal && x.showRental && f.rentalVehicles > 0,
    tickets: f.isReal && x.showTickets && f.ticketTypes > 0,
    resources: f.resources > 0 && x.allowResourceBooking,
    memberships: f.membershipPlans > 0,
    classes: f.classes > 0 && x.allowResourceBooking,
    reservations: f.isReal && f.enabledModules.has("reservations"),
    courses: f.courses > 0,
    portfolio: f.portfolio > 0,
    // An empty catalogue is omitted, not drawn as a dashed «no products» box.
    // The demo catalogue always has rows.
    catalog: f.isReal ? catalogPrimary > 0 || goodsCart : true,
    // The visit-terms card. Its price-from and visit-length pills are what the
    // summary's HOW MUCH and WHAT rows already say (and each service row says
    // again), so once a summary renders the card earns its place only with a
    // fact the summary does not carry: specialties, insurance, a cancellation
    // window.
    healthcareInfo:
      kind === "healthcare" &&
      (h.hasSpecialties ||
        h.hasInsurance ||
        h.cancelHours > 0 ||
        (!summary && (h.pricedServices > 0 || h.timedServices > 0))),
    doctors: f.doctors > 0,
    verifications:
      f.isReal && f.enabledModules.has("verifications") && f.verifications > 0,
    loyalty: f.isReal && f.loyaltyRegistered,
    // «لسا ما في تقييمات» is a placeholder to a visitor who cannot write one
    // anyway (reviews need a completed order). It shows when there is
    // something to read, or when THIS viewer can add the first one.
    reviews:
      f.isReal &&
      f.enabledModules.has("reviews") &&
      (f.reviews.listed > 0 || f.reviews.viewerCanReview),
  };
}

export function resolveBusinessProfile(
  category: CategoryKey,
  facts: ProfileFacts,
): ResolvedProfile {
  const kind = profileKind(category);
  const order = resolveProfileOrder(category);
  const present = presence(facts, kind);
  const modules = order.filter((k) => present[k]);
  const omitted = order.filter((k) => !present[k]);

  const ordering = orderingEnabled(facts) && present.catalog;
  const booking = bookingEnabled(facts) && present.catalog;
  let primaryCta: PrimaryCta | null = null;
  if (booking) {
    primaryCta = { action: "bookAppointment", targetId: "offerings", outbound: false };
  } else if (ordering) {
    primaryCta = {
      action: kind === "restaurant" ? "orderNow" : "addToCart",
      targetId: "offerings",
      outbound: false,
    };
  } else if (present.serviceRequest) {
    primaryCta = { action: "contactStore", targetId: "sec-serviceRequest", outbound: false };
  } else if (present.leadForm) {
    primaryCta = { action: "contactStore", targetId: "sec-leadForm", outbound: false };
  } else if (facts.hasContactNumber && facts.isReal) {
    primaryCta = { action: "contactStore", targetId: null, outbound: true };
  }

  return {
    kind,
    order,
    modules,
    present,
    omitted,
    hasSummary: SUMMARY_KINDS.has(kind),
    primaryCta,
    transacts: booking || ordering,
  };
}

/** The whole profile in one call: modules, primary action, and the summary
 *  rows. Two passes because the summary's rows link only to sections that
 *  exist, and whether the summary itself exists depends on how many rows it
 *  has — neither pass reads the other's output for its own key. */
export function resolveProfile(
  category: CategoryKey,
  facts: Omit<ProfileFacts, "summaryRows">,
  summary: Omit<SummaryFacts, "present"> | null,
): { profile: ResolvedProfile; summaryRows: SummaryRow[] } {
  const first = resolveBusinessProfile(category, { ...facts, summaryRows: 0 });
  const rows =
    summary && first.hasSummary
      ? resolveProfileSummary({ ...summary, present: first.present })
      : [];
  const profile =
    rows.length > 0
      ? resolveBusinessProfile(category, { ...facts, summaryRows: rows.length })
      : first;
  return { profile, summaryRows: profile.present.summary ? rows : [] };
}

// ── At-a-glance summary ─────────────────────────────────────────────────────

export type SummaryRowKey =
  | "who"
  | "what"
  | "when"
  | "where"
  | "howMuch"
  | "whyTrust";

export type SummaryRow =
  | { key: "who"; count: number; specialties: string[]; more: number; targetId: string }
  | {
      key: "what";
      count: number;
      names: string[];
      more: number;
      minMinutes: number | null;
      maxMinutes: number | null;
      targetId: string | null;
    }
  | {
      key: "when";
      openNow: boolean;
      today: { open: string; close: string } | null;
      targetId: string | null;
    }
  | { key: "where"; area: string | null; branches: number; targetId: string | null }
  | {
      key: "howMuch";
      min: number | null;
      max: number | null;
      insurance: string | null;
      targetId: string | null;
    }
  | {
      key: "whyTrust";
      signals: TrustKind[];
      rating: number | null;
      reviewCount: number;
      fulfilled: number;
      verifications: number;
      targetId: string | null;
    };

export type SummaryFacts = {
  /** The roster (doctors / providers), in display order. */
  team: { specialty: string | null }[];
  /** Service rows: name, price and the recorded visit length. */
  services: { name: string; price: number; minutes: number | null }[];
  /** Free-text the merchant wrote; null when blank. */
  specialtiesText: string | null;
  insurance: string | null;
  /** isOpenNow(): null when no weekly grid is configured. */
  openNow: boolean | null;
  today: { open: string; close: string } | null;
  area: string | null;
  branches: number;
  /** Admin-reviewed trust signals only (lib/trust.ts) — never a paid plan. */
  signals: TrustKind[];
  /** Store reviews (the header's rating source). */
  reviewCount: number;
  rating: number | null;
  fulfilled: number;
  /** Admin-VERIFIED documents only. */
  verifiedDocuments: number;
  /** Which on-page sections exist, so a row only links to something real. */
  present: Partial<Record<ProfileModuleKey, boolean>>;
};

const LIST_MAX = 3;

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.replace(/\s+/g, " ").trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** The at-a-glance rows. A row exists only when its fact does: a clinic that
 *  never listed a doctor gets no WHO row (not "the doctor" guessed from the
 *  store name), an unpriced service list gets no HOW MUCH row (never "$0"),
 *  and a store no one reviewed and no admin verified gets no WHY TRUST row. */
export function resolveProfileSummary(f: SummaryFacts): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const at = (k: ProfileModuleKey, id: string = `sec-${k}`) =>
    f.present[k] ? id : null;

  if (f.team.length > 0) {
    const specs = uniq(f.team.map((t) => t.specialty ?? ""));
    rows.push({
      key: "who",
      count: f.team.length,
      specialties: specs.slice(0, LIST_MAX),
      more: Math.max(0, specs.length - LIST_MAX),
      targetId: "sec-doctors",
    });
  }

  const names = uniq(f.services.map((s) => s.name));
  const specText = f.specialtiesText?.trim() || null;
  if (names.length > 0 || specText) {
    const mins = f.services
      .map((s) => s.minutes)
      .filter((m): m is number => m != null && m > 0);
    rows.push({
      key: "what",
      count: names.length,
      names: names.length ? names.slice(0, LIST_MAX) : [specText as string],
      more: Math.max(0, names.length - LIST_MAX),
      minMinutes: mins.length ? Math.min(...mins) : null,
      maxMinutes: mins.length ? Math.max(...mins) : null,
      targetId: names.length ? at("catalog", "offerings") : null,
    });
  }

  if (f.openNow != null) {
    rows.push({
      key: "when",
      openNow: f.openNow,
      today: f.today,
      targetId: at("hours"),
    });
  }

  const area = f.area?.trim() || null;
  if (area || f.branches > 1) {
    rows.push({
      key: "where",
      area,
      branches: f.branches > 1 ? f.branches : 0,
      targetId: at("location") ?? at("branches"),
    });
  }

  const prices = f.services.map((s) => s.price).filter((p) => p > 0);
  const insurance = f.insurance?.trim() || null;
  if (prices.length > 0 || insurance) {
    rows.push({
      key: "howMuch",
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      insurance,
      targetId: prices.length ? at("catalog", "offerings") : null,
    });
  }

  const rated = f.reviewCount > 0 && f.rating != null;
  if (f.signals.length > 0 || rated || f.fulfilled > 0 || f.verifiedDocuments > 0) {
    rows.push({
      key: "whyTrust",
      signals: [...f.signals],
      rating: rated ? f.rating : null,
      reviewCount: rated ? f.reviewCount : 0,
      fulfilled: Math.max(0, f.fulfilled),
      verifications: f.verifiedDocuments,
      targetId: at("verifications") ?? at("reviews"),
    });
  }

  return rows;
}

// ── Reviews 2.0 ─────────────────────────────────────────────────────────────

/** What a review may say about the transaction behind it.
 *
 *  `orderedOnMatjar` — the row carries database evidence that its author
 *  ordered the reviewed item on Matjar: `product_reviews.verified`, which the
 *  set_product_review_verified() trigger derives from order_items on every
 *  insert AND update (0273), so the author cannot set it.
 *
 *  `unconfirmed` — everything else, including EVERY store-level review. The
 *  reviews insert policy has demanded a completed order or booking since 0143,
 *  but the row itself records nothing, older rows predate the rule, and the
 *  author's account id is (rightly) not readable by the page (MP-010). Checked
 *  directly on 2026-09-25: three of the five live store reviews have no
 *  completed purchase behind them. So no store review is ever labelled
 *  verified — not even the ones that are — until the row carries the fact. */
export type ReviewVerification = "orderedOnMatjar" | "unconfirmed";

export type ReviewSource = "store" | "product";

export function reviewVerification(r: {
  source: ReviewSource;
  /** product_reviews.verified — ignored for store reviews. */
  verified?: boolean | null;
}): ReviewVerification {
  return r.source === "product" && r.verified === true
    ? "orderedOnMatjar"
    : "unconfirmed";
}

/** One review as the profile shows it. No account id, ever (MP-010). */
export type ProfileReview = {
  id: string;
  source: ReviewSource;
  rating: number;
  comment: string | null;
  authorName: string | null;
  createdAt: string | null;
  /** The shop's answer — store reviews only (reviews.reply, 0276). */
  reply: string | null;
  replyAt: string | null;
  /** The product or service the review is about, when the row says so. */
  subject: { id: string; name: string; kind: "product" | "service" } | null;
  verification: ReviewVerification;
};

export type ReviewSummary = {
  /** Store-level reviews — the same set the header's rating is computed from. */
  storeCount: number;
  storeAverage: number | null;
  /** Reviews of this store's products and services. */
  itemCount: number;
  /** How many carry `orderedOnMatjar`. */
  orderedCount: number;
};

export function summarizeReviews(list: readonly ProfileReview[]): ReviewSummary {
  const store = list.filter((r) => r.source === "store");
  const items = list.filter((r) => r.source === "product");
  return {
    storeCount: store.length,
    storeAverage: store.length
      ? store.reduce((s, r) => s + r.rating, 0) / store.length
      : null,
    itemCount: items.length,
    orderedCount: list.filter((r) => r.verification === "orderedOnMatjar").length,
  };
}

/** Newest first; a review with no date sorts last rather than first. */
export function sortReviews(list: readonly ProfileReview[]): ProfileReview[] {
  return [...list].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : -Infinity;
    const tb = b.createdAt ? Date.parse(b.createdAt) : -Infinity;
    return tb - ta;
  });
}
