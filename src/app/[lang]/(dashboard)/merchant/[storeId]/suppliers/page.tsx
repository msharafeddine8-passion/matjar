import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { LoadError } from "@/components/ui/load-error";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  SuppliersManager,
  type SupplierRow,
  type SupplierTx,
} from "@/components/suppliers-manager";
import { requireModuleAccess } from "@/lib/staff-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Suppliers module of the Business OS: supplier book + debt ledger.
export default async function StoreSuppliersPage({
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
  await requireModuleAccess(supabase, storeId, "suppliers", lang);

  const [
    { data: suppliersData, error: suppliersErr },
    { data: txData, error: txErr },
  ] = await Promise.all([
    supabase
      .from("store_suppliers")
      .select("id, name, phone, notes")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("supplier_transactions")
      .select("id, supplier_id, kind, label, amount, happened_on")
      .eq("store_id", storeId)
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  // A failed read showed "no suppliers, nothing owed" — not the same thing.
  const loadErr = suppliersErr ?? txErr;
  if (loadErr) console.error("[suppliers] read failed", loadErr);

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
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.os.suppliers.title}
        </h1>

        {loadErr ? (
          <LoadError message={dict.common.loadError} className="mt-6" />
        ) : (
        <div className="mt-6">
          <SuppliersManager
            storeId={storeId}
            lang={lang as Locale}
            dict={dict}
            suppliers={(suppliersData ?? []) as SupplierRow[]}
            transactions={(txData ?? []) as SupplierTx[]}
          />
        </div>
        )}
      </Container>
    </div>
  );
}
