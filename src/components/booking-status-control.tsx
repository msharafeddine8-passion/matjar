"use client";
import { notifyError, notifyWithLink } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { statusErrorKind, statusNeedsConfirm } from "@/lib/booking-status";
import { bookingWaHref, type WaLocale } from "@/lib/wa-templates";

const STATUSES = [
  "pending",
  "accepted",
  "scheduled",
  "completed",
  "no_show",
  "cancelled",
  "rejected",
] as const;

export type StatusControlCopy = {
  confirm: string;
  confirmYes: string;
  cancel: string;
  classFull: string;
  conflict: string;
};

/** A guest booking (no account → no in-app notification): after a change the
 *  merchant gets a toast with a prefilled WhatsApp message to send. */
export type GuestNotice = {
  phone: string | null;
  customerName: string | null;
  storeName: string;
  service: string | null;
  date: string | null;
  time: string | null;
  locale: WaLocale;
  message: string;
  action: string;
};

export function BookingStatusControl({
  bookingId,
  status,
  labels,
  errorLabel,
  copy,
  guest,
}: {
  bookingId: string;
  status: string;
  labels: Record<string, string>;
  errorLabel?: string;
  copy?: StatusControlCopy;
  guest?: GuestNotice | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  // A refresh (AutoRefresh, another staff member) brings a new status prop;
  // without this the select kept showing the stale local choice.
  const [seen, setSeen] = useState(status);
  if (status !== seen) {
    setSeen(status);
    setValue(status);
  }

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = value;
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
    setValue(next);
    setBusy(true);
    const { error } = await createClient()
      .from("bookings")
      .update({ status: next })
      .eq("id", bookingId);
    setBusy(false);
    if (error) {
      setValue(prev);
      const kind = statusErrorKind(error);
      const msg =
        kind === "classFull" && copy
          ? copy.classFull
          : kind === "conflict" && copy
            ? copy.conflict
            : errorLabel;
      if (msg) notifyError(msg);
      return;
    }
    if (guest) {
      const key =
        next === "rejected" || next === "cancelled"
          ? "booking_declined"
          : next === "accepted" || next === "scheduled"
            ? "booking_confirmation"
            : null;
      const href = key ? bookingWaHref(key, guest, guest.locale) : null;
      if (href) notifyWithLink(guest.message, { href, label: guest.action });
    }
    router.refresh();
  }

  return (
    <select
      value={value}
      disabled={busy}
      onChange={onChange}
      aria-label={labels[value] ?? value}
      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus:border-primary disabled:opacity-60"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {labels[s]}
        </option>
      ))}
    </select>
  );
}
