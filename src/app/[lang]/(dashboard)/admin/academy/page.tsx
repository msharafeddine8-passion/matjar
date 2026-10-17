import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import type { GuideBlock } from "@/content/academy";
import {
  AdminAcademyClient,
  type GuideRow,
} from "@/components/admin-academy-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminAcademyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("academy", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_guides")
    .select(
      "id, slug, category, level, title, title_en, excerpt, read_min, emoji, blocks, published, sort_order",
    )
    .order("sort_order", { ascending: true });

  const rows = (data ?? []) as unknown as {
    id: string;
    slug: string;
    category: string;
    level: string;
    title: string;
    title_en: string | null;
    excerpt: string | null;
    read_min: number | null;
    emoji: string | null;
    blocks: GuideBlock[] | null;
    published: boolean;
    sort_order: number | null;
  }[];

  const guides: GuideRow[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    category: r.category,
    level: r.level,
    title: r.title,
    title_en: r.title_en ?? "",
    excerpt: r.excerpt ?? "",
    read_min: r.read_min ?? 0,
    emoji: r.emoji ?? "",
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    published: r.published,
    sort_order: r.sort_order ?? 0,
  }));

  return <AdminAcademyClient lang={lang} dict={dictSlice(dict, ["admin", "auth", "common", "hub"])} guides={guides} />;
}
