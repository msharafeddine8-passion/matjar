import { requestNow } from "@/lib/now";
import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import {
  ExternalLink,
  BarChart3,
  Sun,
  Clock,
  Ban,
} from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { toCategoryKey, type CategoryKey } from "@/lib/catalog";
import {
  getSector,
  resolveStoreModules,
  sectorPrimarySetup,
} from "@/lib/sectors";
import { computeCompleteness } from "@/lib/completeness";
import { validateStorePublic } from "@/lib/data-quality";
import { parseHours } from "@/lib/hours";
import { SITE_URL } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { StoreShareCard } from "@/components/store-share-card";
import { StoreChecklist } from "@/components/store-checklist";
import { StoreStatusNotice } from "@/components/store-status-notice";
import { Stat } from "@/components/os-dashboard/stat";
import { WidgetCard } from "@/components/os-dashboard/widget-card";
import { RevenueChart } from "@/components/os-dashboard/revenue-chart";
import {
  TodayPanel,
  type TodayCounterRow,
  type TodayBookingRow,
} from "@/components/os-dashboard/today-panel";
import {
  AlertsCard,
  type AlertRow,
} from "@/components/os-dashboard/alerts-card";
import {
  ActivityFeed,
  type ActivityRow,
} from "@/components/os-dashboard/activity-feed";
import {
  TasksWidget,
  type TaskRow,
} from "@/components/os-dashboard/tasks-widget";
import {
  SuggestionsCard,
  type SuggestionRow,
} from "@/components/os-dashboard/suggestions-card";
import {
  QuickActions,
  type QuickAction,
  type QuickActionKey,
} from "@/components/os-dashboard/quick-actions";
import {
  ReviewsWidget,
  type MerchantReview,
} from "@/components/os-dashboard/reviews-widget";
import { MerchantToday } from "@/components/merchant/merchant-today";
import { dictSlice } from "@/lib/dict-slice";
import type { StorePlan } from "@/lib/plan-tiers";
import { formatUsd } from "@/lib/currency";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtMoney = (n: number) => formatUsd(n, { cents: true });

// ===== The dashboard's building blocks, ordered per sector =====
// Same widgets everywhere — a clinic and a boutique share one codebase — but
// each sector leads with what its day actually revolves around. Ordering is
// data, not copy-pasted JSX.
type WidgetKey =
  | "kpis"
  | "chart"
  | "today"
  | "alerts"
  | "suggestions"
  | "tasks"
  | "activity"
  | "reviews";

// Reviews sit last in every sector: answering one is never more urgent than
// today's orders, but it is the only place the merchant can do it at all.
const WIDGET_ORDER: Record<
  "commerce" | "food" | "booking" | "services",
  WidgetKey[]
> = {
  // Shops & showrooms: money first, then what needs attention.
  commerce: ["kpis", "chart", "alerts", "today", "suggestions", "tasks", "activity", "reviews"],
  // Restaurants: the pass comes first — orders & kitchen, then the numbers.
  food: ["today", "kpis", "chart", "alerts", "suggestions", "tasks", "activity", "reviews"],
  // Clinics & agents: today's appointments are the whole morning.
  booking: ["today", "kpis", "alerts", "suggestions", "activity", "tasks", "chart", "reviews"],
  // Service pros: open requests (quotes to send!) lead, bookings right behind.
  services: ["today", "kpis", "alerts", "suggestions", "activity", "tasks", "chart", "reviews"],
};

