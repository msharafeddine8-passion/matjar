"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Badge } from "@/components/ui/badge";
import { WEEK_DAYS, type WeekHours } from "@/lib/hours";

// Structured business-hours editor: 7 rows (day + closed toggle + open/close
// times) + booking slot length. Serializes into a hidden input so the parent
// form submits it like any other field.
export function HoursEditor({
  dict,
  initial,
  initialSlot,
}: {
  dict: Pick<Dictionary, "os">;
  initial: WeekHours | null;
  initialSlot: number;
}) {
  const t = dict.os.hours;
  const [hours, setHours] = useState<WeekHours>(initial ?? {});
  const [slot, setSlot] = useState(String(initialSlot || 30));

  function toggleDay(day: string, open: boolean) {
    setHours((h) => {
      const next = { ...h };
      if (open) next[day] = h[day] ?? { open: "09:00", close: "18:00" };
      else delete next[day];
      return next;
    });
  }

  function setTime(day: string, key: "open" | "close", value: string) {
    setHours((h) => ({
      ...h,
      [day]: { ...(h[day] ?? { open: "09:00", close: "18:00" }), [key]: value },
    }));
  }

  const timeField =
    "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";

  return (
    <div className="rounded-2xl border border-border bg-surface-muted/40 p-4">
      <input type="hidden" name="hours_json" value={JSON.stringify(hours)} />
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Clock className="h-4 w-4 text-primary" />
        {t.title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>

      <div className="mt-3 space-y-1.5">
        {WEEK_DAYS.map((day) => {
          const span = hours[day];
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <label className="flex w-28 shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={!!span}
                  onChange={(e) => toggleDay(day, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                {t.days[day]}
              </label>
              {span ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{t.from}</span>
                  <input
                    type="time"
                    value={span.open}
                    onChange={(e) => setTime(day, "open", e.target.value)}
                    className={timeField}
                  />
                  <span>{t.to}</span>
                  <input
                    type="time"
                    value={span.close}
                    onChange={(e) => setTime(day, "close", e.target.value)}
                    className={timeField}
                  />
                </div>
              ) : (
                <Badge variant="neutral" size="sm">
                  {t.closed}
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      <label className="mt-4 block text-sm font-semibold">
        {t.slotLabel}
        <select
          name="booking_slot_minutes"
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
          className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m} {t.minutes}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
