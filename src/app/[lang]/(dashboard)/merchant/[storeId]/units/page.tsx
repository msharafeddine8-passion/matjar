import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BedDouble } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/staff-access";
import { Container } from "@/components/ui/container";
import { UnitManager, type UnitRow } from "@/components/unit-manager";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreUnitsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.units;

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
    .select("name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  // Staff: the module's own permission (owner-only modules: the owner).
  await requireModuleAccess(supabase, storeId, "units", lang);

  const { data } = await supabase
    .from("accommodation_units")
    .select(
      "id, name, unit_type, max_guests, bedrooms, bathrooms, base_nightly_price, weekend_price, min_nights, cleaning_fee, security_deposit, active",
    )
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const units = (data ?? []) as UnitRow[];

  return (
    <div className="py-10">
      <Container className="max-w-5xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <BedDouble className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>
        <UnitManager storeId={storeId} dict={dictSlice(dict, ["auth", "catalogItem", "common", "os"])} initial={units} />
      </Container>
    </div>
  );
}
