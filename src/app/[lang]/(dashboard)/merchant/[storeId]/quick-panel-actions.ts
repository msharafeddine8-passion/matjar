"use server";

// «المساعد الذكي» — the answers. One server action per question, run only when
// the merchant taps the chip (the exceptions strip is the one read made
// without asking, and it is a handful of counts).
//
// NO AI and nothing invented: every number below is a query result under the
// caller's own RLS. Each action re-checks, before any query:
//   1. the caller is signed in and belongs to the store (owner or staff),
//   2. the store's EFFECTIVE plan is Pro or Business (FEATURES.quickPanel),
//   3. the staff permission the chip needs (CHIP_PERMISSION) — the same key
//      the rows' RLS is gated on, so a staff member without `customers` never
//      sees a debt, even by calling this action by hand.

import { createClient } from "@/lib/supabase/server";
import { effectivePlan, hasPlan } from "@/lib/plan-tiers";
import { isBusiness } from "@/lib/plan";
import { getUsdLbpRate } from "@/lib/data/settings";
import { bodiesOf, loadLastSent, loadWaTemplates } from "@/lib/wa-actions-server";
import { phoneKey, type CartLine, type WaLocale } from "@/lib/wa-templates";
import {
  daysBetween,
  summarizeBalanceRows,
  todayInBeirut,
  type LedgerBalanceRow,
  type LedgerCurrency,
} from "@/lib/ledger";
import {
  CHIP_LIST_LIMIT,
  CHIP_PERMISSION,
  INACTIVE_DAYS,
  OVERDUE_DAYS,
  beirutToday,
  beirutTomorrow,
  beirutWeeks,
  beirutYmd,
  bumpLatest,
  inRange,
  inactiveCustomers,
  isLowStock,
  isQuickChip,
  pctChange,
  totalsByCurrency,
  unconfirmedCutoff,
  type Perms,
  type QuickChip,
} from "@/lib/quick-panel";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Ctx = {
  supabase: Supabase;
  perms: Perms;
  /** pos_sales is gated on its own staff key, `pos` (0159). */
  canPos: boolean;
  plan: string;
  storeName: string;
  storeSlug: string | null;
};

export type Refusal = { ok: false; reason: "locked" | "forbidden" | "failed" };
type Money = Record<LedgerCurrency, number>;

async function context(storeId: string): Promise<Ctx | Refusal> {
  if (typeof storeId !== "string" || !UUID_RE.test(storeId)) return { ok: false, reason: "forbidden" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "forbidden" };

  const { data: storeRow } = await supabase
    .from("stores")
    .select("name, slug, owner_id, plan, trial_ends_at")
    .eq("id", storeId)
    .maybeSingle();
  if (!storeRow) return { ok: false, reason: "forbidden" };
  const s = storeRow as {
    name: string;
    slug: string | null;
    owner_id: string;
    plan: string | null;
    trial_ends_at: string | null;
  };

  let perms: Perms;
  let canPos = true;
  if (s.owner_id === user.id) {
    perms = { orders: true, products: true, customers: true, bookings: true };
  } else {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!staffRow) return { ok: false, reason: "forbidden" };
    const p = (staffRow.permissions as Record<string, boolean> | null) ?? {};
    perms = {
      orders: p.orders ?? false,
      products: p.products ?? false,
      customers: p.customers ?? false,
      bookings: p.bookings ?? false,
    };
    canPos = p.pos ?? false;
  }

  const plan = effectivePlan(s.plan, s.trial_ends_at);
  if (!hasPlan(plan, "pro")) return { ok: false, reason: "locked" };
  return { supabase, perms, canPos, plan, storeName: s.name, storeSlug: s.slug };
}

/** Every page of a query, 1,000 rows at a time (PostgREST's page), up to max. */
async function pages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  max: number,
): Promise<{ rows: T[]; capped: boolean } | null> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, Math.min(from + 999, max - 1));
    if (error) return null;
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < 1000) return { rows, capped: false };
  }
  return { rows, capped: true };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type OrderRow = {
  id: string;
  status: string;
  total: number;
  currency: string;
  customer_name: string | null;
  created_at: string;
};
export type TodayOrdersAnswer = { chip: "todayOrders"; count: number; rows: OrderRow[]; totals: Money; rate: number };

export type StockRow = { id: string; name: string; stock: number; low_stock_threshold: number };
export type LowStockAnswer = { chip: "lowStock"; count: number; rows: StockRow[]; target: "inventory" | "items" };

