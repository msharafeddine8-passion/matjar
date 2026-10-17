"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/currency";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

export type ClassRow = {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  day_of_week: number;
  start_time: string;
  capacity: number;
  price: number | null;
};

// Next date (yyyy-mm-dd) whose weekday matches dow (0=Sun..6=Sat).
function nextDateFor(dow: number): string {
  const now = new Date();
  const diff = (dow - now.getDay() + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Public "book a spot" for weekly group classes (gyms, group courses). Shows the
// next occurrence of each class with spots-left (capacity − booked, via the
// class_spots_taken RPC) and books into the shared bookings table.
export function ClassesBooking({
  storeId,
  lang,
  dict,
  classes,
  customerName,
  customerPhone = null,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "booking" | "classes">;
  classes: ClassRow[];
  customerName: string | null;
  customerPhone?: string | null;
}) {
  const router = useRouter();
  const t = dict.classes;
  const days = t.days as string[];
  const [supabase] = useState(() => createClient());
  const prefillName =
    customerName && !customerName.includes("@") ? customerName : "";
  const [name, setName] = useState(prefillName);
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [taken, setTaken] = useState<Record<string, number>>({});
  const [booked, setBooked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        classes.map(async (c) => {
          const { data } = await supabase.rpc("class_spots_taken", {
            p_class_id: c.id,
            p_date: nextDateFor(c.day_of_week),
          });
          return [c.id, (data as number | null) ?? 0] as const;
        }),
      );
      if (!cancelled) setTaken(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [classes, supabase, booked]);

  async function book(c: ClassRow) {
    setBusy(c.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login`);
      return;
    }
    const date = nextDateFor(c.day_of_week);
    const { data: fresh } = await supabase.rpc("class_spots_taken", {
      p_class_id: c.id,
      p_date: date,
    });
    if (((fresh as number | null) ?? 0) >= c.capacity) {
      setTaken((s) => ({ ...s, [c.id]: (fresh as number | null) ?? c.capacity }));
      setBusy(null);
      return;
    }
    const { error } = await supabase.from("bookings").insert({
      store_id: storeId,
      customer_id: user.id,
      class_id: c.id,
      service_name: c.name,
      requested_date: date,
      requested_time: c.start_time,
      customer_name: name.trim() || customerName || "",
      phone: phone.trim() || null,
    });
    setBusy(null);
    if (error) return;
    setBooked((s) => new Set(s).add(c.id));
    router.refresh();
  }

  if (!classes.length) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <CalendarRange className="h-5 w-5 text-primary" />
        {t.publicTitle}
      </h2>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:max-w-lg">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={dict.booking.yourNamePlaceholder}
          aria-label={dict.booking.yourName}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+961 …"
          aria-label={dict.booking.yourPhone}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {classes.map((c) => {
          const name = lang === "en" ? c.name_en || c.name : c.name;
          const left = Math.max(0, c.capacity - (taken[c.id] ?? 0));
          const full = left <= 0;
          const isBooked = booked.has(c.id);
          return (
            <div
              key={c.id}
              className="flex flex-col rounded-2xl border border-border bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold">{name}</h3>
                {c.price != null && (
                  <span className="text-sm font-bold text-primary">{formatUsd(c.price)}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {days[c.day_of_week]} · <span dir="ltr">{c.start_time}</span>
              </p>
              {c.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.description}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-bold ${full ? "text-danger" : "text-success"}`}
                >
                  {full ? t.full : t.spotsLeft.replace("{n}", String(left))}
                </span>
                {isBooked ? (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-success">
                    <Check className="h-4 w-4" />
                    {t.success}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => book(c)}
                    disabled={full || busy === c.id || !name.trim() || phone.trim().length < 4}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy === c.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    {busy === c.id ? t.booking : t.book}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
