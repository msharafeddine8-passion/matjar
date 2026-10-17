import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { labelFor } from "@/lib/status-labels";
import { regions } from "@/lib/catalog";
import {
  AdminModerationClient,
  type ModerationItem,
} from "@/components/admin-moderation-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminWholesalePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("wholesale", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("wholesale_products")
    .select(
      "id, title, seller_name, category, unit, moq, price, region, image_url, status, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    seller_name: string | null;
    category: string | null;
    unit: string | null;
    moq: number | null;
    price: number | null;
    region: string | null;
    image_url: string | null;
    status: string;
    created_at: string;
  }[];

  // Both translated on the public listing page; the moderation queue was
  // joining the raw columns, so an Arabic reviewer read "cosmetics · north".
  // `unit` stays as typed — it is merchant free text (carton / kg / …), not an
  // enum, and translating a merchant's own word would be putting words in it.
  const regionName = (key: string | null) =>
    key ? (regions.find((x) => x.key === key)?.name[lang] ?? key) : null;

  const items: ModerationItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.seller_name,
    meta:
      [
        labelFor(dict, "wholesaleCategory", r.category),
        regionName(r.region),
        r.price != null ? `$${r.price}${r.unit ? `/${r.unit}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    image: r.image_url,
    status: r.status,
    createdAt: r.created_at,
  }));

  return (
    <AdminModerationClient
      lang={lang}
      dict={dictSlice(dict, ["admin", "common"])}
      table="wholesale_products"
      title={dict.admin.wholesale.title}
      subtitle={dict.admin.wholesale.subtitle}
      viewBase="wholesale"
      items={items}
    />
  );
}