export type Debtor = {
  id: string;
  name: string;
  phone: string | null;
  balances: Money;
  overdueDays: number | null;
};
export type DebtsAnswer = {
  chip: "debts";
  count: number;
  usd: Debtor[];
  lbp: Debtor[];
  bodies: Record<WaLocale, string>;
  lastSent: Record<string, string>;
  storeName: string;
};

export type BookingRow = {
  id: string;
  status: string;
  phone: string | null;
  customerName: string | null;
  hasAccount: boolean;
  service: string | null;
  date: string | null;
  time: string | null;
};
export type TomorrowAnswer = {
  chip: "tomorrowBookings";
  date: string;
  today: string;
  count: number;
  rows: BookingRow[];
  templates: { booking_confirmation: Record<WaLocale, string>; booking_reminder: Record<WaLocale, string> };
  lastSent: Record<string, string>;
  storeName: string;
};

export type CartRow = {
  id: string;
  phone: string;
  customerName: string | null;
  lines: CartLine[];
  itemCount: number;
  totalEstimate: number;
  updatedAt: string;
  lastWaAt: string | null;
};
export type CartsAnswer = {
  chip: "abandonedCarts";
  count: number;
  rows: CartRow[];
  bodies: Record<WaLocale, string>;
  rate: number;
  storeName: string;
  storeSlug: string | null;
};

export type InactiveRow = { id: string; name: string; phone: string | null; lastActive: string; days: number };
export type InactiveAnswer = {
  chip: "inactiveCustomers";
  count: number;
  rows: InactiveRow[];
  neverActive: number;
  sources: ("orders" | "ledger" | "bookings")[];
  capped: boolean;
  storeName: string;
};

export type WeekAnswer = {
  chip: "weekSales";
  thisWeek: { total: Money; online: Money; pos: Money; orders: number };
  lastToDate: Money;
  lastFull: Money;
  pct: Record<LedgerCurrency, number | null>;
  hasPos: boolean;
  rate: number;
  capped: boolean;
};

export type ChipAnswer =
  | TodayOrdersAnswer
  | LowStockAnswer
  | DebtsAnswer
  | TomorrowAnswer
  | CartsAnswer
  | InactiveAnswer
  | WeekAnswer;

export type ChipResult = { ok: true; answer: ChipAnswer } | Refusal;

async function todayOrders(c: Ctx, storeId: string): Promise<TodayOrdersAnswer | null> {
  const day = beirutToday(new Date());
  const [list, all, rate] = await Promise.all([
    c.supabase
      .from("orders")
      .select("id, status, total, currency, customer_name, created_at", { count: "exact" })
      .eq("store_id", storeId)
      .gte("created_at", day.start.toISOString())
      .lt("created_at", day.end.toISOString())
      .order("created_at", { ascending: false })
      .limit(CHIP_LIST_LIMIT),
    pages<{ total: number; currency: string | null }>(
      (from, to) =>
        c.supabase
          .from("orders")
          .select("total, currency")
          .eq("store_id", storeId)
          .gte("created_at", day.start.toISOString())
          .lt("created_at", day.end.toISOString())
          .not("status", "in", "(cancelled,rejected)")
          .order("created_at")
          .range(from, to),
      20000,
    ),
    getUsdLbpRate(),
  ]);
  if (list.error || !all) return null;
  return {
    chip: "todayOrders",
    count: list.count ?? (list.data ?? []).length,
    rows: ((list.data ?? []) as OrderRow[]).map((r) => ({ ...r, total: Number(r.total) })),
    totals: totalsByCurrency(all.rows).totals,
    rate,
  };
}

async function lowStockRows(c: Ctx, storeId: string): Promise<StockRow[] | null> {
  const res = await pages<{ id: string; name: string; stock: number | null; low_stock_threshold: number | null }>(
    (from, to) =>
      c.supabase
        .from("products")
        .select("id, name, stock, low_stock_threshold")
        .eq("store_id", storeId)
        .is("deleted_at", null)
        .not("stock", "is", null)
        .order("stock", { ascending: true })
        .range(from, to),
    20000,
  );
  if (!res) return null;
  return res.rows
    .filter(isLowStock)
    .map((p) => ({ id: p.id, name: p.name, stock: Number(p.stock), low_stock_threshold: p.low_stock_threshold ?? 5 }));
}

