"use client";
import { notifyError } from "@/lib/notify";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bike, ShoppingBag, ChefHat } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";

export type KitchenOrder = {
  id: string;
  status: "pending" | "accepted" | "preparing" | "ready";
  fulfillment: string | null;
  customer_name: string | null;
  customer_note: string | null;
  created_at: string;
  order_items: { name: string; quantity: number; note: string | null }[];
};

type ColumnKey = "new" | "inProgress" | "ready";

const columnOf = (status: KitchenOrder["status"]): ColumnKey =>
  status === "pending" ? "new" : status === "ready" ? "ready" : "inProgress";

// Kitchen display board (restaurant deep pack): active orders in three lanes —
// new / preparing / ready — with one big tap to advance each ticket. Elapsed
// time turns amber then red so nothing burns quietly. Auto-refreshes.
export function KitchenBoard({
  dict,
  orders,
}: {
  dict: Pick<Dictionary, "auth" | "os" | "store">;
  orders: KitchenOrder[];
}) {
  const router = useRouter();
  const t = dict.os.kitchen;
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  // Tick the clock + re-pull orders periodically (a kitchen screen is left
  // open). State-in-effect is intentional: Date.now() can't run during SSR.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 30_000);
    return () => clearInterval(tick);
  }, [router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function advance(order: KitchenOrder) {
    const next =
      order.status === "pending"
        ? "preparing"
        : order.status !== "ready"
          ? "ready"
          : order.fulfillment === "delivery"
            ? "out_for_delivery"
            : "completed";
    setBusy(order.id);
    const { error } = await createClient()
      .from("orders")
      .update({ status: next })
      .eq("id", order.id);
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  const advanceLabel = (o: KitchenOrder) =>
    o.status === "pending"
      ? t.acceptStart
      : o.status !== "ready"
        ? t.markReady
        : o.fulfillment === "delivery"
          ? t.handOffDelivery
          : t.handOffPickup;

  const columns: { key: ColumnKey; title: string; accent: string }[] = [
    { key: "new", title: t.new, accent: "bg-info" },
    { key: "inProgress", title: t.inProgress, accent: "bg-warning" },
    { key: "ready", title: t.ready, accent: "bg-success" },
  ];

  if (!orders.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border py-20 text-center text-muted-foreground">
        <ChefHat className="h-10 w-10" />
        <p className="font-semibold">{t.empty}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {columns.map((col) => {
        const list = orders.filter((o) => columnOf(o.status) === col.key);
        return (
          <section key={col.key} className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${col.accent}`} />
              {col.title}
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-extrabold text-foreground">
                {list.length}
              </span>
            </h2>
            <div className="mt-3 space-y-3">
              {list.map((o) => {
                const mins =
                  now > 0
                    ? Math.max(
                        0,
                        Math.floor(
                          (now - new Date(o.created_at).getTime()) / 60_000,
                        ),
                      )
                    : null;
                const heat =
                  mins == null
                    ? "bg-surface-muted text-muted-foreground"
                    : mins >= 30
                      ? "bg-danger-soft text-danger"
                      : mins >= 15
                        ? "bg-warning-soft text-warning"
                        : "bg-surface-muted text-muted-foreground";
                return (
                  <article
                    key={o.id}
                    className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-muted-foreground">
                        #{o.id.slice(0, 5)}
                      </span>
                      {mins != null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${heat}`}
                        >
                          {mins}
                          {t.minutesShort}
                        </span>
                      )}
                      <span className="ms-auto flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
                        {o.fulfillment === "delivery" ? (
                          <Bike className="h-3.5 w-3.5" />
                        ) : (
                          <ShoppingBag className="h-3.5 w-3.5" />
                        )}
                        {o.fulfillment === "delivery"
                          ? dict.store.delivery
                          : dict.store.pickup}
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1">
                      {o.order_items.map((it, i) => (
                        <li key={i} className="font-bold leading-snug">
                          <div className="flex gap-2">
                            <span className="tabular-nums text-primary">
                              {it.quantity}×
                            </span>
                            <span className="min-w-0">{it.name}</span>
                          </div>
                          {it.note && (
                            <span className="ms-6 block text-xs font-medium italic text-warning">
                              ↳ {it.note}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>

                    {o.customer_note && (
                      <p className="mt-2 rounded-lg bg-warning-soft p-2 text-sm font-medium text-warning">
                        {o.customer_note}
                      </p>
                    )}
                    {o.customer_name && (
                      <p className="mt-2 text-xs font-semibold text-muted-foreground">
                        {o.customer_name}
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={busy === o.id}
                      onClick={() => advance(o)}
                      className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                    >
                      {advanceLabel(o)}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
