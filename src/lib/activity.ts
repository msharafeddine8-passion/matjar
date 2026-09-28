// The customer activity centre — the pure half.
//
// Everything a customer started on Matjar, from ten tables, onto one screen.
// This file holds the decisions (what each row is called, which step it is
// on, what the customer can do next, what "order again" would actually put
// back in the cart); lib/data/activity.ts only fetches. Kept apart so the
// decisions can be tested in node without a database, and so the client list
// can import the same rules the server used.
//
// Deliberately NOT one status vocabulary. `pending` on a food order and
// `pending` on a Sunday Market listing are different promises, and flattening
// them into one pill is how a customer ends up believing a listing was an
// order. Each row keeps its own kind and its own domain's words; this file
// never decides that two domains mean the same thing.

import { beirutDay } from "@/lib/attendance";
import { effectivePrice } from "@/lib/pricing";

/** Every kind of thing a customer can start. Order = tab order on screen. */
export const ACTIVITY_KINDS = [
  "order",
  "booking",
  "stay",
  "rental",
  "ticket",
  "service",
  "craft",
  "lead",
  "job",
  "listing",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isActivityKind(v: unknown): v is ActivityKind {
  return (
    typeof v === "string" && (ACTIVITY_KINDS as readonly string[]).includes(v)
  );
}

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  /** Who is on the other side: the store, the tradesman, the employer. Empty
   *  when RLS no longer shows it (a store that closed) — the screen then
   *  falls back to the title rather than inventing a name. */
  storeName: string;
  /** Deep link to the existing screen for this row. */
  href: string;
  title: string;
  /** Raw status, in its own domain. Job applications have no status column;
   *  they carry the app-side value `sent` (see status-labels.ts). */
  status: string;
  createdAt: string;
  /** Raw `lead_kind`, leads only — the row's only description when the
   *  customer typed no message. Translated by the screen. */
  leadKind: string | null;
  /** Money, only where the row itself states an amount. Never a guess. */
  total: number | null;
  /** True when the ball is in the CUSTOMER's court — drives the tab badge. */
  needsCustomer: boolean;
  /** The calendar date(s) the thing happens on (YYYY-MM-DD), straight from
   *  the row. Date-only columns: they carry no time zone to convert. */
  startsOn: string | null;
  endsOn: string | null;
  /** Tickets: how many seats. */
  quantity: number | null;
  /** What "again" needs to point back at. */
  storeId: string | null;
  productId: string | null;
  providerId: string | null;
};

// ---------------------------------------------------------------------------
// Raw rows, as lib/data/activity.ts selects them.
// ---------------------------------------------------------------------------

type Named = { name: string | null } | null;

export type RawOrder = {
  id: string;
  status: string;
  total: number | string | null;
  created_at: string;
  updated_at?: string | null;
  store_id: string | null;
  stores: Named;
};
export type RawBooking = {
  id: string;
  status: string;
  service_name: string | null;
  requested_date: string | null;
  created_at: string;
  store_id: string | null;
  product_id: string | null;
  stores: Named;
};
export type RawStay = {
  id: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  grand_total: number | string | null;
  created_at: string;
  store_id: string | null;
  stores: Named;
  accommodation_units: { name: string | null; name_en: string | null } | null;
};
export type RawRental = {
  id: string;
  status: string;
  pickup_date: string | null;
  return_date: string | null;
  grand_total: number | string | null;
  created_at: string;
  store_id: string | null;
  stores: Named;
  rental_vehicles: { name: string | null; name_en: string | null } | null;
};
export type RawTicket = {
  id: string;
  status: string | null;
  quantity: number | null;
  created_at: string;
  store_id: string | null;
  stores: Named;
  event_ticket_types: { name: string | null; name_en: string | null } | null;
};
export type RawServiceRequest = {
  id: string;
  status: string;
  description: string | null;
  quote_amount: number | string | null;
  counter_amount: number | string | null;
  created_at: string;
  store_id: string | null;
  stores: Named;
};
export type RawCraft = {
  id: string;
  status: string;
  description: string | null;
  created_at: string;
  provider_id: string | null;
  craft_providers: Named;
  /** Reverse embed on craft_reviews.request_id (unique) — one or none. */
  craft_reviews?: { id: string }[] | { id: string } | null;
};
export type RawLead = {
  id: string;
  status: string;
  kind: string | null;
  message: string | null;
  created_at: string;
  store_id: string | null;
  stores: Named;
};
export type RawJobApplication = {
  id: string;
  created_at: string;
  job_id: string | null;
  job_postings: { title: string | null; company_name: string | null } | null;
};
export type RawListing = {
  id: string;
  status: string;
  title: string | null;
  price: number | string | null;
  created_at: string;
  updated_at?: string | null;
};

