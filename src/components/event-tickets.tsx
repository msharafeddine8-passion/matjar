"use client";

import { useEffect, useState } from "react";
import { Ticket, CheckCircle2 } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";

type TicketType = {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  price: number;
  capacity: number | null;
  sold: number;
};

// Customer-facing event ticket purchase (Model K, migration 0193). Loads the
// store's active ticket types on the client; capacity is enforced server-side.
export function EventTickets({
  storeId,
  lang,
  dict,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "tickets">;
}) {
  const t = dict.tickets;
  const [types, setTypes] = useState<TicketType[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data } = await supabase
        .from("event_ticket_types")
        .select("id, name, name_en, description, price, capacity, sold")
        .eq("store_id", storeId)
        .eq("active", true)
        .order("sort_order", { ascending: true });
      setTypes((data ?? []) as TicketType[]);
      const [{ data: { user } }] = await Promise.all([supabase.auth.getUser()]);
      if (user) {
        setName(
          (user.user_metadata?.full_name as string | undefined) ??
            user.email ??
            "",
        );
      }
    })();
  }, [storeId]);

  async function buy() {
    if (!picked || name.trim().length < 2 || phone.trim().length < 4 || busy)
      return;
    setBusy(true);
    const { error } = await createClient().rpc("buy_tickets", {
      p_type_id: picked,
      p_quantity: qty,
      p_name: name.trim(),
      p_phone: phone.trim(),
    });
    setBusy(false);
    if (error) {
      notifyError(
        error.message?.includes("sold_out")
          ? t.soldOutErr
          : dict.common.actionFailed,
      );
      return;
    }
    setDone(true);
  }

  if (types === null) return null;
  if (types.length === 0) return null;

  if (done) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
        <h3 className="mt-2 text-lg font-extrabold">{t.sentTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t.sentNote}</p>
        <button
          onClick={() => {
            setDone(false);
            setPicked(null);
          }}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
        >
          {t.another}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-5">
      <h3 className="flex items-center gap-2 text-lg font-extrabold">
        <Ticket className="h-5 w-5 text-primary" />
        {t.title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      <div className="mt-4 space-y-3">
        {types.map((tt) => {
          const label = lang === "en" && tt.name_en?.trim() ? tt.name_en : tt.name;
          const left = tt.capacity == null ? null : tt.capacity - tt.sold;
          const soldOut = left != null && left <= 0;
          const isPicked = picked === tt.id;
          return (
            <div
              key={tt.id}
              className={`rounded-2xl border bg-surface p-3 ${isPicked ? "border-primary" : "border-border"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold">{label}</span>
                  {left != null && (
                    <span className="ms-2 text-xs text-muted-foreground">
                      {soldOut ? t.soldOut : `${left} ${t.remaining}`}
                    </span>
                  )}
                </div>
                <span className="font-extrabold text-primary">${tt.price}</span>
              </div>
              {tt.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {tt.description}
                </p>
              )}
              <button
                onClick={() => setPicked(isPicked ? null : tt.id)}
                disabled={soldOut}
                className={`mt-2 w-full rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 ${
                  isPicked
                    ? "border border-primary text-primary"
                    : "bg-primary text-primary-foreground hover:bg-primary-hover"
                }`}
              >
                {soldOut ? t.soldOut : isPicked ? t.cancel : t.buy}
              </button>

              {isPicked && !soldOut && (
                <div className="mt-3 grid gap-2 border-t border-border pt-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t.name}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:col-span-1"
                    />
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t.phone}
                      inputMode="tel"
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                    <input
                      type="number"
                      min={1}
                      max={left ?? 50}
                      value={qty}
                      onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <Button
                    onClick={buy}
                    loading={busy}
                    disabled={name.trim().length < 2 || phone.trim().length < 4}
                  >
                    {t.confirm} · ${(tt.price * qty).toLocaleString("en-US")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
