// ===== Matjar — Google free-listings product feed =====
//
// One feed per store at /feeds/<slug>/google.xml, in the RSS 2.0 +
// `xmlns:g="http://base.google.com/ns/1.0"` shape Google Merchant Center reads
// as a scheduled fetch. Meta's Commerce Manager accepts the same file as a
// catalog data feed: every attribute below uses the Google name, which is the
// name Meta's catalog spec also takes (id, title, description, link,
// image_link, price, sale_price, availability, condition, brand, gtin).
//
// The merchant connects it in their OWN Merchant Center account. Matjar pays
// nothing per store: no feed-management app, no AI rewrite of titles, no API
// key. The file is rendered from the catalogue as it stands and cached for an
// hour (see the route).
//
// Everything here is PURE — no I/O, no dictionary — so the mapping, the
// escaping and the exclusion rules are unit-tested in
// src/lib/__tests__/google-feed.test.ts. The route does the reading.
//
// What the feed will NEVER do: invent data. There is no barcode column; a GTIN
// is emitted only when the merchant's SKU is itself a checksum-valid GTIN. The
// SKU is never sent as an MPN (Google: "only submit MPNs assigned by a
// manufacturer" — a shop's own stock code is not one). The brand is the
// product's own `brand` when the merchant typed one, and otherwise the store's
// name, which is what the store page already prints as the seller.

import { toCategoryKey } from "./catalog";
import { resolveOffering, type OfferingKind } from "./offering";
import { effectivePlan, hasPlan } from "./plan-tiers";
import { isFlashActive } from "./pricing";
import { resolveStoreModules } from "./sectors";
import { resolveStoreExperience } from "./store-experience";

/** How long a rendered feed may be served before it is rebuilt. Google fetches
 *  a scheduled feed at most daily, so an hour is fresh enough and keeps a
 *  crawler hammering the URL from ever reaching the database per request. */
export const FEED_REVALIDATE_SECONDS = 3600;

/** Google's hard limits on the two text attributes. */
export const TITLE_MAX = 150;
export const DESCRIPTION_MAX = 5000;

/** Every price on Matjar is stored in US dollars — there is no currency column
 *  on `products` or `stores`; the LBP figure on the storefront is a display
 *  conversion at the admin's rate (lib/currency.ts formatLbp), never a stored
 *  price. The feed therefore states USD. If a per-store currency is ever
 *  added, it is this one constant that becomes a parameter. */
export const FEED_CURRENCY = "USD";

export type FeedStore = {
  id: string;
  name: string;
  slug: string | null;
  /** business_types.slug — the sector, resolved through toCategoryKey. */
  sectorSlug: string | null;
  status: string;
  deletedAt: string | null;
  plan: string | null;
  trialEndsAt: string | null;
  returnPolicy: string | null;
  shippingPolicy: string | null;
  googleFeedEnabled: boolean;
};

export type FeedProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string | null;
  discount_price: number | string | null;
  flash_price?: number | string | null;
  flash_start?: string | null;
  flash_end?: string | null;
  image_url: string | null;
  gallery?: unknown;
  stock: number | null;
  is_available: boolean;
  status: string;
  deleted_at: string | null;
  hidden_by_plan?: boolean | null;
  item_kind: string | null;
  brand: string | null;
  sku: string | null;
  attributes?: unknown;
};

export type FeedAvailability = "in_stock" | "out_of_stock";
export type FeedCondition = "new" | "used" | "refurbished";

export type FeedItem = {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  price: string;
  salePrice: string | null;
  /** ISO 8601 interval, only when the sale is a time-boxed flash price. */
  salePriceEffectiveDate: string | null;
  availability: FeedAvailability;
  condition: FeedCondition;
  brand: string;
  gtin: string | null;
};

/** Why a product row is left out of the feed. Also what the dashboard's
 *  checklist counts. */
export type FeedExclusion =
  | "not_active"
  | "deleted"
  | "unavailable"
  | "hidden_by_plan"
  | "not_physical_good"
  | "no_price"
  | "no_image"
  | "no_description";

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

