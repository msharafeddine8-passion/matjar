import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { formatUsd } from "@/lib/currency";
import { SITE_URL } from "@/lib/site";
import { beirutToday } from "@/lib/quick-panel";
import {
  PosTerminal,
  type PosProduct,
  type PosCustomer,
  type PosLocation,
} from "@/components/pos-terminal";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fmt(n: number) {
  return formatUsd(n, { cents: true });
}

// POS module of the Business OS: record in-store sales against the catalog.
export default async function StorePosPage({
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
    .select("id, name, owner_id")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isPro(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }

  // Staff need the orders permission to sell.
  const isOwner =
    (store as unknown as { owner_id: string }).owner_id === user.id;
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms =
      (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.orders ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  // Beirut's day, not the server's: on Vercel setHours(0) is UTC midnight, so
  // a sale rung up between 00:00 and 03:00 Beirut used to count as yesterday.
  const startOfToday = beirutToday(new Date()).start;
  const [
    { data: productsData },
    { data: customersData },
    { data: todayData },
    { data: locationsData },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price, discount_price, image_url, stock")
      .eq("store_id", storeId)
      .eq("is_available", true)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("store_customers")
      .select("id, name")
      .eq("store_id", storeId)
      .order("name"),
    supabase
      .from("pos_sales")
      .select("total")
      .eq("store_id", storeId)
      .gte("created_at", startOfToday.toISOString()),
    // Branches for the sale stamp — primary first so it's the default pick.
    supabase
      .from("store_locations")
      .select("id, name, area")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("is_primary", { ascending: false }),
  ]);

  // Loyalty phone + gift-card code at the till (0310). Both reads fail softly
  // before the migration is applied, and the till then renders as before.
  const [{ data: programRow }, { data: acceptsGift, error: giftErr }] = await Promise.all([
    supabase.from("loyalty_programs").select("kind, is_active").eq("store_id", storeId).maybeSingle(),
    supabase.rpc("store_accepts_gift_cards", { p_store_id: storeId }),
  ]);
  const program = programRow as { kind: "stamps" | "points"; is_active: boolean } | null;

  const todaySales = (todayData ?? []) as { total: number }[];
  const todayTotal = todaySales.reduce((s, r) => s + Number(r.total), 0);

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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {dict.os.pos.title}
          </h1>
          <span className="flex items-center gap-2 rounded-full bg-primary-soft px-4 py-1.5 text-sm font-bold text-primary">
            <ReceiptText className="h-4 w-4" />
            {dict.os.pos.todaySales}: {todaySales.length} · {fmt(todayTotal)}
          </span>
        </div>

        <div className="mt-6">
          <PosTerminal
            storeId={storeId}
            dict={dict}
            products={(productsData ?? []) as PosProduct[]}
            customers={(customersData ?? []) as PosCustomer[]}
            locations={(locationsData ?? []) as PosLocation[]}
            extras={{
              loyalty: program?.is_active ? program.kind : null,
              giftCards: !giftErr && acceptsGift === true,
              lang,
              storeName: (store as { name: string }).name,
              siteUrl: SITE_URL,
            }}
          />
        </div>
      </Container>
    </div>
  );
}
