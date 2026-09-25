"use client";

// «المساعد الذكي» — one-tap questions at the top of the merchant home.
//
// Nothing here guesses. Each chip calls ONE server action
// (merchant/[storeId]/quick-panel-actions.ts) the moment it is tapped — no
// query runs on page load except the exceptions strip's few counts — and every
// number on screen is what that action read from the database under the
// caller's RLS. Locked stores (below Pro) see the chips greyed out with the
// upgrade prompt and trigger no query at all.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Coins,
  Lock,
  MessageCircle,
  PackageMinus,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UserX,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatLbp, formatUsd } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { formatLedgerAmount, statementUrl, LEDGER_CURRENCIES, type LedgerCurrency } from "@/lib/ledger";
import { waLink } from "@/lib/phone";
import {
  DEFAULT_WA_TEMPLATES,
  WA_AND,
  WA_LOCALES,
  formatWaDate,
  formatWaTotal,
  storeLinkPath,
  waActionHref,
  type WaLocale,
  type WaValues,
} from "@/lib/wa-templates";
import { INACTIVE_DAYS, OVERDUE_DAYS, fillOffer, OFFER_MAX_CHARS, type QuickChip } from "@/lib/quick-panel";
import { WaActionButton, WaLocaleToggle } from "@/components/wa-actions/wa-action-button";
import { BookingWaActions } from "@/components/wa-actions/booking-wa-actions";
import {
  formatSince,
  logWaAction,
  touchNow,
  useMinuteNow,
  useWaLocale,
} from "@/components/wa-actions/wa-client";
import {
  quickPanelChip,
  quickPanelExceptions,
  type CartsAnswer,
  type ChipResult,
  type DebtsAnswer,
  type Debtor,
  type Exceptions,
  type InactiveAnswer,
  type LowStockAnswer,
  type TodayOrdersAnswer,
  type TomorrowAnswer,
  type WeekAnswer,
} from "@/app/[lang]/(dashboard)/merchant/[storeId]/quick-panel-actions";

type T = Dictionary["quickPanel"];
type WaT = Dictionary["waActions"];
type Money = Record<LedgerCurrency, number>;

const ICONS: Record<QuickChip, LucideIcon> = {
  todayOrders: ReceiptText,
  lowStock: PackageMinus,
  debts: Coins,
  tomorrowBookings: CalendarClock,
  abandonedCarts: ShoppingCart,
  inactiveCustomers: UserX,
  weekSales: TrendingUp,
};

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s);

/** Dollars and lira side by side, each in its own currency, never summed. */
function MoneyText({ m, lang }: { m: Money; lang: "ar" | "en" }) {
  const parts = LEDGER_CURRENCIES.filter((c) => m[c] !== 0).map((c) =>
    c === "USD" ? formatUsd(m.USD, { cents: true }) : formatLedgerAmount(m.LBP, "LBP", lang),
  );
  return <span className="text-money">{parts.length ? parts.join(" + ") : formatUsd(0)}</span>;
}

/** Sends a tab opened during the tap to its address, or this one when a popup
 *  blocker refused the tab (same as the ledger screen). */
function openIn(win: Window | null, href: string) {
  if (win) win.location.replace(href);
  else window.location.assign(href);
}

