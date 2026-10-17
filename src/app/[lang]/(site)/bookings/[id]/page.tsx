import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CalendarCheck, Phone, StickyNote, Store as StoreIcon } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { labelFor, statusTone } from "@/lib/status-labels";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OrderCancelButton } from "@/components/order-cancel-button";
import { BookingReschedule } from "@/components/booking-reschedule";
import { AttendanceConfirm } from "@/components/attendance-confirm";
import { dictSlice } from "@/lib/dict-slice";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BookingRow = {
  id: string;
  customer_id: string;
  status: string;
  service_name: string | null;
  requested_date: string | null;
  requested_time: string | null;
  notes: string | null;
  created_at: string;
  attendance_confirmed_at: string | null;
  stores: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp: string | null;
  } | null;
};

// One appointment, on its own screen.
//
// It exists because the activity list had nowhere to send a booking (MP-023):
// tapping "شوف حجزك" landed the customer on /bookings and left them to find
// their own row in it — the one thing they had already told us they wanted.
// Orders have had /orders/{id} all along; this is the same promise kept for the
// other three quarters of the list.
//
// Deliberately NOT a second implementation of anything. Cancel, reschedule and
// attendance are the exact components /bookings renders, with the exact props —
// the state machine lives in them and in the RPCs behind them, and a detail
// screen is not the place to grow a second opinion about when a booking may be
// cancelled.
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  // A malformed id is a 404 before it ever reaches Postgres — an invalid uuid
  // makes the query itself error rather than return nothing.
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login?next=/${lang}/bookings/${id}`);

  const { data } = await supabase
    .from("bookings")
    .select(
      "id, customer_id, status, service_name, requested_date, requested_time, notes, created_at, attendance_confirmed_at, stores(id, name, phone, whatsapp)",
    )
    .eq("id", id)
    .maybeSingle();

  const booking = data as unknown as BookingRow | null;
  // RLS already scopes this, and the explicit owner check is the second lock:
  // a merchant can read bookings for their own store, and this is the
  // customer's screen.
  if (!booking || booking.customer_id !== user.id) notFound();

  const t = dict.booking;
  const store = booking.stores;
  const live =
    booking.status === "pending" ||
    booking.status === "accepted" ||
    booking.status === "scheduled";

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-2xl">
        <Breadcrumbs
          items={[
            { label: t.myBookings, href: `/${lang}/bookings` },
            { label: booking.service_name || t.booking },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1
              dir="auto"
              className="text-2xl font-extrabold tracking-tight"
            >
              {booking.service_name || t.booking}
            </h1>
            {store && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <StoreIcon className="h-4 w-4 shrink-0" />
                <Link
                  href={`/${lang}/store/${store.id}`}
                  dir="auto"
                  className="truncate font-semibold hover:text-primary"
                >
                  {store.name}
                </Link>
              </p>
            )}
          </div>
          <Badge variant={statusTone("booking", booking.status)}>
            {labelFor(dict, "booking", booking.status)}
          </Badge>
        </div>

        <Card className="mt-6 space-y-3 p-5 text-sm">
          {/* A date and a clock time are digits either way round — LTR and
              tabular so they do not reflow inside the Arabic paragraph. */}
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 shrink-0 text-primary" />
            <span className="font-semibold">{t.date}</span>
            <span dir="ltr" className="tabular-nums">
              {booking.requested_date ?? "—"}
            </span>
            {booking.requested_time && (
              <>
                <span className="font-semibold">{t.time}</span>
                <span dir="ltr" className="tabular-nums">
                  {booking.requested_time}
                </span>
              </>
            )}
          </div>
          {booking.notes && (
            <p className="flex items-start gap-2">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span dir="auto">{booking.notes}</span>
            </p>
          )}
          {store?.phone && (
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-primary" />
              <a
                href={`tel:${store.phone}`}
                dir="ltr"
                className="font-semibold tabular-nums hover:text-primary"
              >
                {store.phone}
              </a>
            </p>
          )}
        </Card>

        {/* Everything the customer can still do about this appointment, in one
            place instead of spread down a list of other people's bookings. */}
        {(live || booking.status === "pending") && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {live && <OrderCancelButton id={booking.id} kind="booking" dict={dictSlice(dict, ["auth", "booking", "common", "orders"])} />}
            {booking.status === "pending" && (
              <BookingReschedule
                bookingId={booking.id}
                dict={dictSlice(dict, ["booking", "common"])}
                initialDate={booking.requested_date}
                initialTime={booking.requested_time}
              />
            )}
            {(booking.status === "accepted" || booking.status === "scheduled") &&
              (booking.attendance_confirmed_at ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-success-soft px-3 py-1.5 text-xs font-bold text-success">
                  {t.attendance.confirmed}
                </span>
              ) : (
                <AttendanceConfirm bookingId={booking.id} dict={dictSlice(dict, ["booking", "common"])} />
              ))}
          </div>
        )}

        <Link
          href={`/${lang}/activity`}
          className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {dict.common.back}
        </Link>
      </Container>
    </div>
  );
}
