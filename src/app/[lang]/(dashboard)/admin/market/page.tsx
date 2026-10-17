import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  AdminMarketClient,
  type AdminListing,
} from "@/components/admin-market-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminMarketPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("market", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const [{ data }, { count: openReports }] = await Promise.all([
    supabase
      .from("listings")
      .select(
        "id, title, price, city, region, status, is_featured, images, views, created_at, stores(name)",
      )
      // The admin select policy deliberately still shows removed rows so
      // they can be restored; the queue is the working list, not the archive.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("listing_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    price: number;
    city: string | null;
    region: string | null;
    status: AdminListing["status"];
    is_featured: boolean;
    images: string[] | null;
    views: number;
    created_at: string;
    stores: { name: string } | null;
  }[];

  const listings: AdminListing[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    price: Number(r.price),
    city: r.city,
    region: r.region,
    status: r.status,
    isFeatured: r.is_featured,
    image: Array.isArray(r.images) && r.images.length ? r.images[0] : null,
    storeName: r.stores?.name ?? null,
    views: r.views ?? 0,
    createdAt: r.created_at,
  }));

  return (
    <AdminMarketClient
      lang={lang}
      dict={dictSlice(dict, ["admin", "common", "moderation"])}
      listings={listings}
      openReports={openReports ?? 0}
    />
  );
}
