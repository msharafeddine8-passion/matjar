import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  AdminDemandClient,
  type DemandRequestRow,
  type DemandSummaryRow,
} from "./demand-admin-client";

// Unmet demand: zero-result searches (search_logs) and «ما لقيت يلي بدّك ياه»
// requests (demand_requests, migration 0306) side by side.
//
// Section 'growth' — merchant acquisition already lives there, and 0306's RLS,
// demand_summary() and set_demand_status() all gate on admin_can('growth'), so
// this page guard and the database agree about who may see a contact.
export default async function AdminDemandPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("growth", lang);
  const dict = await getDictionary(lang);
  const sp = await searchParams;
  const days = sp.days === "90" ? 90 : 30;

  const supabase = await createClient();
  const [summaryRes, recentRes] = await Promise.all([
    supabase.rpc("demand_summary", { p_days: days }),
    supabase
      .from("demand_requests")
      .select(
        "id, q, section, region, area, contact, contact_kind, note, status, user_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const summary = (summaryRes.data ?? []) as unknown as DemandSummaryRow[];
  const recent = ((recentRes.data ?? []) as unknown as (Omit<
    DemandRequestRow,
    "signedIn"
  > & { user_id: string | null })[]).map(({ user_id, ...r }) => ({
    ...r,
    // The id itself is not shown; only whether the person was signed in.
    signedIn: user_id !== null,
  }));

  return (
    <AdminDemandClient
      lang={lang}
      dict={dict}
      days={days}
      summary={summary}
      recent={recent}
      loadFailed={Boolean(summaryRes.error || recentRes.error)}
    />
  );
}