async function lowStock(c: Ctx, storeId: string): Promise<LowStockAnswer | null> {
  const rows = await lowStockRows(c, storeId);
  if (!rows) return null;
  // There is no supplier-order (purchase order) table in the database — the
  // supplier module is a contact list and a payables ledger. So the action is
  // "open inventory" (Business, where stock is received) or the product list
  // (Pro, where inventory is not included), never a draft order.
  return {
    chip: "lowStock",
    count: rows.length,
    rows: rows.slice(0, CHIP_LIST_LIMIT),
    target: isBusiness(c.plan) ? "inventory" : "items",
  };
}

async function debtorSummaries(c: Ctx, storeId: string) {
  const { data, error } = await c.supabase.rpc("ledger_balances", { p_store_id: storeId });
  if (error) return null;
  const today = todayInBeirut();
  return summarizeBalanceRows((data ?? []) as LedgerBalanceRow[])
    .filter((s) => s.balances.USD > 0 || s.balances.LBP > 0)
    .map<Debtor>((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      balances: s.balances,
      overdueDays: s.oldestUnpaidOn ? daysBetween(s.oldestUnpaidOn, today) : null,
    }));
}

async function debts(c: Ctx, storeId: string): Promise<DebtsAnswer | null> {
  const list = await debtorSummaries(c, storeId);
  if (!list) return null;
  // Per currency, largest first — never ranked across currencies.
  const top = (cur: LedgerCurrency) =>
    list
      .filter((d) => d.balances[cur] > 0)
      .sort((a, b) => b.balances[cur] - a.balances[cur] || a.name.localeCompare(b.name))
      .slice(0, CHIP_LIST_LIMIT);
  const usd = top("USD");
  const lbp = top("LBP");
  const ids = [...new Set([...usd, ...lbp].map((d) => d.id))];
  const [wa, lastSent] = await Promise.all([
    loadWaTemplates(c.supabase, storeId),
    loadLastSent(c.supabase, storeId, "ledger_customer", ids),
  ]);
  return {
    chip: "debts",
    count: list.length,
    usd,
    lbp,
    bodies: bodiesOf(wa.templates, "debt_reminder"),
    lastSent,
    storeName: c.storeName,
  };
}

async function tomorrowBookingRows(c: Ctx, storeId: string, statuses: string[]) {
  const day = beirutTomorrow(new Date());
  // requested_date is the bookings screen's date; a booking stored only with a
  // starts_at instant is placed on its Beirut day instead.
  const { data, error } = await c.supabase
    .from("bookings")
    .select("id, status, service_name, requested_date, requested_time, customer_name, phone, customer_id, starts_at")
    .eq("store_id", storeId)
    .in("status", statuses)
    .or(
      `requested_date.eq.${day.ymd},and(requested_date.is.null,starts_at.gte.${day.start.toISOString()},starts_at.lt.${day.end.toISOString()})`,
    )
    .order("requested_time", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) return null;
  return { day, rows: (data ?? []) as {
    id: string;
    status: string;
    service_name: string | null;
    requested_date: string | null;
    requested_time: string | null;
    customer_name: string | null;
    phone: string | null;
    customer_id: string | null;
    starts_at: string | null;
  }[] };
}

async function tomorrowBookings(c: Ctx, storeId: string): Promise<TomorrowAnswer | null> {
  const res = await tomorrowBookingRows(c, storeId, ["pending", "accepted", "scheduled"]);
  if (!res) return null;
  const shown = res.rows.slice(0, CHIP_LIST_LIMIT * 2);
  const [wa, lastSent] = await Promise.all([
    loadWaTemplates(c.supabase, storeId),
    loadLastSent(c.supabase, storeId, "booking", shown.map((b) => b.id)),
  ]);
  return {
    chip: "tomorrowBookings",
    date: res.day.ymd,
    today: todayInBeirut(),
    count: res.rows.length,
    rows: shown.map((b) => ({
      id: b.id,
      status: b.status,
      phone: b.phone,
      customerName: b.customer_name,
      hasAccount: !!b.customer_id,
      service: b.service_name,
      date: b.requested_date ?? res.day.ymd,
      time: b.requested_time ?? (b.starts_at
        ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(b.starts_at))
        : null),
    })),
    templates: {
      booking_confirmation: bodiesOf(wa.templates, "booking_confirmation"),
      booking_reminder: bodiesOf(wa.templates, "booking_reminder"),
    },
    lastSent,
    storeName: c.storeName,
  };
}

