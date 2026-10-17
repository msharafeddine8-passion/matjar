import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Users,
  Truck,
} from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { LoadError } from "@/components/load-error";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";
import { formatUsd } from "@/lib/currency";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Bars({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: number }[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-muted-foreground">{title}</h2>
      {rows.length ? (
        <div className="mt-4 space-y-3">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">{r.label}</span>
                <span className="font-bold">{r.value}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(r.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

// Stacked daily-revenue columns: online (brand blue) under POS (amber).
// Pure CSS — percentage heights inside a fixed-height flex column.
function RevenueColumns({
  days,
  legendOnline,
  legendPos,
  hasPos,
}: {
  days: { label: string; online: number; pos: number }[];
  legendOnline: string;
  legendPos: string;
  hasPos: boolean;
}) {
  const max = Math.max(1, ...days.map((d) => d.online + d.pos));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 150 }}>
        {days.map((d) => {
          const total = d.online + d.pos;
          return (
            <div
              key={d.label}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${d.label} — $${Number(total.toFixed(2)).toLocaleString("en-US")}`}
            >
              {d.pos > 0 && (
                <div
                  className={`w-full rounded-t-md bg-accent`}
                  style={{ height: `${(d.pos / max) * 100}%` }}
                />
              )}
              {d.online > 0 && (
                <div
                  className={`w-full bg-primary ${d.pos > 0 ? "" : "rounded-t-md"}`}
                  style={{ height: `${(d.online / max) * 100}%` }}
                />
              )}
              {total === 0 && (
                <div className="h-1 w-full rounded-t-md bg-surface-muted" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {days.map((d, i) => (
          <span
            key={d.label}
            className="flex-1 text-center text-[9px] font-medium text-muted-foreground"
          >
            {i % 2 === 0 ? d.label : ""}
          </span>
        ))}
      </div>
      {hasPos && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
            {legendOnline}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
            {legendPos}
          </span>
        </div>
      )}
    </div>
  );
}

function Delta({ pct }: { pct: number }) {
  if (pct === 0) return null;
  const up = pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-bold ${up ? "text-success" : "text-danger"}`}
    >
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {Math.abs(pct)}%
    </span>
  );
}

export default async function StoreReportsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.merchant.analytics;
  const td = dict.merchant.dispatch;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);
  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isPro(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }

  // Revenue data: staff need the orders permission.
  const isOwner =
    (store as unknown as { owner_id: string }).owner_id === user.id;
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms =
      (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.orders ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  // Everything is aggregated server-side (see migration 0087) so revenue can't
  // silently truncate past PostgREST's 1000-row cap as a store grows.
  const { data: report, error: reportErr } = await supabase.rpc("store_report", {
    p_store_id: storeId,
    p_days: 14,
  });
  const r = (report ?? {}) as {
    total_orders?: number;
    online_sales?: number;
    online_realized?: number;
    online_pending?: number;
    pos_total?: number;
    week?: { count: number; pct: number };
    month?: { count: number; pct: number };
    per_day?: { day: string; orders: number; online: number; pos: number }[];
    status_rows?: { status: string; count: number }[];
    top_products?: { name: string; qty: number }[];
  };

  // Sales leads with REALIZED (completed) revenue; pending is surfaced below so
  // the figure isn't inflated by orders still in progress.
  const totalSales = Number(r.online_realized ?? 0) + Number(r.pos_total ?? 0);
  const pendingSales = Number(r.online_pending ?? 0);

  // Date-only day keys: formatted at UTC midnight in UTC so no zone shifts
  // them; Western digits like the rest of the merchant screens.
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(
      lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
      { month: "numeric", day: "numeric", timeZone: "UTC" },
    );
  const perDay = (r.per_day ?? []).map((d) => ({
    label: dayLabel(d.day),
    value: Number(d.orders),
  }));
  const revenueDays = (r.per_day ?? []).map((d) => ({
    label: dayLabel(d.day),
    online: Number(d.online),
    pos: Number(d.pos),
  }));
  const statusRows = (r.status_rows ?? []).map((s) => ({
    label: (dict.orders.status as Record<string, string>)[s.status] ?? s.status,
    value: Number(s.count),
  }));
  const topProducts = (r.top_products ?? []).map((tp) => ({
    label: tp.name,
    value: Number(tp.qty),
  }));

  const kpis = [
    { label: t.totalOrders, value: String(r.total_orders ?? 0) },
    { label: t.sales, value: formatUsd(totalSales) },
    {
      label: t.thisWeek,
      value: String(r.week?.count ?? 0),
      pct: r.week?.pct ?? 0,
    },
    {
      label: t.thisMonth,
      value: String(r.month?.count ?? 0),
      pct: r.month?.pct ?? 0,
    },
  ];

  // ===== Delivery cost (migration 0213). Same 14-day window as the revenue
  // block above. Cancelled dispatches are excluded — their fee was taken back
  // off the order, so counting them would overstate what couriers actually cost.
  // Profit, not just takings. store_margin_report() has existed since 0210 and
  // nothing had ever called it, so a merchant could see what came in but never
  // what was left. It only counts lines whose cost was known at the moment of
  // sale and reports the coverage separately, so a half-filled catalogue
  // understates profit rather than inventing it (0248).
  const { data: marginData, error: marginErr } = await supabase.rpc("store_margin_report", {
    p_store_id: storeId,
    p_days: 30,
  });
  const m = (marginData ?? {}) as {
    revenue?: number;
    cogs?: number;
    gross_profit?: number;
    lines_total?: number;
    lines_no_cost?: number;
    coverage_pct?: number;
  };
  const marginLines = Number(m.lines_total ?? 0);
  const coverage = Number(m.coverage_pct ?? 0);
  const grossProfit = Number(m.gross_profit ?? 0);
  const marginPct =
    Number(m.revenue ?? 0) > 0
      ? (grossProfit / Number(m.revenue)) * 100
      : 0;

  const { data: delivery, error: deliveryErr } = await supabase.rpc("store_delivery_report", {
    p_store_id: storeId,
    p_days: 14,
  });
  const d = (delivery ?? {}) as {
    total_fees?: number;
    dispatches?: number;
    delivered?: number;
    avg_fee?: number;
    by_courier?: { name: string; fees: number }[];
  };
  const dispatchCount = Number(d.dispatches ?? 0);
  const courierRows = (d.by_courier ?? []).map((c) => ({
    label: c.name,
    value: Number(c.fees),
  }));
  const deliveryKpis = [
    { label: td.totalFees, value: formatUsd(Number(d.total_fees ?? 0)) },
    { label: td.dispatches, value: String(dispatchCount) },
    { label: td.delivered, value: String(d.delivered ?? 0) },
    { label: td.avgFee, value: formatUsd(Number(d.avg_fee ?? 0)) },
  ];

  // ===== Audience side (visits / sources / conversion), from migration 0161.
  const { data: audience, error: audienceErr } = await supabase.rpc("store_audience", {
    p_store_id: storeId,
    p_days: 14,
  });
  const a = (audience ?? {}) as {
    total_visits?: number;
    unique_visitors?: number;
    product_views?: number;
    conversion?: number;
    per_day?: { day: string; visits: number; uniques: number }[];
    sources?: { source: string; visits: number }[];
    top_viewed?: { name: string; views: number }[];
  };
  const sourceLabels = t.sources as Record<string, string>;
  const visitsDays = (a.per_day ?? []).map((d) => ({
    label: dayLabel(d.day),
    value: Number(d.visits),
  }));
  const sourceRows = (a.sources ?? []).map((s) => ({
    label: sourceLabels[s.source] ?? s.source,
    value: Number(s.visits),
  }));
  const topViewed = (a.top_viewed ?? []).map((v) => ({
    label: v.name,
    value: Number(v.views),
  }));
  const audienceKpis = [
    { label: t.visits, value: String(a.total_visits ?? 0) },
    { label: t.uniqueVisitors, value: String(a.unique_visitors ?? 0) },
    { label: t.conversion, value: `${a.conversion ?? 0}%` },
    { label: t.productViews, value: String(a.product_views ?? 0) },
  ];
  const hasVisits = Number(a.total_visits ?? 0) > 0;

  // A failed report RPC used to render as a page of honest-looking zeros.
  const loadFailed = !!(reportErr || marginErr || deliveryErr || audienceErr);
  if (loadFailed) {
    console.error(
      "[reports] read failed",
      reportErr ?? marginErr ?? deliveryErr ?? audienceErr,
    );
    return (
      <div className="py-10">
        <Container className="max-w-4xl">
          <Link
            href={`/${lang}/merchant/${storeId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronPrev className="h-4 w-4" />
            {(store as { name: string }).name}
          </Link>
          <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <BarChart3 className="h-7 w-7 text-primary" />
            {t.title}
          </h1>
          <LoadError title={dict.common.loadError} retryLabel={dict.common.reload} className="mt-6" />
        </Container>
      </div>
    );
  }

  return (
    <div className="py-10">
      <Container className="max-w-4xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <BarChart3 className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {/* ISS-017: at zero this page is a wall of 0 / $0 with three "no data"
            panels under it, and nothing anywhere says why or what would change
            it. The zeros are honest and they stay — a report that hides its own
            emptiness is worse — but the explanation goes above them, where it is
            read first, with the same next step the OS home would have given. */}
        {Number(r.total_orders ?? 0) === 0 && (
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="reports"
            title={dict.os.nextStep.reportsTitle}
            className="mt-6"
          />
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-2xl bg-surface-muted/60 p-4">
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-extrabold">
                {k.value}
                {"pct" in k && typeof k.pct === "number" && <Delta pct={k.pct} />}
              </p>
            </div>
          ))}
        </div>

        {pendingSales > 0 && (
          <p className="mt-2 text-xs font-semibold text-warning">
            {dict.os.finance.pending}: {formatUsd(pendingSales)} —{" "}
            {dict.os.finance.pendingHint}
          </p>
        )}

        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-muted-foreground">
            {t.revenueDaily}
          </h2>
          <div className="mt-4">
            <RevenueColumns
              days={revenueDays}
              legendOnline={dict.os.finance.online}
              legendPos={dict.os.finance.pos}
              hasPos={Number(r.pos_total ?? 0) > 0}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Bars title={t.ordersOverTime} rows={perDay} empty={t.noData} />
          <Bars title={t.statusBreakdown} rows={statusRows} empty={t.noData} />
          <Bars title={t.topProducts} rows={topProducts} empty={t.noData} />
        </div>

        {/* ===== Profit ===== */}
        {marginLines > 0 && (
          <div className="mt-12 border-t border-border pt-8">
            <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <TrendingUp className="h-6 w-6 text-primary" />
              {t.profitTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.profitSubtitle}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: t.profitRevenue, value: formatUsd(Number(m.revenue ?? 0)) },
                { label: t.profitCogs, value: formatUsd(Number(m.cogs ?? 0)) },
                { label: t.profitGross, value: formatUsd(grossProfit) },
                { label: t.profitMargin, value: marginPct.toFixed(1) + "%" },
              ].map((k) => (
                <div
                  key={k.label}
                  className="rounded-2xl border border-border bg-surface p-4"
                >
                  <p className="text-xs font-semibold text-muted-foreground">
                    {k.label}
                  </p>
                  <p className="mt-1 text-xl font-extrabold tabular-nums">
                    {k.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Coverage is the honesty line. At 60% these figures describe 60%
                of what was sold, and a merchant reading them as the whole
                picture would be wrong in the direction that costs money. */}
            {coverage < 100 && (
              <p className="mt-3 rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold text-warning">
                {t.profitCoverage
                  .replace("{pct}", String(coverage))
                  .replace("{n}", String(Number(m.lines_no_cost ?? 0)))}
              </p>
            )}
          </div>
        )}

        {/* ===== Delivery cost ===== */}
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <Truck className="h-6 w-6 text-primary" />
            {td.reportTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {td.reportSubtitle}
          </p>

          {dispatchCount ? (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {deliveryKpis.map((k) => (
                  <div
                    key={k.label}
                    className="rounded-2xl bg-surface-muted/60 p-4"
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {k.label}
                    </p>
                    <p className="mt-1 text-2xl font-extrabold">{k.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Bars
                  title={td.byCourier}
                  rows={courierRows}
                  empty={t.noData}
                />
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface-muted/40 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {td.noDispatches}
              </p>
            </div>
          )}
        </div>

        {/* ===== Audience & conversion ===== */}
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <Users className="h-6 w-6 text-primary" />
            {t.audienceTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.audienceSubtitle}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {audienceKpis.map((k) => (
              <div key={k.label} className="rounded-2xl bg-surface-muted/60 p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  {k.label}
                </p>
                <p className="mt-1 text-2xl font-extrabold">{k.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t.conversionHint}
          </p>

          {hasVisits ? (
            <>
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h3 className="text-sm font-bold text-muted-foreground">
                  {t.visitsOverTime}
                </h3>
                <div className="mt-4">
                  <RevenueColumns
                    days={visitsDays.map((d) => ({
                      label: d.label,
                      online: d.value,
                      pos: 0,
                    }))}
                    legendOnline={t.visits}
                    legendPos=""
                    hasPos={false}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Bars
                  title={t.trafficSources}
                  rows={sourceRows}
                  empty={t.noData}
                />
                <Bars title={t.topViewed} rows={topViewed} empty={t.noData} />
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface-muted/40 p-8 text-center">
              <p className="text-sm font-semibold">{t.noVisitsTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.noVisitsHint}
              </p>
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}
