import type { CategoryKey } from "./catalog";
import type { FeatureModuleKey } from "./modules-catalog";
import { resolveStoreModules } from "./sectors";
import { isDirectoryOnlySector } from "./store-experience";

// ===== Offering Experience Resolver =====
//
// Every row of `products` used to render as a Product. A dental cleaning was
// given a stock badge, "منتجات مشابهة" and "تقييمات المنتج"; a restaurant dish
// behaved like a retail SKU with a delivery promise. The table is shared by
// three declared kinds (`products.item_kind` ∈ product | service | digital) and
// seventeen sectors, and the detail page read none of that — it branched once,
// on `item_kind === 'service' || sector is not a commerce sector`, and rendered
// one hardcoded JSX sequence for everything else.
//
// This is the sibling of `resolveProfileOrder` in sectors.ts, for the OFFERING
// rather than the store: given a store category and the offering's own kind it
// returns the page variant, the primary CTA, and the ordered sections. It is a
// pure function (no I/O, no dictionary) so it is unit-testable and can be reused
// by any surface that has to speak about one offering.

/** `products.item_kind` — the three kinds an offering row may declare. */
export type OfferingKind = "product" | "service" | "digital";

/** The page shape. Three, deliberately: goods, appointments, menu items. */
export type OfferingVariant =
  | "physicalProduct"
  | "appointmentService"
  | "menuItem";

/** The primary action. Not a function of the variant alone: a physical good in
 *  a directory-only sector (a car, a flat) must not reach a cart. */
export type OfferingCtaKey =
  | "addToCart"
  | "addToOrder"
  | "bookAppointment"
  | "contactStore";

/** Which noun the whole page speaks in — indexes `dict.offering.<noun>.*`.
 *  This is what stops a clinic page saying "تقييمات المنتج". */
export type OfferingNoun = "product" | "service" | "dish";

export type OfferingSectionKey =
  | "gallery"
  | "header"
  | "price"
  | "duration"
  | "stock"
  | "included"
  | "description"
  | "provider"
  | "buyBox"
  | "share"
  | "policies"
  | "boughtTogether"
  | "reviews"
  | "qa"
  | "moreFromStore"
  | "related"
  | "recentlyViewed";

/** Exactly the order the page rendered before this existed (plus the two
 *  sections that had no home: `duration`, which was buried inside the booking
 *  box, and `provider`, which did not exist at all). Any variant that omits a
 *  key without DECLARING the omission gets it appended in this order. */
export const DEFAULT_OFFERING_SECTIONS: OfferingSectionKey[] = [
  "gallery",
  "header",
  "price",
  "duration",
  "stock",
  "included",
  "description",
  "provider",
  "buyBox",
  "share",
  "policies",
  "boughtTogether",
  "reviews",
  "qa",
  "moreFromStore",
  "related",
  "recentlyViewed",
];

/** Where a section renders. The page is a two-column hero plus a stack of
 *  full-width blocks; the resolver orders within each region rather than
 *  pretending the page is one flat list. */
export type OfferingSlot = "gallery" | "detail" | "page";

const DETAIL_SECTIONS: ReadonlySet<OfferingSectionKey> = new Set([
  "header",
  "price",
  "duration",
  "stock",
  "included",
  "description",
  "provider",
  "buyBox",
  "share",
  "policies",
]);

export function offeringSectionSlot(key: OfferingSectionKey): OfferingSlot {
  if (key === "gallery") return "gallery";
  return DETAIL_SECTIONS.has(key) ? "detail" : "page";
}

/** How a price is worded. `fixed` prints the number; `from` prefixes it with
 *  "يبدأ من" (the caller knows the number is a floor — a size range, a menu of
 *  options); `onConsult` prints no number at all, because a service whose
 *  merchant entered no price is priced after the consultation and "$0" would
 *  be a lie in the merchant's mouth. Goods never resolve to `onConsult`: a
 *  good with no price is a data error, not a pricing model. */
export type OfferingPriceLabel = "fixed" | "from" | "onConsult";

