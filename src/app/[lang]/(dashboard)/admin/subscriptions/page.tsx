import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import type { StorePlan } from "@/lib/plan-tiers";
import { AdminSubsClient, type SubRow } from "@/components/admin-subs-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminSubscriptionsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("subscriptions", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data: storesData } = await supabase
    .from("stores")
    .select("id, name, plan")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const stores = (storesData ?? []) as {
    id: string;
    name: string;
    plan: StorePlan;
  }[];
  const ids = stores.map((s) => s.id);

  const subMap = new Map<string, { id: string; expiresAt: string | null }>();
  const payMap = new Map<string, number>();
  if (ids.length) {
    const [{ data: subs }, { data: pays }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("id, store_id, expires_at")
        .in("store_id", ids)
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      supabase.from("payments").select("store_id").in("store_id", ids),
    ]);
    for (const sub of (subs ?? []) as {
      id: string;
      store_id: string;
      expires_at: string | null;
    }[]) {
      if (!subMap.has(sub.store_id))
        subMap.set(sub.store_id, { id: sub.id, expiresAt: sub.expires_at });
    }
    for (const p of (pays ?? []) as { store_id: string }[]) {
      payMap.set(p.store_id, (payMap.get(p.store_id) ?? 0) + 1);
    }
  }

  const rows: SubRow[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    plan: s.plan,
    subId: subMap.get(s.id)?.id ?? null,
    expiresAt: subMap.get(s.id)?.expiresAt ?? null,
    payments: payMap.get(s.id) ?? 0,
  }));

  return <AdminSubsClient lang={lang} dict={dictSlice(dict, ["admin", "auth", "common"])} rows={rows} />;
}
