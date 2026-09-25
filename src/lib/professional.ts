/**
 * The professional profile engine.
 *
 * A craftsman and a freelancer are the same kind of thing — a person you are
 * deciding whether to trust with a job — and the platform had modelled them as
 * two unrelated lists. Crafts were person-first in the database and gigs were
 * not: `gigs` carries `freelancer_id` AND a denormalised `freelancer_name`, and
 * puts `rating_avg` and `completed_count` on the SERVICE rather than the
 * person. The visible consequence is that the only freelancer on the platform
 * today appears as three unconnected adverts.
 *
 * This module is the shared shape both sectors resolve into. It is deliberately
 * a data contract and a resolver, not a component: the brief's own warning is
 * against "one giant component with dozens of boolean props", and the way you
 * get that is by letting each sector pass its own flags into a shared view.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The rule that governs every field here
 *
 * Every optional field means "absent" and MUST render nothing when absent. It
 * does not mean zero, and it does not mean "show a placeholder".
 *
 * That is not a style preference on this platform, it is the reality of the
 * data. Measured 2026-08-24 on production:
 *
 *   craft_providers          0 rows      — not one craftsman exists
 *   craft_services           0
 *   craft_works (portfolio)  0
 *   craft_reviews            0
 *   craft_requests           0
 *   trades / trade_groups    47 / 9      — the taxonomy is complete
 *   gigs                     3, all three belonging to ONE person
 *   that person's profile    name only: no photo, no bio, no skills,
 *                            no languages, not verified
 *   ratings anywhere         0
 *
 * So a profile built to always show a rating, a portfolio grid, a response time
 * and an availability line renders, today, as a page of empty boxes — which is
 * worse than the list it replaced. Each block asks whether it has anything to
 * say before it says it, and the completeness prompts exist to get the person
 * to fill them in.
 */

import type { Locale } from "@/i18n/config";

export type ProfessionalKind = "craft" | "freelance";

/**
 * How a price is expressed. Trades genuinely cannot always quote up front — an
 * electrician has to see the fault — so "we will quote you" is a first-class
 * answer here rather than a missing price.
 */
export type PricingMode =
  | "fixed" // a set price for a defined job
  | "from" // a floor: "starts from $x"
  | "hourly"
  | "per_unit" // priced by the metre, the panel, the door…
  | "visit_fee" // the call-out is priced; the work is quoted after
  | "quote_required"; // no number can honestly be shown

/**
 * Two notes on which of these the database can actually produce today.
 *
 * `craft_services.pricing_type` is CHECK-constrained to
 * `fixed | from | hourly | per_meter | quote`. `per_unit` exists because
 * `per_meter` does: a painter quoting by the square metre was being degraded to
 * "we'll quote you", which throws away a real number the tradesman gave. It
 * carries its `unit` so "$12" can never render without "the square metre"
 * beside it — a per-unit rate shown as a flat price is the single most
 * expensive misreading on a page like this.
 *
 * `visit_fee` has NO column behind it in any table. It is a real trade
 * practice and the shape is right, but nothing can write it until a migration
 * adds it, so treat any code path for it as unreachable rather than as a
 * shipped feature.
 */
export type ProfessionalPrice = {
  mode: PricingMode;
  /** Absent for `quote_required`, and absent is not zero. */
  amount?: number | null;
  /**
   * The thing being priced, for `per_unit` — "متر مربّع", "لوح". Required in
   * practice for that mode: without it the amount is a number with no meaning.
   */
  unit?: string | null;
  /** Only for a job with a genuinely known duration. */
  durationMinutes?: number | null;
};

export type ProfessionalService = {
  id: string;
  name: string;
  description?: string | null;
  price: ProfessionalPrice;
  /** Freelance delivery promise, in days. Never invented for trades. */
  deliveryDays?: number | null;
  revisions?: number | null;
  includes?: string[];
};

export type PortfolioItem = {
  id: string;
  title?: string | null;
  imageUrl: string;
  description?: string | null;
  /** Set only where a `before` image genuinely exists — see §19. */
  beforeImageUrl?: string | null;
  year?: number | null;
  /**
   * True only when this work came out of a completed job ON Matjar. It is the
   * strongest trust signal the platform can offer and it must never be set for
   * a self-uploaded image, which is what every portfolio item is today.
   */
  viaMatjar?: boolean;
};

/**
 * Verification, kept as separate facts rather than one ambiguous tick.
 *
 * A paid plan is NOT verification and the two must never merge: `pro` is a
 * subscription, everything else is something the platform checked.
 */
