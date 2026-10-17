"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { statusErrorKind, statusNeedsConfirm } from "@/lib/booking-status";
import type { StatusControlCopy } from "@/components/booking-status-control";

const STATUSES = [
  "requested",
  "confirmed",
  "declined",
  "checked_in",
  "checked_out",
  "completed",
  "cancelled",
  "no_show",
] as const;

// Merchant-side stay-booking status control (update_stay_status RPC, 0191).
export function StayStatusControl({
  stayId,
  status,
  labels,
  errorLabel,
  copy,
}: {
  stayId: string;
  status: string;
  labels: Record<string, string>;
  errorLabel: string;
  copy?: StatusControlCopy;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [val, setVal] = useState(status);
  const [busy, setBusy] = useState(false);
  // Re-sync when a refresh brings a different status.
  const [seen, setSeen] = useState(status);
  if (status !== seen) {
    setSeen(status);
    setVal(status);
  }

  async function change(next: string) {
    const prev = val;
    if (
      copy &&
      statusNeedsConfirm(next) &&
      !(await confirm({
        message: copy.confirm.replace("{status}", labels[next] ?? next),
        confirmLabel: copy.confirmYes,
        cancelLabel: copy.cancel,
        danger: true,
      }))
    ) {
      return;
    }
    setVal(next);
    setBusy(true);
    const { error } = await createClient().rpc("update_stay_status", {
      p_id: stayId,
      p_status: next,
    });
    setBusy(false);
    if (error) {
      setVal(prev);
      // 23P01: re-confirming dates another stay now holds.
      notifyError(
        copy && statusErrorKind(error) === "conflict" ? copy.conflict : errorLabel,
      );
      return;
    }
    router.refresh();
  }

  return (
    <select
      value={val}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      aria-label={labels[val] ?? val}
      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary disabled:opacity-60"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {labels[s]}
        </option>
      ))}
    </select>
  );
}
