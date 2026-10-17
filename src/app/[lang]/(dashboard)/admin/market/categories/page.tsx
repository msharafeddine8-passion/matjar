import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  MarketCategoryManager,
  type MarketCategoryRow,
} from "@/components/market-category-manager";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminMarketCategoriesPage({
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
    .from("market_categories")
    .select("id, slug, name_ar, name_en, sort_order, is_active")
    .order("sort_order", { ascending: true });
  const categories = (data ?? []) as MarketCategoryRow[];

  return (
    <MarketCategoryManager lang={lang} dict={dictSlice(dict, ["admin", "auth", "common"])} categories={categories} />
  );
}