export type ProfessionalTrust = {
  identityVerified?: boolean;
  phoneVerified?: boolean;
  credentialVerified?: boolean;
  businessRegistered?: boolean;
  /** Subscription tier. Displayed apart from the verification facts. */
  pro?: boolean;
};

export type ProfessionalReview = {
  id: string;
  rating: number;
  comment?: string | null;
  customerName?: string | null;
  createdAt: string;
  /** Reply from the professional. */
  reply?: string | null;
  /** True when the review is attached to a completed Matjar job. */
  verifiedJob?: boolean;
};

/**
 * Where someone works — which is NOT where they live. A craftsman is often an
 * individual operating from home, and publishing that address would expose a
 * private residence. Areas and region only; `craft_provider_areas` already
 * models it this way and nothing here may widen it.
 */
export type ServiceArea = {
  region?: string | null;
  areas: string[];
  /** They travel to the customer rather than receiving them. */
  onSite?: boolean;
  /** Work delivered remotely — freelance. */
  remote?: boolean;
};

export type ProfessionalProfile = {
  kind: ProfessionalKind;
  id: string;
  name: string;
  /** "كهربائي منازل", "Graphic Designer" — what they do, in their words. */
  headline?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  /** Their trades or professional categories, most relevant first. */
  specialties: string[];
  skills: string[];
  languages: string[];
  yearsExperience?: number | null;
  trust: ProfessionalTrust;
  area: ServiceArea;
  services: ProfessionalService[];
  portfolio: PortfolioItem[];
  reviews: ProfessionalReview[];
  /** Denormalised aggregates. `null` when there are none — never 0 for display. */
  ratingAvg?: number | null;
  ratingCount: number;
  /** Jobs completed through Matjar. Only ever a counted fact. */
  completedCount?: number | null;
  /** Structured weekly hours, when the person keeps them. */
  hours?: unknown;
};

/* ────────────────────────────────────────────────────────────────────────── */

/** A rating is worth showing only when a real review is behind it. */
export function hasRating(p: {
  ratingAvg?: number | null;
  ratingCount: number;
}): boolean {
  return p.ratingCount > 0 && p.ratingAvg != null && p.ratingAvg > 0;
}

/**
 * The cheapest honest "from" price across a person's services, or null.
 *
 * `quote_required` services contribute no number by definition, and a person
 * offering only quoted work correctly yields null rather than 0 — "يبدأ من $0"
 * on a page about an electrician would be a lie the platform invented.
 */
export function startingPrice(services: ProfessionalService[]): number | null {
  const nums = services
    .map((s) =>
      // `per_unit` is excluded for the same reason `quote_required` is: "$12 the
      // square metre" is not a price the job starts at. Surfacing it as
      // "يبدأ من $12" on a card, stripped of its unit, would understate a
      // hundred-metre job by two orders of magnitude.
      s.price.mode === "quote_required" || s.price.mode === "per_unit"
        ? null
        : s.price.amount,
    )
    .filter((n): n is number => typeof n === "number" && n > 0);
  return nums.length ? Math.min(...nums) : null;
}

/**
 * Which blocks a profile page should render, in order.
 *
 * The order differs by kind because the deciding evidence differs. For a trade
 * you are asking "can this person be trusted in my home, and what will it
 * cost" — so trust and area come before the work. For freelance you are asking
 * "is this person good enough" — so the portfolio is the argument and leads.
 *
 * A block never appears with nothing in it.
 */
export type ProfileBlock =
  | "about"
  | "services"
  | "portfolio"
  | "skills"
  | "experience"
  | "area"
  | "availability"
  | "reviews";

const ORDER: Record<ProfessionalKind, ProfileBlock[]> = {
  // The work is the pitch; the price list follows it.
  craft: ["about", "services", "portfolio", "area", "availability", "experience", "reviews"],
  // Evidence first: for a designer, the portfolio IS the credential.
  freelance: ["about", "portfolio", "services", "skills", "experience", "reviews", "area"],
};

export function profileBlocks(p: ProfessionalProfile): ProfileBlock[] {
  const has: Record<ProfileBlock, boolean> = {
    about: Boolean((p.bio ?? "").trim()),
    services: p.services.length > 0,
    portfolio: p.portfolio.length > 0,
    skills: p.skills.length > 0,
    experience: p.yearsExperience != null && p.yearsExperience > 0,
    area: Boolean(p.area.areas.length || p.area.region || p.area.remote),
    availability: p.hours != null,
    reviews: p.reviews.length > 0,
  };
  return ORDER[p.kind].filter((b) => has[b]);
}

