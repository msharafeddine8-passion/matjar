import Link from "next/link";
import { Gift, Stamp } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { CouponManager, type Coupon } from "@/components/coupon-manager";
import { ChevronPrev } from "@/components/ui/directional-icon";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreCouponsPage({
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

  // Owner-only.
  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isPro(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }

  const { data: couponsData } = await supabase
    .from("coupons")
    .select("id, code, type, value, min_order, expires_at, max_uses, used_count, is_active, once_per_customer")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  const coupons = (couponsData ?? []) as Coupon[];

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
          {dict.merchant.coupons.title}
        </h1>
        <div className="mt-6">
          <CouponManager storeId={storeId} dict={dict} coupons={coupons} />
        </div>
        {/* Loyalty card + gift cards (0310) sit beside coupons: the same
            owner, the same Pro floor, the same "bring them back" job. */}
        <nav aria-label={dict.loyaltyCards.nav.heading} className="mt-8 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["loyalty", Stamp, dict.loyaltyCards.nav.loyalty, dict.loyaltyCards.nav.loyaltyHint],
              ["gift-cards", Gift, dict.loyaltyCards.nav.gift, dict.loyaltyCards.nav.giftHint],
            ] as const
          ).map(([path, Icon, label, hint]) => (
            <Link
              key={path}
              href={`/${lang}/merchant/${storeId}/${path}`}
              className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-primary/40"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-bold">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </Link>
          ))}
        </nav>
      </Container>
    </div>
  );
}
