// ===== دفتر الدين — pure helpers =====
//
// Everything the debt-ledger screens compute, with no React, no Supabase and no
// dictionary import, so it runs identically on the server, in the browser and
// under vitest.
//
// Data model (see supabase/migrations/0307_debt_ledger.sql):
//   a ledger customer = a row of public.store_customers
//   a ledger entry    = a row of public.customer_transactions
//   «أعطيت» = kind "charge"   (the customer now owes more)
//   «استلمت» = kind "payment"  (the customer paid some down)
//   "adjustment" is 0211's correction kind and counts like a charge.
//
// THE ONE RULE: a balance is PER CURRENCY. USD and LBP are never added, never
// converted, never netted against each other. A debt written in lira is owed in
// lira. The database functions follow the same rule (ledger_balances).

export type LedgerCurrency = "USD" | "LBP";
export type LedgerKind = "charge" | "payment" | "adjustment";

/** Display order everywhere: dollars first, the way the notebook is ruled. */
export const LEDGER_CURRENCIES: readonly LedgerCurrency[] = ["USD", "LBP"];

export function isLedgerCurrency(v: unknown): v is LedgerCurrency {
  return v === "USD" || v === "LBP";
}

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  amount: number;
  currency: LedgerCurrency;
  /** yyyy-mm-dd — the day the merchant says it happened. */
  happened_on: string;
  /** ISO timestamp; orders same-day entries. Optional for tests / statement. */
  created_at?: string | null;
  label?: string | null;
  attachment_path?: string | null;
};

export type CurrencyBalance = { currency: LedgerCurrency; balance: number };

// ---------------------------------------------------------------------------
// Money arithmetic
// ---------------------------------------------------------------------------
// Sums are done in integer cents. 0.1 + 0.2 is 0.30000000000000004 in floating
// point, and a customer's balance must be the number on the paper.

const toCents = (n: number) => Math.round(Number(n) * 100);
const fromCents = (c: number) => c / 100;

/** + for what the customer now owes, − for what they paid. */
export function signedAmount(e: Pick<LedgerEntry, "kind" | "amount">): number {
  return e.kind === "payment" ? -Number(e.amount) : Number(e.amount);
}

/** Balance per currency, both currencies always present (0 when unused). */
export function balancesByCurrency(
  entries: readonly Pick<LedgerEntry, "kind" | "amount" | "currency">[],
): Record<LedgerCurrency, number> {
  const cents: Record<LedgerCurrency, number> = { USD: 0, LBP: 0 };
  for (const e of entries) {
    if (!isLedgerCurrency(e.currency)) continue;
    cents[e.currency] += toCents(signedAmount(e));
  }
  return { USD: fromCents(cents.USD), LBP: fromCents(cents.LBP) };
}

/** The currencies with something on them, in display order. A customer who
 *  only ever bought in dollars has no LBP line — not an "LBP 0" line. */
export function nonZeroBalances(
  balances: Record<LedgerCurrency, number>,
): CurrencyBalance[] {
  return LEDGER_CURRENCIES.filter((c) => balances[c] !== 0).map((c) => ({
    currency: c,
    balance: balances[c],
  }));
}

/** Oldest first; same day → created first; then id, so the order is total. */
export function chronological<T extends LedgerEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.happened_on !== b.happened_on) return a.happened_on < b.happened_on ? -1 : 1;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Each entry with the running balance OF ITS OWN CURRENCY after it —
 *  the "balance" column of a paper ledger, kept once per currency. */
export function withRunningBalance<T extends LedgerEntry>(
  entries: readonly T[],
): (T & { running: number })[] {
  const cents: Record<LedgerCurrency, number> = { USD: 0, LBP: 0 };
  return chronological(entries).map((e) => {
    cents[e.currency] += toCents(signedAmount(e));
    return { ...e, running: fromCents(cents[e.currency]) };
  });
}

// ---------------------------------------------------------------------------
// Overdue
// ---------------------------------------------------------------------------

/**
 * The date of the oldest charge that payments have not yet covered, settling
 * FIFO — a payment crosses out the oldest line first. Mirrors
 * `oldest_unpaid_charge_on` in public.ledger_balances. null when nothing is
 * owed in that currency.
 */
