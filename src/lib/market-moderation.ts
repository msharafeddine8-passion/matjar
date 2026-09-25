// Sunday Market moderation signals — pure, no I/O.
//
// Every function here FLAGS; none of them removes, hides or rejects anything.
// The moderation queue (/admin/market/queue) sorts by these signals and a
// human decides. That is deliberate: a classifieds board on a platform this
// size cannot afford to eat a legitimate seller's listing because a price
// looked odd, and an automated takedown with no human in the loop is the
// failure mode the owner asked us not to build.
//
// The signals are computed from rows a market moderator can already read
// (listings, listing_reports, content_reports) plus the seller history RPC
// from migration 0313 (market_seller_facts). Before 0313 is applied the
// seller-history signals are simply absent.

/** Mirrors expire_stale_listings (migration 0039): 60 days from created_at. */
export const LISTING_LIFETIME_DAYS = 60;

/** A category median needs this many priced listings before a price can be
 *  called unusual. Below it, one odd listing would move the median itself. */
export const MIN_PRICE_SAMPLES = 5;

/** A price below 1/5 or above 5x the category median is worth a look. Wide
 *  on purpose: a used phone and a new one share a category. */
export const PRICE_LOW_RATIO = 0.2;
export const PRICE_HIGH_RATIO = 5;

/** An account younger than this is "new" — not suspicious by itself, only a
 *  tiebreaker that raises the priority of other signals. */
export const NEW_SELLER_DAYS = 7;

export type ModerationSignal =
  | "reported"
  | "duplicate"
  | "priceLow"
  | "priceHigh"
  | "priceMissing"
  | "noCategory"
  | "noImages"
  | "contactInText"
  | "newSeller"
  | "sellerSuspended"
  | "sellerRejections";

/** How much each signal moves a listing up the queue. Reports and a suspended
 *  seller are people/admins telling us something; the rest are heuristics. */
export const SIGNAL_WEIGHT: Record<ModerationSignal, number> = {
  reported: 50,
  sellerSuspended: 40,
  duplicate: 20,
  priceLow: 20,
  contactInText: 15,
  sellerRejections: 15,
  priceHigh: 10,
  noCategory: 8,
  newSeller: 5,
  noImages: 4,
  priceMissing: 2,
};

export type ModerationListing = {
  id: string;
  sellerId: string;
  title: string;
  description?: string | null;
  price: number | null;
  images: string[];
  categoryId: string | null;
  status: string;
  createdAt: string;
};

export type SellerFacts = {
  memberSince: string | null;
  isActive: boolean;
  listingsTotal: number;
  listingsLive: number;
  listingsRejected: number;
  listingsRemoved: number;
  reportsOpen: number;
  reportsTotal: number;
};

// Arabic diacritics + tatweel, and the letter variants people type
// interchangeably. Two titles that differ only by these are the same title.
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** A title reduced to what a person would call "the same words". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Listing id → the ids it duplicates.
 *
 * Two listings are duplicates when they are both still in play (pending /
 * active) and EITHER the same seller posted the same normalised title twice,
 * OR any two sellers used the very same first photo URL (a re-upload makes a
 * new URL, so a shared URL means the same stored file — copied from another
 * listing). Different sellers with the same title are not flagged: "iPhone 13"
 * is a title many honest people type.
 */
export function findDuplicates(
  listings: ModerationListing[],
): Map<string, string[]> {
  const live = listings.filter(
    (l) => l.status === "pending" || l.status === "active",
  );
  const byKey = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const list = byKey.get(key);
    if (list) list.push(id);
    else byKey.set(key, [id]);
  };
  for (const l of live) {
    const t = normalizeTitle(l.title);
    if (t) add(`t:${l.sellerId}:${t}`, l.id);
    const img = l.images[0]?.trim();
    if (img) add(`i:${img}`, l.id);
  }
  const out = new Map<string, string[]>();
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const others = ids.filter((x) => x !== id);
      const prev = out.get(id) ?? [];
      out.set(id, Array.from(new Set([...prev, ...others])));
    }
  }
  return out;
}

export type PriceStats = { median: number; samples: number };

/** Median price per category over priced listings that were approved at
 *  some point (active or sold). Pending ones are excluded so a batch of fake
 *  prices cannot set the bar it is then measured against. */
export function categoryPriceStats(
  listings: ModerationListing[],
): Map<string, PriceStats> {
  const buckets = new Map<string, number[]>();
  for (const l of listings) {
    if (!l.categoryId) continue;
    if (l.status !== "active" && l.status !== "sold") continue;
    if (l.price == null || !(l.price > 0)) continue;
    const b = buckets.get(l.categoryId);
    if (b) b.push(l.price);
    else buckets.set(l.categoryId, [l.price]);
  }
  const out = new Map<string, PriceStats>();
  for (const [cat, prices] of buckets) {
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median =
      prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    out.set(cat, { median, samples: prices.length });
  }
  return out;
}

