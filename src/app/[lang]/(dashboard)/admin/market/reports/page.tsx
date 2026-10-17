import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  AdminMarketReportsClient,
  type AdminReport,
} from "@/components/admin-market-reports-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminMarketReportsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("market", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("listing_reports")
    .select("id, listing_id, reason, status, created_at, listings(title)")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(300);

  const rows = (data ?? []) as unknown as {
    id: string;
    listing_id: string;
    reason: string;
    status: "open" | "reviewed";
    created_at: string;
    listings: { title: string } | null;
  }[];

  const reports: AdminReport[] = rows.map((r) => ({
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listings?.title ?? "—",
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at,
  }));

  return (
    <AdminMarketReportsClient lang={lang} dict={dictSlice(dict, ["admin", "common", "market", "moderation"])} reports={reports} />
  );
}