export function QuickPanel({
  storeId,
  lang,
  locked,
  chips,
  business,
  t,
  waT,
  orderStatus,
  bookingStatus,
}: {
  storeId: string;
  lang: string;
  locked: boolean;
  /** The chips this person may ask (permission- and sector-filtered). */
  chips: QuickChip[];
  /** Business plan: the low-stock action opens inventory, else products. */
  business: boolean;
  t: T;
  waT: WaT;
  orderStatus: Record<string, string>;
  bookingStatus: Record<string, string>;
}) {
  const base = `/${lang}/merchant/${storeId}`;
  const L: "ar" | "en" = lang === "en" ? "en" : "ar";
  const [active, setActive] = useState<QuickChip | null>(null);
  const [results, setResults] = useState<Partial<Record<QuickChip, ChipResult | "loading">>>({});
  const [exceptions, setExceptions] = useState<Exceptions | null>(null);

  // The strip shown without asking: a few counts, fetched once after the page
  // is on screen so the dashboard never waits for them.
  useEffect(() => {
    if (locked) return;
    let alive = true;
    quickPanelExceptions(storeId).then(
      (r) => {
        if (alive && r.ok) setExceptions(r.exceptions);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [storeId, locked]);

  async function ask(chip: QuickChip, force = false) {
    if (active === chip && !force) {
      setActive(null);
      return;
    }
    setActive(chip);
    const cached = results[chip];
    if (!force && cached && cached !== "loading" && cached.ok) return;
    setResults((r) => ({ ...r, [chip]: "loading" }));
    let res: ChipResult;
    try {
      res = await quickPanelChip(storeId, chip);
    } catch {
      res = { ok: false, reason: "failed" };
    }
    setResults((r) => ({ ...r, [chip]: res }));
  }

  if (chips.length === 0) return null;

  const strip: { key: string; text: string; href: string }[] = [];
  if (exceptions) {
    if (exceptions.lowStock)
      strip.push({ key: "stock", text: fill(t.exceptions.lowStock, { n: exceptions.lowStock }), href: `${base}/${business ? "inventory" : "items"}` });
    if (exceptions.overdueDebts)
      strip.push({
        key: "debts",
        text: fill(t.exceptions.overdueDebts, { n: exceptions.overdueDebts, days: OVERDUE_DAYS }),
        href: `${base}/ledger`,
      });
    if (exceptions.unconfirmedOrders)
      strip.push({ key: "orders", text: fill(t.exceptions.unconfirmedOrders, { n: exceptions.unconfirmedOrders }), href: `${base}/orders` });
    if (exceptions.tomorrowPending)
      strip.push({ key: "bookings", text: fill(t.exceptions.tomorrowPending, { n: exceptions.tomorrowPending }), href: `${base}/bookings` });
  }

  const current = active ? results[active] : undefined;

  return (
    <section
      aria-labelledby="quick-panel-title"
      className="mt-4 rounded-3xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 id="quick-panel-title" className="text-base font-extrabold">
            {t.title}
          </h2>
          <p className="text-xs text-muted-foreground">{locked ? t.lockedBody : t.subtitle}</p>
        </div>
      </div>

      {strip.length > 0 && (
        <div className="mt-3" role="region" aria-label={t.exceptions.title}>
          <p className="sr-only">{t.exceptions.title}</p>
          <ul className="flex flex-wrap gap-2">
            {strip.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-warning/30 bg-warning-soft px-3 text-xs font-bold text-warning transition-colors hover:border-warning"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {s.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {chips.map((chip) => {
            const Icon = locked ? Lock : ICONS[chip];
            const on = active === chip;
            return (
              <button
                key={chip}
                type="button"
                disabled={locked}
                aria-pressed={on}
                aria-controls={on ? "quick-panel-answer" : undefined}
                onClick={() => ask(chip)}
                className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface hover:border-primary/50 hover:text-primary"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {t.chips[chip]}
              </button>
            );
          })}
        </div>
      </div>

      {locked && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft/40 p-3">
          <p className="min-w-0 flex-1 text-sm font-semibold">{t.lockedTitle}</p>
          <Link href={`${base}/subscription`} className={buttonVariants({ variant: "primary", size: "sm" })}>
            {t.lockedCta}
          </Link>
        </div>
      )}

      {active && current && (
        <div
          id="quick-panel-answer"
          aria-live="polite"
          className="mt-4 rounded-2xl border border-border bg-surface-muted/40 p-4"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">{t.chips[active]}</h3>
            <button
              type="button"
              onClick={() => setActive(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface"
              aria-label={t.close}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {current === "loading" ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : !current.ok ? (
            <div className="text-sm">
              <p className="font-semibold text-danger">
                {current.reason === "forbidden" ? t.noPermission : current.reason === "locked" ? t.lockedTitle : t.failed}
              </p>
              {current.reason === "failed" && (
                <button type="button" onClick={() => ask(active, true)} className={`mt-2 ${buttonVariants({ variant: "secondary", size: "sm" })}`}>
                  {t.retry}
                </button>
              )}
            </div>
          ) : current.answer.chip === "todayOrders" ? (
            <TodayOrders a={current.answer} t={t} base={base} lang={L} orderStatus={orderStatus} />
          ) : current.answer.chip === "lowStock" ? (
            <LowStock a={current.answer} t={t} base={base} />
          ) : current.answer.chip === "debts" ? (
            <Debts a={current.answer} t={t} waT={waT} base={base} lang={L} storeId={storeId} />
          ) : current.answer.chip === "tomorrowBookings" ? (
            <Tomorrow a={current.answer} t={t} waT={waT} base={base} lang={L} storeId={storeId} bookingStatus={bookingStatus} />
          ) : current.answer.chip === "abandonedCarts" ? (
            <Carts a={current.answer} t={t} waT={waT} base={base} lang={L} storeId={storeId} />
          ) : current.answer.chip === "inactiveCustomers" ? (
            <Inactive a={current.answer} t={t} lang={L} storeId={storeId} />
          ) : (
            <Week a={current.answer} t={t} base={base} lang={L} />
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const rowCls = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm";

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={`mt-3 ${buttonVariants({ variant: "secondary", size: "sm" })}`}>
      {label}
    </Link>
  );
}

function Showing({ shown, total, t }: { shown: number; total: number; t: T }) {
  if (total <= shown) return null;
  return <p className="mt-1 text-xs text-muted-foreground">{fill(t.showing, { n: shown })}</p>;
}

function beirutTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Beirut",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function TodayOrders({
  a,
  t,
  base,
  lang,
  orderStatus,
}: {
  a: TodayOrdersAnswer;
  t: T;
  base: string;
  lang: "ar" | "en";
  orderStatus: Record<string, string>;
}) {
  const tt = t.todayOrders;
  return (
    <div>
      <p className="text-lg font-extrabold">{a.count === 0 ? tt.none : fill(tt.count, { n: a.count })}</p>
      {a.count > 0 && (
        <p className="text-sm text-muted-foreground">
          {tt.total.split("{total}")[0]}
          <MoneyText m={a.totals} lang={lang} />
          {a.totals.USD > 0 && a.rate > 0 && (
            <span className="text-money ms-1 text-xs">({formatLbp(a.totals.USD, a.rate, lang)})</span>
          )}
          {tt.total.split("{total}")[1] ?? ""}
        </p>
      )}
      {a.rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {a.rows.map((o) => (
            <li key={o.id} className={rowCls}>
              <Link href={`${base}/orders/${o.id}`} className="min-w-0 flex-1 font-semibold hover:text-primary">
                <bdi>{o.customer_name || tt.guest}</bdi>
                <span className="text-money ms-2 text-xs font-normal text-muted-foreground">{beirutTime(o.created_at)}</span>
              </Link>
              <Badge variant={o.status === "pending" ? "warning" : o.status === "cancelled" || o.status === "rejected" ? "neutral" : "info"}>
                {orderStatus[o.status] ?? o.status}
              </Badge>
              <span className="text-money font-bold">
                {o.currency === "LBP" ? formatLedgerAmount(o.total, "LBP", lang) : formatUsd(o.total, { cents: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Showing shown={a.rows.length} total={a.count} t={t} />
      <ActionLink href={`${base}/orders`} label={tt.open} />
    </div>
  );
}

function LowStock({ a, t, base }: { a: LowStockAnswer; t: T; base: string }) {
  const tt = t.lowStock;
  return (
    <div>
      <p className="text-lg font-extrabold">{a.count === 0 ? tt.none : fill(tt.count, { n: a.count })}</p>
      {a.rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {a.rows.map((p) => (
            <li key={p.id} className={rowCls}>
              <span className="min-w-0 flex-1 font-semibold">
                <bdi>{p.name}</bdi>
              </span>
              <span className={`text-xs font-bold ${p.stock <= 0 ? "text-danger" : "text-warning"}`}>
                {fill(tt.item, { stock: p.stock, threshold: p.low_stock_threshold })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Showing shown={a.rows.length} total={a.count} t={t} />
      <p className="mt-2 text-xs text-muted-foreground">{tt.rule}</p>
      {a.count > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {a.target === "inventory" ? tt.noSupplierOrders : tt.noSupplierOrdersItems}
        </p>
      )}
      <ActionLink
        href={`${base}/${a.target}`}
        label={a.target === "inventory" ? tt.openInventory : tt.openItems}
      />
    </div>
  );
}

function DebtRemind({
  d,
  a,
  storeId,
  lang,
  waT,
  failedText,
}: {
  d: Debtor;
  a: DebtsAnswer;
  storeId: string;
  lang: "ar" | "en";
  waT: WaT;
  failedText: string;
}) {
  const waLocale = useWaLocale(lang);
  const now = useMinuteNow();
  const [sentAt, setSentAt] = useState<string | null>(a.lastSent[`${d.id}:debt_reminder`] ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const dialable = waLink(d.phone) !== null;

  async function remind() {
    // Opened synchronously inside the tap so a popup blocker lets it through.
    const win = window.open("", "_blank");
    setBusy(true);
    setErr(false);
    const { data, error } = await createClient().rpc("create_ledger_statement_token", { p_customer_id: d.id });
    setBusy(false);
    const tok = data as { token?: string } | null;
    if (error || !tok?.token) {
      win?.close();
      setErr(true);
      return;
    }
    // Only what is OWED, each currency on its own, never converted.
    const owed = LEDGER_CURRENCIES.filter((c) => d.balances[c] > 0).map((c) =>
      formatLedgerAmount(d.balances[c], c, waLocale),
    );
    const built = waActionHref(d.phone, {
      body: a.bodies[waLocale] ?? DEFAULT_WA_TEMPLATES.debt_reminder[waLocale],
      fallbackBody: DEFAULT_WA_TEMPLATES.debt_reminder[waLocale],
      values: {
        customer_name: d.name,
        store_name: a.storeName,
        balance: owed.join(WA_AND[waLocale]),
        link: statementUrl(window.location.origin, waLocale, tok.token),
      },
      locale: waLocale,
    });
    if (!built) {
      win?.close();
      return;
    }
    openIn(win, built.href);
    logWaAction({ storeId, key: "debt_reminder", targetType: "ledger_customer", targetId: d.id });
    setSentAt(new Date().toISOString());
    touchNow();
  }

  const since = sentAt ? formatSince(sentAt, now, waT.ago, lang) : null;
  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={remind}
        disabled={!dialable || busy}
        className={`${buttonVariants({ variant: "whatsapp", size: "sm" })} w-full sm:w-auto`}
      >
        <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
        {waT.keys.debt_reminder}
      </button>
      {!dialable ? (
        <p className="mt-1 text-xs text-muted-foreground">{waT.noPhone}</p>
      ) : err ? (
        <p className="mt-1 text-xs text-danger">{failedText}</p>
      ) : since ? (
        <p className="mt-1 text-xs text-muted-foreground">{waT.lastSent.split("{when}").join(since)}</p>
      ) : null}
    </div>
  );
}

function Debts({
  a,
  t,
  waT,
  base,
  lang,
  storeId,
}: {
  a: DebtsAnswer;
  t: T;
  waT: WaT;
  base: string;
  lang: "ar" | "en";
  storeId: string;
}) {
  const tt = t.debts;
  const block = (cur: LedgerCurrency, list: Debtor[], title: string) =>
    list.length > 0 && (
      <div className="mt-3">
        <h4 className="text-xs font-bold text-muted-foreground">{title}</h4>
        <ul className="mt-1 divide-y divide-border">
          {list.map((d) => (
            <li key={`${cur}-${d.id}`} className={rowCls}>
              <Link href={`${base}/ledger/${d.id}`} className="min-w-0 flex-1 font-semibold hover:text-primary">
                <bdi>{d.name}</bdi>
                {d.overdueDays !== null && d.overdueDays > OVERDUE_DAYS && (
                  <Badge variant="warning" className="ms-2">
                    {fill(tt.overdue, { n: d.overdueDays })}
                  </Badge>
                )}
              </Link>
              <span className="text-money font-bold">{formatLedgerAmount(d.balances[cur], cur, lang)}</span>
              <DebtRemind d={d} a={a} storeId={storeId} lang={lang} waT={waT} failedText={tt.linkFailed} />
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div>
      <p className="text-lg font-extrabold">{a.count === 0 ? tt.none : fill(tt.count, { n: a.count })}</p>
      {a.count > 0 && (
        <>
          <p className="text-xs text-muted-foreground">{tt.note}</p>
          <div className="mt-2">
            <WaLocaleToggle uiLang={lang} labels={waT} />
          </div>
        </>
      )}
      {block("USD", a.usd, tt.usd)}
      {block("LBP", a.lbp, tt.lbp)}
      <ActionLink href={`${base}/ledger`} label={tt.open} />
    </div>
  );
}

function Tomorrow({
  a,
  t,
  waT,
  base,
  lang,
  storeId,
  bookingStatus,
}: {
  a: TomorrowAnswer;
  t: T;
  waT: WaT;
  base: string;
  lang: "ar" | "en";
  storeId: string;
  bookingStatus: Record<string, string>;
}) {
  const tt = t.tomorrowBookings;
  return (
    <div>
      <p className="text-lg font-extrabold">
        {a.count === 0 ? tt.none : fill(tt.count, { n: a.count, date: formatWaDate(a.date, lang) ?? a.date })}
      </p>
      {a.rows.length > 0 && (
        <>
          <div className="mt-2">
            <WaLocaleToggle uiLang={lang} labels={waT} />
          </div>
          <ul className="mt-2 space-y-2">
            {a.rows.map((b) => (
              <li key={b.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    {b.time && <span className="text-money me-2">{b.time}</span>}
                    <bdi>{b.customerName || "—"}</bdi>
                  </span>
                  {b.status === "pending" && <Badge variant="warning">{bookingStatus.pending ?? b.status}</Badge>}
                </div>
                {b.service && <p className="text-xs text-muted-foreground"><bdi>{b.service}</bdi></p>}
                <BookingWaActions
                  uiLang={lang}
                  storeId={storeId}
                  storeName={a.storeName}
                  booking={b}
                  today={a.today}
                  templates={a.templates}
                  lastSent={a.lastSent}
                  t={waT}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <Showing shown={a.rows.length} total={a.count} t={t} />
      <ActionLink href={`${base}/bookings`} label={tt.open} />
    </div>
  );
}

function Carts({
  a,
  t,
  waT,
  base,
  lang,
  storeId,
}: {
  a: CartsAnswer;
  t: T;
  waT: WaT;
  base: string;
  lang: "ar" | "en";
  storeId: string;
}) {
  const tt = t.abandonedCarts;
  const linkPath = {} as Record<WaLocale, string | null>;
  for (const l of WA_LOCALES) linkPath[l] = storeLinkPath(l, storeId, a.storeSlug);
  return (
    <div>
      <p className="text-lg font-extrabold">{a.count === 0 ? tt.none : fill(tt.count, { n: a.count })}</p>
      {a.rows.length > 0 && (
        <>
          <div className="mt-2">
            <WaLocaleToggle uiLang={lang} labels={waT} />
          </div>
          <ul className="mt-2 space-y-2">
            {a.rows.map((c) => {
              const values = {} as Record<WaLocale, WaValues>;
              for (const l of WA_LOCALES) {
                values[l] = {
                  customer_name: c.customerName,
                  store_name: a.storeName,
                  total: c.totalEstimate > 0 ? formatWaTotal(c.totalEstimate, a.rate, l) : null,
                  coupon: null,
                };
              }
              return (
                <li key={c.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold"><bdi>{c.customerName || waT.carts.guest}</bdi></span>
                    <bdi dir="ltr" className="text-xs text-muted-foreground">{c.phone}</bdi>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {waT.carts.items.split("{n}").join(String(c.itemCount))}
                    {c.totalEstimate > 0 && (
                      <>
                        {" · "}
                        <span className="text-money">{formatUsd(c.totalEstimate, { cents: true })}</span>
                      </>
                    )}
                  </p>
                  <div className="mt-2">
                    <WaActionButton
                      uiLang={lang}
                      storeId={storeId}
                      templateKey="abandoned_cart"
                      targetType="cart"
                      targetId={c.id}
                      phone={c.phone}
                      label={waT.keys.abandoned_cart}
                      bodies={a.bodies}
                      values={values}
                      linkPath={linkPath}
                      items={c.lines.map((l) => ({ name: l.name, quantity: l.quantity }))}
                      lastSentAt={c.lastWaAt}
                      labels={{ noPhone: waT.noPhone, lastSent: waT.lastSent, ago: waT.ago, truncated: waT.truncated }}
                      variant="whatsapp"
                      full
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Showing shown={a.rows.length} total={a.count} t={t} />
      <ActionLink href={`${base}/abandoned-carts`} label={tt.open} />
    </div>
  );
}

const OFFER_KEY = (storeId: string) => `matjar.quickPanel.offer.${storeId}`;

function Inactive({ a, t, lang, storeId }: { a: InactiveAnswer; t: T; lang: "ar" | "en"; storeId: string }) {
  const tt = t.inactiveCustomers;
  // Mounted only after a tap (client-side), so reading the merchant's last
  // wording from this device here cannot disagree with a server render.
  const [text, setText] = useState<string>(() => {
    try {
      return window.localStorage.getItem(OFFER_KEY(storeId)) || tt.offerDefault;
    } catch {
      return tt.offerDefault;
    }
  });
  const save = (v: string) => {
    setText(v);
    try {
      window.localStorage.setItem(OFFER_KEY(storeId), v);
    } catch {
      /* private mode: the edit lasts for this visit */
    }
  };
  const src = a.sources.map((s) => (s === "orders" ? tt.srcOrders : s === "ledger" ? tt.srcLedger : tt.srcBookings));
  const fmtDate = (ymd: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${ymd}T12:00:00Z`));

  return (
    <div>
      <p className="text-lg font-extrabold">
        {a.count === 0 ? fill(tt.none, { days: INACTIVE_DAYS }) : fill(tt.count, { n: a.count, days: INACTIVE_DAYS })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{fill(tt.rule, { n: a.neverActive })}</p>
      <p className="text-xs text-muted-foreground">{fill(tt.sources, { list: src.join(lang === "ar" ? "، " : ", ") })}</p>

      {a.rows.length > 0 && (
        <>
          <label className="mt-3 block text-sm font-semibold">
            {tt.offerLabel}
            <textarea
              value={text}
              maxLength={OFFER_MAX_CHARS}
              onChange={(e) => save(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-border bg-surface p-3 text-sm font-normal"
            />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{tt.offerHint}</p>
          <ul className="mt-2 divide-y divide-border">
            {a.rows.map((c) => {
              const href = waLink(c.phone, fillOffer(text, { name: c.name, store: a.storeName }));
              return (
                <li key={c.id} className={rowCls}>
                  <span className="min-w-0 flex-1">
                    <bdi className="font-semibold">{c.name}</bdi>
                    <span className="block text-xs text-muted-foreground">
                      {fill(tt.lastActive, { date: fmtDate(c.lastActive), n: c.days })}
                    </span>
                  </span>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "whatsapp", size: "sm" })}
                    >
                      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                      {tt.send}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">{tt.noPhone}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <Showing shown={a.rows.length} total={a.count} t={t} />
        </>
      )}
    </div>
  );
}

function Pct({ n }: { n: number | null }) {
  if (n === null) return null;
  const up = n >= 0;
  return (
    <Badge variant={up ? "success" : "danger"} className="ms-2">
      <span className="text-money">{`${up ? "+" : "−"}${Math.abs(n)}%`}</span>
    </Badge>
  );
}

function Week({ a, t, base, lang }: { a: WeekAnswer; t: T; base: string; lang: "ar" | "en" }) {
  const tt = t.weekSales;
  const hasThis = a.thisWeek.total.USD !== 0 || a.thisWeek.total.LBP !== 0;
  const hasLast = a.lastToDate.USD !== 0 || a.lastToDate.LBP !== 0;
  const inPlay = LEDGER_CURRENCIES.filter((c) => a.thisWeek.total[c] !== 0 || a.lastToDate[c] !== 0);
  const single: LedgerCurrency | null = inPlay.length === 1 ? inPlay[0] : null;
  const split = (label: string, m: Money) => (
    <li className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <MoneyText m={m} lang={lang} />
    </li>
  );
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground">{tt.title}</p>
      {hasThis ? (
        <p className="text-2xl font-extrabold">
          <MoneyText m={a.thisWeek.total} lang={lang} />
          {/* A percentage only when ONE currency is in play: with dollars and
              lira both moving, a single figure would have to pick one of them
              and would read as the change of the whole week. */}
          {single ? <Pct n={a.pct[single]} /> : null}
        </p>
      ) : (
        <p className="text-lg font-extrabold">{tt.none}</p>
      )}
      {hasThis && a.thisWeek.total.USD > 0 && a.rate > 0 && (
        <p className="text-money text-xs text-muted-foreground">{formatLbp(a.thisWeek.total.USD, a.rate, lang)}</p>
      )}
      <ul className="mt-2 space-y-1 text-sm">
        {split(`${tt.online} · ${fill(tt.orders, { n: a.thisWeek.orders })}`, a.thisWeek.online)}
        {a.hasPos && split(tt.pos, a.thisWeek.pos)}
      </ul>
      <p className="mt-3 text-sm">
        {hasLast ? (
          <>
            {tt.vsLast.split("{total}")[0]}
            <MoneyText m={a.lastToDate} lang={lang} />
            {tt.vsLast.split("{total}")[1] ?? ""}
          </>
        ) : (
          <span className="text-muted-foreground">{tt.noCompare}</span>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {tt.lastFull.split("{total}")[0]}
        <MoneyText m={a.lastFull} lang={lang} />
        {tt.lastFull.split("{total}")[1] ?? ""}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{a.hasPos ? tt.sourcesBoth : tt.sourcesOnline}</p>
      <p className="text-xs text-muted-foreground">{tt.weekRule}</p>
      <ActionLink href={`${base}/reports`} label={tt.open} />
    </div>
  );
}