async function abandonedCarts(c: Ctx, storeId: string): Promise<CartsAnswer | null> {
  // store_abandoned_carts (0309, applied) re-checks staff_can(store,'orders').
  const [rpc, wa, rate] = await Promise.all([
    c.supabase.rpc("store_abandoned_carts", { p_store_id: storeId }),
    loadWaTemplates(c.supabase, storeId),
    getUsdLbpRate(),
  ]);
  if (rpc.error) return null;
  const all = (rpc.data ?? []) as {
    id: string;
    phone: string;
    customer_name: string | null;
    items: CartLine[] | null;
    item_count: number;
    total_estimate: number | string;
    updated_at: string;
    last_wa_at: string | null;
  }[];
  return {
    chip: "abandonedCarts",
    count: all.length,
    rows: all.slice(0, CHIP_LIST_LIMIT).map((r) => ({
      id: r.id,
      phone: r.phone,
      customerName: r.customer_name,
      lines: (r.items ?? []).map((l) => ({ ...l, unit_price: l.unit_price == null ? null : Number(l.unit_price) })),
      itemCount: r.item_count,
      totalEstimate: Number(r.total_estimate),
      updatedAt: r.updated_at,
      lastWaAt: r.last_wa_at,
    })),
    bodies: bodiesOf(wa.templates, "abandoned_cart"),
    rate,
    storeName: c.storeName,
    storeSlug: c.storeSlug,
  };
}

const ACTIVITY_CAP = 5000;

async function inactive(c: Ctx, storeId: string): Promise<InactiveAnswer | null> {
  const [customers, ledger, orders, bookings] = await Promise.all([
    pages<{ id: string; name: string; phone: string | null }>(
      (from, to) =>
        c.supabase.from("store_customers").select("id, name, phone").eq("store_id", storeId).order("created_at").range(from, to),
      ACTIVITY_CAP,
    ),
    pages<{ customer_id: string; happened_on: string }>(
      (from, to) =>
        c.supabase
          .from("customer_transactions")
          .select("customer_id, happened_on")
          .eq("store_id", storeId)
          .order("happened_on", { ascending: false })
          .range(from, to),
      ACTIVITY_CAP,
    ),
    // Orders and bookings count only when this person may read them; the
    // answer names its sources, so a narrower view is said, not hidden.
    c.perms.orders
      ? pages<{ phone: string | null; created_at: string }>(
          (from, to) =>
            c.supabase
              .from("orders")
              .select("phone, created_at")
              .eq("store_id", storeId)
              .not("phone", "is", null)
              .order("created_at", { ascending: false })
              .range(from, to),
          ACTIVITY_CAP,
        )
      : Promise.resolve(null),
    c.perms.bookings
      ? pages<{ phone: string | null; requested_date: string | null; created_at: string }>(
          (from, to) =>
            c.supabase
              .from("bookings")
              .select("phone, requested_date, created_at")
              .eq("store_id", storeId)
              .not("phone", "is", null)
              .order("created_at", { ascending: false })
              .range(from, to),
          ACTIVITY_CAP,
        )
      : Promise.resolve(null),
  ]);
  if (!customers || !ledger) return null;

  const today = todayInBeirut();
  const byCustomer = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const t of ledger.rows) bumpLatest(byCustomer, t.customer_id, t.happened_on);
  const sources: InactiveAnswer["sources"] = ["ledger"];
  if (orders) {
    sources.unshift("orders");
    for (const o of orders.rows) bumpLatest(byPhone, phoneKey(o.phone), beirutYmd(new Date(o.created_at)));
  }
  if (bookings) {
    sources.push("bookings");
    for (const b of bookings.rows) {
      // A future appointment is not "activity so far" — cap it at today.
      const d = b.requested_date ?? beirutYmd(new Date(b.created_at));
      bumpLatest(byPhone, phoneKey(b.phone), d > today ? today : d);
    }
  }
  const r = inactiveCustomers(customers.rows, byCustomer, byPhone, phoneKey, today, INACTIVE_DAYS);
  return {
    chip: "inactiveCustomers",
    count: r.inactive.length,
    rows: r.inactive.slice(0, CHIP_LIST_LIMIT * 2),
    neverActive: r.neverActive,
    sources,
    capped: customers.capped || ledger.capped || !!orders?.capped || !!bookings?.capped,
    storeName: c.storeName,
  };
}

