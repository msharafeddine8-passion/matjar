import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { AdminPagesClient, type PageRow } from "@/components/admin-pages-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminPagesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("pages", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("site_pages")
    .select("id, slug, title, title_en, body, published")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as {
    id: string;
    slug: string;
    title: string;
    title_en: string | null;
    body: string | null;
    published: boolean;
  }[];

  const pages: PageRow[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    title_en: r.title_en ?? "",
    body: r.body ?? "",
    published: r.published,
  }));

  return <AdminPagesClient lang={lang} dict={dictSlice(dict, ["admin", "auth", "common"])} pages={pages} />;
}
