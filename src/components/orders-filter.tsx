"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Printer, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Dictionary } from "@/i18n/get-dictionary";
import { OrderStatusControl } from "@/components/order-status-control";
import { OrderPayments, type OrderPayment } from "@/components/order-payments";
import { OrderNoteEditor } from "@/components/order-note-editor";
import { OrderAssignTags } from "@/components/order-assign-tags";
import { formatUsd } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import {
  OrderDispatch,
  type DispatchCourier,
  type DeliveryRequest,
} from "@/components/order-dispatch";
import { CardList, CardRow } from "@/components/ui/card";
import {
  OrderWaActions,
  type OrderWaTemplates,
} from "@/components/wa-actions/order-wa-actions";

type OrderItem = {
  name: string;
  quantity: number;
  unit_price: number;
  note: string | null;
};

// One order, fully shaped on the server: money ledger and branch label resolved
// so this client component only filters and renders — no extra round-trips.
export type OrderCard = {
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
  payments: OrderPayment[];
  branch: { name: string | null; area: string | null } | null;
  assigned_to: string | null;
  tags: string[];
  delivery_fee: number | null;
  change_for: number | null;
  delivery_instructions: string | null;
  custom_fields: Record<string, string> | null;
  scheduled_for: string | null;
  /** Live courier dispatch for this order, if one was requested. */
  delivery: DeliveryRequest | null;
  /** Placed from a customer account — decides the WhatsApp link target. */
  customer_id?: string | null;
  /** The delivery zone, whose ETA (if it states one) feeds «تأكيد الطلب». */
  delivery_zone_id?: string | null;
};

/** Everything the WhatsApp buttons on each card share. */
export type OrdersWaContext = {
  rate: number;
  templates: OrderWaTemplates;
  lastSent: Record<string, string>;
  zoneEta: Record<string, { min: number | null; max: number | null }>;
};

// Mirrors the order_status enum, minus the implicit "all" tab rendered first.
const STATUS_FILTERS = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
  "rejected",
] as const;

function chip(active: boolean) {
  return active
    ? "bg-primary text-primary-foreground border-primary"
    : "bg-surface text-foreground border-border hover:border-primary/40";
}

