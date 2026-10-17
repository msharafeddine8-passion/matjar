"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Clock,
} from "lucide-react";
import { ChevronNext, ChevronPrev } from "@/components/ui/directional-icon";
import type { Dictionary } from "@/i18n/get-dictionary";
import { providerIcon } from "@/lib/sectors";

export type CalendarBooking = {
  id: string;
  service_name: string | null;
  requested_date: string | null;
  requested_time: string | null;
  customer_name: string | null;
  status: string;
  doctor: string | null;
};

// Status → chip tone. Same tone approach used elsewhere (kitchen-board, the
// customer bookings page): a soft tinted fill + darker ink, one hue per state.
const TONE: Record<string, string> = {
  pending: "border-warning/30 bg-warning-soft text-warning",
  accepted: "border-success/30 bg-success-soft text-success",
  scheduled: "border-success/30 bg-success-soft text-success",
  completed: "border-border bg-surface-muted text-muted-foreground",
  cancelled: "border-danger/30 bg-danger-soft text-danger",
  rejected: "border-danger/30 bg-danger-soft text-danger",
  no_show: "border-danger/30 bg-danger-soft text-danger",
};
const FALLBACK_TONE = "border-border bg-surface-muted text-muted-foreground";

// Local YYYY-MM-DD — not toISOString(), which converts to UTC and can land on
// the wrong calendar day. Matches the Postgres `date` value on requested_date.
function ymd(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Merchant week calendar: a fixed 7-day window (Sun→Sat) over the bookings the
// page already fetched. All week math runs on the client (new Date()) so it
// never touches SSR; prev/next just shift the window and we re-filter in memory.
export function BookingsCalendar({
  lang,
  dict,
  bookings,
  category,
}: {
  lang: string;
  dict: Dictionary;
  bookings: CalendarBooking[];
  /** Store sector key — picks the provider icon (stethoscope only for clinics/vets). */
  category?: string;
}) {
  const t = dict.booking;
  const ProviderIcon = providerIcon(category);
  const statusLabels = t.status as Record<string, string>;
  const [today, setToday] = useState<Date | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  // new Date() can't run during SSR without risking a hydration mismatch, so
  // resolve "today" after mount (same guard as kitchen-board's clock).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setToday(new Date());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fmtWeekday = useMemo(
    () => new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : lang, { weekday: "short" }),
    [lang],
  );
  const fmtDay = useMemo(
    () => new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : lang, { day: "numeric" }),
    [lang],
  );
  const fmtRange = useMemo(
    () => new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : lang, { day: "numeric", month: "short" }),
    [lang],
  );

  // Bucket bookings by their date string once; per-day look-up is then O(1).
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const b of bookings) {
      if (!b.requested_date) continue;
      const key = b.requested_date.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(b);
      else map.set(key, [b]);
    }
    return map;
  }, [bookings]);

  // The 7 visible days: start of the current week (Sunday), shifted by the nav
  // offset. Derived only once "today" is known (post-mount).
  const days = useMemo(() => {
    if (!today) return [] as Date[];
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
    // Step by calendar date, not by fixed 24h ms — otherwise a DST transition in
    // the visible week would duplicate one day and skip its neighbour.
    return Array.from(
      { length: 7 },
      (_, i) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }, [today, weekOffset]);

  const mounted = today !== null;
  const todayKey = today ? ymd(today) : "";
  const visibleCount = days.reduce(
    (n, d) => n + (byDate.get(ymd(d))?.length ?? 0),
    0,
  );

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <CalendarDays className="h-5 w-5 text-primary" />
          {t.calendar}
        </h2>
        <div className="flex items-center gap-2">
          {mounted && days.length === 7 && (
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">
              {fmtRange.format(days[0])} – {fmtRange.format(days[6])}
            </span>
          )}
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label={t.prevWeek}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-2 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <ChevronPrev className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold transition-colors hover:border-primary disabled:opacity-50"
          >
            {t.thisWeek}
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label={t.nextWeek}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-2 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <ChevronNext className="h-4 w-4" />
          </button>
        </div>
      </div>

      {mounted ? (
        <div className="mt-4 overflow-x-auto">
          <div className="grid min-w-[48rem] grid-cols-7 gap-2">
            {days.map((day) => {
              const key = ymd(day);
              const list = byDate.get(key) ?? [];
              const isToday = key === todayKey;
              return (
                <div key={key} className="min-w-0">
                  <div
                    className={`rounded-xl px-1 py-2 text-center ${
                      isToday
                        ? "bg-primary-soft text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="block text-[11px] font-bold uppercase">
                      {fmtWeekday.format(day)}
                    </span>
                    <span className="block text-sm font-extrabold tabular-nums">
                      {fmtDay.format(day)}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {list.map((b) => {
                      const time = b.requested_time?.trim() || "—";
                      const customer = b.customer_name?.trim() || "—";
                      const service = b.service_name?.trim() ?? "";
                      const label = [
                        time,
                        customer,
                        service,
                        b.doctor,
                        statusLabels[b.status] ?? b.status,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div
                          key={b.id}
                          tabIndex={0}
                          title={label}
                          aria-label={label}
                          className={`rounded-lg border px-2 py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            TONE[b.status] ?? FALLBACK_TONE
                          }`}
                        >
                          <div className="flex items-center gap-1 text-xs font-extrabold tabular-nums">
                            <Clock className="h-3 w-3 shrink-0" />
                            <span className="truncate">{time}</span>
                          </div>
                          <div className="mt-0.5 truncate text-xs font-bold">
                            {customer}
                          </div>
                          {service && (
                            <div className="truncate text-[11px] opacity-80">
                              {service}
                            </div>
                          )}
                          {b.doctor && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold">
                              <ProviderIcon className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="truncate">{b.doctor}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {visibleCount === 0 && (
            <p className="mt-3 text-center text-sm text-muted-foreground">
              {t.noAppointments}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 h-40 rounded-2xl border border-dashed border-border" />
      )}
    </section>
  );
}