// ===== Matjar Business OS — store home =====
// Not a launcher anymore (the sidebar owns navigation) — a living, sector-aware
// dashboard: real revenue, today's work, honest alerts and suggestions.
export default async function StoreOsHomePage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.dashboard;

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
    .select(
      // lat/lng: the map pin is a completeness item (8 of 13 live stores have
      // none), so the coordinates ride along on the store row already fetched
      // rather than costing a second query.
      // status_reason/status_changed_at: the owner of a suspended shop is the
      // one person who most needs to know why and since when, and audit_logs is
      // super-admin-only by RLS — so it rides on their own store row (0282).
      // phone/area/service_area/region: read by the public data quality gate
      // (lib/data-quality.ts) whose notes the checklist shows the owner.
      "id, name, slug, status, accent_color, owner_id, short_code, plan, trial_ends_at, logo_url, cover_url, description, hours, whatsapp, phone, area, service_area, region, lat, lng, status_reason, status_changed_at, business_types(slug, name_ar, name_en)",
    )
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const s = store as unknown as {
    name: string;
    slug: string | null;
    status: string;
    accent_color: string | null;
    owner_id: string;
    short_code: string;
    plan: StorePlan | null;
    trial_ends_at: string | null;
    logo_url: string | null;
    cover_url: string | null;
    description: string | null;
    hours: unknown;
    whatsapp: string | null;
    phone: string | null;
    area: string | null;
    service_area: string | null;
    region: string | null;
    lat: number | null;
    lng: number | null;
    status_reason: string | null;
    status_changed_at: string | null;
    business_types: { slug: string; name_ar: string; name_en: string } | null;
  };
  const category = toCategoryKey(s.business_types?.slug, `store ${storeId}`);
  const sector = getSector(category);
  /** Nothing public exists for this store yet — no page, no shareable link. */
  const isPending = s.status !== "active";
  /** Suspended and rejected are outcomes, not waiting rooms: the merchant is
   *  owed an explanation rather than the "under review" reassurance. */
  const isStopped = s.status === "suspended" || s.status === "rejected";
  const typeName =
    (lang === "ar" ? s.business_types?.name_ar : s.business_types?.name_en) ??
    "";

  // Owner sees everything; staff only what their permissions grant. Revenue
  // figures are strictly owner-or-orders-permission — never leaked to others.
  const isOwner = s.owner_id === user.id;
  let perms: Record<string, boolean> = {};
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    perms = (staffRow?.permissions as Record<string, boolean> | null) ?? {};
  }
  const canOrders = isOwner || (perms.orders ?? false);
  const canBookings = isOwner || (perms.bookings ?? false);
  const canProducts = isOwner || (perms.products ?? false);
  const canRevenue = canOrders;

  const allModules = new Set(Object.values(sector.modules).flat());
  const hasOrders = allModules.has("orders");
  const hasBookings = allModules.has("bookings");
  const hasRequests = allModules.has("requests");
  const hasKitchen = allModules.has("kitchen");
  const hasInventory = allModules.has("inventory");

  // "Today" in the merchant's timezone (Lebanon platform), for booking dates.
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
  }).format(new Date());
  const since14d = new Date(requestNow() - 14 * 86400_000).toISOString();

  // Sector-aware onboarding: sectors whose core entity isn't products (a hotel's
  // units, an events organizer's ticket types) get a tailored primary-setup step.
  // Decided here rather than next to its consumer because it is a pure function
  // of the category — which the store row already gave us — and knowing it now
  // is what lets its count ride in the wave below instead of trailing it.
  const primarySetup = sectorPrimarySetup(category);

  // Everything in one round-trip: the report RPC (aggregated server-side, see
  // 0087/0111) + cheap head-counts and limit≤8 lists, each gated by permission
  // and by whether this sector even has the module.
  //
  // Everything that CAN be in this wave must be. The fan-out itself is close to
  // free — measured, 22 parallel PostgREST calls cost about the same wall time
  // as one, because they share the connection and overlap end to end. What is
  // not free is a query that waits for the wave to finish first: each of those
  // adds a whole round-trip to the critical path. The visits pulse and the
  // primary-setup count used to be exactly that, and neither needed anything
  // the wave produces — only `canRevenue`, `isOwner` and the category, all
  // known above. Keep it that way: adding a query after this wave costs a
  // round-trip, adding one inside it costs nothing.
  const none = { data: null, count: null } as const;
  const [
    reportRes,
    itemsRes,
    pendingOrdersRes,
    pendingBookingsRes,
    todayBookingsCountRes,
    todayBookingsRes,
    pendingRequestsRes,
    lowStockRes,
    tasksRes,
    tasksCountRes,
    recentOrdersRes,
    recentBookingsRes,
    autoRunsRes,
    campaigns14Res,
    automationsCountRes,
    followersRes,
    costedItemsRes,
    providersRes,
    storeModulesRes,
    reviewsRes,
    visitsRes,
    primaryCountRes,
  ] = await Promise.all([
    canRevenue
      ? supabase.rpc("store_report", { p_store_id: storeId, p_days: 14 })
      : Promise.resolve(none),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .is("deleted_at", null),
    canOrders && hasOrders
      ? supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .eq("status", "pending")
      : Promise.resolve(none),
    canBookings && hasBookings
      ? supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .eq("status", "pending")
      : Promise.resolve(none),
    canBookings && hasBookings
      ? supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .eq("requested_date", todayIso)
          .in("status", ["pending", "accepted", "scheduled"])
      : Promise.resolve(none),
    canBookings && hasBookings
      ? supabase
          .from("bookings")
          .select("id, service_name, requested_time, customer_name")
          .eq("store_id", storeId)
          .eq("requested_date", todayIso)
          .in("status", ["pending", "accepted", "scheduled"])
          .order("requested_time", { ascending: true, nullsFirst: false })
          .limit(5)
      : Promise.resolve(none),
    canBookings && hasRequests
      ? supabase
          .from("service_requests")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .eq("status", "pending")
      : Promise.resolve(none),
    canProducts && hasInventory
      ? supabase
          .from("products")
          .select("id, name, stock")
          .eq("store_id", storeId)
          .is("deleted_at", null)
          .not("stock", "is", null)
          .lte("stock", 5)
          .order("stock", { ascending: true })
          .limit(5)
      : Promise.resolve(none),
    supabase
      .from("store_tasks")
      .select("id, title, priority, due_on")
      .eq("store_id", storeId)
      .eq("status", "open")
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("store_tasks")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "open"),
    canOrders && hasOrders
      ? supabase
          .from("orders")
          .select("id, total, status, customer_name, created_at")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve(none),
    canBookings && hasBookings
      ? supabase
          .from("bookings")
          .select("id, service_name, customer_name, created_at")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false })
          .limit(3)
      : Promise.resolve(none),
    canOrders
      ? supabase
          .from("automation_runs")
          .select("id, trigger, created_at")
          .eq("store_id", storeId)
          .eq("status", "fired")
          .order("created_at", { ascending: false })
          .limit(3)
      : Promise.resolve(none),
    isOwner
      ? supabase
          .from("store_campaigns")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .gte("created_at", since14d)
      : Promise.resolve(none),
    isOwner
      ? supabase
          .from("automations")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
      : Promise.resolve(none),
    isOwner
      ? supabase
          .from("follows")
          .select("user_id", { count: "exact", head: true })
          .eq("store_id", storeId)
      : Promise.resolve(none),
    // Cost prices are what the profit report runs on, and across the live
    // platform not one product carries one — so the report computes zero for
    // everybody and nothing ever said why. Counted here, inside the existing
    // wave, so asking the question costs no extra round-trip.
    isOwner
      ? supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .is("deleted_at", null)
          .gt("cost", 0)
      : Promise.resolve(none),
    // The roster count is not gated on the sector's default modules: the
    // RESOLVED set isn't known until this wave returns, and gating on defaults
    // would leave a store that switched `team` on stuck reporting zero
    // providers forever — told to add a team it can never be credited for.
    isOwner
      ? supabase
          .from("doctors")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
      : Promise.resolve(none),
    // Per-store module toggles. Completeness follows the resolved module set,
    // so a store that switched `location` off is never nagged for a map pin.
    supabase
      .from("store_modules")
      .select("module_key, enabled")
      .eq("store_id", storeId),
    // What customers said in public, plus whatever the shop already answered.
    // Ungated: a review is on the storefront for the world to read, so hiding
    // it from the staff who caused it would protect nothing.
    supabase
      .from("reviews")
      .select("id, customer_name, rating, comment, created_at, reply, reply_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(5),
    // Free storefront-visits pulse (migration 0167) — a reason for every
    // merchant to check in daily; the full audience breakdown is on the Pro
    // reports page. Gated on canRevenue exactly as the tile that renders it is.
    canRevenue
      ? supabase.rpc("store_visits_summary", {
          p_store_id: storeId,
          p_days: 7,
        })
      : Promise.resolve(none),
    // How many of the sector's core entity exist yet (hotel units, ticket
    // types). Only two sectors have one; everywhere else this is a no-op.
    isOwner && primarySetup
      ? supabase
          .from(primarySetup.table)
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
      : Promise.resolve(none),
  ]);

  const report = (reportRes.data ?? null) as {
    total_orders?: number;
    online_realized?: number;
    online_pending?: number;
    pos_total?: number;
    week?: { count: number; pct: number };
    month?: { count: number; pct: number };
    per_day?: { day: string; orders: number; online: number; pos: number }[];
  } | null;

  const itemsCount = itemsRes.count ?? 0;
  const costedItems = costedItemsRes.count ?? 0;
  const providers = providersRes.count ?? 0;
  const pendingOrders = pendingOrdersRes.count ?? 0;
  const pendingBookings = pendingBookingsRes.count ?? 0;
  const todayBookingsCount = todayBookingsCountRes.count ?? 0;
  const pendingRequests = pendingRequestsRes.count ?? 0;
  const openTasks = tasksCountRes.count ?? 0;
  const lowStock = (lowStockRes.data ?? []) as {
    id: string;
    name: string;
    stock: number;
  }[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const reviews = (reviewsRes.data ?? []) as MerchantReview[];
  const todayBookings = (todayBookingsRes.data ?? []) as {
    id: string;
    service_name: string | null;
    requested_time: string | null;
    customer_name: string | null;
  }[];
  const recentOrders = (recentOrdersRes.data ?? []) as {
    id: string;
    total: number;
    status: string;
    customer_name: string | null;
    created_at: string;
  }[];
  const recentBookings = (recentBookingsRes.data ?? []) as {
    id: string;
    service_name: string | null;
    customer_name: string | null;
    created_at: string;
  }[];
  const autoRuns = (autoRunsRes.data ?? []) as {
    id: string;
    trigger: string;
    created_at: string;
  }[];

  const base = `/${lang}/merchant/${storeId}`;

  // ---- KPI row (revenue strictly gated) ------------------------------------
  const realized =
    Number(report?.online_realized ?? 0) + Number(report?.pos_total ?? 0);
  const pendingRevenue = Number(report?.online_pending ?? 0);
  type StatItem = {
    label: string;
    value: string;
    hint?: string;
    pct?: number;
    href?: string;
    highlight?: boolean;
  };

  // The visits pulse, fetched up in the wave (see the note there).
  const vSummary =
    (visitsRes.data as { visits?: number; uniques?: number } | null) ?? {};
  const visits7d = {
    visits: vSummary.visits ?? 0,
    uniques: vSummary.uniques ?? 0,
  };

  let stats: StatItem[] = [];
  if (canRevenue && report) {
    stats = [
      {
        label: t.revenue,
        value: fmtMoney(realized),
        hint: t.revenueHint,
        href: `${base}/reports`,
      },
      {
        label: t.pendingRevenue,
        value: fmtMoney(pendingRevenue),
        hint: t.pendingRevenueHint,
        href: hasOrders ? `${base}/orders` : `${base}/reports`,
        highlight: pendingRevenue > 0,
      },
      {
        label: t.weekOrders,
        value: String(report.week?.count ?? 0),
        pct: report.week?.pct ?? 0,
        href: hasOrders ? `${base}/orders` : `${base}/reports`,
      },
      {
        label: t.monthOrders,
        value: String(report.month?.count ?? 0),
        pct: report.month?.pct ?? 0,
        href: `${base}/reports`,
      },
      {
        label: t.weekVisits,
        value: String(visits7d.visits),
        hint:
          visits7d.uniques > 0
            ? t.weekVisitsHint.replace("{n}", String(visits7d.uniques))
            : undefined,
        href: `${base}/reports`,
      },
    ];
  } else if (canBookings) {
    // Bookings-only staff still get a useful pulse — counts, never money.
    stats = [
      {
        label: dict.merchant.kpi.pendingBookings,
        value: String(pendingBookings),
        href: `${base}/bookings`,
        highlight: pendingBookings > 0,
      },
      {
        label: t.todayBookings,
        value: String(todayBookingsCount),
        href: `${base}/bookings`,
      },
      ...(hasRequests
        ? [
            {
              label: t.todayRequests,
              value: String(pendingRequests),
              href: `${base}/requests`,
              highlight: pendingRequests > 0,
            },
          ]
        : []),
    ];
  }

  // ---- Revenue chart -------------------------------------------------------
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(
      lang === "ar" ? "ar" : "en",
      { month: "numeric", day: "numeric" },
    );
  const perDay = report?.per_day ?? [];
  const chartDays = perDay.map((d, i) => ({
    label: dayLabel(d.day),
    online: Number(d.online),
    pos: Number(d.pos),
    isToday: i === perDay.length - 1,
    tooltip: `${dayLabel(d.day)} — ${fmtMoney(Number(d.online) + Number(d.pos))}`,
  }));

  // ---- Today, for the phone shell -----------------------------------------
  // The LAST bucket of the same per_day series the chart above renders, so the
  // two can never disagree, and store_report buckets by Beirut days (0219) —
  // "today" is the merchant's today, not one that rolls over at 21:00 local.
  //
  // Both figures ride on `report`, which is fetched only when canRevenue, so
  // a staff member without the orders permission gets null for both and the
  // tiles are absent rather than zeroed. `online` here is the day's booked
  // total with cancelled/rejected excluded — the same definition the chart's
  // bars and tooltip use.
  const todayBucket = perDay.length ? perDay[perDay.length - 1] : null;
  const todayNumbers = {
    orders:
      canRevenue && todayBucket ? Number(todayBucket.orders) : null,
    sales:
      canRevenue && todayBucket
        ? Number(todayBucket.online) + Number(todayBucket.pos)
        : null,
  };

  const showChart =
    canRevenue &&
    !!report &&
    (sector.flow.kind === "commerce" || realized + pendingRevenue > 0);

  // ---- Today panel ---------------------------------------------------------
  const counters: TodayCounterRow[] = [];
  if (canOrders && hasOrders)
    counters.push({
      key: "orders",
      label: t.todayPendingOrders,
      count: pendingOrders,
      href: `${base}/orders`,
    });
  if (canOrders && hasKitchen)
    counters.push({
      key: "kitchen",
      label: t.todayKitchen,
      count: null,
      href: `${base}/kitchen`,
    });
  if (canBookings && hasRequests)
    counters.push({
      key: "requests",
      label: t.todayRequests,
      count: pendingRequests,
      href: `${base}/requests`,
    });
  const bookingRows: TodayBookingRow[] | null =
    canBookings && hasBookings
      ? todayBookings.map((b) => ({
          id: b.id,
          time: b.requested_time ? b.requested_time.slice(0, 5) : null,
          customer: b.customer_name || t.customerFallback,
          service: b.service_name,
        }))
      : null;
  const showToday = counters.length > 0 || bookingRows !== null;

  // ---- Alerts (honest ones only) -------------------------------------------
  const alerts: AlertRow[] = [];
  if (isOwner && s.plan === "free" && s.trial_ends_at) {
    const daysLeft =
      (new Date(s.trial_ends_at).getTime() - requestNow()) / 86400_000;
    if (daysLeft >= 0 && daysLeft <= 3) {
      alerts.push({
        id: "trial",
        kind: "trial",
        text: t.trialAlert.replace(
          "{date}",
          new Date(s.trial_ends_at).toLocaleDateString(
            lang === "ar" ? "ar" : "en",
            { month: "long", day: "numeric" },
          ),
        ),
        cta: t.trialCta,
        href: `${base}/subscription`,
      });
    }
  }
  if (canOrders && pendingOrders > 0) {
    alerts.push({
      id: "pending-orders",
      kind: "orders",
      text: t.pendingOrdersAlert.replace("{n}", String(pendingOrders)),
      cta: t.review,
      href: `${base}/orders`,
    });
  }
  for (const p of lowStock) {
    alerts.push({
      id: `stock-${p.id}`,
      kind: "stock",
      text: t.lowStockAlert
        .replace("{name}", p.name)
        .replace("{n}", String(p.stock)),
      cta: t.restock,
      href: `${base}/inventory`,
    });
  }
  const showAlerts = alerts.length > 0 || isOwner;

  // ---- Activity feed (orders + bookings + automation runs, merged) ---------
  const triggerLabels = dict.os.automations.triggers as Record<string, string>;
  const activity: ActivityRow[] = [
    ...recentOrders.map((o) => ({
      id: o.id,
      kind: "order" as const,
      text: `${t.activityOrder} · ${o.customer_name || t.customerFallback}`,
      meta: fmtMoney(Number(o.total)),
      createdAt: o.created_at,
    })),
    ...recentBookings.map((b) => ({
      id: b.id,
      kind: "booking" as const,
      text: `${t.activityBooking} · ${b.customer_name || t.customerFallback}${
        b.service_name ? ` · ${b.service_name}` : ""
      }`,
      createdAt: b.created_at,
    })),
    ...autoRuns.map((a) => ({
      id: a.id,
      kind: "automation" as const,
      text: `${t.activityAutomation} · ${triggerLabels[a.trigger] ?? a.trigger}`,
      createdAt: a.created_at,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  const showActivity = canOrders || canBookings;

  // ---- Profile completeness (weighted, sector-aware) -----------------------
  // Which feature modules this store actually runs (sector defaults overlaid
  // with its own toggles) — the completeness rules hang off this, not off the
  // sector, so a store that switched a module off is never asked to fill it in.
  const modOverrides: Record<string, boolean> = {};
  for (const row of (storeModulesRes.data ?? []) as {
    module_key: string;
    enabled: boolean;
  }[])
    modOverrides[row.module_key] = row.enabled;
  const enabledModules = resolveStoreModules(category, modOverrides);

  // Sector-aware onboarding: `primarySetup` is resolved above the wave and its
  // count rides in it. Still null for everyone the query was skipped for, so
  // the completeness rules below cannot tell the difference.
  const primaryCount: number | null =
    isOwner && primarySetup ? (primaryCountRes.count ?? 0) : null;

  // One weighted number instead of eight equal ticks. What each item is worth,
  // which ones block publishing and which single one to do next are all decided
  // in src/lib/completeness.ts — this page only supplies the facts.
  const completeness = computeCompleteness(
    category,
    enabledModules,
    {
      logo: !!s.logo_url,
      cover: !!s.cover_url,
      description: !!s.description?.trim(),
      // Counts the weekly grid, not the retired free-text box (0244). A merchant
      // who filled the grid properly was told to go add hours, while one who
      // typed "9 صباحا" got the tick and the open/closed badge got nothing.
      hours: !!parseHours(s.hours),
      whatsapp: !!s.whatsapp?.trim(),
      // Coordinates, not a text address: "الأقرب إليك" cannot use prose.
      mapPin: s.lat != null && s.lng != null,
      brandColor: !!s.accent_color,
      customLink: !!s.slug,
      // Sectors whose core entity isn't products count that entity instead — a
      // hotel's readiness hangs on its rooms, not on a catalogue it never keeps.
      offerings: primaryCount ?? itemsCount,
      offeringsWithCost: costedItems,
      providers,
    },
    primarySetup
      ? { key: primarySetup.labelKey, href: primarySetup.module }
      : undefined,
  );
  const checklistDone = completeness.next === null;

  // The public data quality gate, on the same facts. Not a second checklist:
  // completeness is what the merchant still wants to do, this is what the
  // platform checks before ranking the page — and the one state ("blocked")
  // that keeps a live page out of explore is something the owner must be told
  // in plain words rather than infer from a percentage.
  const storeQuality = validateStorePublic(
    {
      name: s.name,
      category: s.business_types?.slug ?? null,
      area: s.area,
      service_area: s.service_area,
      region: s.region,
      phone: s.phone,
      whatsapp: s.whatsapp,
      description: s.description,
      logo_url: s.logo_url,
      cover_url: s.cover_url,
      offerings: isOwner ? (primaryCount ?? itemsCount) : undefined,
    },
    { sector: category, modules: enabledModules },
  );

  // ---- Smart suggestions (rule-based, from data already on hand) -----------
  const hasAudience =
    (followersRes.count ?? 0) > 0 || (report?.total_orders ?? 0) > 0;
  const suggestions: SuggestionRow[] = [];
  if (isOwner) {
    if (itemsCount === 0)
      suggestions.push({
        key: "addItem",
        text: t.suggestAddItem,
        cta: t.suggestAddItemCta,
        href: `${base}/items`,
      });
    if (!checklistDone)
      suggestions.push({
        key: "checklist",
        text: t.suggestChecklist,
        cta: t.suggestChecklistCta,
        href: `${base}/edit`,
      });
    if (lowStock.length > 0 && hasInventory)
      suggestions.push({
        key: "restock",
        text: t.suggestRestock,
        cta: t.suggestRestockCta,
        href: `${base}/inventory`,
      });
    if (hasAudience && (campaigns14Res.count ?? 0) === 0)
      suggestions.push({
        key: "campaign",
        text: t.suggestCampaign,
        cta: t.suggestCampaignCta,
        href: `${base}/campaigns`,
      });
    if ((automationsCountRes.count ?? 0) === 0)
      suggestions.push({
        key: "automation",
        text: t.suggestAutomation,
        cta: t.suggestAutomationCta,
        href: `${base}/automations`,
      });
  }
  const topSuggestions = suggestions.slice(0, 3);

  // ---- Quick actions (per sector, permission-filtered) ---------------------
  const quickDefs: Record<
    CategoryKey,
    { key: QuickActionKey; label: string; path: string; perm: string }[]
  > = {
    food: [
      { key: "orders", label: t.quickOrders, path: "orders", perm: "orders" },
      { key: "kitchen", label: t.quickKitchen, path: "kitchen", perm: "orders" },
      { key: "addItem", label: t.quickAddMenuItem, path: "items", perm: "products" },
    ],
    retail: [
      { key: "addItem", label: t.quickAddProduct, path: "items", perm: "products" },
      { key: "pos", label: t.quickPos, path: "pos", perm: "orders" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    services: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "requests", label: t.quickRequests, path: "requests", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
    ],
    healthcare: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "requests", label: t.quickRequests, path: "requests", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
    ],
    realEstate: [
      { key: "addItem", label: t.quickAddListing, path: "items", perm: "products" },
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    automotive: [
      { key: "addItem", label: t.quickAddListing, path: "items", perm: "products" },
      { key: "orders", label: t.quickOrders, path: "orders", perm: "orders" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    beauty: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    fitness: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    sportsCourts: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
    ],
    education: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    events: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    hospitality: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    pharmacy: [
      { key: "addItem", label: t.quickAddProduct, path: "items", perm: "products" },
      { key: "orders", label: t.quickOrders, path: "orders", perm: "orders" },
      { key: "pos", label: t.quickPos, path: "pos", perm: "orders" },
    ],
    petCare: [
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    professional: [
      { key: "requests", label: t.quickRequests, path: "requests", perm: "bookings" },
      { key: "bookings", label: t.quickBookings, path: "bookings", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
    ],
    contractors: [
      { key: "requests", label: t.quickRequests, path: "requests", perm: "bookings" },
      { key: "addItem", label: t.quickAddService, path: "items", perm: "products" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
    farm: [
      { key: "addItem", label: t.quickAddProduct, path: "items", perm: "products" },
      { key: "orders", label: t.quickOrders, path: "orders", perm: "orders" },
      { key: "campaign", label: t.quickCampaign, path: "campaigns", perm: "orders" },
    ],
  };
  const quickActions: QuickAction[] = quickDefs[category]
    .filter((a) => isOwner || (perms[a.perm] ?? false))
    .map((a) => ({ key: a.key, label: a.label, href: `${base}/${a.path}` }));

  // ---- Layout: same widgets, sector-specific emphasis ----------------------
  const layoutKind =
    category === "food"
      ? "food"
      : sector.flow.kind === "commerce"
        ? "commerce"
        : category === "services"
          ? "services"
          : "booking";
  const order = WIDGET_ORDER[layoutKind];

  const widgets: Record<WidgetKey, React.ReactNode> = {
    kpis:
      stats.length > 0 ? (
        <div
          className={`grid grid-cols-2 gap-3 ${
            stats.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
          }`}
        >
          {stats.map((k) => (
            <Stat key={k.label} {...k} />
          ))}
        </div>
      ) : null,
    chart: showChart ? (
      <WidgetCard
        title={t.chartTitle}
        Icon={BarChart3}
        action={{ label: dict.merchant.analytics.link, href: `${base}/reports` }}
      >
        <RevenueChart
          days={chartDays}
          legendOnline={dict.os.finance.online}
          legendPos={dict.os.finance.pos}
          todayLabel={t.chartToday}
          hasPos={Number(report?.pos_total ?? 0) > 0}
          empty={t.chartEmpty}
        />
      </WidgetCard>
    ) : null,
    today: showToday ? (
      <WidgetCard title={t.todayTitle} Icon={Sun}>
        <TodayPanel
          counters={counters}
          bookings={bookingRows}
          bookingsTitle={t.todayBookings}
          noBookings={t.todayNoBookings}
          bookingsHref={`${base}/bookings`}
          viewAll={t.viewAll}
          bookingsFirst={layoutKind === "booking"}
        />
      </WidgetCard>
    ) : null,
    alerts: showAlerts ? (
      <AlertsCard title={t.alertsTitle} empty={t.alertsEmpty} alerts={alerts} />
    ) : null,
    suggestions:
      topSuggestions.length > 0 ? (
        <SuggestionsCard title={t.suggestionsTitle} suggestions={topSuggestions} />
      ) : null,
    tasks: (
      <TasksWidget
        title={t.tasksTitle}
        openLabel={t.tasksOpen}
        empty={t.tasksEmpty}
        viewAll={t.tasksAll}
        href={`${base}/tasks`}
        tasks={tasks}
        openCount={openTasks}
        lang={lang}
      />
    ),
    activity: showActivity ? (
      <ActivityFeed
        title={t.activityTitle}
        empty={t.activityEmpty}
        rows={activity}
        lang={lang}
      />
    ) : null,
    // Only reviews the shop already has — an empty card here would be nagging a
    // brand-new store about feedback nobody could have left yet.
    reviews: reviews.length ? (
      <ReviewsWidget
        reviews={reviews}
        canReply={isOwner}
        dict={dictSlice(dict, ["reviews", "common"])}
        lang={lang}
      />
    ) : null,
  };

  const visibleOrder = order.filter((key) => widgets[key] !== null);
  const spanOf = (key: WidgetKey, index: number) =>
    key === "kpis" || key === "chart" || (key === "today" && index === 0)
      ? "lg:col-span-2"
      : "";

  const SectorIcon = sector.Icon;

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-5xl">
        <div data-animate>
          <Link
            href={`/${lang}/merchant`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronPrev className="h-4 w-4" />
            {dict.merchant.products.back}
          </Link>

          {/* ===== The phone's first screenful =====
              A merchant on a phone gets the decision before the decoration:
              what arrived, how today is going, and the two or three things
              they do twenty times a day. The full sector-ordered dashboard
              renders underneath it, unchanged, at every width — this block
              disappears at lg, where the KPI row and the chart already say
              all of this with room to spare. */}
          <MerchantToday
            pending={canOrders && hasOrders ? pendingOrders : null}
            ordersHref={`${base}/orders`}
            today={todayNumbers}
            quickActions={quickActions}
            labels={{
              waitingOne: dict.merchant.mobile.ordersWaitingOne,
              waitingMany: dict.merchant.mobile.ordersWaitingMany,
              waitingCta: dict.merchant.mobile.ordersWaitingCta,
              todayTitle: dict.merchant.mobile.todayTitle,
              todayOrders: dict.merchant.mobile.todayOrders,
              todaySales: dict.merchant.mobile.todaySales,
              todaySalesHint: dict.merchant.mobile.todaySalesHint,
              pendingOrders: dict.merchant.mobile.pendingOrders,
              quickTitle: dict.merchant.mobile.quickTitle,
            }}
          />

          {/* Sector-tinted hero: identity + the day's quick actions. */}
          <div
            className={`mt-4 overflow-hidden rounded-3xl border border-border bg-gradient-to-br ${sector.heroTint} bg-surface p-6 sm:p-8`}
          >
            <div className="flex flex-wrap items-center gap-4 sm:gap-5">
              {s.logo_url ? (
                <Image
                  src={s.logo_url}
                  alt=""
                  width={64}
                  height={64}
                  className="h-16 w-16 shrink-0 rounded-2xl border border-border bg-surface object-cover shadow-sm"
                />
              ) : (
                <span
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${sector.iconTint} shadow-sm`}
                >
                  <SectorIcon className="h-8 w-8" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                    {s.name}
                  </h1>
                  {typeName && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${sector.iconTint}`}
                    >
                      {typeName}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dict.os.tagline}
                  {itemsCount > 0 && (
                    <span className="ms-2 font-semibold">
                      · {itemsCount} {dict.os.itemsHint}
                    </span>
                  )}
                </p>
              </div>
              {/* stores_select only exposes rows with status='active', so a
                  store still in review has no public page at all — this link
                  led to a 404 and the share/QR tools beside it minted codes
                  pointing at the same nothing. A merchant who printed one on a
                  shopfront had no way to find out. */}
              {isStopped ? (
                // "قيد المراجعة" on a suspended shop is a false reassurance —
                // nobody is reviewing it. The notice below says what happened.
                <span className="flex shrink-0 items-center gap-1.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-bold text-danger">
                  <Ban className="h-4 w-4" />
                  {
                    dict.merchant.status[
                      s.status as "suspended" | "rejected"
                    ]
                  }
                </span>
              ) : isPending ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-xl border border-warning/30 bg-warning-soft px-4 py-2 text-sm font-bold text-warning">
                  <Clock className="h-4 w-4" />
                  {dict.os.storePending}
                </span>
              ) : (
                <Link
                  href={`/${lang}/store/${storeId}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface/80 px-4 py-2 text-sm font-bold backdrop-blur transition-colors hover:border-primary hover:text-primary"
                >
                  <ExternalLink className="h-4 w-4" />
                  {dict.os.viewPublic}
                </Link>
              )}
            </div>

            {/* From lg only: below it the same actions already sit in the
                phone block above, one screenful higher and above the fold.
                Rendering both would be the same row of buttons twice. */}
            {quickActions.length > 0 && (
              <div className="mt-6 hidden lg:block">
                <QuickActions actions={quickActions} />
              </div>
            )}
          </div>

          {/* A stopped shop gets an explanation before anything else. It sits
              above the checklist on purpose: nudging someone to finish their
              profile while their storefront is switched off, without saying so,
              is the version of this screen we are replacing. Only the owner ever
              reaches it: stores_select exposes a non-active row to the owner and
              to a super admin, so a staff member of a suspended store is
              redirected out of this page before it renders — a separate gap,
              older than this change, and not one a reason column can close. */}
          {isStopped && (
            <StoreStatusNotice
              lang={lang}
              dict={dict}
              status={s.status as "suspended" | "rejected"}
              storeName={s.name}
              reason={s.status_reason}
              changedAt={s.status_changed_at}
              className="mt-6"
            />
          )}

          {/* Onboarding checklist (owner nudge until the store is complete). */}
          {isOwner && (
            <div className="mt-6">
              <StoreChecklist
                lang={lang}
                dict={dict}
                storeId={storeId}
                storeName={s.name}
                storeSlug={s.slug}
                status={s.status}
                completeness={completeness}
                quality={storeQuality}
              />
            </div>
          )}

          {/* The living dashboard — widget order follows the sector's day. */}
          <div className="mt-6 grid gap-4 sm:gap-5 lg:grid-cols-2" data-animate>
            {visibleOrder.map((key, index) => (
              <div key={key} className={spanOf(key, index)}>
                {widgets[key]}
              </div>
            ))}
          </div>

          {/* The share card hands over a QR and a short link meant for a
              shopfront or a receipt. Until the store is approved both resolve
              to nothing, so it stays hidden rather than inviting the merchant
              to print a dead link. */}
          {/* Suppressed entirely for a stopped store: the "we will tell you the
              moment it is approved" copy is written for a shop waiting its turn,
              and a suspended one is not waiting. Its explanation is above. */}
          {!isStopped && (
            <div className="mt-8">
              {isPending ? (
                <div className="rounded-2xl border border-dashed border-warning/40 bg-warning-soft/40 p-5 text-center">
                  <p className="font-bold text-warning">{dict.os.storePending}</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    {dict.os.storePendingHint}
                  </p>
                </div>
              ) : (
                <StoreShareCard code={s.short_code} baseUrl={SITE_URL} dict={dict} />
              )}
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}
