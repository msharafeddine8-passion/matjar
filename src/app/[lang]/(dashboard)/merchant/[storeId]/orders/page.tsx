import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { loadStaffNotes, pickStaffNote } from "@/lib/order-staff-note";
import { Container } from "@/components/ui/container";
import { AutoRefresh } from "@/components/auto-refresh";
import { type OrderPayment } from "@/components/order-payments";
import { OrdersFilter, type OrderCard } from "@/components/orders-filter";
import {
  type DispatchCourier,
  type DeliveryRequest,
} from "@/components/order-dispatch";
import { getStorePlan } from "@/lib/plan-server";
import { hasPlan } from "@/lib/plan-tiers";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";
import {
  MerchantOrderCard,
  type MerchantOrderCardData,
} from "@/components/merchant/merchant-order-card";
import { ShoppingCart } from "lucide-react";
import { getUsdLbpRate } from "@/lib/data/settings";
import {
  bodiesOf,
  loadLastSent,
  loadWaTemplates,
} from "@/lib/wa-actions-server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one status that means "waiting on the merchant". It is also exactly
 *  what the bottom-nav badge counts and what the accept button clears, so the
 *  badge, the home banner and this list can never disagree. */
const NEEDS_ACTION = "pending";

type OrderItem = {
  name: string;
  quantity: number;
  unit_price: number;
  note: string | null;
  /** Joined off order_items.product_id: how this product is sold (0299). Null
   *  for every piece-priced product — which is every product that predates
   *  that migration — and for a staff member whose RLS does not let them read
   *  the catalogue. Either way the line falls back to a plain count. */
  products: {
    sold_by: string | null;
    unit_measure: string | null;
    unit_amount: number | null;
  } | null;
};
type OrderRow = {
  id: string;
  status: string;
  total: number;
  fulfillment: "delivery" | "pickup";
  address: string | null;
  phone: string | null;
  customer_name: string | null;
  customer_note: string | null;
  store_note: string | null;
  created_at: string;
  location_id: string | null;
  order_items: OrderItem[];
  assigned_to: string | null;
  tags: string[] | null;
  delivery_fee: number | null;
  change_for: number | null;
  delivery_instructions: string | null;
  custom_fields: Record<string, string> | null;
  scheduled_for: string | null;
  customer_id: string | null;
  delivery_zone_id: string | null;
};
type StoreLocation = { id: string; name: string | null; area: string | null };
type TeamMember = { user_id: string; name: string; role: string };

