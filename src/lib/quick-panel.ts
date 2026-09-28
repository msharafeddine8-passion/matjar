// ===== «المساعد الذكي» — the quick-action panel's pure rules =====
//
// NO AI. Every answer on the panel is a database query; this file is the part
// of those answers that is arithmetic rather than SQL — Beirut calendar
// boundaries, what "inactive" means, the exception thresholds, per-currency
// totals — so it can be pinned by vitest (src/lib/__tests__/quick-panel.test.ts)
// and read the same on the server and in the browser.
//
// Time: a shop's "today", "tomorrow" and "this week" are Beirut's, never the
// server's UTC day and never the visitor's machine clock. The offset comes from
// Intl (Lebanon keeps DST: +2 in winter, +3 in summer), not from a constant.

import type { LedgerCurrency } from "./ledger";

// ---------------------------------------------------------------------------
// The chips
// ---------------------------------------------------------------------------

export const QUICK_CHIPS = [
  "todayOrders",
  "lowStock",
  "debts",
  "tomorrowBookings",
  "abandonedCarts",
  "inactiveCustomers",
  "weekSales",
] as const;
export type QuickChip = (typeof QUICK_CHIPS)[number];

export function isQuickChip(v: unknown): v is QuickChip {
  return typeof v === "string" && (QUICK_CHIPS as readonly string[]).includes(v);
}

/** The staff permission each chip needs — the same key the database's RLS
 *  gates those rows on, so a chip opens for exactly the people who could read
 *  its answer anyway. The owner always passes. */
export const CHIP_PERMISSION: Record<QuickChip, "orders" | "products" | "customers" | "bookings"> = {
  todayOrders: "orders",
  lowStock: "products",
  debts: "customers",
  tomorrowBookings: "bookings",
  abandonedCarts: "orders", // checkout_intents is gated on `orders` (0291)
  inactiveCustomers: "customers",
  weekSales: "orders", // the reports screen's key
};

export type Perms = { orders: boolean; products: boolean; customers: boolean; bookings: boolean };

