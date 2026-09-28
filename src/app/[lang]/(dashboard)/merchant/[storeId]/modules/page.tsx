import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Blocks } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { toCategoryKey } from "@/lib/catalog";
import { featurePlanFloor } from "@/lib/feature-availability";
import { hasPlan, type StorePlan } from "@/lib/plan-tiers";
import { sectorDefaultModules } from "@/lib/sectors";
import { Container } from "@/components/ui/container";
import { ModulesManager, type ModuleItem } from "@/components/modules-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Merchant "Modules" page (owner-only). Shows the store's sector capabilities
// as on/off toggles. The store's ENABLED set = sector default bundle overlaid
// with store_modules overrides; the public store page + dashboard read it.
export default async function StoreModulesPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.modules;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id, plan, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  const s = store as unknown as {
    name: string;
    owner_id: string;
    plan: StorePlan | null;
    business_types: { slug: string } | null;
  };
  // Module management is an owner concern.
  if (s.owner_id !== user.id) redirect(`/${lang}/merchant/${storeId}`);

  const category = toCategoryKey(s.business_types?.slug, `store ${storeId}`);

  const { data: overridesData } = await supabase
    .from("store_modules")
    .select("module_key, enabled")
    .eq("store_id", storeId);
  const overrides: Record<string, boolean> = {};
  for (const r of (overridesData ?? []) as {
    module_key: string;
    enabled: boolean;
  }[]) {
    overrides[r.module_key] = r.enabled;
  }

  // Only the sector's own capabilities (not the whole 23-module catalog — that
  // would offer a clothing shop "courses"). Each defaults ON unless overridden.
  //
  // The lock comes from the availability registry's plan floor — the same
  // floor /pricing prints and the module's own screen enforces — not from a
  // tier field of its own. That field said "Pro" for inventory (a Business
  // screen) and for classes (open on every plan), so this page locked and
  // labelled modules differently from the screens behind them. hasPlan ranks
  // Business above Pro, so the top tier is never locked out of a Pro module.
  const items: ModuleItem[] = sectorDefaultModules(category).map((key) => {
    const floor = featurePlanFloor(key);
    return {
      key,
      floor,
      locked: floor !== "free" && !hasPlan(s.plan, floor),
      enabled: overrides[key] ?? true,
    };
  });

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {s.name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Blocks className="h-7 w-7 text-primary" />
          {t.heading}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subheading}</p>
        <div className="mt-6">
          <ModulesManager storeId={storeId} dict={dict} items={items} />
        </div>
      </Container>
    </div>
  );
}
