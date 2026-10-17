import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { BranchManager, type BranchRow } from "@/components/branch-manager";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreBranchesPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.branches;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id, branch_stock_separate")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  // Branches are an owner-only setting (matches the registry ownerOnly flag).
  if ((store as unknown as { owner_id: string }).owner_id !== user.id)
    redirect(`/${lang}/merchant/${storeId}`);
  // Multiple branches is a Business-plan feature.
  if (!isBusiness(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} requiredPlan="business" />;
  }

  const { data } = await supabase
    .from("store_locations")
    .select(
      "id, name, address, region, area, phone, whatsapp, lat, lng, is_primary, is_active, hours",
    )
    .eq("store_id", storeId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  const branches = (data ?? []) as BranchRow[];

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        <BranchManager
          storeId={storeId}
          lang={lang}
          dict={dictSlice(dict, ["common", "os"])}
          initial={branches}
          stockSeparate={
            (store as unknown as { branch_stock_separate: boolean | null })
              .branch_stock_separate ?? false
          }
        />
      </Container>
    </div>
  );
}
