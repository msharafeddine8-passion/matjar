import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import {
  AutomationManager,
  type AutomationRow,
  type RunRow,
  type LocationOption,
} from "@/components/automation-manager";
import { requireModuleAccess } from "@/lib/staff-access";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Automations module of the Business OS — a no-code "when this, do that" builder.
// Pro-only, and (like reports/CRM) staff need the orders permission.
export default async function StoreAutomationsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.automations;

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
    .select("id, name, owner_id")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isBusiness(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} requiredPlan="business" />;
  }

  // Staff: the permission the module's own tables check (requireModuleAccess).
  await requireModuleAccess(supabase, storeId, "automations", lang);

  const [{ data: autosData }, { data: runsData }, { data: locsData }] =
    await Promise.all([
      supabase
        .from("automations")
        .select("id, name, trigger, conditions, actions, enabled, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("automation_runs")
        .select("id, automation_id, trigger, status, detail, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("store_locations")
        .select("id, name, region, is_active, is_primary")
        .eq("store_id", storeId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true }),
    ]);

  const automations = (autosData ?? []) as unknown as AutomationRow[];
  const runs = (runsData ?? []) as unknown as RunRow[];
  const locations = ((locsData ?? []) as unknown as {
    id: string;
    name: string | null;
    region: string | null;
    is_active: boolean;
  }[])
    .filter((l) => l.is_active)
    .map((l) => ({ id: l.id, name: l.name, region: l.region }) as LocationOption);

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-info text-white shadow-sm shadow-primary/30">
            <Zap className="h-5 w-5" />
          </span>
          {t.title}
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground">{t.subtitle}</p>

        <AutomationManager
          storeId={storeId}
          storeName={(store as { name: string }).name}
          lang={lang}
          dict={dictSlice(dict, ["common", "os"])}
          initial={automations}
          runs={runs}
          locations={locations}
        />
      </Container>
    </div>
  );
}