/**
 * What this person still has to add, for their own dashboard.
 *
 * Coaching, not a public score. A completeness percentage shown to CUSTOMERS
 * rates the professional on paperwork rather than on work, and the one
 * freelancer on the platform would currently score near zero — which says
 * nothing true about whether they are any good.
 */
export type CompletenessStep = {
  key: string;
  done: boolean;
  /** Ordering hint: the steps a customer actually decides on come first. */
  weight: number;
};

export function completeness(p: ProfessionalProfile): {
  steps: CompletenessStep[];
  done: number;
  total: number;
} {
  const common: CompletenessStep[] = [
    { key: "photo", done: Boolean(p.photoUrl), weight: 5 },
    { key: "headline", done: Boolean((p.headline ?? "").trim()), weight: 5 },
    { key: "bio", done: Boolean((p.bio ?? "").trim()), weight: 3 },
    { key: "services", done: p.services.length > 0, weight: 5 },
    { key: "portfolio", done: p.portfolio.length >= 3, weight: 4 },
  ];
  const perKind: CompletenessStep[] =
    p.kind === "craft"
      ? [
          { key: "trades", done: p.specialties.length > 0, weight: 5 },
          { key: "area", done: p.area.areas.length > 0, weight: 5 },
          { key: "hours", done: p.hours != null, weight: 3 },
          { key: "verify", done: Boolean(p.trust.identityVerified), weight: 2 },
        ]
      : [
          { key: "skills", done: p.skills.length >= 3, weight: 5 },
          { key: "languages", done: p.languages.length > 0, weight: 2 },
          { key: "verify", done: Boolean(p.trust.identityVerified), weight: 2 },
        ];
  const steps = [...common, ...perKind].sort((a, b) => b.weight - a.weight);
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}

/**
 * Sector-appropriate wording for the primary action. A trade is asked to come
 * and do a job; a freelancer is asked to quote for one. Calling both "order"
 * is how a marketplace starts sounding like a shop that sells people.
 */
export function primaryCtaKey(kind: ProfessionalKind): "requestService" | "requestQuote" {
  return kind === "craft" ? "requestService" : "requestQuote";
}

/** Locale-aware years-of-experience phrasing lives with the dictionary, not here. */
export type ProfessionalCopyLocale = Locale;

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The zero-supply index rule (prelaunch phase 4).
 *
 * A directory page with nobody in it is thin content: 47 crafts trade pages
 * that all say "no tradesman yet" are 47 near-duplicates to a search engine,
 * and a filtered view (`?area=`, `?type=`, `?view=`) is a crawl trap of
 * permutations. So a page is indexable only when it can answer with real
 * supply AND it is the canonical, unfiltered view.
 *
 * `uniqueContent` is the escape hatch for a page whose value does not depend
 * on supply — the /crafts landing carries the whole 47-trade taxonomy and the
 * symptom index, which is worth ranking even at zero providers. Nothing sets
 * it for a page that merely has a nice empty state.
 *
 * `follow` is always true: the links out of an empty page (the request flow,
 * the sibling trades, the join page) are exactly what a crawler should find.
 * The navigation stays; only the index entry goes.
 */
export type SupplyRobots = { index: boolean; follow: true };

export function supplyRobots(opts: {
  /** Real, browsable rows this exact view would show. Negative/NaN = 0. */
  supply: number;
  /** Any query parameter that narrows or re-sorts the canonical view. */
  filtered?: boolean;
  /** The page is worth indexing without supply (see above). */
  uniqueContent?: boolean;
}): SupplyRobots {
  const supply = Number.isFinite(opts.supply) && opts.supply > 0 ? opts.supply : 0;
  if (opts.filtered) return { index: false, follow: true };
  return { index: supply > 0 || opts.uniqueContent === true, follow: true };
}

/**
 * Split a list of services into "this same person's other services" and
 * "someone else's", dropping the service being viewed.
 *
 * The gig page used to show "related services" straight out of browse_gigs by
 * category — which, with one freelancer on the platform, is that same person's
 * other two gigs dressed as two other sellers. The same person's work belongs
 * under their name; "related" means other people.
 */
export function splitServicesByOwner<T extends { id: string; freelancer_id: string }>(
  rows: T[],
  ownerId: string,
  currentId: string,
): { same: T[]; others: T[] } {
  const same: T[] = [];
  const others: T[] = [];
  for (const r of rows) {
    if (r.id === currentId) continue;
    (r.freelancer_id === ownerId ? same : others).push(r);
  }
  return { same, others };
}
