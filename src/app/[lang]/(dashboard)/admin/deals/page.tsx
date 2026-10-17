import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  AdminDealsClient,
  type DealRow,
} from "@/components/admin-deals-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminDealsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("deals", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const [{ data: flashData }, { data: clearanceData }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, price, flash_price, flash_start, flash_end, in_clearance, stores(name)",
      )
      .not("flash_price", "is", null)
      .order("flash_end", { ascending: true })
      .limit(200),
    supabase
      .from("products")
      .select(
        "id, name, price, flash_price, flash_start, flash_end, in_clearance, stores(name)",
      )
      .eq("in_clearance", true)
      .limit(200),
  ]);

  type ProductRow = {
    id: string;
    name: string;
    price: number;
    flash_price: number | null;
    flash_start: string | null;
    flash_end: string | null;
    in_clearance: boolean;
    stores: { name: string } | null;
  };

  const flashRows = (flashData ?? []) as unknown as ProductRow[];
  const clearanceRows = (clearanceData ?? []) as unknown as ProductRow[];

  // Merge + dedupe (a product can be both a flash offer and in clearance).
  const byId = new Map<string, ProductRow>();
  for (const r of [...flashRows, ...clearanceRows]) byId.set(r.id, r);

  const rows: DealRow[] = Array.from(byId.values()).map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    flashPrice: r.flash_price == null ? null : Number(r.flash_price),
    flashEnd: r.flash_end,
    inClearance: Boolean(r.in_clearance),
    store: r.stores?.name ?? null,
  }));

  return <AdminDealsClient lang={lang} dict={dictSlice(dict, ["admin", "common"])} rows={rows} />;
}
