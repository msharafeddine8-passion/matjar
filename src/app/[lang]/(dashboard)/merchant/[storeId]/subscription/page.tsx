import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Crown, Check, Sparkles } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { RequestProButton } from "@/components/request-pro-button";
import { StartTrialButton } from "@/components/start-trial-button";
import { PLAN_TIERS, promoState, annualPrice, planRank } from "@/lib/plan-tiers";
import { planCopy } from "@/lib/plan-copy";
import { PLAN_HIGHLIGHTS } from "@/lib/feature-availability";
import { requestNow } from "@/lib/now";
import { Money } from "@/components/ui/money";
import { CardList, CardRow } from "@/components/ui/card";

// Single source of truth for Pro pricing (promo-aware): plan-tiers.
const PRO_PRICE_MONTHLY = PLAN_TIERS.pro.monthly;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreSubscriptionPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.merchant.subscription;

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
    .select("id, name, plan, owner_id, trial_ends_at")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  // Billing is owner-only (matches the registry's ownerOnly flag).
  if ((store as unknown as { owner_id: string }).owner_id !== user.id)
    redirect(`/${lang}/merchant/${storeId}`);
  // Read the RAW plan here (not the trial-collapsed effective plan): a store on
  // an active free trial is still on the free plan for billing, so we keep the
  // subscribe CTA visible and show a trial-countdown banner instead.
  const plan = (store as { plan: string }).plan;
  // Rank-based: a Business store is also "Pro or higher" — don't show it the
  // upgrade CTA. (planRank: free 0, basic 1, pro 2, business 3.)
  const isPro = planRank(plan) >= 2;
  /** Anything the merchant is actually paying for — Basic counts. */
  const isPaid = planRank(plan) >= 1;
  const planName =
    ({ basic: t.basic, pro: t.pro, business: t.business } as Record<
      string,
      string | undefined
    >)[plan] ?? t.free;
  const proYearly = annualPrice(PLAN_TIERS.pro, promoState(new Date()).active);
  const trialEndsAt =
    (store as { trial_ends_at: string | null }).trial_ends_at ?? null;
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const onTrial = !isPro && trialEnd != null && trialEnd > new Date();
  const trialDaysLeft = onTrial
    ? Math.max(
        1,
        Math.ceil((trialEnd!.getTime() - requestNow()) / (1000 * 60 * 60 * 24)),
      )
    : 0;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("store_id", storeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const expiresAt = (sub as { expires_at: string | null } | null)?.expires_at ?? null;

  const { data: paymentsData } = await supabase
    .from("payments")
    .select("id, amount, period, paid_at")
    .eq("store_id", storeId)
    .order("paid_at", { ascending: false });
  const payments = (paymentsData ?? []) as {
    id: string;
    amount: number;
    period: "monthly" | "yearly";
    paid_at: string;
  }[];

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

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
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t.title}</h1>

        {/* Current plan */}
        <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm text-muted-foreground">{t.currentPlan}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {/* Name the plan the store is actually on. This read `isPro ? pro
                : free`, which is a two-way answer to a four-way question: a
                store paying for Basic was told it was on Free and shown the
                upgrade pitch, and a Business store was called Pro. Being told
                you are not paying, on the page where you pay, is the worst
                place in the product to get this wrong. */}
            <span className="flex items-center gap-1.5 text-2xl font-extrabold">
              {isPaid && <Crown className="h-6 w-6 text-accent" />}
              {planName}
            </span>
            {isPaid && (
              <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success">
                {t.active}
              </span>
            )}
          </div>
          {isPaid && expiresAt && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t.expiresOn}: <span className="font-semibold text-foreground">{fmtDate(expiresAt)}</span>
            </p>
          )}
          {isPro && (
            <p className="mt-3 font-semibold text-primary">{t.proActive}</p>
          )}
        </div>

        {/* Never trialed (older store): offer the self-serve free trial — it
            activates instantly and starts counting, no admin approval. The
            title's {days} is TRIAL_DAYS, filled by plan-copy. */}
        {!isPaid && trialEndsAt === null && (
          <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-6">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-primary">
              <Sparkles className="h-5 w-5" />
              {planCopy(t.startTrialTitle)}
            </h2>
            <p className="mt-2 text-sm font-medium text-primary/80">
              {t.startTrialBody}
            </p>
            <StartTrialButton
              storeId={storeId}
              label={t.startTrialCta}
              busyLabel={t.startTrialBusy}
              errorLabel={dict.common.actionFailed}
            />
          </div>
        )}

        {/* Active free trial: Pro features are unlocked but billing is still
            free — nudge the owner to subscribe before the trial ends. */}
        {onTrial && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm font-semibold text-primary">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              {t.trialBanner.replace("{days}", String(trialDaysLeft))}
            </span>
          </div>
        )}

        {/* Paid upgrade CTA — shown during/after the trial (a never-trialed store
            sees the free-trial card above instead). */}
        {!isPro && trialEndsAt !== null && (
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning-soft p-6">
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <Crown className="h-5 w-5 text-accent" />
              {t.upgradeTitle}
            </h2>
            <p className="mt-2 text-sm text-warning/80">{t.upgradeBody}</p>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-warning">
                ${PRO_PRICE_MONTHLY}
              </span>
              <span className="text-sm font-semibold text-warning/70">
                {dict.pricing.perMonth}
              </span>
              <span className="text-sm font-bold text-warning">
                · ${proYearly}
                {dict.pricing.perYear}
              </span>
            </p>
            {/* Same list the /pricing Pro card shows, from the availability
                config — not the hand-written array this used to read, which
                promised unlimited products and a verified badge that paying has
                never granted. */}
            <ul className="mt-3 grid gap-1.5">
              {PLAN_HIGHLIGHTS.pro
                .filter((id) => id !== "products")
                .map((id) => (
                  <li
                    key={id}
                    className="flex items-start gap-2 text-sm font-medium text-warning"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {dict.pricing.features[id]}
                  </li>
                ))}
            </ul>
            <RequestProButton
              storeId={storeId}
              requestLabel={t.requestUpgrade}
              sentLabel={t.requestSent}
              phonePlaceholder={t.requestPhone}
            />
            <p className="mt-2 text-xs text-warning/70">{t.requestNote}</p>
          </div>
        )}

        {/* Payment history */}
        <h2 className="mb-3 mt-8 text-lg font-bold">{t.paymentsTitle}</h2>
        {payments.length ? (
          <CardList>
            {payments.map((p) => (
              <CardRow key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-semibold">{fmtDate(p.paid_at)}</span>
                <span className="text-muted-foreground">
                  {p.period === "yearly" ? t.yearly : t.monthly}
                </span>
                <span className="font-bold text-primary">
                  <Money value={p.amount} />
                </span>
              </CardRow>
            ))}
          </CardList>
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
            {t.noPayments}
          </div>
        )}
      </Container>
    </div>
  );
}
