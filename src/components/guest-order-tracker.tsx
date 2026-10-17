"use client";

import { useState } from "react";
import { Search, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { SubDict } from "@/lib/dict-slice";
import { OrderTimeline, type OrderEvent } from "@/components/order-timeline";

type Result = {
  status: string;
  total: number;
  fulfillment: string;
  created_at: string;
  store_name: string;
};

// Guest order status lookup: phone + the order id (from the URL) → the
// get_guest_order RPC. No account needed; matches the phone the order was
// placed with.
export function GuestOrderTracker({
  orderId,
  lang,
  dict,
}: {
  orderId: string;
  lang: Locale;
  dict: SubDict<"orders", "status"> & SubDict<"os", "track">;
}) {
  const t = dict.os.track;
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [notFound, setNotFound] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setNotFound(false);
    setResult(null);
    const { data } = await createClient().rpc("get_guest_order", {
      p_order_id: orderId,
      p_phone: phone.trim(),
    });
    setBusy(false);
    const row = (Array.isArray(data) ? data[0] : data) as Result | undefined;
    if (!row) {
      setNotFound(true);
      return;
    }
    setResult(row);
    // Real transition timestamps (0173) — same phone proof as the order RPC.
    const { data: ev } = await createClient().rpc("get_guest_order_events", {
      p_order_id: orderId,
      p_phone: phone.trim(),
    });
    setEvents((ev ?? []) as OrderEvent[]);
  }

  return (
    <div>
      {!result && (
        <form
          onSubmit={check}
          className="rounded-2xl border border-border bg-surface p-5"
        >
          <label className="text-sm font-semibold" htmlFor="guest-track-phone">{t.phone}</label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="guest-track-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              placeholder="+961…"
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy || !phone.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              <Search className="h-4 w-4" />
              {busy ? t.checking : t.check}
            </button>
          </div>
          {notFound && (
            <p className="mt-3 text-sm font-semibold text-danger">
              {t.notFound}
            </p>
          )}
        </form>
      )}

      {result && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Package className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">
                {t.orderAt}{" "}
                <span className="font-bold text-foreground">
                  {result.store_name}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t.placedOn}{" "}
                {new Date(result.created_at).toLocaleDateString(
                  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                  { timeZone: "Asia/Beirut", year: "numeric", month: "short", day: "numeric" },
                )}{" "}
                · ${Number(result.total).toLocaleString("en-US")}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <OrderTimeline
              events={events}
              status={result.status}
              fulfillment={result.fulfillment}
              labels={dict.orders.status as unknown as Record<string, string>}
              lang={lang}
            />
          </div>
        </div>
      )}
    </div>
  );
}
