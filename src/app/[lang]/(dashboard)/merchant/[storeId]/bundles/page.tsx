import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Package } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/staff-access";
import { Container } from "@/components/ui/container";
import { LoadError } from "@/components/load-error";
import {
  BundleManager,
  type Component,
  type BundleRow,
} from "@/components/bundle-manager";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreBundlesPage({
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
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  // Staff: the module's own permission (owner-only modules: the owner).
  await requireModuleAccess(supabase, storeId, "items", lang);

  // Every non-bundle product is a candidate component; bundles are the existing
  // is_bundle rows with their items.
  const { data: prodData, error: prodErr } = await supabase
    .from("products")
    .select("id, name, name_en, price, image_url, is_bundle")
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const all = (prodData ?? []) as unknown as {
    id: string;
    name: string;
    name_en: string | null;
    price: number;
    image_url: string | null;
    is_bundle: boolean;
  }[];

  const components: Component[] = all
    .filter((p) => !p.is_bundle)
    .map((p) => ({
      id: p.id,
      name: p.name,
      nameEn: p.name_en,
      price: Number(p.price),
    }));

  const bundleProducts = all.filter((p) => p.is_bundle);
  const { data: itemsData, error: itemsErr } = bundleProducts.length
    ? await supabase
        .from("bundle_items")
        .select("bundle_id, product_id, quantity, sort_order")
        .in(
          "bundle_id",
          bundleProducts.map((b) => b.id),
        )
        .order("sort_order", { ascending: true })
    : { data: [], error: null };
  const loadErr = prodErr ?? itemsErr;
  if (loadErr) console.error("[bundles] read failed", loadErr);
  const itemsByBundle: Record<
    string,
    { productId: string; quantity: number }[]
  > = {};
  for (const it of (itemsData ?? []) as {
    bundle_id: string;
    product_id: string;
    quantity: number;
  }[]) {
    (itemsByBundle[it.bundle_id] ??= []).push({
      productId: it.product_id,
      quantity: it.quantity,
    });
  }

  const bundles: BundleRow[] = bundleProducts.map((b) => ({
    id: b.id,
    name: b.name,
    nameEn: b.name_en,
    price: Number(b.price),
    imageUrl: b.image_url,
    items: itemsByBundle[b.id] ?? [],
  }));

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}/items`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Package className="h-7 w-7 text-primary" />
          {dict.merchant.bundles.title}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {dict.merchant.bundles.subtitle}
        </p>
        {loadErr ? (
          <LoadError title={dict.common.loadError} retryLabel={dict.common.reload} className="mt-8" />
        ) : (
          <div className="mt-8">
            <BundleManager
              storeId={storeId}
              lang={lang}
              dict={dictSlice(dict, ["common", "merchant"])}
              components={components}
              bundles={bundles}
            />
          </div>
        )}
      </Container>
    </div>
  );
}