/** "priceLow" | "priceHigh" | "priceMissing" | null. Never a verdict. */
export function priceSignal(
  price: number | null,
  stats: PriceStats | undefined,
): "priceLow" | "priceHigh" | "priceMissing" | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return "priceMissing";
  if (!stats || stats.samples < MIN_PRICE_SAMPLES || !(stats.median > 0)) return null;
  if (price < stats.median * PRICE_LOW_RATIO) return "priceLow";
  if (price > stats.median * PRICE_HIGH_RATIO) return "priceHigh";
  return null;
}

// A Lebanese mobile/landline in any of the usual spellings, or a link. In a
// listing's text this is how a deal is moved off the platform (and off any
// record) — worth a look, not a crime.
const PHONE_IN_TEXT =
  /(?:(?:\+|00)961[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3}\b)|(?:\b(?:0?3|7[016-9]|81)[\s-]?\d{3}[\s-]?\d{3}\b)/;
const LINK_IN_TEXT = /(?:https?:\/\/|www\.|wa\.me\/|t\.me\/)/i;

export function hasContactInText(text: string | null | undefined): boolean {
  if (!text) return false;
  const digits = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return PHONE_IN_TEXT.test(digits) || LINK_IN_TEXT.test(digits);
}

export function daysBetween(fromIso: string, now: Date): number {
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Days until the nightly sweep expires an active listing (0 = today). */
export function daysUntilExpiry(createdAt: string, now: Date): number {
  return Math.max(0, LISTING_LIFETIME_DAYS - daysBetween(createdAt, now));
}

export type ModerationContext = {
  duplicates: Map<string, string[]>;
  priceStats: Map<string, PriceStats>;
  /** listing id → open reports (listing_reports + content_reports). */
  openReports: Map<string, number>;
  /** seller id → history; absent when 0313 is not applied yet. */
  sellers?: Map<string, SellerFacts>;
  now: Date;
};

export function moderationSignals(
  l: ModerationListing,
  ctx: ModerationContext,
): ModerationSignal[] {
  const out: ModerationSignal[] = [];
  if ((ctx.openReports.get(l.id) ?? 0) > 0) out.push("reported");
  if ((ctx.duplicates.get(l.id)?.length ?? 0) > 0) out.push("duplicate");
  const p = priceSignal(
    l.price,
    l.categoryId ? ctx.priceStats.get(l.categoryId) : undefined,
  );
  if (p) out.push(p);
  if (!l.categoryId) out.push("noCategory");
  if (!l.images.length) out.push("noImages");
  if (hasContactInText(`${l.title}\n${l.description ?? ""}`)) out.push("contactInText");
  const s = ctx.sellers?.get(l.sellerId);
  if (s) {
    if (!s.isActive) out.push("sellerSuspended");
    if (s.listingsRejected >= 2) out.push("sellerRejections");
    if (s.memberSince && daysBetween(s.memberSince, ctx.now) < NEW_SELLER_DAYS)
      out.push("newSeller");
  }
  return out;
}

export function priorityScore(
  signals: ModerationSignal[],
  status: string,
  reports = 0,
): number {
  // A pending listing is waiting on us whatever its signals say.
  let score = status === "pending" ? 30 : 0;
  for (const s of signals) score += SIGNAL_WEIGHT[s];
  // Several people reporting the same listing is stronger than one.
  if (reports > 1) score += Math.min(reports - 1, 5) * 10;
  return score;
}

export type QueueItem<T extends ModerationListing = ModerationListing> = {
  listing: T;
  signals: ModerationSignal[];
  score: number;
  reports: number;
  duplicateOf: string[];
};

/** The queue: every pending listing, plus any live one with a signal worth
 *  a look (priceMissing alone is not — plenty of honest listings say "call"). */
export function buildQueue<T extends ModerationListing>(
  listings: T[],
  ctx: ModerationContext,
): QueueItem<T>[] {
  const items: QueueItem<T>[] = [];
  for (const l of listings) {
    if (l.status !== "pending" && l.status !== "active") continue;
    const signals = moderationSignals(l, ctx);
    const meaningful = signals.filter((s) => s !== "priceMissing" && s !== "noImages");
    if (l.status === "active" && meaningful.length === 0) continue;
    const reports = ctx.openReports.get(l.id) ?? 0;
    items.push({
      listing: l,
      signals,
      score: priorityScore(signals, l.status, reports),
      reports,
      duplicateOf: ctx.duplicates.get(l.id) ?? [],
    });
  }
  // Highest score first; oldest first within a score (it has waited longest).
  return items.sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(a.listing.createdAt) - Date.parse(b.listing.createdAt),
  );
}

/** Reasons a moderator can give. The key is stored; the text shown to the
 *  seller comes from the dictionary (moderation.rejectReasons). */
export const REJECT_REASONS = [
  "mismatch",
  "prohibited",
  "duplicate",
  "misleading",
  "price",
  "contact",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export function isRejectReason(v: unknown): v is RejectReason {
  return typeof v === "string" && (REJECT_REASONS as readonly string[]).includes(v);
}