// Characters XML 1.0 forbids outright (everything below U+0020 except tab, LF,
// CR, plus the two non-characters). A merchant pasting from Word can bring any
// of them in, and one of them makes Google reject the WHOLE file, not the item.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Strip characters XML 1.0 cannot carry at all. */
export function stripInvalidXml(value: string): string {
  return value.replace(INVALID_XML_CHARS, "");
}

/** Escape text for an XML attribute or element body. */
export function xmlEscape(value: string): string {
  return stripInvalidXml(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap merchant free text in CDATA. A literal "]]>" inside the text would
 *  close the section early, so it is split across two sections — the standard
 *  and only safe way to carry it. */
export function cdata(value: string): string {
  return `<![CDATA[${stripInvalidXml(value).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "12.00 USD" — Google's price format: a dot decimal, two places, a space,
 *  then the ISO 4217 code. Never grouped ("1,200.00" is rejected). */
export function formatFeedPrice(amount: number, currency: string = FEED_CURRENCY): string {
  return `${(Math.round(amount * 100) / 100).toFixed(2)} ${currency}`;
}

/** Collapse whitespace and cut at a word boundary under `max` characters. */
export function clampText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** GTIN-8/12/13/14 with a correct mod-10 check digit. The only way a GTIN
 *  reaches the feed: the merchant's SKU IS a real barcode number. */
export function isValidGtin(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v)) return false;
  // A run of zeros passes the checksum and is never a real GTIN.
  if (/^0+$/.test(v)) return false;
  const digits = v.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  // Weights 3,1,3,1… counted from the digit nearest the check digit.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** in_stock / out_of_stock from real data. `stock` null means the shop does
 *  not count stock (every product in production today), which is how the
 *  storefront reads it too: orderable, not "unknown". */
export function feedAvailability(row: Pick<FeedProductRow, "stock" | "is_available">): FeedAvailability {
  if (!row.is_available) return "out_of_stock";
  if (row.stock != null && row.stock <= 0) return "out_of_stock";
  return "in_stock";
}

/** "new" unless the merchant recorded otherwise on the retail/automotive
 *  `condition` attribute (lib/attributes.ts). */
export function feedCondition(attributes: unknown): FeedCondition {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    const c = (attributes as Record<string, unknown>).condition;
    if (c === "used") return "used";
    if (c === "refurbished") return "refurbished";
  }
  return "new";
}

function galleryUrls(gallery: unknown): string[] {
  if (!Array.isArray(gallery)) return [];
  return gallery.filter(
    (u): u is string => typeof u === "string" && /^https:\/\//i.test(u),
  );
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Whether the store's EFFECTIVE plan (an active trial counts as Pro, and never
 *  downgrades a paid plan) includes the feed. Pro and Business. */
export function feedPlanAllowed(plan: string | null | undefined, trialEndsAt: string | null | undefined): boolean {
  return hasPlan(effectivePlan(plan, trialEndsAt), "pro");
}

const hasText = (v: string | null | undefined) => !!v && v.trim().length > 0;

/** Whether the product is a purchasable physical good — the only thing Google
 *  Shopping lists. Decided by the offering resolver, never by a slug list: a
 *  service routes to booking, a dish is a menu item, a car or a flat in a
 *  directory-only sector cannot be bought on Matjar, and a digital download is
 *  not a physical good. */
export function isPurchasablePhysicalGood(
  row: Pick<FeedProductRow, "item_kind">,
  sectorSlug: string | null,
): boolean {
  const kind = (row.item_kind ?? "product") as OfferingKind;
  if (kind !== "product") return false;
  const category = toCategoryKey(sectorSlug, "google-feed");
  const offering = resolveOffering({ category, itemKind: kind });
  if (offering.variant !== "physicalProduct" || !offering.addableToCart) return false;
  // …and the storefront itself takes orders. The offering resolver lets a car
  // reach a cart (automotive is not directory-only), but the store page never
  // renders a basket there: a car is rented through 0298 or enquired about.
  // Google Shopping is for things a shopper can buy on the landing page.
  return resolveStoreExperience({
    category,
    enabledModules: resolveStoreModules(category),
  }).canOrderProducts;
}

/** Every reason this row is not in the feed, in a fixed order. Empty = listed.
 *  Visibility first (what the public cannot see is never listed), then kind,
 *  then the three data gaps Google rejects an item for. */
export function feedExclusions(row: FeedProductRow, sectorSlug: string | null): FeedExclusion[] {
  const out: FeedExclusion[] = [];
  if (row.status !== "active") out.push("not_active");
  if (row.deleted_at) out.push("deleted");
  if (!row.is_available) out.push("unavailable");
  if (row.hidden_by_plan) out.push("hidden_by_plan");
  if (!isPurchasablePhysicalGood(row, sectorSlug)) out.push("not_physical_good");
  const price = num(row.price);
  if (price == null || price <= 0) out.push("no_price");
  if (!row.image_url || !/^https:\/\//i.test(row.image_url)) out.push("no_image");
  if (!hasText(row.description)) out.push("no_description");
  return out;
}

/** The sale attributes for a row, or nulls. A running flash price wins (it is
 *  what the product page charges right now — lib/pricing.ts) and carries its
 *  window, so Google stops showing it when the page stops charging it. A
 *  standing discount is a sale only when it is actually lower. */
function salePriceFor(
  row: FeedProductRow,
  price: number,
  now: number,
): { salePrice: number | null; effective: string | null } {
  const flash = num(row.flash_price);
  if (
    flash != null &&
    flash > 0 &&
    flash < price &&
    isFlashActive(
      { price, flashPrice: flash, flashStart: row.flash_start, flashEnd: row.flash_end },
      now,
    )
  ) {
    const start = new Date(row.flash_start as string).toISOString();
    const end = new Date(row.flash_end as string).toISOString();
    return { salePrice: flash, effective: `${start}/${end}` };
  }
  const discount = num(row.discount_price);
  if (discount != null && discount > 0 && discount < price) {
    return { salePrice: discount, effective: null };
  }
  return { salePrice: null, effective: null };
}

/** Map one product row to a feed item, or null when it is excluded. */
export function toFeedItem(
  row: FeedProductRow,
  store: Pick<FeedStore, "name" | "sectorSlug">,
  opts: { siteUrl: string; now?: number },
): FeedItem | null {
  if (feedExclusions(row, store.sectorSlug).length > 0) return null;
  const price = num(row.price) as number;
  const now = opts.now ?? Date.now();
  const { salePrice, effective } = salePriceFor(row, price, now);
  const base = opts.siteUrl.replace(/\/$/, "");
  const brand = hasText(row.brand) ? (row.brand as string).trim() : store.name.trim();
  const sku = row.sku?.trim() ?? null;
  return {
    id: row.id,
    title: clampText(row.name, TITLE_MAX),
    description: clampText(row.description as string, DESCRIPTION_MAX),
    link: `${base}/ar/product/${row.id}`,
    imageLink: row.image_url as string,
    // Google takes up to ten additional images.
    additionalImageLinks: galleryUrls(row.gallery)
      .filter((u) => u !== row.image_url)
      .slice(0, 10),
    price: formatFeedPrice(price),
    salePrice: salePrice != null ? formatFeedPrice(salePrice) : null,
    salePriceEffectiveDate: effective,
    availability: feedAvailability(row),
    condition: feedCondition(row.attributes),
    brand: clampText(brand, 70),
    gtin: isValidGtin(sku) ? sku : null,
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function tag(name: string, value: string, asCdata = false): string {
  return `      <g:${name}>${asCdata ? cdata(value) : xmlEscape(value)}</g:${name}>`;
}

/** One <item>. Plain elements for machine values, CDATA for merchant text. */
export function feedItemXml(item: FeedItem): string {
  const lines = [
    "    <item>",
    tag("id", item.id),
    tag("title", item.title, true),
    tag("description", item.description, true),
    tag("link", item.link),
    tag("image_link", item.imageLink),
    ...item.additionalImageLinks.map((u) => tag("additional_image_link", u)),
    tag("availability", item.availability),
    tag("price", item.price),
  ];
  if (item.salePrice) lines.push(tag("sale_price", item.salePrice));
  if (item.salePriceEffectiveDate)
    lines.push(tag("sale_price_effective_date", item.salePriceEffectiveDate));
  lines.push(tag("condition", item.condition), tag("brand", item.brand, true));
  if (item.gtin) lines.push(tag("gtin", item.gtin));
  lines.push("    </item>");
  return lines.join("\n");
}

/** The whole document. */
export function buildGoogleFeedXml(args: {
  storeName: string;
  storeUrl: string;
  items: FeedItem[];
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>${cdata(args.storeName)}</title>`,
    `    <link>${xmlEscape(args.storeUrl)}</link>`,
    `    <description>${cdata(`${args.storeName} — Matjar`)}</description>`,
    ...args.items.map(feedItemXml),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Whether the public feed answers at all for this store. Every condition the
 *  dashboard checks is re-checked here, at read time: a store that drops to
 *  Basic, deletes its return policy or is suspended stops serving a feed
 *  without anyone having to remember to switch it off. */
export function feedServes(store: FeedStore): boolean {
  return (
    store.status === "active" &&
    !store.deletedAt &&
    store.googleFeedEnabled &&
    feedPlanAllowed(store.plan, store.trialEndsAt) &&
    hasText(store.returnPolicy) &&
    hasText(store.shippingPolicy)
  );
}

/** The feed's public address. The slug when the store has one (readable, and
 *  what the merchant will paste); the store id otherwise, which the route also
 *  accepts, so a store without a slug is not locked out. */
export function feedPath(store: Pick<FeedStore, "id" | "slug">): string {
  return `/feeds/${encodeURIComponent(store.slug || store.id)}/google.xml`;
}

// ---------------------------------------------------------------------------
// Pre-flight checklist (the dashboard page)
// ---------------------------------------------------------------------------

export type ChecklistKey =
  | "plan"
  | "storeActive"
  | "returnPolicy"
  | "shippingPolicy"
  | "listableProducts";

export type ChecklistItem = { key: ChecklistKey; ok: boolean };

export type ProductIssue = {
  id: string;
  name: string;
  missing: ("image" | "description" | "price")[];
};

export type FeedChecklist = {
  items: ChecklistItem[];
  /** Every blocking item passes — activation is allowed. */
  canActivate: boolean;
  /** Physical goods that would be listed today. */
  listableCount: number;
  /** Physical goods the public can see that Google would reject, and why. */
  productIssues: ProductIssue[];
};

/** Evaluate the pre-flight checklist. Blocking: the plan, an active store, both
 *  policies, and at least one listable product. Product gaps are listed so the
 *  merchant can fix them; they block only when nothing at all is listable. */
export function evaluateFeedChecklist(args: {
  store: Pick<
    FeedStore,
    "status" | "deletedAt" | "plan" | "trialEndsAt" | "returnPolicy" | "shippingPolicy" | "sectorSlug"
  >;
  products: FeedProductRow[];
}): FeedChecklist {
  const { store } = args;
  const productIssues: ProductIssue[] = [];
  let listableCount = 0;
  for (const row of args.products) {
    const reasons = feedExclusions(row, store.sectorSlug);
    if (reasons.length === 0) {
      listableCount++;
      continue;
    }
    // Only goods the public can already see are worth fixing for Google: a
    // service or a hidden row is left out on purpose, not by a data gap.
    const structural = reasons.filter(
      (r) => r !== "no_image" && r !== "no_description" && r !== "no_price",
    );
    if (structural.length > 0) continue;
    productIssues.push({
      id: row.id,
      name: row.name,
      missing: [
        ...(reasons.includes("no_image") ? (["image"] as const) : []),
        ...(reasons.includes("no_description") ? (["description"] as const) : []),
        ...(reasons.includes("no_price") ? (["price"] as const) : []),
      ],
    });
  }
  const items: ChecklistItem[] = [
    { key: "plan", ok: feedPlanAllowed(store.plan, store.trialEndsAt) },
    { key: "storeActive", ok: store.status === "active" && !store.deletedAt },
    { key: "returnPolicy", ok: hasText(store.returnPolicy) },
    { key: "shippingPolicy", ok: hasText(store.shippingPolicy) },
    { key: "listableProducts", ok: listableCount > 0 },
  ];
  return {
    items,
    canActivate: items.every((i) => i.ok),
    listableCount,
    productIssues,
  };
}
