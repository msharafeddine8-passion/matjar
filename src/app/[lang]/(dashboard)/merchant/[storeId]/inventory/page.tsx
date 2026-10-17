import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { LoadError } from "@/components/load-error";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  InventoryManager,
  type InventoryProduct,
  type Movement,
} from "@/components/inventory-manager";
import {
  ReceiveStockForm,
  type ReceivableProduct,
  type SupplierOption,
} from "@/components/receive-stock-form";
import { requireModuleAccess } from "@/lib/staff-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Inventory module of the Business OS: stock levels + movement ledger.
export default async function StoreInventoryPage({
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
  await requireModuleAccess(supabase, storeId, "inventory", lang);

  const [
    { data: productsData, error: productsErr },
    { data: movementsData, error: movementsErr },
    { data: supplierData, error: supplierErr },
    { count: branchCount },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, image_url, stock, low_stock_threshold")
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("stock_movements")
      .select("id, delta, reason, created_at, products(name)")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(20),
    // Receiving goods is where cost prices actually get filled in, so the
    // supplier list belongs on this screen rather than one module away.
    supabase
      .from("store_suppliers")
      .select("id, name")
      .eq("store_id", storeId)
      .order("name"),
    // ISS-023: every stock number on this screen is store-wide. A store with
    // more than one branch is told so rather than left to infer it.
    supabase
      .from("store_locations")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId),
  ]);
  // A failed read rendered as "no products / no movements" — shown as such a
  // merchant re-receives stock that is already there.
  const loadErr = productsErr ?? movementsErr ?? supplierErr;
  if (loadErr) console.error("[inventory] read failed", loadErr);

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
          {dict.os.inventory.title}
        </h1>

        {loadErr ? (
          <LoadError title={dict.common.loadError} retryLabel={dict.common.reload} className="mt-6" />
        ) : (
        <>
        <div className="mt-6">
          <ReceiveStockForm
            storeId={storeId}
            suppliers={(supplierData ?? []) as SupplierOption[]}
            products={(productsData ?? []) as ReceivableProduct[]}
            labels={{
              title: dict.os.inventory.receiveTitle,
              body: dict.os.inventory.receiveBody,
              supplier: dict.os.inventory.receiveSupplier,
              noSupplier: dict.os.inventory.receiveNoSupplier,
              note: dict.os.inventory.receiveNote,
              notePlaceholder: dict.os.inventory.receiveNotePlaceholder,
              product: dict.os.inventory.receiveProduct,
              qty: dict.os.inventory.receiveQty,
              pack: dict.os.inventory.receivePack,
              unitCost: dict.os.inventory.receiveUnitCost,
              units: dict.os.inventory.receiveUnits,
              addLine: dict.os.inventory.receiveAddLine,
              remove: dict.os.inventory.receiveRemove,
              total: dict.os.inventory.receiveTotal,
              submit: dict.os.inventory.receiveSubmit,
              saving: dict.os.inventory.receiveSaving,
              saved: dict.os.inventory.receiveSaved,
              needLine: dict.os.inventory.receiveNeedLine,
              error: dict.common.actionFailed,
            }}
          />
        </div>

        <div className="mt-6">
          <InventoryManager
            lang={lang as Locale}
            dict={dict}
            products={(productsData ?? []) as InventoryProduct[]}
            movements={(movementsData ?? []) as unknown as Movement[]}
            branchCount={branchCount ?? 0}
          />
        </div>
        </>
        )}
      </Container>
    </div>
  );
}