export function OrdersFilter({
  orders,
  dict,
  lang,
  storeId,
  storeName,
  team,
  couriers,
  canDispatch,
  wa,
}: {
  orders: OrderCard[];
  dict: Dictionary;
  lang: string;
  storeId: string;
  storeName: string;
  team: { id: string; name: string }[];
  couriers: DispatchCourier[];
  canDispatch: boolean;
  wa?: OrdersWaContext;
}) {
  const [status, setStatus] = useState<string>("all");
  const [query, setQuery] = useState("");
  // Same contract OrderStatusControl uses for these labels.
  const statusLabels = dict.orders.status as Record<string, string>;

  const filtered = useMemo(() => {
    // Strip a leading "#" so searching the displayed "#a1b2c3d4" id still matches.
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!q) return true;
      const name = (o.customer_name ?? "").toLowerCase();
      return (
        name.includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [orders, status, query]);

  return (
    <>
      <div className="mt-8 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 sm:max-w-md">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict.orders.filter.searchPlaceholder}
          className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setStatus("all")}
          className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${chip(status === "all")}`}
        >
          {dict.orders.filter.all}
        </button>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${chip(status === s)}`}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <CardList className="mt-6">
          {filtered.map((order) => {
            const branch = order.branch;
            return (
              <CardRow key={order.id} className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="min-w-0 text-sm font-semibold text-muted-foreground">
                    {dict.orders.order} #{order.id.slice(0, 8)}
                    {order.customer_name && (
                      <span className="ms-2 font-bold text-foreground">
                        {order.customer_name}
                      </span>
                    )}
                    <span className="ms-2 text-xs">
                      {new Date(order.created_at).toLocaleString(
                        lang === "ar" ? "ar" : "en",
                        {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </span>
                    {branch && (
                      <span className="ms-2 whitespace-nowrap rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {branch.name || branch.area
                          ? `${dict.os.branches.branchLabel}: ${branch.name || branch.area}`
                          : dict.os.branches.branchLabel}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/${lang}/merchant/${storeId}/orders/${order.id}/invoice`}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold transition-colors hover:border-primary hover:text-primary"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {dict.os.invoice.link}
                    </Link>
                    <OrderStatusControl
                      orderId={order.id}
                      status={order.status}
                      labels={dict.orders.status}
                      errorLabel={dict.auth.errorGeneric}
                      confirmLabels={{
                        message: dict.orders.confirmStatusDestructive,
                        confirm: dict.common.confirm,
                        cancel: dict.common.cancel,
                      }}
                      finalNote={dict.orders.completedIsFinal}
                    />
                  </span>
                </div>
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  {order.order_items.map((item, i) => (
                    <li key={i} className="flex flex-col gap-0.5">
                      <div className="flex justify-between gap-4">
                        <span>
                          {item.quantity}× {item.name}
                        </span>
                        <span className="text-muted-foreground">
                          <Money value={item.unit_price * item.quantity} />
                        </span>
                      </div>
                      {item.note && (
                        <span className="ps-4 text-xs italic text-warning">
                          ↳ {item.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {order.scheduled_for && (
                  <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-sm font-bold text-warning">
                    🕒 {dict.orders.scheduledFor}:{" "}
                    {new Date(order.scheduled_for).toLocaleString(
                      lang === "ar" ? "ar" : "en",
                      { dateStyle: "medium", timeStyle: "short" },
                    )}
                  </p>
                )}
                <div className="mt-3 flex justify-between border-t border-border pt-3 font-bold">
                  <span>{dict.orders.total}</span>
                  <span>{formatUsd(order.total)}</span>
                </div>
                <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
                  <p>
                    {order.fulfillment === "delivery"
                      ? dict.store.delivery
                      : dict.store.pickup}
                    {order.phone ? (
                      <>
                        {" · "}
                        <span dir="ltr">{order.phone}</span>
                      </>
                    ) : null}
                    {order.delivery_fee != null &&
                      Number(order.delivery_fee) > 0 && (
                        <span className="ms-2 font-semibold text-foreground">
                          {dict.orders.deliveryFeeLabel}: $
                          {Number(order.delivery_fee)}
                        </span>
                      )}
                  </p>
                  {order.address && <p>{order.address}</p>}
                  {order.delivery_instructions && (
                    <p className="font-semibold text-warning">
                      📍 {order.delivery_instructions}
                    </p>
                  )}
                  {order.change_for != null && Number(order.change_for) > 0 && (
                    <p className="font-semibold text-foreground">
                      💵 {dict.orders.changeForLabel}: $
                      {Number(order.change_for)}
                    </p>
                  )}
                  {order.customer_note && (
                    <p className="italic">“{order.customer_note}”</p>
                  )}
                  {order.custom_fields &&
                    Object.entries(order.custom_fields).map(([k, v]) => (
                      <p key={k} className="font-semibold text-foreground">
                        <span className="text-muted-foreground">{k}:</span> {v}
                      </p>
                    ))}
                </div>
                {wa && (
                  <OrderWaActions
                    uiLang={lang}
                    storeId={storeId}
                    storeName={storeName}
                    rate={wa.rate}
                    templates={wa.templates}
                    lastSent={wa.lastSent}
                    t={dict.waActions}
                    order={{
                      id: order.id,
                      status: order.status,
                      phone: order.phone,
                      customerName: order.customer_name,
                      hasAccount: !!order.customer_id,
                      total: Number(order.total ?? 0),
                      items: order.order_items.map((it) => ({
                        name: it.name,
                        quantity: Number(it.quantity),
                      })),
                      scheduledFor: order.scheduled_for,
                      etaMinMinutes:
                        order.fulfillment === "delivery" && order.delivery_zone_id
                          ? (wa.zoneEta[order.delivery_zone_id]?.min ?? null)
                          : null,
                      etaMaxMinutes:
                        order.fulfillment === "delivery" && order.delivery_zone_id
                          ? (wa.zoneEta[order.delivery_zone_id]?.max ?? null)
                          : null,
                    }}
                  />
                )}
                {/* The card above is the DECISION layer: who, what, how
                    much, what state. Everything below is the WORK layer —
                    payments, courier, notes, assignment — needed on the one
                    order being handled, noise on the nineteen others. Folded,
                    with the two facts worth surfacing (money recorded, courier
                    en route) shown on the fold itself. */}
                <details className="group mt-3 border-t border-border pt-3">
                  <summary className="flex cursor-pointer select-none items-center justify-between gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground">
                    <span>{dict.orders.manageOrder}</span>
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      {order.payments.length > 0 && (
                        <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">
                          {dict.orders.hasPayments.replace(
                            "{n}",
                            String(order.payments.length),
                          )}
                        </span>
                      )}
                      {order.delivery && (
                        <span className="rounded-full bg-info-soft px-2 py-0.5 text-info">
                          {dict.orders.hasCourier}
                        </span>
                      )}
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </span>
                  </summary>

                  <OrderPayments
                    orderId={order.id}
                    orderTotal={Number(order.total ?? 0)}
                    orderStatus={order.status}
                    payments={order.payments}
                    dict={dict}
                  />
                  {/* Pickup orders never need a courier. */}
                  {order.fulfillment === "delivery" && (
                    <OrderDispatch
                      orderId={order.id}
                      lang={lang}
                      storeId={storeId}
                      storeName={storeName}
                      customerName={order.customer_name}
                      address={order.address}
                      couriers={couriers}
                      request={order.delivery}
                      canDispatch={canDispatch}
                      dict={dict}
                    />
                  )}
                  <OrderNoteEditor
                    orderId={order.id}
                    storeId={storeId}
                    note={order.store_note}
                    labels={dict.orders.storeNote}
                    errorLabel={dict.common.actionFailed}
                  />
                  <OrderAssignTags
                    orderId={order.id}
                    assignedTo={order.assigned_to}
                    tags={order.tags}
                    team={team}
                    labels={dict.orders.assign}
                    errorLabel={dict.common.actionFailed}
                  />
                </details>
              </CardRow>
            );
          })}
        </CardList>
      ) : (
        <div className="mt-6">
          {/* The house empty state, not a bare dashed box — and it offers the
              one useful next step: clear the filters that produced nothing. */}
          <EmptyState icon={Search} title={dict.orders.filter.noMatch} />
        </div>
      )}
    </>
  );
}