export type OfferingExperience = {
  variant: OfferingVariant;
  cta: OfferingCtaKey;
  noun: OfferingNoun;
  /** Ordered sections to render. Never contains a key twice. */
  sections: OfferingSectionKey[];
  /** Sections this variant DECLARES inapplicable. `sections` ∪ `omitted` is
   *  always the full key set — a section can be withheld on purpose, never by
   *  the accident of somebody forgetting to list it. */
  omitted: OfferingSectionKey[];
  /** The kind that "related"/"more from store" lists must be filtered to, so a
   *  clinic never recommends a t-shirt under "خدمات مشابهة" (and a retail page
   *  never lists a service under "منتجات مشابهة"). */
  relatedKind: OfferingKind;
  /** The buy box transacts on this page (cart/order). False when the offering
   *  routes into the booking engine or is directory-only. */
  transacts: boolean;
  // ── Facts every OTHER surface asks (cards, cart, rails, JSON-LD) ──────────
  // Each one used to be re-derived by the surface from `stock != null` or from
  // the sector, which is how a service card grew a stock badge. They are
  // answered here once, per variant, and tested per variant.
  /** Stock is a retail fact: the "متوفّر / باقي 3 / نفد المخزون" badge, the
   *  low-stock count on a card and the back-in-stock waitlist. Off for a dish
   *  (a kitchen runs out, it does not carry inventory) and for a service. */
  showsStock: boolean;
  /** A quantity stepper exists only where a basket does. */
  showsQuantity: boolean;
  /** Variants, add-ons and modifier groups — things you pick before it can be
   *  made or packed. A service has none: who performs it is `provider`, when
   *  is the booking engine's. */
  showsOptions: boolean;
  /** The merchant-entered `duration_minutes`, rendered where a duration means
   *  something (an appointment). Never inferred. */
  showsDuration: boolean;
  /** "/ كيلو" after the price — a goods-only reading of `sold_by`. */
  showsUnitPrice: boolean;
  /** What the card says the thing IS, when the card would otherwise pass for
   *  a product: "خدمة" on a service. Null where the picture and the price
   *  already say enough. */
  cardBadge: OfferingNoun | null;
  /** May a surface put this in a basket? True only for the two cart CTAs on a
   *  page that transacts. This is the ONE test the cart paths run: a service
   *  is never addable, whatever page it is standing on. */
  addableToCart: boolean;
};

type Composition = {
  sections?: OfferingSectionKey[];
  omit?: OfferingSectionKey[];
};

const COMPOSITION: Record<OfferingVariant, Composition> = {
  // Today's page, unchanged in order. A good has no duration and no roster of
  // people who deliver it.
  physicalProduct: {
    omit: ["duration", "provider"],
  },
  // You choose a service by what it is, how long it takes and who performs it —
  // then you book. Stock is meaningless for an appointment, and "يُشترى عادةً
  // مع" is retail language that has no business on a dental cleaning.
  appointmentService: {
    sections: [
      "gallery",
      "header",
      "price",
      "duration",
      "description",
      "included",
      "provider",
      "buyBox",
      "policies",
      "share",
      "reviews",
      "qa",
      "related",
      "moreFromStore",
      "recentlyViewed",
    ],
    omit: ["stock", "boughtTogether"],
  },
  // A dish is picture, description, price, then the options you must answer
  // before it can be cooked. Nobody reads a spec sheet for a shawarma.
  menuItem: {
    sections: [
      "gallery",
      "header",
      "price",
      "stock",
      "description",
      "included",
      "buyBox",
      "share",
      "policies",
      "boughtTogether",
      "reviews",
      "qa",
      "related",
      "moreFromStore",
      "recentlyViewed",
    ],
    omit: ["duration", "provider"],
  },
};

const NOUN: Record<OfferingVariant, OfferingNoun> = {
  physicalProduct: "product",
  appointmentService: "service",
  menuItem: "dish",
};

const RELATED_KIND: Record<OfferingVariant, OfferingKind> = {
  physicalProduct: "product",
  appointmentService: "service",
  menuItem: "product",
};

/** The per-variant facts that do not depend on the sector's engine. */
const FACTS: Record<
  OfferingVariant,
  Pick<
    OfferingExperience,
    | "showsStock"
    | "showsOptions"
    | "showsDuration"
    | "showsUnitPrice"
    | "cardBadge"
  >
> = {
  physicalProduct: {
    showsStock: true,
    showsOptions: true,
    showsDuration: false,
    showsUnitPrice: true,
    cardBadge: null,
  },
  appointmentService: {
    showsStock: false,
    showsOptions: false,
    showsDuration: true,
    showsUnitPrice: false,
    cardBadge: "service",
  },
  menuItem: {
    showsStock: false,
    showsOptions: true,
    showsDuration: false,
    showsUnitPrice: false,
    cardBadge: null,
  },
};

/** The two CTAs that put something in a basket. */
export function isCartCta(cta: OfferingCtaKey): boolean {
  return cta === "addToCart" || cta === "addToOrder";
}

/** How to word a price for an offering — see `OfferingPriceLabel`.
 *
 *  Pure and data-driven: `onConsult` is returned only when the row genuinely
 *  carries no price (null or 0) AND the thing is a service. Nothing here
 *  invents a number, and a merchant who typed $0 on a t-shirt still gets $0
 *  printed, because that is what they typed. */
export function offeringPriceLabel(args: {
  variant: OfferingVariant;
  price: number | null | undefined;
  /** The caller knows this number is a floor (variants at different prices,
   *  a service menu). Ignored when there is no number to be a floor of. */
  isFloor?: boolean;
}): OfferingPriceLabel {
  const priced = args.price != null && args.price > 0;
  if (!priced && args.variant === "appointmentService") return "onConsult";
  return priced && args.isFloor ? "from" : "fixed";
}

/** The page shape for an offering. */
export function offeringVariant(args: {
  category: CategoryKey;
  itemKind: OfferingKind;
}): OfferingVariant {
  // The kind wins over the sector: a clinic that sells supplements sells a
  // product, and a butcher that offers home cutting offers a service.
  if (args.itemKind === "service") return "appointmentService";
  if (args.category === "food") return "menuItem";
  return "physicalProduct";
}

