import { notFound } from "next/navigation";
import { Receipt, TrendingUp, Undo2, Coins } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { filterByQuery } from "@/lib/admin-search";
import { warnIfTruncated } from "@/lib/data/bounds";
import { AdminSearchBox } from "@/components/admin-search-box";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderPayments, type OrderPayment } from "@/components/order-payments";
import { dictSlice } from "@/lib/dict-slice";

type OrderRow = {
  id: string;
  status: string;
  total: number;
  customer_name: string | null;
  phone: string | null;
  created_at: string;
  store_id: string;
  location_id: string | null;
  stores: { name: string } | null;
};
type StoreLocation = {
  id: string;
  store_id: string;
  name: string | null;
  area: string | null;
};

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

/** How many orders the unsearched page shows. Every row renders a full payment
 *  ledger, so this is a render budget as much as a query one. */
const BROWSE_WINDOW = 100;
/** How deep a search reaches. Searching only what browsing shows would answer
 *  "no such order" for anything older than the last hundred — the question an
 *  admin is asked on the phone is almost never about the last hundred. Only
 *  matches render, so the wider window costs a query, not a page. */
const SEARCH_WINDOW = 500;

// Admin reconciliation: platform-wide payment/refund totals + the same per-order
// ledger merchants use (admins are authorized by the RPC + RLS, so refunds work
// here too). The super_admin gate lives in the admin layout.
export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("orders", lang);
  const dict = await getDictionary(lang);
  const t = dict.admin.ordersAdmin;
  const ts = dict.admin.listSearch;
  const q = (await searchParams).q ?? "";

  const supabase = await createClient();

  // Platform-wide money totals + order count, aggregated server-side (super_admin
  // gated). Fetching the whole ledger and reducing in JS silently truncated past
  // PostgREST's 1000-row cap, so totals read low at scale.
  // If the RPC fails, say so. `report ?? {}` followed by `?? 0` turned any
  // failure into a confident "$0 collected · 0 orders", which reads as a real
  // answer — a quiet day — rather than as no answer at all. An admin cannot
  // tell those apart, and $0 is the more dangerous of the two to believe.
  const { data: report, error: reportError } = await supabase.rpc(
    "admin_orders_report",
  );
  const summary = (report ?? {}) as {
    collected?: number;
    refunded?: number;
    net?: number;
    order_count?: number;
  };
  const collected = Number(summary.collected ?? 0);
  const refunded = Number(summary.refunded ?? 0);
  const net = Number(summary.net ?? 0);
  const orderCount = summary.order_count ?? 0;
  /** An em dash instead of a number when the figure is genuinely unknown. */
  const kpi = (formatted: string) => (reportError ? "—" : formatted);

  const window = q ? SEARCH_WINDOW : BROWSE_WINDOW;
  const { data } = await supabase
    .from("orders")
    .select(
      "id, status, total, customer_name, phone, created_at, store_id, location_id, stores(name)",
    )
    .order("created_at", { ascending: false })
    .limit(window);
  const fetched = (data ?? []) as unknown as OrderRow[];
  warnIfTruncated(fetched, window, "orders (admin)");

  // ISS-014. Phone and the short order id are in the haystack because those are
  // what a customer reads out; the store and customer names go through the same
  // hamza-folding matcher as everywhere else. The id match is on the prefix the
  // row actually prints — searching for a fragment the screen never shows would
  // be a promise this page cannot keep.
  const orders = filterByQuery(fetched, q, (o) => [
    o.customer_name,
    o.phone,
    o.stores?.name,
    o.id.slice(0, 8),
  ]);

  // Branch labels for the listed orders — only shown when that store actually
  // has multiple branches (single-branch stores would just repeat themselves).
  const storeIds = [...new Set(orders.map((o) => o.store_id))];
  const { data: locData } = storeIds.length
    ? await supabase
        .from("store_locations")
        .select("id, store_id, name, area")
        .in("store_id", storeIds)
    : { data: [] };
  const locations = (locData ?? []) as StoreLocation[];
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const branchCountByStore = new Map<string, number>();
  locations.forEach((l) => {
    branchCountByStore.set(
      l.store_id,
      (branchCountByStore.get(l.store_id) ?? 0) + 1,
    );
  });

  // Ledger rows for the listed orders, grouped by order id.
  const orderIds = orders.map((o) => o.id);
  const { data: payData } = orderIds.length
    ? await supabase
        .from("order_payments")
        .select("id, order_id, kind, amount, method, note, created_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: true })
    : { data: [] };
  const paymentsByOrder = new Map<string, OrderPayment[]>();
  ((payData ?? []) as (OrderPayment & { order_id: string })[]).forEach((p) => {
    const list = paymentsByOrder.get(p.order_id) ?? [];
    list.push(p);
    paymentsByOrder.set(p.order_id, list);
  });

  const orderStatus = dict.orders.status as Record<string, string>;
  const statusVariant: Record<
    string,
    "neutral" | "primary" | "success" | "warning" | "danger" | "info"
  > = {
    pending: "warning",
    accepted: "info",
    preparing: "info",
    ready: "primary",
    out_for_delivery: "primary",
    completed: "success",
    cancelled: "neutral",
    rejected: "danger",
  };

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={Receipt} title={t.title} subtitle={t.subtitle} />

        <div data-animate className="space-y-8">
          <StatGrid>
            <Stat
              label={t.totalCollected}
              value={kpi(money(collected))}
              icon={<TrendingUp className="text-success" />}
            />
            <Stat
              label={t.totalRefunded}
              value={kpi(money(refunded))}
              icon={<Undo2 className="text-danger" />}
            />
            <Stat
              label={t.netRevenue}
              value={kpi(money(net))}
              icon={<Coins />}
            />
            <Stat
              label={t.orderCount}
              value={kpi((orderCount ?? 0).toLocaleString("en-US"))}
              icon={<Receipt className="text-primary" />}
            />
          </StatGrid>

          {/* Under the KPI tiles, not above them: the totals are platform-wide
              and come from admin_orders_report, so they do not move when the
              list is filtered. Putting the box between them and the list is
              what makes that read as intended rather than as a bug. */}
          <AdminSearchBox
            placeholder={t.searchPlaceholder}
            clearLabel={ts.clear}
            hint={
              q
                ? `${ts.matchCount.replace("{n}", String(orders.length))} · ${ts.window.replace("{n}", String(fetched.length))}`
                : ts.window.replace("{n}", String(fetched.length))
            }
          />

          {orders.length ? (
            <Card>
              <div className="divide-y divide-border">
                {orders.map((order) => {
                  const branch =
                    order.location_id &&
                    (branchCountByStore.get(order.store_id) ?? 0) > 1
                      ? locationById.get(order.location_id)
                      : undefined;
                  return (
                    <div
                      key={order.id}
                      className="p-4 transition-colors hover:bg-surface-muted"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                          <span dir="ltr" className="font-mono text-xs">
                            #{order.id.slice(0, 8)}
                          </span>
                          <span className="font-bold text-foreground">
                            {order.stores?.name ?? "—"}
                          </span>
                          {order.customer_name && (
                            <span>· {order.customer_name}</span>
                          )}
                          <Badge
                            variant={statusVariant[order.status] ?? "neutral"}
                            size="sm"
                          >
                            {orderStatus[order.status] ?? order.status}
                          </Badge>
                          {branch && (
                            <Badge variant="neutral" size="sm">
                              {branch.name || branch.area
                                ? `${dict.os.branches.branchLabel}: ${branch.name || branch.area}`
                                : dict.os.branches.branchLabel}
                            </Badge>
                          )}
                        </span>
                        <span className="font-bold tabular-nums">
                          {money(order.total)}
                        </span>
                      </div>
                      <OrderPayments
                        orderId={order.id}
                        orderTotal={Number(order.total ?? 0)}
                        orderStatus={order.status}
                        payments={paymentsByOrder.get(order.id) ?? []}
                        dict={dictSlice(dict, ["common", "payments"])}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={Receipt}
              title={q ? ts.noMatch.replace("{q}", q) : t.empty}
            />
          )}
        </div>
      </Container>
    </div>
  );
}
