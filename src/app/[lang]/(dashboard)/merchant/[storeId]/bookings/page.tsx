import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Mail, MessageCircle, Phone, UserX } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/phone";
import { Container } from "@/components/ui/container";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  BookingStatusControl,
  type GuestNotice,
} from "@/components/booking-status-control";
import { BookingReschedule } from "@/components/booking-reschedule";
import {
  BookingsCalendar,
  type CalendarBooking,
} from "@/components/bookings-calendar";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";
import { BookingWaActions } from "@/components/wa-actions/booking-wa-actions";
import { WaLocaleToggle } from "@/components/wa-actions/wa-action-button";
import { LoadError } from "@/components/load-error";
import { todayInBeirut } from "@/lib/ledger";
import {
  bodiesOf,
  loadLastSent,
  loadWaTemplates,
} from "@/lib/wa-actions-server";
import { requireModuleAccess } from "@/lib/staff-access";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** History rows per "show older" step. */
const PAST_PAGE = 50;
/** Ceiling on how far "show older" can grow one request. */
const PAST_MAX_PAGES = 20;

const BOOKING_COLS =
  "id, status, service_name, requested_date, requested_time, customer_name, phone, customer_id, notes, patient_status, party_size, class_id, attendance_confirmed_at, doctors(name)";

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
  class_id: string | null;
  attendance_confirmed_at: string | null;
  doctors: { name: string } | null;
};

export default async function StoreBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; storeId: string }>;
  searchParams: Promise<{ past?: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const tl = dict.booking.list;
  const pastPages = Math.min(
    PAST_MAX_PAGES,
    Math.max(1, Math.floor(Number((await searchParams).past) || 1)),
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);
  await requireModuleAccess(supabase, storeId, "bookings", lang);
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  const storeName = (store as { name: string }).name;
  const category =
    (store as unknown as { business_types: { slug: string } | null })
      .business_types?.slug ?? undefined;

  const today = todayInBeirut();

  // Two reads instead of "every booking the store ever took, oldest first":
  //  - upcoming: today (Beirut) onward, undated requests, and EVERY pending
  //    request whatever its date — soonest first, the merchant's schedule;
  //  - history («سابقة»): before today and already handled, newest first,
  //    50 at a time behind "show older".
  const [upcomingRes, pastRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(BOOKING_COLS)
      .eq("store_id", storeId)
      .or(`requested_date.gte.${today},requested_date.is.null,status.eq.pending`)
      .order("requested_date", { ascending: true, nullsFirst: false })
      .order("requested_time", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("bookings")
      .select(BOOKING_COLS)
      .eq("store_id", storeId)
      .lt("requested_date", today)
      .neq("status", "pending")
      .order("requested_date", { ascending: false })
      .order("requested_time", { ascending: false, nullsFirst: false })
      .limit(PAST_PAGE * pastPages + 1),
  ]);
  const loadErr = upcomingRes.error ?? pastRes.error;
  if (loadErr) console.error("[bookings] read failed", loadErr);
  // PostgREST types the doctors embed as an array; at runtime a to-one FK
  // returns a single object (or null), which is what BookingRow expects.
  const upcoming = (upcomingRes.data ?? []) as unknown as BookingRow[];
  const pastAll = (pastRes.data ?? []) as unknown as BookingRow[];
  const hasMorePast = pastAll.length > PAST_PAGE * pastPages;
  const past = hasMorePast ? pastAll.slice(0, PAST_PAGE * pastPages) : pastAll;
  const bookings = [...upcoming, ...past];

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
    booking_declined: bodiesOf(waTemplates.templates, "booking_declined"),
  };

  // Pending = new/unhandled requests that still need the merchant's reply.
  const pendingCount = upcoming.filter((b) => b.status === "pending").length;

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

  const statusCopy = {
    ...dict.booking.statusControl,
    cancel: dict.common.cancel,
  };
  const waLocale = lang === "en" ? "en" : "ar";

  const renderRow = (b: BookingRow) => {
    // No account → no in-app notification reaches them; the merchant is the
    // only channel, so the controls offer a prefilled WhatsApp after a change.
    const guest: GuestNotice | null = b.customer_id
      ? null
      : {
          phone: b.phone,
          customerName: b.customer_name,
          storeName,
          service: b.service_name,
          date: b.requested_date,
          time: b.requested_time,
          locale: waLocale,
          message: tl.guestNotify,
          action: tl.guestNotifyAction,
        };
    // Class seats and party reservations are not a single movable slot.
    const reschedulable =
      ["pending", "accepted", "scheduled"].includes(b.status) &&
      !b.class_id &&
      !b.party_size;
    const email = b.customer_id ? emailByCustomer.get(b.customer_id) : null;
    return (
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
              {!b.customer_id && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">
                  <UserX className="h-3 w-3" aria-hidden />
                  {tl.guestChip}
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
                <span className="text-xs text-warning">{dict.booking.noPhone}</span>
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
          </div>
          <BookingStatusControl
            bookingId={b.id}
            status={b.status}
            labels={dict.booking.status}
            errorLabel={dict.auth.errorGeneric}
            copy={statusCopy}
            guest={guest}
          />
        </div>
        {reschedulable && (
          <div className="mt-3">
            <BookingReschedule
              bookingId={b.id}
              dict={dictSlice(dict, ["booking", "common"])}
              initialDate={b.requested_date}
              initialTime={b.requested_time}
              guest={guest}
            />
          </div>
        )}
        <BookingWaActions
          uiLang={lang}
          storeId={storeId}
          storeName={storeName}
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
    );
  };

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {storeName}
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

        {loadErr ? (
          <LoadError
            title={dict.common.loadError}
            retryLabel={dict.common.reload}
            className="mt-8"
          />
        ) : bookings.length ? (
          <>
            <BookingsCalendar
              lang={lang}
              dict={dictSlice(dict, ["booking"])}
              bookings={calendarBookings}
              category={category}
            />
            {upcoming.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-lg font-extrabold">{tl.upcoming}</h2>
                <div className="space-y-4">{upcoming.map(renderRow)}</div>
              </section>
            )}
            {past.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 text-lg font-extrabold text-muted-foreground">
                  {tl.past}
                </h2>
                <div className="space-y-4">{past.map(renderRow)}</div>
                {hasMorePast && (
                  <Link
                    href={`/${lang}/merchant/${storeId}/bookings?past=${pastPages + 1}`}
                    scroll={false}
                    className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
                  >
                    {tl.loadMore}
                  </Link>
                )}
              </section>
            )}
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