async function weekSales(c: Ctx, storeId: string): Promise<WeekAnswer | null> {
  const now = new Date();
  const w = beirutWeeks(now);
  const since = w.lastStart.toISOString();
  const [online, pos, rate] = await Promise.all([
    pages<{ total: number; currency: string | null; created_at: string }>(
      (from, to) =>
        c.supabase
          .from("orders")
          .select("total, currency, created_at")
          .eq("store_id", storeId)
          .gte("created_at", since)
          .not("status", "in", "(cancelled,rejected)")
          .order("created_at")
          .range(from, to),
      20000,
    ),
    // Point-of-sale rows only for someone the pos_sales RLS lets read them; for
    // anyone else RLS would return nothing and "no POS sales" would be a lie.
    !c.canPos
      ? Promise.resolve(null)
      : pages<{ total: number; currency: string | null; created_at: string }>(
      (from, to) =>
        c.supabase
          .from("pos_sales")
          .select("total, currency, created_at")
          .eq("store_id", storeId)
          .gte("created_at", since)
          .order("created_at")
          .range(from, to),
      20000,
    ),
    getUsdLbpRate(),
  ]);
  if (!online) return null;
  // A POS read that FAILED is not "no POS sales": no answer beats a wrong one.
  if (c.canPos && !pos) return null;
  const posRows = pos?.rows ?? [];
  const both = [...online.rows, ...posRows];

  const thisOnline = inRange(online.rows, w.thisStart, now);
  const thisPos = inRange(posRows, w.thisStart, now);
  const thisTotal = totalsByCurrency([...thisOnline, ...thisPos]).totals;
  const lastToDate = totalsByCurrency(inRange(both, w.lastStart, w.lastSamePoint)).totals;
  const lastFull = totalsByCurrency(inRange(both, w.lastStart, w.thisStart)).totals;
  return {
    chip: "weekSales",
    thisWeek: {
      total: thisTotal,
      online: totalsByCurrency(thisOnline).totals,
      pos: totalsByCurrency(thisPos).totals,
      orders: thisOnline.length,
    },
    lastToDate,
    lastFull,
    pct: {
      USD: pctChange(thisTotal.USD, lastToDate.USD),
      LBP: pctChange(thisTotal.LBP, lastToDate.LBP),
    },
    hasPos: posRows.length > 0,
    rate,
    capped: online.capped || !!pos?.capped,
  };
}

/** One chip's answer. */
export async function quickPanelChip(storeId: string, chip: QuickChip): Promise<ChipResult> {
  if (!isQuickChip(chip)) return { ok: false, reason: "forbidden" };
  const c = await context(storeId);
  if ("ok" in c) return c;
  if (!c.perms[CHIP_PERMISSION[chip]]) return { ok: false, reason: "forbidden" };
  try {
    const answer =
      chip === "todayOrders"
        ? await todayOrders(c, storeId)
        : chip === "lowStock"
          ? await lowStock(c, storeId)
          : chip === "debts"
            ? await debts(c, storeId)
            : chip === "tomorrowBookings"
              ? await tomorrowBookings(c, storeId)
              : chip === "abandonedCarts"
                ? await abandonedCarts(c, storeId)
                : chip === "inactiveCustomers"
                  ? await inactive(c, storeId)
                  : await weekSales(c, storeId);
    return answer ? { ok: true, answer } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type Exceptions = {
  lowStock: number | null;
  overdueDebts: number | null;
  unconfirmedOrders: number | null;
  tomorrowPending: number | null;
};

/**
 * The strip shown without asking. Each count is null when this person may not
 * see it (or it could not be read) — the strip then leaves it out rather than
 * printing a zero it does not know.
 */
export async function quickPanelExceptions(
  storeId: string,
): Promise<{ ok: true; exceptions: Exceptions } | Refusal> {
  const c = await context(storeId);
  if ("ok" in c) return c;
  try {
    const [stock, debtors, orders, bookings] = await Promise.all([
      c.perms.products ? lowStockRows(c, storeId) : Promise.resolve(null),
      c.perms.customers ? debtorSummaries(c, storeId) : Promise.resolve(null),
      c.perms.orders
        ? c.supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("store_id", storeId)
            .eq("status", "pending")
            .lt("created_at", unconfirmedCutoff(Date.now()).toISOString())
        : Promise.resolve(null),
      c.perms.bookings ? tomorrowBookingRows(c, storeId, ["pending"]) : Promise.resolve(null),
    ]);
    return {
      ok: true,
      exceptions: {
        lowStock: stock ? stock.length : null,
        overdueDebts: debtors
          ? debtors.filter((d) => d.overdueDays !== null && d.overdueDays > OVERDUE_DAYS).length
          : null,
        unconfirmedOrders: orders && !orders.error ? (orders.count ?? 0) : null,
        tomorrowPending: bookings ? bookings.rows.length : null,
      },
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
