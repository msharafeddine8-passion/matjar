"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Phone, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { Money } from "@/components/ui/money";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { waNumber } from "@/lib/phone";
import { formatBeirutDateTime } from "@/lib/datetime";
import { orderStatusErrorKind } from "@/lib/order-progress";
import {
  formatQuantityMeasure,
  unitPricingOf,
} from "@/lib/unit-pricing";

// ===== One order, as it looks in a merchant's hand =====
//
// The desktop orders screen is a filter bar, a status <select> and a fold with
// payments, courier, notes and assignment inside it. All of that stays. It is
// the wrong shape for the sixty seconds after an order arrives, which is a
// two-outcome decision: take it, or ring the person and ask something first.
//
// So this card carries only what the decision needs — who, what, how it is
// going out, how much — and two targets big enough to hit without looking.
//
// ── The accept path is the existing one, unchanged ────────────────────────
//
// `orders.update({ status: 'accepted' })` through the browser client, which is
// byte-for-byte what OrderStatusControl's <select> does when the merchant picks
// "مقبول". Same table, same column, same RLS, same triggers, same notification.
// No new RPC, no new status, no money touched. If accepting an order ever needs
// to do something more, it needs to do it in one place and this card must not
// be that place.
//
// ── Weight-priced lines read in kilos ─────────────────────────────────────
//
// `order_items.quantity` is an integer count of orderable units and always will
// be (see src/lib/unit-pricing.ts — the subtotal arithmetic depends on it). But
// for a butcher one unit IS a kilo, so "2×" on a line of مفرومة is a lie told in
// the merchant's own notation: he is cutting two kilos, not two pieces. The
// product's own sold_by/unit_measure/unit_amount say which, and where they do,
// the line reads "2 كيلو". A piece-priced product is unchanged — every product
// that predates migration 0299 has all three columns null and falls straight
// back to "2×".
//
// The unit columns arrive by joining `products` off order_items.product_id.
// A staff member holding only the `orders` permission cannot select products
// under RLS, so for them the join returns null and the line falls back to the
// count. Wrong-looking, never wrong: it degrades to exactly what the desktop
// screen has always shown.

export type MerchantOrderLine = {
  name: string;
  quantity: number;
  soldBy: string | null;
  unitMeasure: string | null;
  unitAmount: number | null;
};

export type MerchantOrderCardData = {
  id: string;
  total: number;
  fulfillment: "delivery" | "pickup";
  customerName: string | null;
  phone: string | null;
  customerNote: string | null;
  address: string | null;
  createdAt: string;
  items: MerchantOrderLine[];
};

export function MerchantOrderCard({
  order,
  lang,
  labels,
}: {
  order: MerchantOrderCardData;
  lang: "ar" | "en";
  labels: {
    order: string;
    total: string;
    delivery: string;
    pickup: string;
    accept: string;
    accepting: string;
    call: string;
    noPhone: string;
    reject: string;
    rejecting: string;
    confirmReject: string;
    confirmRejectCta: string;
    cancel: string;
    /** The customer cancelled while the card was on screen (0333). */
    closedError: string;
    error: string;
    customerFallback: string;
  };
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"accepted" | "rejected" | null>(null);

  // Same write as the status <select>, for the two answers a pending order
  // can get. Rejecting gives the stock back and tells the customer, so it
  // asks first; accepting stays one tap.
  async function move(next: "accepted" | "rejected") {
    if (
      next === "rejected" &&
      !(await confirm({
        message: labels.confirmReject,
        confirmLabel: labels.confirmRejectCta,
        cancelLabel: labels.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(next);
    const { error } = await createClient()
      .from("orders")
      .update({ status: next })
      .eq("id", order.id);
    setBusy(null);
    if (error) {
      const kind = orderStatusErrorKind(error.message);
      notifyError(kind ? labels.closedError : labels.error);
      if (kind) router.refresh();
      return;
    }
    router.refresh();
  }

  // A Lebanese local number (03709064) is dialable as typed from a phone in
  // Lebanon; the normalised international form is dialable from anywhere, so
  // prefer it and fall back to the raw digits rather than hiding the button on
  // a number the merchant could have rung.
  const intl = waNumber(order.phone);
  const rawDigits = (order.phone ?? "").replace(/[^\d+]/g, "");
  const dial = intl ? `+${intl}` : rawDigits.length >= 6 ? rawDigits : null;

  return (
    <article className="rounded-2xl border-2 border-warning/40 bg-surface p-4 shadow-xs">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-base font-extrabold">
          {order.customerName || labels.customerFallback}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {labels.order} #{order.id.slice(0, 8)}
        </span>
        <span className="ms-auto text-xs font-semibold text-muted-foreground">
          <bdi dir="ltr">{formatBeirutDateTime(order.createdAt, lang, "time")}</bdi>
        </span>
      </header>

      <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
        {order.items.map((item, i) => {
          const u = unitPricingOf({
            soldBy: item.soldBy,
            unitMeasure: item.unitMeasure,
            unitAmount: item.unitAmount,
          });
          return (
            <li key={i} className="flex items-baseline gap-2">
              {/* Both forms are Western digits and must not be reordered by the
                  surrounding RTL run, so both are isolated LTR with tabular
                  figures — the same reason <Money> exists. */}
              <span
                dir="ltr"
                className="shrink-0 font-bold tabular-nums text-primary"
              >
                {u ? formatQuantityMeasure(u, item.quantity, lang) : `${item.quantity}×`}
              </span>
              <span className="min-w-0 flex-1">{item.name}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
          {order.fulfillment === "delivery" ? labels.delivery : labels.pickup}
        </span>
        <span className="text-lg font-extrabold">
          <Money value={order.total} cents />
        </span>
      </div>

      {order.address && order.fulfillment === "delivery" && (
        <p className="mt-2 text-xs text-muted-foreground">{order.address}</p>
      )}
      {order.customerNote && (
        <p className="mt-2 text-xs italic text-warning">
          “{order.customerNote}”
        </p>
      )}

      {/* h-12 = 48px tall: hittable with a thumb while holding the phone,
          without looking at it. Accept and call share the width; reject is the
          narrow third target, behind a confirm, so it is there when the item
          is out but cannot be hit by accident. */}
      <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => move("accepted")}
          disabled={busy !== null}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-success-strong px-3 text-sm font-bold text-success-strong-foreground shadow-sm transition-[transform,box-shadow] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55"
        >
          <Check className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {busy === "accepted" ? labels.accepting : labels.accept}
          </span>
        </button>
        {dial ? (
          <a
            href={`tel:${dial}`}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-bold shadow-xs transition-[transform,box-shadow] active:scale-[0.97] hover:border-primary/40"
          >
            <Phone className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 truncate">{labels.call}</span>
          </a>
        ) : (
          <span className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm font-bold text-muted-foreground">
            <Phone className="h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{labels.noPhone}</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => move("rejected")}
          disabled={busy !== null}
          className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-danger/30 bg-surface px-3 text-sm font-bold text-danger transition-[transform,box-shadow] active:scale-[0.97] hover:bg-danger-soft disabled:pointer-events-none disabled:opacity-55"
        >
          <X className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {busy === "rejected" ? labels.rejecting : labels.reject}
          </span>
        </button>
      </div>
    </article>
  );
}
