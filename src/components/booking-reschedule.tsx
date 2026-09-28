"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Dictionary } from "@/i18n/get-dictionary";
import { beirutYmd } from "@/lib/quick-panel";

// Move a booking to a new date/time via reschedule_booking (0175): the server
// re-runs the same conflict rules as placing, so a taken slot is refused.
export function BookingReschedule({
  bookingId,
  dict,
  initialDate,
  initialTime,
}: {
  bookingId: string;
  dict: Dictionary;
  initialDate?: string | null;
  initialTime?: string | null;
}) {
  const router = useRouter();
  const t = dict.booking.reschedule;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate ?? "");
  const [time, setTime] = useState(initialTime?.slice(0, 5) ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || !date || !time) return;
    setBusy(true);
    const { data, error } = await createClient().rpc("reschedule_booking", {
      p_booking_id: bookingId,
      p_date: date,
      p_time: time,
    });
    setBusy(false);
    const res = data as { ok: boolean; code?: string } | null;
    if (error || !res?.ok) {
      const code = res?.code ?? "";
      notifyError(
        code === "slot_taken" || code === "capacity_full"
          ? t.slotTaken
          : code === "outside_hours"
            ? t.outsideHours
            : dict.common.actionFailed,
      );
      return;
    }
    notifySuccess(t.done);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        {t.action}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        min={beirutYmd(new Date())}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !date || !time}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {t.confirm}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        {dict.common.cancel}
      </button>
    </div>
  );
}
