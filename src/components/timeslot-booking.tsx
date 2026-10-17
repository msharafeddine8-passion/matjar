"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUsd } from "@/lib/currency";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { slotsKey, slotsLoading } from "@/lib/booking-slots";

export type Resource = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  open_hour: number;
  close_hour: number;
};

// Public "book by the hour" flow for time-slot sectors (courts / rooms /
// rentals). Availability comes from the resource_booked_times RPC (SECURITY
// DEFINER); a booking reuses the existing bookings table via resource_id.
export function TimeslotBooking({
  storeId,
  lang,
  dict,
  resources,
  customerName,
  customerPhone = null,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "booking" | "timeslot">;
  resources: Resource[];
  customerName: string | null;
  customerPhone?: string | null;
}) {
  const router = useRouter();
  const t = dict.timeslot;
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(new Date()),
    [],
  );

  // A slot is unbookable if it's already passed today (Asia/Beirut).
  const nowBeirut = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Beirut",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()),
    [],
  );

  const prefillName =
    customerName && !customerName.includes("@") ? customerName : "";
  const [name, setName] = useState(prefillName);
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  // Which (resource, day) the `taken` set actually describes. Loading is then
  // derived from "what we hold isn't what's selected" instead of a separate
  // flag the fetch effect has to raise and lower in step with it.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resource = resources.find((r) => r.id === resourceId) ?? resources[0];
  const resName =
    lang === "en" ? resource?.name_en || resource?.name : resource?.name;

  const slots = useMemo(() => {
    if (!resource) return [] as string[];
    const out: string[] = [];
    for (let h = resource.open_hour; h < resource.close_hour; h++) {
      out.push(`${String(h).padStart(2, "0")}:00`);
    }
    return out;
  }, [resource]);
  const isPast = (s: string) => date === today && s <= nowBeirut;

  const currentSlotsKey = slotsKey(resourceId, date, done);
  const loadingSlots = slotsLoading(currentSlotsKey, loadedKey);

  // Changing the resource or the day drops the picked slot — it belonged to the
  // old day. Adjusted during render so the slot can never be submitted against
  // a date the merchant has already moved away from.
  const [lastSlotsKey, setLastSlotsKey] = useState(currentSlotsKey);
  if (currentSlotsKey !== lastSlotsKey) {
    setLastSlotsKey(currentSlotsKey);
    setSlot(null);
  }

  useEffect(() => {
    if (!resourceId || !date) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("resource_booked_times", {
        p_resource_id: resourceId,
        p_date: date,
      });
      if (cancelled) return;
      setTaken(new Set((data ?? []) as string[]));
      setLoadedKey(slotsKey(resourceId, date, done));
    })();
    return () => {
      cancelled = true;
    };
  }, [resourceId, date, supabase, done]);

  async function book() {
    if (!slot || !resource) return;
    setBooking(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login`);
      return;
    }
    // Re-check availability right before writing to avoid a race.
    const { data: fresh } = await supabase.rpc("resource_booked_times", {
      p_resource_id: resourceId,
      p_date: date,
    });
    if (((fresh ?? []) as string[]).includes(slot)) {
      setTaken(new Set((fresh ?? []) as string[]));
      setSlot(null);
      setBooking(false);
      return;
    }
    const { error: err } = await supabase.from("bookings").insert({
      store_id: storeId,
      customer_id: user.id,
      resource_id: resourceId,
      service_name: resource.name,
      requested_date: date,
      requested_time: slot,
      customer_name: name.trim() || customerName || "",
      phone: phone.trim() || null,
    });
    setBooking(false);
    if (err) {
      // 23505 = the slot was taken in the race window (DB conflict guard).
      if (err.code === "23505") {
        setTaken((prev) => new Set(prev).add(slot));
        setSlot(null);
        setError(dict.booking.slotTaken);
      } else {
        setError(dict.auth.errorGeneric);
      }
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (!resources.length) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <CalendarClock className="h-5 w-5 text-primary" />
        {t.title}
      </h2>

      {done ? (
        <div className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm font-semibold text-success">
          <Check className="h-5 w-5" />
          {t.success}
        </div>
      ) : (
        <div className="space-y-4">
          {resources.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {resources.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setResourceId(r.id)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                    r.id === resourceId
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {lang === "en" ? r.name_en || r.name : r.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:max-w-lg">
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

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {resource?.price != null && (
              <span className="text-sm font-bold text-primary">
                {formatUsd(resource.price)} {t.perHour}
              </span>
            )}
          </div>

          {loadingSlots ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : slots.filter((s) => !taken.has(s) && !isPast(s)).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t.noSlots}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const isTaken = taken.has(s) || isPast(s);
                const active = slot === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={isTaken}
                    onClick={() => setSlot(s)}
                    className={`rounded-xl border py-2.5 text-sm font-bold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : isTaken
                          ? "border-border bg-surface-muted text-muted-foreground line-through"
                          : "border-border hover:border-primary"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="text-sm font-medium text-danger">{error}</p>}

          <button
            type="button"
            onClick={book}
            disabled={!slot || booking || !name.trim() || phone.trim().length < 4}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60 sm:w-auto sm:px-8"
          >
            {booking && <Loader2 className="h-4 w-4 animate-spin" />}
            {booking ? t.booking : t.book}
          </button>
        </div>
      )}
    </section>
  );
}