export type RawActivity = {
  orders?: RawOrder[] | null;
  bookings?: RawBooking[] | null;
  stays?: RawStay[] | null;
  rentals?: RawRental[] | null;
  tickets?: RawTicket[] | null;
  services?: RawServiceRequest[] | null;
  crafts?: RawCraft[] | null;
  leads?: RawLead[] | null;
  jobs?: RawJobApplication[] | null;
  listings?: RawListing[] | null;
  /** Stores the customer has already reviewed (reviews are per store). */
  reviewedStoreIds?: readonly string[] | null;
};

/** How long a finished order keeps asking for a review. Past this it stops
 *  being "something you still have to do" — a badge the customer can never
 *  clear is a badge they learn to ignore. */
export const REVIEW_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

function money(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function snippet(s: string | null | undefined, max = 60): string {
  return (s ?? "").trim().slice(0, max);
}

function localName(
  row: { name: string | null; name_en: string | null } | null,
  lang: string,
): string {
  if (!row) return "";
  return (lang === "en" && row.name_en ? row.name_en : row.name) ?? "";
}

function hasCraftReview(v: RawCraft["craft_reviews"]): boolean {
  if (!v) return false;
  return Array.isArray(v) ? v.length > 0 : Boolean(v.id);
}

const base = (lang: string) => `/${lang}`;

// ---------------------------------------------------------------------------
// "Is it the customer's move?" — per kind, in that kind's own terms.
// ---------------------------------------------------------------------------

/**
 * Whether the ball is in the customer's court.
 *
 * `today` is the Beirut calendar date (YYYY-MM-DD). An appointment whose day
 * has passed is no longer "something to show up to", whatever the merchant
 * forgot to mark it as — otherwise the badge counts last month's haircut.
 */
export function needsCustomer(
  kind: ActivityKind,
  status: string,
  ctx: {
    today: string;
    startsOn?: string | null;
    endsOn?: string | null;
    /** Orders/crafts: already reviewed, so nothing left to do. */
    reviewed?: boolean;
    /** Orders: when it finished (updated_at), for the review window. */
    finishedAt?: string | null;
    nowMs?: number;
  },
): boolean {
  const notPast = (ymd: string | null | undefined) => !ymd || ymd >= ctx.today;
  switch (kind) {
    case "order": {
      if (status !== "completed" || ctx.reviewed) return false;
      if (!ctx.finishedAt || ctx.nowMs == null) return true;
      const age = ctx.nowMs - new Date(ctx.finishedAt).getTime();
      return !(age > REVIEW_WINDOW_DAYS * DAY_MS);
    }
    case "booking":
      return (
        (status === "accepted" || status === "scheduled") &&
        notPast(ctx.startsOn)
      );
    case "stay":
      return status === "confirmed" && notPast(ctx.endsOn ?? ctx.startsOn);
    case "rental":
      return status === "confirmed" && notPast(ctx.endsOn ?? ctx.startsOn);
    case "service":
      // A quote is waiting for the customer's yes, no or counter. `countered`
      // is the opposite: the customer already answered.
      return status === "quoted";
    case "craft":
      return status === "completed" && !ctx.reviewed;
    case "listing":
      // Refused by moderation: the seller can fix and resubmit, or delete.
      return status === "rejected";
    default:
      // Tickets, inquiries and job applications: nothing the customer can do
      // moves them — the other side answers.
      return false;
  }
}

// ---------------------------------------------------------------------------
// Normalisation: ten raw shapes -> one row type.
// ---------------------------------------------------------------------------

/**
 * Turns the raw per-table reads into activity rows, newest first.
 *
 * Pure: `nowMs` is passed in so the Beirut "today" and the review window can
 * be tested at a fixed instant.
 */
export function normaliseActivity(
  raw: RawActivity,
  lang: string,
  nowMs: number,
): ActivityItem[] {
  const today = beirutDay(nowMs);
  const reviewed = new Set(raw.reviewedStoreIds ?? []);
  const L = base(lang);
  const out: ActivityItem[] = [];
  const blank = {
    leadKind: null,
    total: null,
    startsOn: null,
    endsOn: null,
    quantity: null,
    storeId: null,
    productId: null,
    providerId: null,
  } satisfies Partial<ActivityItem>;

  for (const o of raw.orders ?? []) {
    out.push({
      ...blank,
      id: o.id,
      kind: "order",
      storeName: o.stores?.name ?? "",
      href: `${L}/orders/${o.id}`,
      title: `#${o.id.slice(0, 8)}`,
      status: o.status,
      createdAt: o.created_at,
      total: money(o.total),
      storeId: o.store_id,
      needsCustomer: needsCustomer("order", o.status, {
        today,
        reviewed: o.store_id ? reviewed.has(o.store_id) : false,
        finishedAt: o.updated_at ?? null,
        nowMs,
      }),
    });
  }

  for (const b of raw.bookings ?? []) {
    out.push({
      ...blank,
      id: b.id,
      kind: "booking",
      storeName: b.stores?.name ?? "",
      href: `${L}/bookings/${b.id}`,
      title: b.service_name ?? "",
      status: b.status,
      createdAt: b.created_at,
      startsOn: b.requested_date,
      storeId: b.store_id,
      productId: b.product_id,
      needsCustomer: needsCustomer("booking", b.status, {
        today,
        startsOn: b.requested_date,
      }),
    });
  }

  // Stays, rentals, tickets and quote requests have no customer detail screen
  // of their own: they live on the store page (StaySearch, RentalSearch,
  // EventTickets, ServiceRequestForm), and the quote request form lists the
  // customer's own requests there with the accept/counter buttons. So that
  // is where the row goes — the place the next step can actually be taken.
  for (const s of raw.stays ?? []) {
    out.push({
      ...blank,
      id: s.id,
      kind: "stay",
      storeName: s.stores?.name ?? "",
      href: s.store_id ? `${L}/store/${s.store_id}` : `${L}/activity`,
      title: localName(s.accommodation_units, lang),
      status: s.status,
      createdAt: s.created_at,
      total: money(s.grand_total),
      startsOn: s.check_in,
      endsOn: s.check_out,
      storeId: s.store_id,
      needsCustomer: needsCustomer("stay", s.status, {
        today,
        startsOn: s.check_in,
        endsOn: s.check_out,
      }),
    });
  }

  for (const r of raw.rentals ?? []) {
    out.push({
      ...blank,
      id: r.id,
      kind: "rental",
      storeName: r.stores?.name ?? "",
      href: r.store_id ? `${L}/store/${r.store_id}` : `${L}/activity`,
      title: localName(r.rental_vehicles, lang),
      status: r.status,
      createdAt: r.created_at,
      total: money(r.grand_total),
      startsOn: r.pickup_date,
      endsOn: r.return_date,
      storeId: r.store_id,
      needsCustomer: needsCustomer("rental", r.status, {
        today,
        startsOn: r.pickup_date,
        endsOn: r.return_date,
      }),
    });
  }

  for (const t of raw.tickets ?? []) {
    out.push({
      ...blank,
      id: t.id,
      kind: "ticket",
      storeName: t.stores?.name ?? "",
      href: t.store_id ? `${L}/store/${t.store_id}` : `${L}/activity`,
      title: localName(t.event_ticket_types, lang),
      // 0193 defaults every ticket to `reserved` and nothing in the schema or
      // the app ever changes it; a null is read the same way.
      status: t.status ?? "reserved",
      createdAt: t.created_at,
      quantity: t.quantity ?? null,
      storeId: t.store_id,
      needsCustomer: false,
    });
  }

  for (const q of raw.services ?? []) {
    // The amount on the table right now: the customer's counter once they
    // sent one, the merchant's quote otherwise. Nothing before a quote exists.
    const amount =
      q.status === "countered"
        ? money(q.counter_amount)
        : money(q.quote_amount);
    out.push({
      ...blank,
      id: q.id,
      kind: "service",
      storeName: q.stores?.name ?? "",
      href: q.store_id ? `${L}/store/${q.store_id}` : `${L}/activity`,
      title: snippet(q.description),
      status: q.status,
      createdAt: q.created_at,
      total: amount,
      storeId: q.store_id,
      needsCustomer: needsCustomer("service", q.status, { today }),
    });
  }

  for (const c of raw.crafts ?? []) {
    out.push({
      ...blank,
      id: c.id,
      kind: "craft",
      storeName: c.craft_providers?.name ?? "",
      href: `${L}/crafts/requests/${c.id}`,
      title: snippet(c.description),
      status: c.status,
      createdAt: c.created_at,
      providerId: c.provider_id,
      needsCustomer: needsCustomer("craft", c.status, {
        today,
        reviewed: hasCraftReview(c.craft_reviews),
      }),
    });
  }

  for (const l of raw.leads ?? []) {
    out.push({
      ...blank,
      id: l.id,
      kind: "lead",
      storeName: l.stores?.name ?? "",
      // NOT /messages: create_lead() (0190) never opens a conversation.
      href: `${L}/inquiries/${l.id}`,
      title: snippet(l.message),
      status: l.status,
      createdAt: l.created_at,
      leadKind: l.kind,
      storeId: l.store_id,
      needsCustomer: false,
    });
  }

  for (const j of raw.jobs ?? []) {
    out.push({
      ...blank,
      id: j.id,
      kind: "job",
      // A posting that closed is hidden by job_postings RLS (active only), so
      // both can be null; the screen then shows the kind and the date alone.
      storeName: j.job_postings?.company_name ?? "",
      href: j.job_id ? `${L}/jobs/${j.job_id}` : `${L}/jobs`,
      title: j.job_postings?.title ?? "",
      status: "sent",
      createdAt: j.created_at,
      needsCustomer: false,
    });
  }

  for (const m of raw.listings ?? []) {
    out.push({
      ...blank,
      id: m.id,
      kind: "listing",
      storeName: "",
      href: `${L}/market/${m.id}`,
      title: m.title ?? "",
      status: m.status,
      createdAt: m.created_at,
      total: money(m.price),
      needsCustomer: needsCustomer("listing", m.status, { today }),
    });
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Dates: Beirut, Western digits.
// ---------------------------------------------------------------------------

const localeFor = (lang: string) =>
  // `ar` alone renders Eastern Arabic digits; commerce here reads 0-9.
  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB";

const INSTANT_FMT = new Map<string, Intl.DateTimeFormat>();
const DAY_FMT = new Map<string, Intl.DateTimeFormat>();

/** When a row was created, as a short Beirut calendar date ("28 Sep"). */
export function formatInstant(iso: string, lang: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  let f = INSTANT_FMT.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(localeFor(lang), {
      timeZone: "Asia/Beirut",
      month: "short",
      day: "numeric",
    });
    INSTANT_FMT.set(lang, f);
  }
  return f.format(t);
}

/**
 * A date-only column (`requested_date`, `check_in`, …) as a short date.
 *
 * These carry no time zone — they ARE the Beirut calendar day the merchant
 * agreed to — so they are formatted at UTC midnight in UTC, which cannot
 * shift them by a day whatever zone the browser is in.
 */
export function formatDay(ymd: string | null, lang: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  let f = DAY_FMT.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(localeFor(lang), {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    DAY_FMT.set(lang, f);
  }
  return f.format(new Date(`${ymd}T00:00:00Z`));
}

/** "Fri 3 Oct – Sun 5 Oct", or one day, or "" when the row has no date. */
export function formatDayRange(
  from: string | null,
  to: string | null,
  lang: string,
): string {
  const a = formatDay(from, lang);
  const b = formatDay(to, lang);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a || b;
}

/** What the tab badge shows: only what the customer must act on. */
export function countNeedingCustomer(items: readonly ActivityItem[]): number {
  return items.filter((i) => i.needsCustomer).length;
}

// ---------------------------------------------------------------------------
// Next actions.
// ---------------------------------------------------------------------------

/** Keys into the `activityCenter.actions` dictionary block. */
export type ActionKey =
  | "track"
  | "review"
  | "viewOrder"
  | "viewBooking"
  | "viewStay"
  | "viewRental"
  | "viewTickets"
  | "answerQuote"
  | "viewRequest"
  | "viewCraft"
  | "rateWork"
  | "viewInquiry"
  | "viewJob"
  | "viewListing"
  | "fixListing"
  | "renewListing"
  | "reorder"
  | "rebook"
  | "requestAgain"
  | "hireAgain";

export type ActivityAction = {
  key: ActionKey;
  /** Absent for `reorder`, which is a client action, not a link. */
  href?: string;
};

const ORDER_OPEN = new Set([
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
]);

/**
 * What tapping the row does, stated as a DESTINATION, never a prediction:
 * "track your order" is true because the order page tracks it, where
 * "arriving today" would be a promise nobody made.
 */
export function primaryAction(it: ActivityItem, lang: string): ActivityAction {
  const L = base(lang);
  switch (it.kind) {
    case "order":
      if (ORDER_OPEN.has(it.status)) return { key: "track", href: it.href };
      return {
        key: it.needsCustomer ? "review" : "viewOrder",
        href: it.href,
      };
    case "booking":
      return { key: "viewBooking", href: it.href };
    case "stay":
      return { key: "viewStay", href: it.href };
    case "rental":
      return { key: "viewRental", href: it.href };
    case "ticket":
      return { key: "viewTickets", href: it.href };
    case "service":
      return {
        key: it.status === "quoted" ? "answerQuote" : "viewRequest",
        href: it.href,
      };
    case "craft":
      return { key: it.needsCustomer ? "rateWork" : "viewCraft", href: it.href };
    case "lead":
      return { key: "viewInquiry", href: it.href };
    case "job":
      return { key: "viewJob", href: it.href };
    case "listing":
      if (it.status === "rejected" || it.status === "draft")
        return { key: "fixListing", href: `${L}/market/${it.id}/edit` };
      if (it.status === "expired")
        return { key: "renewListing", href: `${L}/market/${it.id}/edit` };
      return { key: "viewListing", href: it.href };
  }
}

/**
 * The "do it again" action, where there is one.
 *
 * Only on rows that have ENDED — a second booking offered next to one that
 * is still pending reads as "your first one failed". Every target is an
 * existing flow: the store cart, the store's booking panel with the service
 * preselected (`?service=`, the same deep link the product page uses), the
 * tradesman's own profile. Nothing is booked or ordered from here.
 */
export function againAction(
  it: ActivityItem,
  lang: string,
): ActivityAction | null {
  const L = base(lang);
  switch (it.kind) {
    case "order":
      return it.status === "completed" && it.storeId
        ? { key: "reorder" }
        : null;
    case "booking":
      if (!it.storeId) return null;
      if (!["completed", "no_show", "cancelled"].includes(it.status)) return null;
      return {
        key: "rebook",
        href: it.productId
          ? `${L}/store/${it.storeId}?service=${it.productId}`
          : `${L}/store/${it.storeId}`,
      };
    case "stay":
    case "rental":
      if (!it.storeId) return null;
      if (
        !["completed", "checked_out", "returned", "cancelled"].includes(
          it.status,
        )
      )
        return null;
      return { key: "rebook", href: `${L}/store/${it.storeId}` };
    case "service":
      return it.status === "completed" && it.storeId
        ? { key: "requestAgain", href: `${L}/store/${it.storeId}` }
        : null;
    case "craft":
      return it.status === "completed" && it.providerId
        ? { key: "hireAgain", href: `${L}/crafts/p/${it.providerId}` }
        : null;
    default:
      return null;
  }
}

/**
 * The "again" rail: one entry per place, newest first.
 *
 * Deduplicated by destination — five finished orders from the same bakery are
 * one "order again", not five — and capped, because it is a shortcut strip,
 * not a second copy of the list below it.
 */
export function againCandidates(
  items: readonly ActivityItem[],
  lang: string,
  max = 6,
): { item: ActivityItem; action: ActivityAction }[] {
  const seen = new Set<string>();
  const out: { item: ActivityItem; action: ActivityAction }[] = [];
  const sorted = [...items].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  for (const it of sorted) {
    const action = againAction(it, lang);
    if (!action) continue;
    const key =
      action.key === "reorder"
        ? `reorder:${it.storeId}`
        : `${action.key}:${action.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ item: it, action });
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reorder: what "the same again" can honestly put back in the cart.
// ---------------------------------------------------------------------------

/** One past order line, with the product as it is NOW (null = not visible). */
export type ReorderLine = {
  productId: string | null;
  variantId: string | null;
  name: string;
  /** What was paid per unit on the past order. */
  unitPrice: number;
  quantity: number;
  product: {
    name: string;
    price: number;
    discountPrice: number | null;
    flashPrice: number | null;
    flashStart: string | null;
    flashEnd: string | null;
    stock: number | null;
    status: string;
    isAvailable: boolean;
    deletedAt: string | null;
    itemKind: string | null;
    hasVariants: boolean;
  } | null;
};

export type ReorderDropReason =
  | "gone"
  | "unavailable"
  | "outOfStock"
  | "hasOptions"
  | "service";

export type ReorderPlan = {
  /** productId -> quantity, the shape of `matjar-cart-<storeId>`. */
  add: Record<string, number>;
  kept: {
    productId: string;
    name: string;
    quantity: number;
    /** Asked for more than is in stock: the quantity was lowered to stock. */
    reduced: boolean;
    was: number;
    now: number;
  }[];
  dropped: { name: string; productId: string | null; reason: ReorderDropReason }[];
  /** Kept lines whose unit price moved (either way). */
  priceChanged: number;
  wasTotal: number;
  nowTotal: number;
};

const CENT = 0.005;

/**
 * Plans "order again" from a past order and the products as they stand now.
 *
 * Only what the store cart can carry honestly goes back in:
 *  - the cart is keyed by product id alone and quick-add omits variant_id, so
 *    a line with a variant (or a product that has variants now) would be
 *    charged the base price — it is sent to the product page instead;
 *  - services are booked, not ordered (0304 rejects them in order_items);
 *  - a product the customer can no longer see, one that is switched off or
 *    out of stock is dropped, and SAID to be dropped;
 *  - a quantity above tracked stock is lowered to the stock, and flagged.
 * Prices are compared per unit against effectivePrice() — the same function
 * the store page charges with — so "the price changed" is the truth.
 */
export function planReorder(
  lines: readonly ReorderLine[],
  nowMs: number = Date.now(),
): ReorderPlan {
  const plan: ReorderPlan = {
    add: {},
    kept: [],
    dropped: [],
    priceChanged: 0,
    wasTotal: 0,
    nowTotal: 0,
  };

  // Same product on two lines (ordered twice in one basket) is one cart entry.
  const grouped = new Map<string, ReorderLine & { quantity: number }>();
  for (const line of lines) {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty === 0) continue;
    const p = line.product;
    const drop = (reason: ReorderDropReason) =>
      plan.dropped.push({
        name: p?.name || line.name,
        productId: line.productId,
        reason,
      });

    if (!line.productId || !p || p.deletedAt) {
      drop("gone");
      continue;
    }
    if (p.itemKind === "service") {
      drop("service");
      continue;
    }
    if (line.variantId || p.hasVariants) {
      drop("hasOptions");
      continue;
    }
    if (p.status !== "active" || !p.isAvailable) {
      drop("unavailable");
      continue;
    }
    const prev = grouped.get(line.productId);
    if (prev) prev.quantity += qty;
    else grouped.set(line.productId, { ...line, quantity: qty });
  }

  for (const [productId, line] of grouped) {
    const p = line.product!;
    let qty = line.quantity;
    let reduced = false;
    if (p.stock != null) {
      const stock = Math.floor(Number(p.stock));
      if (stock <= 0) {
        plan.dropped.push({ name: p.name || line.name, productId, reason: "outOfStock" });
        continue;
      }
      if (qty > stock) {
        qty = stock;
        reduced = true;
      }
    }
    const now = effectivePrice(
      {
        price: Number(p.price),
        discountPrice: p.discountPrice,
        flashPrice: p.flashPrice,
        flashStart: p.flashStart,
        flashEnd: p.flashEnd,
      },
      nowMs,
    );
    const was = Number(line.unitPrice) || 0;
    if (Math.abs(now - was) >= CENT) plan.priceChanged += 1;
    plan.add[productId] = qty;
    plan.kept.push({
      productId,
      name: p.name || line.name,
      quantity: qty,
      reduced,
      was,
      now,
    });
    plan.wasTotal += was * qty;
    plan.nowTotal += now * qty;
  }

  plan.wasTotal = Math.round(plan.wasTotal * 100) / 100;
  plan.nowTotal = Math.round(plan.nowTotal * 100) / 100;
  return plan;
}

/** Reads a stored cart defensively: anything that is not id -> positive int
 *  is dropped rather than trusted. */
export function parseCart(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const q = Math.floor(Number(n));
      if (k && Number.isFinite(q) && q > 0) out[k] = q;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Puts a reorder into a cart that may already hold things.
 *
 * Never overwrites what the customer had (the old ReorderButton replaced the
 * whole basket), and takes the larger of the two quantities rather than the
 * sum, so tapping "order again" twice does not double the order.
 */
export function mergeCart(
  existing: Record<string, number>,
  add: Record<string, number>,
): Record<string, number> {
  const out = { ...existing };
  for (const [id, q] of Object.entries(add)) {
    out[id] = Math.max(out[id] ?? 0, q);
  }
  return out;
}
