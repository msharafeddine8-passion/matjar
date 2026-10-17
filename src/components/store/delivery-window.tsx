"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { deliveryWindows, scheduledForIso } from "@/lib/delivery-windows";
import type { WeekHours } from "@/lib/hours";

// "When would you like it?", and the state that answers it.
//
// Lifted out of store-products.tsx. What came with it is the CLOCK — the awkward
// half — and what deliberately did not is the customer's answer.
//
// WHY THE ANSWER STAYS IN THE PARENT. This picker is rendered inside the
// checkout panel, which is itself inside `items.length > 0`: it unmounts the
// moment the customer empties their basket. Before the split, the chosen day and
// time lived in StoreProducts and therefore survived that, so a shopper who took
// everything out, changed their mind and put it back still had Saturday 4pm
// selected. Owning the answer down here would have quietly thrown it away — and
// worse, left the parent holding a scheduled_for the picker no longer showed.
// So the pick is a controlled value, and only the clock is local.
//
// WHY THE CLOCK IS LOCAL, and read AFTER mount rather than during render: this
// is a client component but it is still server-rendered, and
// `deliveryWindows(hours, new Date())` in the render body would be evaluated
// twice against two different clocks in two different zones — on the server (UTC
// on Vercel) and again in the browser (UTC+3 in Beirut). `daySpan` keys off
// `getDay()` and the dates are built from local parts, so the two runs can
// disagree about which slots exist and even about which DAY it is: a hydration
// mismatch on the money path. Losing `now` on unmount costs nothing, because it
// is re-read on the next mount.
//
// A DAY WITHOUT A TIME IS NOT A WINDOW. It sends nothing and the order is an
// ordinary order-now, which is what every order has been until this existed.
// The server re-checks and drops a past time regardless (0194), so a list that
// ages while the customer types is safe.

/** The customer's answer: a day, and a slot on that day. Both empty = as soon
 *  as possible, which is the default and always has been. */
export type WindowPick = { date: string; time: string };

export const NO_WINDOW: WindowPick = { date: "", time: "" };

/** The pick as the ISO string the order carries in
 *  `p_custom_fields.scheduled_for` — the channel 0194 already reads, so no
 *  schema and no RPC change. Null for "order now". */
export function windowIso(pick: WindowPick): string | null {
  return scheduledForIso(pick.date, pick.time);
}

export function DeliveryWindow({
  lang,
  dict,
  hours,
  value,
  onChange,
}: {
  lang: Locale;
  dict: Dictionary;
  /** The store's own opening hours (stores.hours). The picker renders nothing
   *  at all when the merchant has not set any — a picker with nothing safe to
   *  offer is worse than none. */
  hours: WeekHours | null;
  value: WindowPick;
  onChange: (pick: WindowPick) => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(new Date());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Null until mounted, so the server renders no picker at all rather than one
  // built from the wrong timezone.
  const windows = now ? deliveryWindows(hours, now) : [];
  const daySlots = windows.find((w) => w.date === value.date)?.slots ?? [];

  if (windows.length === 0) return null;

  return (
    <div className="mb-5">
      <span className="text-sm font-semibold">{dict.store.windowTitle}</span>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        <select
          aria-label={dict.store.windowTitle}
          value={value.date}
          // A new day invalidates the slot chosen on the old one.
          onChange={(e) => onChange({ date: e.target.value, time: "" })}
          className="h-11 rounded-xl border border-border bg-surface px-3 text-sm font-semibold outline-none transition-colors focus:border-primary"
        >
          <option value="">{dict.store.windowAsap}</option>
          {windows.map((w, i) => (
            <option key={w.date} value={w.date}>
              {i === 0
                ? dict.store.windowToday
                : i === 1
                  ? dict.store.windowTomorrow
                  : new Date(`${w.date}T12:00`).toLocaleDateString(
                      lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                      { weekday: "long", day: "numeric", month: "short" },
                    )}
            </option>
          ))}
        </select>
        {value.date && (
          <select
            aria-label={dict.store.windowTime}
            dir="ltr"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            className="h-11 rounded-xl border border-border bg-surface px-3 text-sm font-semibold tabular-nums outline-none transition-colors focus:border-primary"
          >
            <option value="">{dict.store.windowTime}</option>
            {daySlots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {dict.store.windowHint}
      </p>
    </div>
  );
}