/** The primary CTA for an offering.
 *
 *  A physical good in a directory-only sector (real estate, car sales — sectors
 *  whose transaction engine is not built, see store-experience.ts) never reaches
 *  a cart: it hands the customer to the store. Everything else transacts through
 *  the path its variant already owns — the cart for goods and dishes, the
 *  booking engine for services. No new transaction path is introduced here.
 *
 *  …and a booking is only offered where a booking can actually happen. The
 *  item-kind toggle is shown in EVERY sector on purpose (a boutique doing
 *  alterations, a phone shop doing repairs, a pharmacy that is really a lab),
 *  but the storefront's booking engine renders only when the `appointments`
 *  module is on — `resolveStoreExperience` derives `showBooking` from the
 *  module set, never from the slug. Those two disagreed: a service row in a
 *  sector without `appointments` was given "احجز موعدًا" pointing at
 *  `/store/<id>?service=<id>`, and the page it landed on had no calendar on it.
 *  That is live today for the `services` sector, whose bundle carries `requests`
 *  and not `appointments`. Where there is no engine the honest CTA is the one
 *  the directory-only sectors already use: go to the store and get in touch. */
export function offeringCta(args: {
  category: CategoryKey;
  itemKind: OfferingKind;
  /** The store's RESOLVED module set, when the caller has one. Omitted, the
   *  sector's default bundle is used — which is also the full set of modules a
   *  store in that sector can currently switch on (the modules screen offers
   *  `sectorDefaultModules` and nothing else), so the sector default is the
   *  right answer, not merely the available one. */
  enabledModules?: ReadonlySet<FeatureModuleKey>;
}): OfferingCtaKey {
  // Directory-only first: those sectors have no engine at all, so not even a
  // service row may promise a booking there.
  if (isDirectoryOnlySector(args.category)) return "contactStore";
  const variant = offeringVariant(args);
  if (variant === "appointmentService") {
    const modules = args.enabledModules ?? resolveStoreModules(args.category);
    return modules.has("appointments") ? "bookAppointment" : "contactStore";
  }
  return variant === "menuItem" ? "addToOrder" : "addToCart";
}

/** Resolve the whole offering-detail experience.
 *
 *  Any section a composition forgets to list is APPENDED in default order
 *  rather than dropped — the same guarantee `resolveProfileOrder` gives the
 *  store profile, and for the same reason: a hand-written ordering is exactly
 *  the kind of list somebody edits in a hurry, and a page silently losing its
 *  reviews is invisible until a merchant complains. A section that genuinely
 *  does not belong must be declared in `omit`, which is visible in the tests. */
export function resolveOffering(args: {
  category: CategoryKey;
  itemKind: OfferingKind;
  /** See `offeringCta` — the store's resolved modules when the caller has
   *  them, the sector's default bundle otherwise. */
  enabledModules?: ReadonlySet<FeatureModuleKey>;
}): OfferingExperience {
  const variant = offeringVariant(args);
  const { sections: chosen, omit = [] } = COMPOSITION[variant];
  const omitted = new Set<OfferingSectionKey>(omit);
  const base = DEFAULT_OFFERING_SECTIONS.filter((k) => !omitted.has(k));
  let sections: OfferingSectionKey[];
  if (!chosen) {
    sections = base;
  } else {
    const listed = new Set(chosen);
    sections = [...chosen, ...base.filter((k) => !listed.has(k))];
  }
  const cta = offeringCta(args);
  const transacts =
    variant !== "appointmentService" && !isDirectoryOnlySector(args.category);
  return {
    variant,
    cta,
    noun: NOUN[variant],
    sections,
    omitted: DEFAULT_OFFERING_SECTIONS.filter((k) => omitted.has(k)),
    relatedKind: RELATED_KIND[variant],
    transacts,
    ...FACTS[variant],
    showsQuantity: transacts,
    addableToCart: transacts && isCartCta(cta),
  };
}

/** The cart guard, in one place.
 *
 *  There is no server action between a basket and the order RPC — the two
 *  surfaces that build a basket call `place_customer_order` / `place_guest_order`
 *  directly, and those functions check status and availability but not
 *  `item_kind`. So the only guard this codebase can put in front of the RPC
 *  without a migration is this one: every surface that assembles a basket
 *  asks it first, and it throws rather than returns false, so a caller cannot
 *  forget to read the answer. The RPC-side counterpart (reject a service row
 *  in `p_items`) is described in the audit report; it is a DB change. */
export class OfferingNotAddableError extends Error {
  readonly cta: OfferingCtaKey;
  constructor(cta: OfferingCtaKey) {
    super(`offering_not_addable:${cta}`);
    this.name = "OfferingNotAddableError";
    this.cta = cta;
  }
}

export function assertAddableToCart(
  offering: Pick<OfferingExperience, "addableToCart" | "cta">,
): void {
  if (!offering.addableToCart) throw new OfferingNotAddableError(offering.cta);
}
