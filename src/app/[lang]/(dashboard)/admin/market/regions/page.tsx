import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  MarketRegionManager,
  type MarketRegionRow,
} from "@/components/market-region-manager";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminMarketRegionsPage({
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
    .from("market_regions")
    .select("id, key, name_ar, name_en, sort_order, is_active")
    .order("sort_order", { ascending: true });
  const regions = (data ?? []) as MarketRegionRow[];

  return <MarketRegionManager lang={lang} dict={dictSlice(dict, ["admin", "common"])} regions={regions} />;
}
