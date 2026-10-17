import { notFound, redirect } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { CardList, CardRow } from "@/components/ui/card";
import { OrderCancelButton } from "@/components/order-cancel-button";
import { BookingReschedule } from "@/components/booking-reschedule";
import { AttendanceConfirm } from "@/components/attendance-confirm";
import { dictSlice } from "@/lib/dict-slice";

type BookingStatus =
  | "pending"
  | "accepted"
  | "scheduled"
  | "completed"
  | "no_show"
  | "cancelled"
  | "rejected";

type BookingRow = {
  id: string;
  status: BookingStatus;
  service_name: string | null;
  requested_date: string | null;
  requested_time: string | null;
  attendance_confirmed_at: string | null;
  stores: { name: string } | null;
};

const statusStyle: Record<BookingStatus, string> = {
  pending: "bg-warning-soft text-warning",
  accepted: "bg-info-soft text-info",
  scheduled: "bg-info-soft text-info",
  completed: "bg-success-soft text-success",
  no_show: "bg-warning-soft text-warning",
  cancelled: "bg-surface-muted text-muted-foreground",
  rejected: "bg-danger-soft text-danger",
};

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data } = await supabase
    .from("bookings")
    .select("id, status, service_name, requested_date, requested_time, attendance_confirmed_at, stores(name)")
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });
  const bookings = (data ?? []) as unknown as BookingRow[];

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {dict.booking.myBookings}
        </h1>

        {bookings.length ? (
          <CardList className="mt-8">
            {bookings.map((b) => (
              <CardRow
                key={b.id}
                className="flex items-center justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-bold">{b.stores?.name ?? "—"}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {b.service_name}
                    {b.requested_date ? ` · ${b.requested_date}` : ""}
                    {b.requested_time ? ` ${b.requested_time}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle[b.status]}`}
                  >
                    {dict.booking.status[b.status]}
                  </span>
                  {(b.status === "pending" ||
                    b.status === "accepted" ||
                    b.status === "scheduled") && (
                    <OrderCancelButton id={b.id} kind="booking" dict={dictSlice(dict, ["auth", "booking", "common", "orders"])} />
                  )}
                  {b.status === "pending" && (
                    <BookingReschedule
                      bookingId={b.id}
                      dict={dictSlice(dict, ["booking", "common"])}
                      initialDate={b.requested_date}
                      initialTime={b.requested_time}
                    />
                  )}
                  {(b.status === "accepted" || b.status === "scheduled") &&
                    (b.attendance_confirmed_at ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-success-soft px-3 py-1.5 text-xs font-bold text-success">
                        {dict.booking.attendance.confirmed}
                      </span>
                    ) : (
                      <AttendanceConfirm bookingId={b.id} dict={dictSlice(dict, ["booking", "common"])} />
                    ))}
                </div>
              </CardRow>
            ))}
          </CardList>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-border py-10 sm:py-16 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <CalendarCheck className="h-7 w-7" />
            </span>
            <p className="mt-4 text-muted-foreground">{dict.booking.noBookings}</p>
          </div>
        )}
      </Container>
    </div>
  );
}
