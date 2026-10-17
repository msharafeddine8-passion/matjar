import { requestNow } from "@/lib/now";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import {
  CampaignManager,
  type CampaignRow,
} from "@/components/campaign-manager";
import { requireModuleAccess } from "@/lib/staff-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Marketing Campaigns module of the Business OS — blast an offer/announcement to
// the store's followers + past customers as an in-app notification + web push.
// Pro-only, and (like automations/reports) staff need the orders permission.
export default async function StoreCampaignsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.campaigns;

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
  if (!isBusiness(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} requiredPlan="business" />;
  }

  // Staff: the permission the module's own tables check (requireModuleAccess).
  await requireModuleAccess(supabase, storeId, "campaigns", lang);

  // Recent campaigns + audience counts. Follower/customer id sets are fetched
  // (capped, matching the RPC's 5000 send cap) so we can show accurate live
  // recipient counts for the three audiences, including the deduped union.
  const [{ data: campData }, { data: followData }, { data: custData }] =
    await Promise.all([
      supabase
        .from("store_campaigns")
        .select("id, title, body, url, audience, sent_count, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("follows")
        .select("user_id")
        .eq("store_id", storeId)
        .limit(5000),
      supabase
        .from("orders")
        .select("customer_id, created_at")
        .eq("store_id", storeId)
        .not("customer_id", "is", null)
        .limit(5000),
    ]);

  const campaigns = (campData ?? []) as unknown as CampaignRow[];

  const followers = new Set(
    ((followData ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  // Per-customer order stats → behavioural segment sizes (matches the RPC's
  // 0164 definitions: repeat 2+, vip 3+, inactive last order > 60 days ago).
  const stats = new Map<string, { count: number; last: string }>();
  for (const o of (custData ?? []) as {
    customer_id: string;
    created_at: string;
  }[]) {
    const s = stats.get(o.customer_id);
    if (s) {
      s.count += 1;
      if (o.created_at > s.last) s.last = o.created_at;
    } else {
      stats.set(o.customer_id, { count: 1, last: o.created_at });
    }
  }
  const customers = new Set(stats.keys());
  const all = new Set<string>([...followers, ...customers]);
  const inactiveBefore = requestNow() - 60 * 24 * 60 * 60 * 1000;
  let repeat = 0;
  let vip = 0;
  let inactive = 0;
  for (const s of stats.values()) {
    if (s.count >= 2) repeat += 1;
    if (s.count >= 3) vip += 1;
    if (new Date(s.last).getTime() < inactiveBefore) inactive += 1;
  }
  const counts = {
    followers: followers.size,
    customers: customers.size,
    all: all.size,
    repeat,
    vip,
    inactive,
  };

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-info text-white shadow-sm shadow-primary/30">
            <Megaphone className="h-5 w-5" />
          </span>
          {t.title}
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground">{t.subtitle}</p>

        <CampaignManager
          storeId={storeId}
          lang={lang}
          dict={dict}
          initial={campaigns}
          counts={counts}
        />
      </Container>
    </div>
  );
}
