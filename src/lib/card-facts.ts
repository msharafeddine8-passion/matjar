import type { CategoryKey, RegionKey, Store } from "./catalog";
import {
  resolveCardFacts,
  type StoreFact,
  type StoreFactSource,
} from "./discovery";

// ===== Sector-aware result cards =====
//
// One StoreCard renders every sector. What differs between a butcher, a clinic
// and a salon is not the markup but WHICH facts a buyer of that sector decides
// by, and in what order: a restaurant is chosen on "do they deliver, how long,
// how much", a clinic on "where is it and what does a visit cost", a salon on
// "what does it start from". This module is that decision, once, as data.
//
// The rule it shares with lib/discovery.ts:
//
//   A fact is emitted only when a real column or row backs it.
//
// No cuisine (no column exists), no specialty (`stores.specialties` is empty
// for every live store), no "next available slot" (not computable without the
// booking engine per store), no ETA or fee without a delivery zone the merchant
// created, no rating below one review. An absent fact is absent — never zero-
// filled, never "—", never estimated.

/** How a sector's card is laid out. Five, deliberately — not seventeen. */
export type CardVariant =
  /** Goods you order: fulfilment first (retail, farm, pharmacy). */
  | "goods"
  /** Food: fulfilment and speed first. */
  | "food"
  /** A clinic: where it is, then what a visit costs. */
  | "clinic"
  /** Services you book: "starts from $X · N services". */
  | "service"
  /** Directory listings (property, vehicles): count and entry price. */
  | "listing";

export const CARD_VARIANT: Record<CategoryKey, CardVariant> = {
  retail: "goods",
  farm: "goods",
  pharmacy: "goods",
  food: "food",
  healthcare: "clinic",
  services: "service",
  beauty: "service",
  petCare: "service",
  fitness: "service",
  sportsCourts: "service",
  education: "service",
  professional: "service",
  contractors: "service",
  events: "service",
  hospitality: "service",
  realEstate: "listing",
  automotive: "listing",
};

export function cardVariant(category: CategoryKey): CardVariant {
  return CARD_VARIANT[category];
}

/**
 * Everything a card may know about one store. Every field is optional: the
 * resolver treats missing, null, empty and non-positive values as "no data".
 */
export type SectorCardSource = StoreFactSource & {
  /** Beirut-clock open state. `null`/absent when the store has no structured
   *  hours — which must NOT be rendered as "open". */
  openNow?: boolean | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
  acceptsDelivery?: boolean | null;
  acceptsPickup?: boolean | null;
  /** Active delivery zones' fee range (store_delivery_zones.fee). */
  deliveryFeeMin?: number | null;
  deliveryFeeMax?: number | null;
  /** Active delivery zones' ETA range, minutes. */
  deliveryEtaMin?: number | null;
  deliveryEtaMax?: number | null;
  /** stores.min_order */
  minOrder?: number | null;
  /** stores.prep_time — the merchant's own words. */
  prepTime?: string | null;
  /** Active item_kind = 'service' rows, and the lowest listed price among the
   *  priced ones. */
  serviceCount?: number | null;
  serviceMinPrice?: number | null;
  /** Lowest listed price over every active, priced catalogue row. */
  itemMinPrice?: number | null;
  area?: string | null;
  region?: RegionKey | null;
  /** stores.insurance — the clinic's own words. */
  insurance?: string | null;
};

/** A store as any card-rendering surface may hold it. Both extras are optional
 *  so demo rows, favourites and RPC rows stay valid Stores — and a store that
 *  does not say `hoursKnown: true` simply gets no open/closed claim. */
export type CardStore = Store & {
  hoursKnown?: boolean;
  facts?: SectorCardSource;
};

export type SectorCardFact =
  | { key: "open"; open: boolean }
  | { key: "rating"; avg: number; count: number }
  | { key: "fulfilment"; delivery: boolean; pickup: boolean }
  | { key: "deliveryFee"; min: number; max: number }
  | { key: "deliveryEta"; min: number; max: number }
  | { key: "minOrder"; amount: number }
  | { key: "prepTime"; text: string }
  | { key: "startingPrice"; amount: number }
  | { key: "serviceCount"; count: number }
  | { key: "location"; area: string | null; region: RegionKey | null }
  | { key: "insurance"; text: string }
  | StoreFact;

export type SectorCardFactKey = SectorCardFact["key"];

/** Order, per variant. Availability is the data's call below; this only says
 *  what a buyer of the sector reads first. `open`, `rating` and `location`
 *  lead every list because the card draws them in fixed slots (badge, star row,
 *  subtitle); the rest is the facts line, in this order. */
const ORDER: Record<CardVariant, SectorCardFactKey[]> = {
  goods: [
    "open",
    "rating",
    "location",
    "fulfilment",
    "deliveryFee",
    "deliveryEta",
    "minOrder",
    "offers",
    "catalog",
    "sections",
  ],
  food: [
    "open",
    "rating",
    "location",
    "fulfilment",
    "deliveryEta",
    "deliveryFee",
    "prepTime",
    "minOrder",
    "offers",
    "catalog",
    "sections",
  ],
  clinic: [
    "open",
    "rating",
    "location",
    "startingPrice",
    "serviceCount",
    "catalog",
    "providers",
    "insurance",
  ],
  service: [
    "open",
    "rating",
    "location",
    "startingPrice",
    "serviceCount",
    "catalog",
    "providers",
    "offers",
  ],
  listing: [
    "open",
    "rating",
    "location",
    "catalog",
    "startingPrice",
    "offers",
  ],
};

const pos = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
const nonNeg = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
const text = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

