"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  isFinalOrderStatus,
  nextOrderStatuses,
  orderStatusErrorKind,
} from "@/lib/order-progress";

// Moving an order here restores its stock and, once the customer has been told,
// cannot be taken back without confusing them. A native select commits on a
// single change event — a stray scroll wheel over a focused control, or a
// mis-tap in a long list on a phone, was enough to cancel a live order with no
// step in between. These two ask first; every other transition stays instant,
// because a merchant working a lunch rush should not have to confirm "ready".
const DESTRUCTIVE = new Set(["cancelled", "rejected"]);

export function OrderStatusControl({
  orderId,
  status,
  fulfillment,
  labels,
  errorLabel,
  errorLabels,
  confirmLabels,
  finalNote,
  closedNote,
  ariaLabel,
}: {
  orderId: string;
  status: string;
  /** Decides the journey offered: a pickup is never "on the way". */
  fulfillment: string;
  labels: Record<string, string>;
  errorLabel?: string;
  /** The database's finality refusals, said plainly (0246 / 0333). */
  errorLabels?: { closed: string; completed: string };
  /** Omit to keep the old behaviour of committing every change immediately. */
  confirmLabels?: { message: string; confirm: string; cancel: string };
  /** Shown instead of the control once the order is completed. */
  finalNote?: string;
  /** Shown instead of the control once the order is cancelled or rejected. */
  closedNote?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  // Completed (0246), cancelled and rejected (0333) are the end of the road.
  // The database refuses to move them, so offering the choice here would only
  // produce an error — and reopening a cancelled order used to re-award loyalty
  // and drive stock negative after both had already been given back.
  if (isFinalOrderStatus(status)) {
    const note = status === "completed" ? finalNote : closedNote;
    return (
      <span className="flex flex-col gap-0.5 text-sm">
        <span className="font-semibold">{labels[status] ?? status}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
    );
  }

  const options = nextOrderStatuses(status, fulfillment);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = value;
    if (next === prev) return;
    if (confirmLabels && DESTRUCTIVE.has(next)) {
      // Show the select snapping back on refusal, rather than leaving it
      // displaying a status the order does not have.
      setValue(next);
      const ok = await confirm({
        message: confirmLabels.message.replace("{status}", labels[next] ?? next),
        confirmLabel: confirmLabels.confirm,
        cancelLabel: confirmLabels.cancel,
        danger: true,
      });
      if (!ok) {
        setValue(prev);
        return;
      }
    }
    setValue(next);
    setBusy(true);
    const { error } = await createClient()
      .from("orders")
      .update({ status: next })
      .eq("id", orderId);
    setBusy(false);
    if (error) {
      setValue(prev);
      const kind = orderStatusErrorKind(error.message);
      const msg =
        kind && errorLabels ? errorLabels[kind] : errorLabel;
      if (msg) notifyError(msg);
      // A finality refusal means the screen is stale — someone else (or the
      // customer) already closed it. Show the true state.
      if (kind) router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <select
      value={value}
      disabled={busy}
      onChange={onChange}
      aria-label={ariaLabel}
      className="min-h-10 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus:border-primary disabled:opacity-60"
    >
      {options.map((s) => (
        <option key={s} value={s}>
          {labels[s] ?? s}
        </option>
      ))}
    </select>
  );
}
