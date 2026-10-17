import { requestNow } from "@/lib/now";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { SITE_URL } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import {
  HrManager,
  type Employee,
  type PayrollRun,
} from "@/components/hr-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// People, hours and pay.
//
// Owner-only, and not because of plan tiers: this screen shows every salary in
// the shop. The per-module staff permissions have no notion of "may see what
// everyone earns", and inventing one by reusing the products permission would
// hand it to the wrong people.
export default async function StoreHrPage({
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
    .select("id, name, owner_id, short_code, lat, lng, clock_radius_m")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  if ((store as unknown as { owner_id: string }).owner_id !== user.id) {
    redirect(`/${lang}/merchant/${storeId}`);
  }

  if (!isBusiness(await getStorePlan(storeId))) {
    return (
      <ProGate lang={lang} dict={dict} storeId={storeId} requiredPlan="business" />
    );
  }

  const [{ data: empData }, { data: openShifts }, { data: runData }] =
    await Promise.all([
      supabase
        .from("store_employees")
        .select(
          "id, name, phone, job_title, pay_basis, pay_rate, pay_currency, id_number, residency_expires_on, status, employee_devices(id, label, last_used_at)",
        )
        .eq("store_id", storeId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("employee_attendance")
        .select("employee_id")
        .eq("store_id", storeId)
        .is("checked_out_at", null),
      supabase
        .from("payroll_runs")
        .select(
          "id, period_start, period_end, status, total_usd, total_lbp, payroll_lines(employee_name, pay_basis, currency, days_worked, minutes_worked, gross, advances, net)",
        )
        .eq("store_id", storeId)
        .order("period_end", { ascending: false })
        .limit(6),
    ]);

  const onShift = new Set(
    ((openShifts ?? []) as { employee_id: string }[]).map((r) => r.employee_id),
  );

  const employees: Employee[] = (
    (empData ?? []) as unknown as (Omit<Employee, "on_shift"> & {
      employee_devices: Employee["devices"];
    })[]
  ).map(({ employee_devices, ...e }) => ({
    ...e,
    devices: employee_devices ?? [],
    on_shift: onShift.has(e.id),
  }));

  const runs = ((runData ?? []) as unknown as (Omit<PayrollRun, "lines"> & {
    payroll_lines: PayrollRun["lines"];
  })[]).map(({ payroll_lines, ...r }) => ({
    ...r,
    lines: payroll_lines ?? [],
  }));

  // Thirty days out, stamped once here: a permit that lapses next month is a
  // problem the shop has now, not when the inspector arrives.
  const cutoff = new Date(requestNow() + 30 * 864e5).toISOString().slice(0, 10);

  const t = dict.os.hr as unknown as Record<string, string>;

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
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {/* The hours live on their own screen: this one answers "who works here
            and what do I owe", and the sheet answers "was Tuesday really four
            hours" — a different question, asked with a row in front of you. */}
        <ButtonLink
          href={`/${lang}/merchant/${storeId}/attendance`}
          variant="outline"
          size="sm"
          className="mt-4"
        >
          <Clock className="h-4 w-4" />
          {t.attLink}
        </ButtonLink>

        <div className="mt-6">
          <HrManager
            storeId={storeId}
            residencyCutoff={cutoff}
            clockLink={`${SITE_URL}/${lang}/clock/${(store as unknown as { short_code: string }).short_code}`}
            clockRadius={
              (store as unknown as { clock_radius_m: number }).clock_radius_m
            }
            storeHasPin={
              (store as unknown as { lat: number | null }).lat != null
            }
            // Read on the server, where the key lives. Without it every punch
            // and every enrolment fails, and the failure surfaces on the
            // employee's phone as "wrong code" — so the owner is the last to
            // find out, from the one person who cannot explain it.
            clockConfigured={!!process.env.SUPABASE_SERVICE_ROLE_KEY}
            employees={employees}
            runs={runs}
            labels={{ ...t, error: dict.common.actionFailed, save: t.save }}
            lang={lang}
          />
        </div>
      </Container>
    </div>
  );
}