export function oldestUnpaidCharge(
  entries: readonly LedgerEntry[],
  currency: LedgerCurrency,
): string | null {
  const mine = chronological(entries.filter((e) => e.currency === currency));
  let paid = 0;
  for (const e of mine) if (e.kind === "payment") paid += toCents(e.amount);
  let running = 0;
  for (const e of mine) {
    if (e.kind === "payment") continue;
    running += toCents(e.amount);
    if (running > paid) return e.happened_on;
  }
  return null;
}

/** Whole days from `fromIso` to `toIso` (both yyyy-mm-dd), calendar-exact. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "Overdue more than N days": the oldest unpaid charge is older than N days. */
export function isOverdue(
  oldestUnpaidOn: string | null | undefined,
  days: number,
  todayIso: string,
): boolean {
  if (!oldestUnpaidOn) return false;
  return daysBetween(oldestUnpaidOn, todayIso) > days;
}

export const OVERDUE_FILTERS = [7, 30, 60] as const;
export type OverdueFilter = (typeof OVERDUE_FILTERS)[number];

/** Today's date in Lebanon as yyyy-mm-dd. A shop's "today" is Beirut's, not
 *  the server's UTC day. */
export function todayInBeirut(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(now);
}

// ---------------------------------------------------------------------------
// The customer list (one row per customer, from ledger_balances rows)
// ---------------------------------------------------------------------------

/** One row as public.ledger_balances returns it. */
export type LedgerBalanceRow = {
  customer_id: string;
  name: string;
  phone: string | null;
  currency: string;
  balance: number | string;
  last_activity: string | null;
  oldest_unpaid_charge_on: string | null;
};

export type LedgerCustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  balances: Record<LedgerCurrency, number>;
  lastActivity: string | null;
  /** Oldest unpaid charge across both currencies — the one that is most late. */
  oldestUnpaidOn: string | null;
};

/** Folds the per-currency rows into one summary per customer. */
export function summarizeBalanceRows(
  rows: readonly LedgerBalanceRow[],
): LedgerCustomerSummary[] {
  const map = new Map<string, LedgerCustomerSummary>();
  for (const r of rows) {
    if (!isLedgerCurrency(r.currency)) continue;
    const s =
      map.get(r.customer_id) ??
      {
        id: r.customer_id,
        name: r.name,
        phone: r.phone,
        balances: { USD: 0, LBP: 0 },
        lastActivity: null,
        oldestUnpaidOn: null,
      };
    s.balances[r.currency] = Number(r.balance);
    if (r.last_activity && (!s.lastActivity || r.last_activity > s.lastActivity)) {
      s.lastActivity = r.last_activity;
    }
    const o = r.oldest_unpaid_charge_on;
    if (o && (!s.oldestUnpaidOn || o < s.oldestUnpaidOn)) s.oldestUnpaidOn = o;
    map.set(r.customer_id, s);
  }
  return [...map.values()];
}

/**
 * Largest outstanding first. Two currencies cannot be compared without a rate,
 * so the rate is used for ORDERING ONLY — to decide whether $50 or 3,000,000
 * LBP is the bigger debt to chase — and never shown or stored as a converted
 * amount. Without a rate, dollars lead and lira breaks ties.
 */
export function sortByOutstanding(
  list: readonly LedgerCustomerSummary[],
  usdLbpRate: number,
): LedgerCustomerSummary[] {
  const weight = (s: LedgerCustomerSummary) =>
    Math.max(0, s.balances.USD) +
    (usdLbpRate > 0 ? Math.max(0, s.balances.LBP) / usdLbpRate : 0);
  return [...list].sort((a, b) => {
    const d = weight(b) - weight(a);
    if (d !== 0) return d;
    const l = Math.max(0, b.balances.LBP) - Math.max(0, a.balances.LBP);
    if (l !== 0) return l;
    return a.name.localeCompare(b.name);
  });
}