export default async function StoreOrdersPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

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
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const { data } = await supabase
    .from("orders")
    .select(
      // The nested products() join is READ-ONLY and additive: it carries the
      // three descriptive unit-pricing columns (0299) so a butcher's line can
      // read "2 كيلو" instead of "2×". Nothing computes a total from them —
      // no deployed function can even see them — so no money moves.
      "id, status, total, fulfillment, address, phone, customer_name, customer_note, store_note, created_at, location_id, assigned_to, tags, delivery_fee, change_for, delivery_instructions, custom_fields, scheduled_for, customer_id, delivery_zone_id, order_items(name, quantity, unit_price, note, products(sold_by, unit_measure, unit_amount))",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  // The internal note lives in order_staff_notes from 0314 (the ordering
  // customer could read orders.store_note through the API). store_note stays
  // in the select as the pre-0314 source; after 0314 it is always NULL.
  const staffNotes = await loadStaffNotes(supabase, storeId);
  const orders = ((data ?? []) as unknown as OrderRow[]).map((o) => ({
    ...o,
    store_note: pickStaffNote(staffNotes, o.id, o.store_note),
  }));

  // Assignable team (owner + staff, with names) for the per-order assignee
  // picker. One RPC — the merchant page can't read other users' profiles.
  const { data: teamData } = await supabase.rpc("store_team", {
    p_store_id: storeId,
  });
  const team = ((teamData ?? []) as TeamMember[]).map((m) => ({
    id: m.user_id,
    name: m.name,
  }));

  // Branch labels: only shown when the store actually has multiple branches.
  const { data: locData } = await supabase
    .from("store_locations")
    .select("id, name, area")
    .eq("store_id", storeId);
  const locations = (locData ?? []) as StoreLocation[];
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const multiBranch = locations.length > 1;

  // Money ledger for these orders, grouped by order id.
  const { data: payData } = await supabase
    .from("order_payments")
    .select("id, order_id, kind, amount, method, note, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });
  const paymentsByOrder = new Map<string, OrderPayment[]>();
  ((payData ?? []) as (OrderPayment & { order_id: string })[]).forEach((p) => {
    const list = paymentsByOrder.get(p.order_id) ?? [];
    list.push(p);
    paymentsByOrder.set(p.order_id, list);
  });

  // Courier dispatch (Pro+). The couriers this store enabled, and any live
  // request per order. The plan is read here for the UI only — request_delivery()
  // enforces it again server-side.
  const plan = await getStorePlan(storeId);
  const canDispatch = hasPlan(plan, "pro");

  const { data: courierData } = await supabase
    .from("store_couriers")
    .select(
      "company_id, price, delivery_companies(id, name, phone, whatsapp, is_active)",
    )
    .eq("store_id", storeId);
  type CourierJoin = {
    company_id: string;
    price: number | null;
    delivery_companies: {
      id: string;
      name: string;
      phone: string | null;
      whatsapp: string | null;
      is_active: boolean;
    } | null;
  };
  const couriers: DispatchCourier[] = ((courierData ?? []) as unknown as
    CourierJoin[])
    .filter((r) => r.delivery_companies?.is_active)
    .map((r) => ({
      id: r.delivery_companies!.id,
      name: r.delivery_companies!.name,
      phone: r.delivery_companies!.phone,
      whatsapp: r.delivery_companies!.whatsapp,
      price: r.price,
    }));

  const { data: delData } = await supabase
    .from("delivery_requests")
    .select("id, order_id, company_id, status, fee, tracking_ref")
    .eq("store_id", storeId)
    .neq("status", "cancelled");
  const deliveryByOrder = new Map<string, DeliveryRequest>();
  ((delData ?? []) as (DeliveryRequest & { order_id: string })[]).forEach((d) =>
    deliveryByOrder.set(d.order_id, d),
  );

  // WhatsApp action buttons (every plan, 0309). The wording, the live rate for
  // the LBP amount, when each button was last tapped, and the ETA the order's
  // delivery zone states — the only ETA a confirmation may quote. Every read
  // is defensive: before 0309 the buttons use the default wording.
  const zoneIds = [
    ...new Set(orders.map((o) => o.delivery_zone_id).filter((z): z is string => !!z)),
  ];
  const [waTemplates, rate, lastSent, zoneRes] = await Promise.all([
    loadWaTemplates(supabase, storeId),
    getUsdLbpRate(),
    loadLastSent(supabase, storeId, "order", orders.map((o) => o.id)),
    zoneIds.length
      ? supabase
          .from("store_delivery_zones")
          .select("id, eta_min_minutes, eta_max_minutes")
          .in("id", zoneIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const zoneEta: Record<string, { min: number | null; max: number | null }> = {};
  for (const z of (zoneRes.data ?? []) as {
    id: string;
    eta_min_minutes: number | null;
    eta_max_minutes: number | null;
  }[]) {
    zoneEta[z.id] = { min: z.eta_min_minutes, max: z.eta_max_minutes };
  }
  const wa = {
    rate,
    lastSent,
    zoneEta,
    templates: {
      order_confirmation: bodiesOf(waTemplates.templates, "order_confirmation"),
      order_status: bodiesOf(waTemplates.templates, "order_status"),
      review_request: bodiesOf(waTemplates.templates, "review_request"),
    },
  };

  // Shape each order for the client filter: resolve its ledger and branch label
  // here so the interactive list can filter/search in memory without refetching.
  const cards: OrderCard[] = orders.map((o) => {
    const loc =
      multiBranch && o.location_id
        ? locationById.get(o.location_id)
        : undefined;
    return {
      ...o,
      tags: o.tags ?? [],
      payments: paymentsByOrder.get(o.id) ?? [],
      branch: loc ? { name: loc.name, area: loc.area } : null,
      delivery: deliveryByOrder.get(o.id) ?? null,
    };
  });

  // ---- The phone's decision queue -----------------------------------------
  // Everything above stays as it is; this is the same rows, filtered to the
  // ones actually waiting on the merchant and sorted newest first, because the
  // order that just came in is the one whose customer is still on the line.
  // (`orders` is already ordered created_at desc, so filtering preserves it.)
  const needsAction: MerchantOrderCardData[] = orders
    .filter((o) => o.status === NEEDS_ACTION)
    .map((o) => ({
      id: o.id,
      total: Number(o.total),
      fulfillment: o.fulfillment,
      customerName: o.customer_name,
      phone: o.phone,
      customerNote: o.customer_note,
      address: o.address,
      createdAt: o.created_at,
      items: (o.order_items ?? []).map((it) => ({
        name: it.name,
        quantity: it.quantity,
        soldBy: it.products?.sold_by ?? null,
        unitMeasure: it.products?.unit_measure ?? null,
        unitAmount: it.products?.unit_amount ?? null,
      })),
    }));

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <AutoRefresh />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {dict.merchant.ordersTitle}
          </h1>
          <Link
            href={`/${lang}/merchant/${storeId}/abandoned-carts`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold transition-colors hover:border-primary/40"
          >
            <ShoppingCart className="h-4 w-4" aria-hidden />
            {dict.waActions.carts.link}
          </Link>
        </div>

        {/* Below lg the merchant is holding the phone one-handed with somebody
            waiting, so the orders that need a decision come first, in full, as
            cards with two targets big enough to hit without looking. The
            filterable list below is still the whole ledger and is untouched —
            this is a queue in front of it, not a replacement for it. From lg up
            it does not render: a desktop shows the same rows with a status
            control and the filter chips already in view. */}
        {needsAction.length > 0 && (
          <section className="mt-6 lg:hidden" aria-label={dict.merchant.mobile.needsActionTitle}>
            <h2 className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
              {dict.merchant.mobile.needsActionTitle}
              <span className="rounded-full bg-danger-strong px-1.5 text-[10px] font-bold text-danger-strong-foreground tabular-nums">
                {needsAction.length}
              </span>
            </h2>
            <div className="mt-2 space-y-3">
              {needsAction.map((o) => (
                <MerchantOrderCard
                  key={o.id}
                  order={o}
                  lang={lang}
                  labels={{
                    order: dict.orders.order,
                    total: dict.orders.total,
                    delivery: dict.store.delivery,
                    pickup: dict.store.pickup,
                    accept: dict.merchant.mobile.acceptOrder,
                    accepting: dict.merchant.mobile.accepting,
                    call: dict.merchant.mobile.callCustomer,
                    noPhone: dict.merchant.mobile.noPhone,
                    error: dict.common.actionFailed,
                    customerFallback: dict.os.dashboard.customerFallback,
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {orders.length ? (
          <OrdersFilter
            orders={cards}
            dict={dict}
            lang={lang}
            storeId={storeId}
            storeName={(store as { name: string }).name}
            team={team}
            couriers={couriers}
            canDispatch={canDispatch}
            wa={wa}
          />
        ) : (
          // ISS-016/034: the same dashed box used to be shown to a store still
          // in review, a store with an empty catalogue and a stocked live store
          // with no traffic. Those are three different problems and only one of
          // them is the merchant's to solve today.
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="orders"
            title={dict.merchant.noOrders}
            className="mt-8"
          />
        )}
      </Container>
    </div>
  );
}
