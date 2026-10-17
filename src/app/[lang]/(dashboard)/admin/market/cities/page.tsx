import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { getMarketRegions } from "@/lib/data/market";
import {
  MarketCityManager,
  type MarketCityRow,
} from "@/components/market-city-manager";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminMarketCitiesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("market", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const [{ data }, regions] = await Promise.all([
    supabase
      .from("market_cities")
      .select("id, region, name_ar, name_en, sort_order, is_active")
      .order("region", { ascending: true })
      .order("sort_order", { ascending: true }),
    getMarketRegions(lang),
  ]);
  const cities = (data ?? []) as MarketCityRow[];

  return (
    <MarketCityManager
      lang={lang}
      dict={dictSlice(dict, ["admin", "common"])}
      cities={cities}
      regions={regions}
    />
  );
}
