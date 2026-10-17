"use client";

import type { Dictionary } from "@/i18n/get-dictionary";
import {
  DEFAULT_WA_TEMPLATES,
  WA_LOCALES,
  bookingLinkPath,
  formatWaDate,
  formatWaTime,
  type WaLocale,
  type WaValues,
} from "@/lib/wa-templates";
import { WaActionButton } from "./wa-action-button";

export type BookingWaData = {
  id: string;
  status: string;
  phone: string | null;
  customerName: string | null;
  hasAccount: boolean;
  service: string | null;
  /** yyyy-mm-dd */
  date: string | null;
  time: string | null;
};

const CONFIRMABLE = new Set(["pending", "accepted", "scheduled"]);
const REMINDABLE = new Set(["accepted", "scheduled"]);
const DECLINED = new Set(["rejected", "cancelled"]);

/**
 * «تأكيد الموعد» and «تذكير قبل بيوم» on a booking. The reminder only appears
 * for an accepted booking with a date that has not passed — reminding someone
 * of yesterday's appointment is not a reminder.
 */
export function BookingWaActions({
  uiLang,
  storeId,
  storeName,
  booking,
  today,
  templates,
  lastSent,
  t,
}: {
  uiLang: string;
  storeId: string;
  storeName: string;
  booking: BookingWaData;
  /** Beirut's today, yyyy-mm-dd. */
  today: string;
  templates: {
    booking_confirmation: Record<WaLocale, string>;
    booking_reminder: Record<WaLocale, string>;
    /** Default wording only (not yet a stored/editable key). */
    booking_declined?: Record<WaLocale, string>;
  };
  lastSent: Record<string, string>;
  t: Dictionary["waActions"];
}) {
  const canConfirm = CONFIRMABLE.has(booking.status);
  const canRemind =
    REMINDABLE.has(booking.status) && !!booking.date && booking.date >= today;
  // A rejected/cancelled booking: tell the customer — for a guest this is the
  // only way they find out.
  const canDecline = DECLINED.has(booking.status);
  if (!canConfirm && !canRemind && !canDecline) return null;

  const values = {} as Record<WaLocale, WaValues>;
  const linkPath = {} as Record<WaLocale, string | null>;
  for (const l of WA_LOCALES) {
    values[l] = {
      customer_name: booking.customerName,
      store_name: storeName,
      service: booking.service,
      date: formatWaDate(booking.date, l),
      time: formatWaTime(booking.time),
    };
    linkPath[l] = bookingLinkPath(l, booking.id, booking.hasAccount);
  }
  const common = {
    uiLang,
    storeId,
    targetType: "booking" as const,
    targetId: booking.id,
    phone: booking.phone,
    values,
    linkPath,
    labels: {
      noPhone: t.noPhone,
      lastSent: t.lastSent,
      ago: t.ago,
      truncated: t.truncated,
    },
  };
  const at = (key: string) => lastSent[`${booking.id}:${key}`] ?? null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-2">
      {canConfirm && (
        <WaActionButton
          {...common}
          variant="whatsapp"
          full
          templateKey="booking_confirmation"
          label={t.keys.booking_confirmation}
          bodies={templates.booking_confirmation}
          lastSentAt={at("booking_confirmation")}
        />
      )}
      {canRemind && (
        <WaActionButton
          {...common}
          full
          templateKey="booking_reminder"
          label={t.keys.booking_reminder}
          bodies={templates.booking_reminder}
          lastSentAt={at("booking_reminder")}
        />
      )}
      {canDecline && (
        <WaActionButton
          {...common}
          full
          templateKey="booking_declined"
          label={t.keys.booking_declined}
          bodies={templates.booking_declined ?? DEFAULT_WA_TEMPLATES.booking_declined}
          lastSentAt={null}
        />
      )}
    </div>
  );
}