export function chipAllowed(chip: QuickChip, perms: Perms): boolean {
  return perms[CHIP_PERMISSION[chip]];
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** A customer is "not back" after this many days with no order, ledger line
 *  or booking. */
export const INACTIVE_DAYS = 30;
/** A debt is overdue when its oldest unpaid charge is older than this. */
export const OVERDUE_DAYS = 30;
/** A pending order older than this has waited too long for a reply. */
export const UNCONFIRMED_ORDER_HOURS = 2;
/** How many rows a chip lists before "open the full screen". */
export const CHIP_LIST_LIMIT = 10;

/** Below-threshold stock, the rule the inventory screen uses: a tracked stock
 *  (not null) at or under the product's own low_stock_threshold (default 5). */
export function isLowStock(p: { stock: number | null; low_stock_threshold: number | null }): boolean {
  if (p.stock === null || p.stock === undefined) return false;
  return p.stock <= (p.low_stock_threshold ?? 5);
}

/** A pending order created before now − 2 hours. */
export function isUnconfirmedOrder(o: { status: string; created_at: string }, nowMs: number): boolean {
  return (
    o.status === "pending" &&
    new Date(o.created_at).getTime() < nowMs - UNCONFIRMED_ORDER_HOURS * 3_600_000
  );
}

/** The instant before which a pending order counts as waiting too long. */
export function unconfirmedCutoff(nowMs: number): Date {
  return new Date(nowMs - UNCONFIRMED_ORDER_HOURS * 3_600_000);
}

// ---------------------------------------------------------------------------
// Beirut calendar
// ---------------------------------------------------------------------------

const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" });
const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Beirut",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Beirut's calendar date of an instant, yyyy-mm-dd. */
export function beirutYmd(at: Date): string {
  return YMD.format(at);
}

/** yyyy-mm-dd shifted by whole days (calendar arithmetic, no clock). */
export function addDaysYmd(ymd: string, days: number): string {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, of a calendar date. */
export function weekdayOfYmd(ymd: string): number {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay();
}

/** Beirut's UTC offset, in minutes, at an instant (+120 or +180). */
export function beirutOffsetMinutes(at: Date): number {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant Beirut's day `ymd` begins. Midnight is taken in the offset that
 * is in force at that midnight — computed twice, because the guess made with
 * the previous day's offset is off by an hour on the two DST-change days.
 * (Lebanon moves its clocks at midnight; on the spring-forward day 00:00 does
 * not exist and the day starts at 01:00, which this also returns.)
 */
export function beirutDayStart(ymd: string): Date {
  const utcMidnight = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
  let guess = utcMidnight - beirutOffsetMinutes(new Date(utcMidnight)) * 60_000;
  guess = utcMidnight - beirutOffsetMinutes(new Date(guess)) * 60_000;
  // Spring forward: the computed instant can land in the previous day.
  if (beirutYmd(new Date(guess)) !== ymd) guess += 3_600_000;
  return new Date(guess);
}

export type BeirutDay = { ymd: string; start: Date; end: Date };

/** A Beirut day as a half-open instant range [start, end). */
export function beirutDay(ymd: string): BeirutDay {
  return { ymd, start: beirutDayStart(ymd), end: beirutDayStart(addDaysYmd(ymd, 1)) };
}

export function beirutToday(now: Date): BeirutDay {
  return beirutDay(beirutYmd(now));
}

export function beirutTomorrow(now: Date): BeirutDay {
  return beirutDay(addDaysYmd(beirutYmd(now), 1));
}

/**
 * This week and last week, for «مبيعات هالأسبوع». Weeks start MONDAY, as a
 * Lebanese shop's week does (Sunday is the day off, not the first day).
 *
 *   thisWeek       = [Monday 00:00 Beirut, now)
 *   lastWeekToDate = [last Monday 00:00, now − 7 days)   ← compared like for like
 *   lastWeek       = [last Monday 00:00, this Monday 00:00)
 *
 * "vs last week" compares this week so far with the SAME stretch of last
 * week: comparing Wednesday morning's total with all of last week would call
 * every week a collapse until Sunday night.
 */
export function beirutWeeks(now: Date): {
  thisStart: Date;
  lastStart: Date;
  lastSamePoint: Date;
  thisStartYmd: string;
  lastStartYmd: string;
} {
  const today = beirutYmd(now);
  const sinceMonday = (weekdayOfYmd(today) + 6) % 7; // Monday → 0 … Sunday → 6
  const thisStartYmd = addDaysYmd(today, -sinceMonday);
  const lastStartYmd = addDaysYmd(thisStartYmd, -7);
  return {
    thisStart: beirutDayStart(thisStartYmd),
    lastStart: beirutDayStart(lastStartYmd),
    lastSamePoint: new Date(now.getTime() - 7 * 86_400_000),
    thisStartYmd,
    lastStartYmd,
  };
}

// ---------------------------------------------------------------------------
// Money, per currency
// ---------------------------------------------------------------------------

export type SaleCurrency = LedgerCurrency;

/** Totals per currency in integer cents — never summed across currencies. A
 *  row in any other currency is counted in `other` and left out, not guessed. */
export function totalsByCurrency(
  rows: readonly { total: number | string | null; currency?: string | null }[],
): { totals: Record<SaleCurrency, number>; count: number; other: number } {
  const cents: Record<SaleCurrency, number> = { USD: 0, LBP: 0 };
  let count = 0;
  let other = 0;
  for (const r of rows) {
    const c = (r.currency ?? "USD").toUpperCase();
    if (c !== "USD" && c !== "LBP") {
      other++;
      continue;
    }
    cents[c] += Math.round(Number(r.total ?? 0) * 100);
    count++;
  }
  return { totals: { USD: cents.USD / 100, LBP: cents.LBP / 100 }, count, other };
}

/** Whole-percent change, or null when there is nothing to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Rows whose instant falls in [from, to). */
export function inRange<T extends { created_at: string }>(rows: readonly T[], from: Date, to: Date): T[] {
  const a = from.getTime();
  const b = to.getTime();
  return rows.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= a && t < b;
  });
}

// ---------------------------------------------------------------------------
// «زباين ما رجعوا» — inactivity
// ---------------------------------------------------------------------------

/**
 * A customer's last activity is the latest REAL date among:
 *   * their orders      (orders.created_at, Beirut date, matched by phone key)
 *   * their ledger lines (customer_transactions.happened_on)
 *   * their bookings    (bookings.requested_date if set, else created_at)
 * A customer is "not back" when that date is more than INACTIVE_DAYS ago.
 *
 * A customer with NO dated activity at all is not listed: nothing says they
 * ever came, so nothing says they stopped. They are counted separately
 * (`neverActive`) so the screen can say so rather than hide them silently.
 */
export type ActivityCustomer = { id: string; name: string; phone: string | null };

export type InactiveCustomer = ActivityCustomer & { lastActive: string; days: number };

export function inactiveCustomers(
  customers: readonly ActivityCustomer[],
  lastByCustomer: ReadonlyMap<string, string>,
  lastByPhoneKey: ReadonlyMap<string, string>,
  keyOf: (phone: string | null) => string | null,
  todayYmd: string,
  days: number = INACTIVE_DAYS,
): { inactive: InactiveCustomer[]; neverActive: number } {
  const inactive: InactiveCustomer[] = [];
  let neverActive = 0;
  for (const c of customers) {
    const a = lastByCustomer.get(c.id) ?? null;
    const k = keyOf(c.phone);
    const b = k ? (lastByPhoneKey.get(k) ?? null) : null;
    const last = a && b ? (a > b ? a : b) : (a ?? b);
    if (!last) {
      neverActive++;
      continue;
    }
    const gap = daysBetweenYmd(last, todayYmd);
    if (gap > days) inactive.push({ ...c, lastActive: last, days: gap });
  }
  // Longest-gone first is not useful — they are likely gone for good. The
  // ones who JUST crossed the line are the ones a message can still bring back.
  inactive.sort((x, y) => x.days - y.days || x.name.localeCompare(y.name));
  return { inactive, neverActive };
}

/** Keep the later of two yyyy-mm-dd dates in a map. */
export function bumpLatest(map: Map<string, string>, key: string | null, ymd: string | null): void {
  if (!key || !ymd) return;
  const cur = map.get(key);
  if (!cur || ymd > cur) map.set(key, ymd);
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// The offer message
// ---------------------------------------------------------------------------

export const OFFER_MAX_CHARS = 500;

/** The merchant's own short text with {name} and {store} filled in. No coupon
 *  is ever invented: the text says what the merchant typed, nothing else. */
export function fillOffer(text: string, values: { name: string; store: string }): string {
  return text
    .slice(0, OFFER_MAX_CHARS)
    .split("{name}")
    .join(values.name.trim())
    .split("{store}")
    .join(values.store.trim())
    .trim();
}
