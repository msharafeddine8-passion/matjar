"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Dictionary } from "@/i18n/get-dictionary";

// "I'm coming ✓" — the customer confirms attendance on an accepted booking
// (confirm_booking_attendance, 0176). The merchant sees the confirmation chip.
export function AttendanceConfirm({
  bookingId,
  dict,
}: {
  bookingId: string;
  dict: Pick<Dictionary, "booking" | "common">;
}) {
  const router = useRouter();
  const t = dict.booking.attendance;
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await createClient().rpc(
      "confirm_booking_attendance",
      { p_booking_id: bookingId },
    );
    setBusy(false);
    const res = data as { ok: boolean } | null;
    if (error || !res?.ok) {
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(t.done);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={confirm}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5 text-xs font-bold text-success transition-opacity hover:opacity-80 disabled:opacity-50"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {t.action}
    </button>
  );
}
