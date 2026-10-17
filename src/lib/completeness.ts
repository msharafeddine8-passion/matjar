import type { CategoryKey } from "@/lib/catalog";
import type { FeatureModuleKey } from "@/lib/modules-catalog";

// What a merchant still has to do, weighted by what it costs them to skip it.
//
// A checklist already existed: eight fixed items, identical for fifteen of the
// seventeen sectors. It is not wrong, it is just blind in the places the data
// says merchants actually stall. Measured on the live platform:
//
//   • 8 of 13 active stores have no map pin — while `location` is a default
//     module for 13 sectors, and "الأقرب إليك" cannot ship without it. The old
//     checklist never asked for one.
//   • 0 of 60 products carry a cost price — so the profit report, which is
//     built and working, computes zero for every merchant who opens it.
//
// Neither omission is visible to a merchant, because nothing ever told them.
//
// Two rules this module follows, both from hard experience elsewhere in this
// codebase:
//
// 1. A percentage must be earned, not counted. Weights are assigned by what the
//    missing thing costs — a shop with no map pin is unfindable; a shop with no
//    brand colour is merely plainer. Counting fields equally produces a number
//    that moves when nothing important changed, and merchants learn to ignore it.
//
// 2. "Complete" and "allowed to publish" are different questions. A profile can
//    be 60% complete and perfectly safe to show, or 90% complete and unsafe
//    because the one missing piece is the thing the transaction needs.

export type CompletenessItem = {
  /** dict.merchant.checklist.* key — the label lives in the dictionary. */
  key: string;
  done: boolean;
  /** Share of the score, relative to the other items for this sector. */
  weight: number;
  /** Blocks publishing rather than merely lowering the score. */
  required: boolean;
  /** Path segment under /merchant/[storeId], or "" for the store itself. */
  href: string;
};

export type Completeness = {
  /** 0–100, weighted. */
  score: number;
  items: CompletenessItem[];
  /** Required items still missing — the publish blockers. */
  missingRequired: CompletenessItem[];
  /** Everything required is present. */
  readyToPublish: boolean;
  /** The single next thing worth doing: the heaviest undone item. */
  next: CompletenessItem | null;
};

/** What the caller has already established about the store. Deliberately flat
 *  booleans and counts: this module does no I/O, so it stays testable and can be
 *  called from a server component without widening a query. */
export type StoreFacts = {
  logo: boolean;
  cover: boolean;
  description: boolean;
  hours: boolean;
  whatsapp: boolean;
  /** Coordinates on the map, not a text address. */
  mapPin: boolean;
  brandColor: boolean;
  customLink: boolean;
  /** Sellable things: products, units, ticket types — whatever this sector's
   *  primary entity is. The caller resolves which. */
  offerings: number;
  /** Offerings carrying a cost price — what the profit report needs. */
  offeringsWithCost: number;
  /** Providers on the roster, where the sector has a team. */
  providers: number;
  /** Whether the store's plan (trial included) can open the team screen. The
   *  team page is a Pro module: a required step behind a paywall would keep a
   *  free clinic "not ready" forever. Omitted = available. */
  teamAvailable?: boolean;
};

const BASE: Omit<CompletenessItem, "done">[] = [
  // Without these a storefront is not a storefront.
  { key: "cover", weight: 12, required: true, href: "edit" },
  { key: "description", weight: 8, required: true, href: "edit" },
  { key: "products", weight: 20, required: true, href: "items" },
  // Findable and contactable — the two things a local marketplace is for.
  { key: "hours", weight: 10, required: false, href: "edit" },
  { key: "whatsapp", weight: 10, required: false, href: "edit" },
  { key: "logo", weight: 8, required: false, href: "edit" },
  // Cosmetic. Real, but nobody loses a sale over a brand colour.
  { key: "brandColor", weight: 3, required: false, href: "settings" },
  { key: "customLink", weight: 4, required: false, href: "settings" },
];

/** A pin is required wherever the sector actually uses location — which is most
 *  of them. Driven off the resolved module set rather than a hand-maintained
 *  list, so a store that switches location off is not nagged for it. */
const MAP_PIN: Omit<CompletenessItem, "done"> = {
  key: "mapPin",
  weight: 15,
  required: true,
  href: "edit",
};

/** Cost prices power the profit report. Not required — a merchant may genuinely
 *  not want to record margins — but heavily weighted, because the report is
 *  built, reachable, and silently useless without them. */
const COST: Omit<CompletenessItem, "done"> = {
  key: "costPrices",
  weight: 10,
  required: false,
  // The cost field is on the product form itself; the inventory screen is a
  // Business module a free store can't open.
  href: "items",
};

/** A clinic without doctors, a salon without stylists: the module that defines
 *  the sector, empty. Required where the sector has a team at all. */
const TEAM: Omit<CompletenessItem, "done"> = {
  key: "team",
  weight: 15,
  required: true,
  href: "doctors",
};

export function computeCompleteness(
  category: CategoryKey,
  modules: Set<FeatureModuleKey>,
  facts: StoreFacts,
  /** Sectors whose primary entity is not products get their own label and link
   *  (a hotel adds units, an organiser adds ticket types). */
  primary?: { key: string; href: string },
): Completeness {
  const specs = [...BASE];

  if (modules.has("location")) specs.push(MAP_PIN);
  if (modules.has("team") && facts.teamAvailable !== false) specs.push(TEAM);
  // Only where the primary entity IS a product, and only once some exist.
  //
  // A hotel's offerings are rooms and an organiser's are ticket types, but cost
  // price lives on `products` — so asking those sectors for margins compares two
  // different populations and leaves an item that can never be satisfied. A
  // permanently undone step is worse than an absent one: it teaches the merchant
  // the whole checklist is noise.
  if (!primary && facts.offerings > 0) specs.push(COST);

  const items: CompletenessItem[] = specs.map((spec) => {
    const s =
      spec.key === "products" && primary
        ? { ...spec, key: primary.key, href: primary.href }
        : spec;
    return { ...s, done: isDone(spec.key, facts) };
  });

  const total = items.reduce((n, i) => n + i.weight, 0);
  const earned = items.reduce((n, i) => n + (i.done ? i.weight : 0), 0);
  const missingRequired = items.filter((i) => i.required && !i.done);

  // The heaviest undone thing, required or not. One instruction beats a list of
  // eight — a merchant who is told everything is told nothing.
  const next =
    [...items]
      .filter((i) => !i.done)
      .sort((a, b) => b.weight - a.weight)[0] ?? null;

  return {
    score: total === 0 ? 100 : Math.round((earned / total) * 100),
    items,
    missingRequired,
    readyToPublish: missingRequired.length === 0,
    next,
  };
}

function isDone(key: string, f: StoreFacts): boolean {
  switch (key) {
    case "logo":
      return f.logo;
    case "cover":
      return f.cover;
    case "description":
      return f.description;
    case "hours":
      return f.hours;
    case "whatsapp":
      return f.whatsapp;
    case "mapPin":
      return f.mapPin;
    case "brandColor":
      return f.brandColor;
    case "customLink":
      return f.customLink;
    // Three is the point where a page stops looking abandoned.
    case "products":
      return f.offerings >= 3;
    case "team":
      return f.providers > 0;
    // Not all-or-nothing: most of the catalogue priced is the useful threshold,
    // because a profit report is wrong in the same way at 0% and at 40%.
    case "costPrices":
      return f.offerings > 0 && f.offeringsWithCost >= Math.ceil(f.offerings * 0.8);
    default:
      return false;
  }
}