/** Case- and digit-insensitive search over name and phone. */
export function matchesSearch(
  s: { name: string; phone: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (s.name.toLowerCase().includes(q)) return true;
  const qd = normalizeDigits(q).replace(/\D/g, "");
  if (!qd) return false;
  return (s.phone ?? "").replace(/\D/g, "").includes(qd);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → 0-9. A phone keyboard set to
 *  Arabic types these into an inputmode="decimal" field. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * The amount a merchant typed, or null when it is not a positive amount.
 * Accepts Arabic-Indic digits, the Arabic decimal separator (٫), thousands
 * separators (",", "٬", spaces) and one "." as the decimal point.
 */
export function parseAmountInput(raw: string): number | null {
  const s = normalizeDigits(raw)
    .replace(/٫/g, ".")
    .replace(/[,\s٬]/g, "")
    .trim();
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  // numeric(12,2) in the database.
  if (n >= 10_000_000_000) return null;
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "$1,250.50" / "$40" / "1,500,000 ل.ل." — Western digits in both locales.
 *  LBP has no cents in practice and is shown whole. */
export function formatLedgerAmount(
  amount: number,
  currency: LedgerCurrency,
  lang: "ar" | "en",
): string {
  const abs = Math.abs(amount);
  if (currency === "LBP") {
    const n = Math.round(abs).toLocaleString("en-US");
    return `${n} ${lang === "ar" ? "ل.ل." : "LBP"}`;
  }
  const whole = Number.isInteger(Math.round(abs * 100) / 100);
  const n = abs.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `$${n}`;
}

// ---------------------------------------------------------------------------
// WhatsApp reminder
// ---------------------------------------------------------------------------

export type ReminderTemplate = {
  /** Uses {name}, {store}, {balances}, {link}. */
  body: string;
  /** Joins two currency amounts: " و " / " and ". */
  and: string;
};

/**
 * The pre-filled WhatsApp text. Only what is actually OWED is listed — a
 * currency the customer is square or in credit on is left out rather than
 * printed as "0". Both currencies stay separate amounts; nothing is converted.
 */
export function buildReminderMessage(opts: {
  template: ReminderTemplate;
  customerName: string;
  storeName: string;
  balances: Record<LedgerCurrency, number>;
  link: string;
  lang: "ar" | "en";
}): string {
  const owed = LEDGER_CURRENCIES.filter((c) => opts.balances[c] > 0).map((c) =>
    formatLedgerAmount(opts.balances[c], c, opts.lang),
  );
  const balances = owed.length > 0 ? owed.join(opts.template.and) : formatLedgerAmount(0, "USD", opts.lang);
  // split/join rather than replaceAll: older Android WebViews (the Capacitor
  // shell) predate String.prototype.replaceAll.
  const fill = (s: string, key: string, value: string) => s.split(`{${key}}`).join(value);
  let out = opts.template.body;
  out = fill(out, "name", opts.customerName.trim());
  out = fill(out, "store", opts.storeName.trim());
  out = fill(out, "balances", balances);
  out = fill(out, "link", opts.link);
  return out;
}

/** Public statement URL for a token. */
export function statementUrl(origin: string, lang: "ar" | "en", token: string): string {
  return `${origin.replace(/\/+$/, "")}/${lang}/statement/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Export (CSV; the Excel export uses the same rows)
// ---------------------------------------------------------------------------

export type ExportEntry = LedgerEntry & {
  customer_name: string;
  customer_phone: string | null;
};

export type ExportLabels = {
  headers: {
    date: string;
    customer: string;
    phone: string;
    type: string;
    currency: string;
    amount: string;
    signed: string;
    note: string;
  };
  kinds: Record<LedgerKind, string>;
};

/** Header row + one row per entry, chronological. Amounts stay numbers so a
 *  spreadsheet can sum them; the signed column makes a per-currency SUMIF the
 *  balance. */
export function buildExportRows(
  entries: readonly ExportEntry[],
  labels: ExportLabels,
): (string | number)[][] {
  const h = labels.headers;
  const rows: (string | number)[][] = [
    [h.date, h.customer, h.phone, h.type, h.currency, h.amount, h.signed, h.note],
  ];
  for (const e of chronological(entries)) {
    rows.push([
      e.happened_on,
      e.customer_name,
      e.customer_phone ?? "",
      labels.kinds[e.kind] ?? e.kind,
      e.currency,
      Number(e.amount),
      signedAmount(e),
      e.label ?? "",
    ]);
  }
  return rows;
}

/**
 * One CSV cell. Quotes when needed, and defuses spreadsheet formula injection:
 * a customer name or note beginning with = + - @ would otherwise run as a
 * formula when the merchant opens the file. Numbers are written as numbers.
 */
export function csvCell(v: string | number): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CRLF lines with a UTF-8 BOM, which is what makes Excel open Arabic text as
 *  Arabic instead of mojibake. */
export function toCsv(rows: readonly (string | number)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
