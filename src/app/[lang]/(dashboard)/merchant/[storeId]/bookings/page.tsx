import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/phone";
import { Container } from "@/components/ui/container";
import { AutoRefresh } from "@/components/auto-refresh";
import { BookingStatusControl } from "@/components/booking-status-control";
import { BookingReschedule } from "@/components/booking-reschedule";
import {
  BookingsCalendar,
  type CalendarBooking,
} from "@/components/bookings-calendar";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";
import { BookingWaActions } from "@/components/wa-actions/booking-wa-actions";
import { WaLocaleToggle } from "@/components/wa-actions/wa-action-button";
import { todayInBeirut } from "@/lib/ledger";
import {
  bodiesOf,
  loadLastSent,
  loadWaTemplates,
} from "@/lib/wa-actions-server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BookingRow = {
  id: string;
  status: string;
  service_name: string | null;
  requested_date: string | null;
  requested_time: string | null;
  customer_name: string | null;
  phone: string | null;
  customer_id: string | null;
  notes: string | null;
  /** 0297 — clinics only, and null on every booking taken before it. */
  patient_status: string | null;
  party_size: number | null;
  attendance_confirmed_at: string | null;
  doctors: { name: string } | null;
};

export default async function StoreBookingsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);
  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Chronological schedule: soonest appointment first (not newest request).
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, status, service_name, requested_date, requested_time, customer_name, phone, customer_id, notes, patient_status, party_size, attendance_confirmed_at, doctors(name)",
    )
    .eq("store_id", storeId)
    .order("requested_date", { ascending: true, nullsFirst: false })
    .order("requested_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  // PostgREST types the doctors embed as an array; at runtime a to-one FK
  // returns a single object (or null), which is what BookingRow expects.
  const bookings = (data ?? []) as unknown as BookingRow[];

  // Account emails of this store's customers (SECURITY DEFINER, store-scoped).
  const emailByCustomer = new Map<string, string>();
  const { data: emailRows } = await supabase.rpc("store_customer_emails", {
    p_store_id: storeId,
  });
  for (const r of (emailRows ?? []) as { customer_id: string; email: string }[]) {
    if (r.customer_id && r.email) emailByCustomer.set(r.customer_id, r.email);
  }
  // WhatsApp confirmation / reminder buttons (every plan, 0309). Defensive
  // reads: before 0309 the default wording is used and nothing is logged.
  const [waTemplates, waLastSent] = await Promise.all([
    loadWaTemplates(supabase, storeId),
    loadLastSent(supabase, storeId, "booking", bookings.map((b) => b.id)),
  ]);
  const waBookingTemplates = {
    booking_confirmation: bodiesOf(waTemplates.templates, "booking_confirmation"),
    booking_reminder: bodiesOf(waTemplates.templates, "booking_reminder"),
  };
  const today = todayInBeirut();

  // Pending = new/unhandled requests that still need the merchant's reply.
  const pendingCount = bookings.filter((b) => b.status === "pending").length;

  // Flatten the doctor join for the calendar client component (dated bookings
  // land on the grid; undated ones still show in the chronological list below).
  const calendarBookings: CalendarBooking[] = bookings.map((b) => ({
    id: b.id,
    service_name: b.service_name,
    requested_date: b.requested_date,
    requested_time: b.requested_time,
    customer_name: b.customer_name,
    status: b.status,
    doctor: b.doctors?.name ?? null,
  }));

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <AutoRefresh />
        <h1 className="mt-3 flex flex-wrap items-center gap-3 text-3xl font-extrabold tracking-tight">
          {dict.booking.myBookings}
          {pendingCount > 0 && (
            <span className="rounded-full bg-primary px-2.5 py-1 text-sm font-bold text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </h1>

        {pendingCount > 0 && (
          <div className="mt-3 rounded-2xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm font-semibold text-primary">
            {dict.booking.newBookingsCount.replace("{count}", String(pendingCount))}
          </div>
        )}

        {bookings.length > 0 && (
          <div className="mt-3">
            <WaLocaleToggle uiLang={lang} labels={dict.waActions} />
          </div>
        )}

        {bookings.length ? (
          <>
            <BookingsCalendar
              lang={lang}
              dict={dict}
              bookings={calendarBookings}
            />
            <div className="mt-8 space-y-4">
            {bookings.map((b) => (
              <div
                key={b.id}
                className={`rounded-2xl border bg-surface p-5 ${
                  b.status === "pending"
                    ? "border-primary/40 ring-1 ring-primary/20"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {b.status === "pending" && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                          {dict.booking.newBadge}
                        </span>
                      )}
                      {b.service_name ?? "—"}
                      {b.doctors?.name && (
                        <span className="ms-2 text-sm font-semibold text-primary">
                          · {b.doctors.name}
                        </span>
                      )}
                      {b.attendance_confirmed_at && (
                        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">
                          {dict.booking.attendance.confirmedMerchant}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {b.customer_name || dict.booking.noName}
                      {b.requested_date ? ` · ${b.requested_date}` : ""}
                      {b.requested_time ? ` ${b.requested_time}` : ""}
                      {b.party_size
                        ? ` · ${b.party_size} ${dict.reservations.people}`
                        : ""}
                    </p>
                    {(() => {
                      const email =
                        b.customer_id ? emailByCustomer.get(b.customer_id) : null;
                      const waNum = b.phone
                        ? b.phone.replace(/[^\d]/g, "")
                        : "";
                      return (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          {b.phone ? (
                            <>
                              <a
                                href={waLink(b.phone) ?? `tel:${b.phone}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-success hover:underline"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                                <span dir="ltr">{b.phone}</span>
                              </a>
                              <a
                                href={`tel:${b.phone}`}
                                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                              >
                                <Phone className="h-3.5 w-3.5" />
                                {dict.booking.call}
                              </a>
                            </>
                          ) : (
                            <span className="text-xs text-warning">
                              {dict.booking.noPhone}
                            </span>
                          )}
                          {email && (
                            <a
                              href={`mailto:${email}`}
                              className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              {email}
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <BookingStatusControl
                    bookingId={b.id}
                    status={b.status}
                    labels={dict.booking.status}
                    errorLabel={dict.auth.errorGeneric}
                  />
                </div>
                {["pending", "accepted", "scheduled"].includes(b.status) && (
                  <div className="mt-3">
                    <BookingReschedule
                      bookingId={b.id}
                      dict={dict}
                      initialDate={b.requested_date}
                      initialTime={b.requested_time}
                    />
                  </div>
                )}
                <BookingWaActions
                  uiLang={lang}
                  storeId={storeId}
                  storeName={(store as { name: string }).name}
                  today={today}
                  templates={waBookingTemplates}
                  lastSent={waLastSent}
                  t={dict.waActions}
                  booking={{
                    id: b.id,
                    status: b.status,
                    phone: b.phone,
                    customerName: b.customer_name,
                    hasAccount: !!b.customer_id,
                    service: b.service_name,
                    date: b.requested_date,
                    time: b.requested_time,
                  }}
                />
                {/* A first visit is a longer slot and a file to open, so it
                    belongs on the row rather than one click deeper. */}
                {b.patient_status === "new" && (
                  <p className="mt-3 inline-flex rounded-lg bg-info-soft px-2.5 py-1 text-xs font-bold text-info">
                    {dict.booking.patientNew}
                  </p>
                )}
                {b.notes && (
                  <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                    {b.notes}
                  </p>
                )}
              </div>
            ))}
            </div>
          </>
        ) : (
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="bookings"
            title={dict.booking.noBookings}
            className="mt-8"
          />
        )}
      </Container>
    </div>
  );
}