/**
 * The ordered, typed facts one card will render.
 *
 * Pure: the same source always yields the same list, and a field with nothing
 * behind it yields nothing — the tests pin "no fact when data missing" for
 * every key.
 */
export function resolveSectorCard(
  category: CategoryKey,
  source: SectorCardSource,
): SectorCardFact[] {
  const variant = cardVariant(category);
  // The pre-existing catalogue facts (count, offers, providers, sections) stay
  // decided in one place — lib/discovery.ts — and are merged in by key.
  const catalogFacts = new Map(
    resolveCardFacts(category, source).map((f) => [f.key, f] as const),
  );
  const out: SectorCardFact[] = [];
  const hasServices = pos(source.serviceCount);

  for (const key of ORDER[variant]) {
    switch (key) {
      case "open":
        if (typeof source.openNow === "boolean")
          out.push({ key, open: source.openNow });
        break;
      case "rating":
        if (pos(source.ratingCount) && pos(source.ratingAvg))
          out.push({
            key,
            avg: source.ratingAvg,
            count: Math.floor(source.ratingCount),
          });
        break;
      case "location": {
        const area = text(source.area);
        const region = source.region ?? null;
        if (area || region) out.push({ key, area, region });
        break;
      }
      case "fulfilment": {
        const delivery = source.acceptsDelivery === true;
        const pickup = source.acceptsPickup === true;
        if (delivery || pickup) out.push({ key, delivery, pickup });
        break;
      }
      case "deliveryFee":
        // A fee is a zone the merchant priced, and only meaningful while the
        // store delivers at all.
        if (
          source.acceptsDelivery === true &&
          nonNeg(source.deliveryFeeMin) &&
          nonNeg(source.deliveryFeeMax)
        )
          out.push({
            key,
            min: Math.min(source.deliveryFeeMin, source.deliveryFeeMax),
            max: Math.max(source.deliveryFeeMin, source.deliveryFeeMax),
          });
        break;
      case "deliveryEta": {
        if (source.acceptsDelivery !== true) break;
        const lo = pos(source.deliveryEtaMin) ? source.deliveryEtaMin : null;
        const hi = pos(source.deliveryEtaMax) ? source.deliveryEtaMax : null;
        if (lo == null && hi == null) break;
        const a = lo ?? (hi as number);
        const b = hi ?? (lo as number);
        out.push({ key, min: Math.min(a, b), max: Math.max(a, b) });
        break;
      }
      case "minOrder":
        if (pos(source.minOrder)) out.push({ key, amount: source.minOrder });
        break;
      case "prepTime": {
        const t = text(source.prepTime);
        if (t) out.push({ key, text: t });
        break;
      }
      case "startingPrice": {
        // Services: the cheapest priced SERVICE. Listings: the cheapest priced
        // row of any kind. Never a product price passed off as a visit fee.
        const amount =
          variant === "listing" ? source.itemMinPrice : source.serviceMinPrice;
        if (pos(amount)) out.push({ key, amount });
        break;
      }
      case "serviceCount":
        if (hasServices)
          out.push({ key, count: Math.floor(source.serviceCount as number) });
        break;
      case "insurance": {
        const t = text(source.insurance);
        if (t) out.push({ key, text: t });
        break;
      }
      case "catalog": {
        // On a service-style card the service count already says it; a second
        // "N items" beside it would count the same rows twice.
        const serviceStyle = variant === "clinic" || variant === "service";
        if (serviceStyle && hasServices) break;
        const f = catalogFacts.get("catalog");
        if (!f || f.key !== "catalog") break;
        // A services-sector store whose rows are all goods (live: a perfume
        // shop filed under beauty) sells products, not "3 services". Only
        // when the service count is KNOWN to be zero — without the rollup the
        // sector's own word stands.
        out.push(
          serviceStyle && source.serviceCount === 0
            ? { ...f, noun: "products" }
            : f,
        );
        break;
      }
      case "offers":
      case "providers":
      case "sections": {
        const f = catalogFacts.get(key);
        if (f) out.push(f);
        break;
      }
    }
  }
  return out;
}

/** Facts the card draws in fixed slots rather than in the facts line. */
export const SLOT_FACTS: ReadonlySet<SectorCardFactKey> = new Set([
  "open",
  "rating",
  "location",
]);

/** The part of a source every Store already carries — so a rail or a search
 *  result with no batched facts still gets an honest badge, rating and place. */
export function storeCardSource(
  store: Pick<Store, "isOpen" | "rating" | "reviews" | "area" | "region"> & {
    hoursKnown?: boolean;
  },
  lang: "ar" | "en",
): SectorCardSource {
  return {
    // `isOpen` defaults to true when hours are unconfigured (lib/hours.ts), so
    // it only becomes an open-state FACT when the store published hours.
    openNow: store.hoursKnown === true ? store.isOpen : null,
    ratingAvg: store.rating ?? null,
    ratingCount: store.reviews ?? null,
    area: store.area?.[lang] ?? null,
    region: store.region ?? null,
  };
}

/** The row-level columns (stores.*) a card may read. Shared by every loader
 *  that maps a stores row, so the three copies of rowToStore cannot drift. */
export type StoreCardRow = {
  accepts_delivery?: boolean | null;
  accepts_pickup?: boolean | null;
  min_order?: number | string | null;
  prep_time?: string | null;
  insurance?: string | null;
};

export function storeRowCardSource(row: StoreCardRow): SectorCardSource {
  const num = (v: number | string | null | undefined) =>
    v == null || v === "" ? null : Number(v);
  return {
    acceptsDelivery: row.accepts_delivery ?? null,
    acceptsPickup: row.accepts_pickup ?? null,
    minOrder: num(row.min_order),
    prepTime: row.prep_time ?? null,
    insurance: row.insurance ?? null,
  };
}
