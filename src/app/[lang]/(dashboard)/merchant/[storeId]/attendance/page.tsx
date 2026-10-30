import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requestNow } from "@/lib/now";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { addDays, beirutDay, weekRange, type TimesheetRow } from "@/lib/attendance";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  AttendanceManager,
  type OpenShift,
  type ShiftEmployee,
} from "@/components/attendance-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The hours, on their own screen.
//
// Owner-only for the same reason the HR screen is: attendance is what payroll
// is computed from, and a correction here moves what somebody is paid. The
// per-module staff permissions have no notion of that, and borrowing one would
// hand it to the wrong people.
export default async function StoreAttendancePage({
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

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id, late_grace_minutes, auto_close_hours")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  if ((store as unknown as { owner_id: string | null }).owner_id !== user.id) {
    redirect(`/${lang}/merchant/${storeId}`);
  }

  if (!isBusiness(await getStorePlan(storeId))) {
    return (
      <ProGate lang={lang} dict={dict} storeId={storeId} requiredPlan="business" />
    );
  }

  const today = beirutDay(requestNow());
  const week = weekRange(requestNow());

  // Two reads of the same function on purpose. The sheet follows whatever range
  // the owner picks; the live board must be right whatever that range is, and
  // an open shift is at most auto_close_hours old — so yesterday and today
  // covers it, including the Monday morning when "this week" does not.
  const [sheetRes, boardRes, empRes] = await Promise.all([
    supabase.rpc("attendance_timesheet", {
      p_store_id: storeId,
      p_from: week.from,
      p_to: week.to,
    }),
    supabase.rpc("attendance_timesheet", {
      p_store_id: storeId,
      p_from: addDays(today, -1),
      p_to: today,
    }),
    supabase
      .from("store_employees")
      .select("id, name, shift_start, shift_end, work_days")
      .eq("store_id", storeId)
      .eq("status", "active")
      .order("name"),
  ]);

  const openRows = ((boardRes.data ?? []) as TimesheetRow[]).filter(
    (r) => !r.checked_out_at,
  );

  // The sheet cannot say who stepped out for a coffee — breaks are their own
  // rows (0266), readable by whoever manages the shop.
  const { data: breakData } = openRows.length
    ? await supabase
        .from("employee_breaks")
        .select("attendance_id, started_at")
        .is("ended_at", null)
        .in(
          "attendance_id",
          openRows.map((r) => r.id),
        )
    : { data: [] };

  const breakSince = new Map(
    ((breakData ?? []) as { attendance_id: string; started_at: string }[]).map(
      (b) => [b.attendance_id, b.started_at],
    ),
  );

  const openShifts: OpenShift[] = openRows
    .map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      checked_in_at: r.checked_in_at,
      break_since: breakSince.get(r.id) ?? null,
    }))
    // Longest on the clock first: that is the one closest to being auto-closed.
    .sort((a, b) => (a.checked_in_at < b.checked_in_at ? -1 : 1));

  const t = dict.os.hr as unknown as Record<string, string>;

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}/hr`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {t.attTitle}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.attSubtitle}</p>

        <div className="mt-6">
          <AttendanceManager
            storeId={storeId}
            lang={lang}
            initialRows={(sheetRes.data ?? []) as TimesheetRow[]}
            initialFrom={week.from}
            initialTo={week.to}
            openShifts={openShifts}
            employees={(empRes.data ?? []) as unknown as ShiftEmployee[]}
            graceMinutes={
              (store as unknown as { late_grace_minutes: number })
                .late_grace_minutes ?? 10
            }
            autoCloseHours={
              (store as unknown as { auto_close_hours: number })
                .auto_close_hours ?? 16
            }
            labels={{ ...t, error: dict.common.actionFailed }}
          />
        </div>
      </Container>
    </div>
  );
}
