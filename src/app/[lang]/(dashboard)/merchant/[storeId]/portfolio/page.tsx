import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  PortfolioManager,
  type PortfolioItem,
} from "@/components/portfolio-manager";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StorePortfolioPage({
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

  const { data: rowsData } = await supabase
    .from("store_portfolio")
    .select("id, title, title_en, description, image_url, link")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const items = (rowsData ?? []) as PortfolioItem[];

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.portfolio.title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {dict.portfolio.subtitle}
        </p>
        <div className="mt-6">
          <PortfolioManager
            storeId={storeId}
            lang={lang}
            dict={dictSlice(dict, ["auth", "catalogItem", "common", "merchant", "portfolio"])}
            items={items}
          />
        </div>
      </Container>
    </div>
  );
}
