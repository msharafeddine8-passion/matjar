import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { getUsdLbpRate } from "@/lib/data/settings";
import {
  bodiesOf,
  loadLastSent,
  loadWaTemplates,
} from "@/lib/wa-actions-server";
import {
  ABANDONED_MAX_AGE_MS,
  isAbandonedCart,
  priceCart,
  usableCoupons,
  type CartLine,
  type CatalogueProduct,
  type CouponRow,
} from "@/lib/wa-templates";
import {
  AbandonedCartsList,
  type AbandonedCart,
} from "@/components/wa-actions/abandoned-carts-list";

// سلات متروكة — customers who tapped «تأكيد الطلب» and whose order never
// arrived. Every plan (FEATURES.whatsappActions). Staff need the `orders`
// permission: it is the key checkout_intents has been readable under since
// 0291, so the screen opens for exactly the people the database lets read the
// rows. The owner always passes.
//
// The list comes from public.store_abandoned_carts (0309). Until 0309 is
// applied that function does not exist, and the same rule (lib/wa-templates
// isAbandonedCart / priceCart) is applied here to checkout_intents + orders
// read under the caller's own RLS — so the screen works either way.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcRow = {
  id: string;
  phone: string;
  customer_name: string | null;
  customer_id: string | null;
  items: CartLine[] | null;
  item_count: number;
  total_estimate: number | string;
  unpriced_items: number;
  created_at: string;
  updated_at: string;
  last_wa_at: string | null;
};

type IntentRow = {
  id: string;
  phone: string;
  customer_name: string | null;
  customer_id: string | null;
  items: unknown;
  created_at: string;
  updated_at: string;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The list: public.store_abandoned_carts (0309), or — before 0309 is applied
 *  — the same rule computed here from checkout_intents + orders under the
 *  caller's own RLS. Outside the component: it reads the clock. */
async function loadAbandonedCarts(
  supabase: Supabase,
  storeId: string,
): Promise<{ carts: AbandonedCart[]; fallback: boolean; loadFailed: boolean }> {
  let carts: AbandonedCart[] = [];
  let fallback = false;
  let loadFailed = false;

  const rpc = await supabase.rpc("store_abandoned_carts", { p_store_id: storeId });
  if (!rpc.error) {
    carts = ((rpc.data ?? []) as RpcRow[]).map((r) => ({
      id: r.id,
      phone: r.phone,
      customerName: r.customer_name,
      lines: (r.items ?? []).map((l) => ({ ...l, unit_price: l.unit_price == null ? null : Number(l.unit_price) })),
      itemCount: r.item_count,
      totalEstimate: Number(r.total_estimate),
      unpriced: r.unpriced_items,
      updatedAt: r.updated_at,
      lastWaAt: r.last_wa_at,
    }));
  } else {
    // Before 0309: the same rule, computed here under the caller's RLS.
    fallback = true;
    const since = new Date(Date.now() - ABANDONED_MAX_AGE_MS).toISOString();
    const { data: intentData, error: intentErr } = await supabase
      .from("checkout_intents")
      .select("id, phone, customer_name, customer_id, items, created_at, updated_at")
      .eq("store_id", storeId)
      .gt("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (intentErr) {
      loadFailed = true;
    } else {
      const intents = (intentData ?? []) as IntentRow[];
      const oldest = intents.reduce<string | null>(
        (m, i) => (!m || i.updated_at < m ? i.updated_at : m),
        null,
      );
      const { data: orderData } = oldest
        ? await supabase
            .from("orders")
            .select("phone, created_at")
            .eq("store_id", storeId)
            .gte("created_at", oldest)
            .limit(5000)
        : { data: [] as { phone: string | null; created_at: string }[] };
      const orders = (orderData ?? []) as { phone: string | null; created_at: string }[];
      const now = new Date();
      const open = intents.filter((i) => isAbandonedCart(i, orders, now));

      const ids = new Set<string>();
      for (const i of open) {
        for (const it of Array.isArray(i.items) ? i.items : []) {
          const pid = (it as { product_id?: unknown })?.product_id;
          if (typeof pid === "string" && UUID_RE.test(pid)) ids.add(pid);
        }
      }
      const products = new Map<string, CatalogueProduct>();
      if (ids.size) {
        const { data: prodData } = await supabase
          .from("products")
          .select("id, name, name_en, price, discount_price, is_available")
          .eq("store_id", storeId)
          .is("deleted_at", null)
          .in("id", [...ids]);
        for (const p of (prodData ?? []) as CatalogueProduct[]) products.set(p.id, p);
      }
      const lastSent = await loadLastSent(supabase, storeId, "cart", open.map((i) => i.id));
      carts = open.map((i) => {
        const priced = priceCart(i.items, products);
        return {
          id: i.id,
          phone: i.phone,
          customerName: i.customer_name,
          lines: priced.lines,
          itemCount: priced.itemCount,
          totalEstimate: priced.totalEstimate,
          unpriced: priced.unpriced,
          updatedAt: i.updated_at,
          lastWaAt: lastSent[`${i.id}:abandoned_cart`] ?? null,
        };
      });
    }
  }

  return { carts, fallback, loadFailed };
}

export default async function AbandonedCartsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.waActions;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: storeData } = await supabase
    .from("stores")
    .select("id, name, slug, owner_id")
    .eq("id", storeId)
    .maybeSingle();
  if (!storeData) redirect(`/${lang}/merchant`);
  const store = storeData as { id: string; name: string; slug: string | null; owner_id: string };

  if (store.owner_id !== user.id) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms = (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.orders ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  // ---- The list ----------------------------------------------------------
  const { carts, fallback, loadFailed } = await loadAbandonedCarts(supabase, storeId);

  // ---- What the reminder needs -------------------------------------------
  const [waTemplates, rate, couponRes] = await Promise.all([
    loadWaTemplates(supabase, storeId),
    getUsdLbpRate(),
    supabase
      .from("coupons")
      .select("code, is_active, expires_at, max_uses, used_count")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const coupons = usableCoupons((couponRes.data ?? []) as CouponRow[]).map((c) => c.code);

  return (
    <div className="py-6 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}/orders`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.merchant.ordersTitle}
        </Link>
        <AutoRefresh />
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t.carts.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t.carts.subtitle}</p>

        <AbandonedCartsList
          uiLang={lang}
          storeId={storeId}
          storeName={store.name}
          storeSlug={store.slug}
          carts={carts}
          coupons={coupons}
          rate={rate}
          bodies={bodiesOf(waTemplates.templates, "abandoned_cart")}
          fallback={fallback}
          loadFailed={loadFailed}
          t={t}
        />
      </Container>
    </div>
  );
}
