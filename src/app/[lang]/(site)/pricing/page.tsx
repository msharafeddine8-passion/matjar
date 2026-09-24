import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { getUsdLbpRate } from "@/lib/data/settings";
import { localeAlternates } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { PricingPlans } from "@/components/pricing-plans";
import { FeatureRoadmap } from "@/components/feature-roadmap";
import { PLAN_ORDER, PLAN_TIERS, promoState, type PlanKey } from "@/lib/plan-tiers";
import { TRIAL_DAYS } from "@/lib/plan";
import { fillPlanCopy, planCopy, planCopyVars } from "@/lib/plan-copy";
import { PRICING_MATRIX, matrixCell, type FeatureId } from "@/lib/feature-availability";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const title = lang === "ar" ? "الأسعار والخطط" : "Pricing & plans";
  // The trial length is a plan fact, so it is filled from plan.ts like every
  // other plan number in copy (see lib/plan-copy.ts) — not typed in here.
  const description = planCopy(
    lang === "ar"
      ? "ثلاث خطط تناسب كل مرحلة — أساسية، احترافية، وأعمال. 0% عمولة على المبيعات، وتجربة مجانية {days} يوم."
      : "Three plans for every stage — Basic, Pro, and Business. 0% commission on sales, with a {days}-day free trial.",
  );
  return { title, description, alternates: localeAlternates(lang, "/pricing") };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // CTA routing: an existing merchant lands on their store's subscription page;
  // a new/guest user gets the open-a-store path (store creation stays free).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let ctaHref = `/${lang}/signup`;
  if (user) {
    const { data: store } = await supabase
      .from("stores")
      .select("id")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    ctaHref = store
      ? `/${lang}/merchant/${(store as { id: string }).id}/subscription`
      : `/${lang}/merchant/new`;
  }

  const lbpRate = await getUsdLbpRate();
  // Reading cookies above makes this route dynamic, so `new Date()` is per
  // request — the promo flips off automatically after PROMO_END.
  const now = new Date();
  const { active: promoActive, daysLeft } = promoState(now);
  const t = dict.pricing;

  // The FAQ names the promo prices, the trial length and the Basic product cap.
  // None of those numbers live in the dictionary any more: the strings carry
  // placeholders and plan-copy fills them from PLAN_TIERS / TRIAL_DAYS, promo-
  // resolved for this request — so the FAQ cannot drift from the cards above.
  // An answer that quotes the promo prices only makes sense while the promo is
  // running (it points at "the countdown above"), so it is dropped after PROMO_END.
  const copyVars = planCopyVars(now);
  const faq = t.faq
    .filter((f) => promoActive || !/\{(basic|pro|business)Annual\}/.test(f.a))
    .map((f) => ({ q: fillPlanCopy(f.q, copyVars), a: fillPlanCopy(f.a, copyVars) }));

  // Every cell is computed, never typed in. Ticks come from the plan floor the
  // merchant screens actually enforce (feature-availability.ts checks each floor
  // against OS_MODULE_META.minPlan), and the numbers come straight out of
  // PLAN_TIERS — so the table cannot contradict the price cards above it or the
  // lock a merchant meets in their dashboard.
  const cell = (id: FeatureId, plan: PlanKey) => {
    const c = matrixCell(id, plan);
    if (c.kind === "included")
      return <Check className="mx-auto h-4 w-4 text-primary" />;
    if (c.kind === "excluded")
      return <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />;
    if (c.kind === "count")
      return (
        <span className="font-semibold">
          {c.value === null ? t.unlimited : c.value}
        </span>
      );
    return (
      <span className="font-semibold">
        {c.token === "zero" ? "0%" : t.support[c.token]}
      </span>
    );
  };

  return (
    <div className="py-10 sm:py-16">
      <Container>
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">{t.title}</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t.subtitle}
          </p>
        </div>

        <div className="mt-10">
          <PricingPlans
            lang={lang}
            dict={dict}
            plans={PLAN_TIERS}
            promoActive={promoActive}
            daysLeft={daysLeft}
            trialDays={TRIAL_DAYS}
            ctaHref={ctaHref}
            lbpRate={lbpRate}
          />
        </div>

        {/* Full feature matrix */}
        <div className="mx-auto mt-16 max-w-4xl">
          <h2 className="text-center text-2xl font-extrabold tracking-tight">
            {t.matrixTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
            {t.matrixSub}
          </p>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-surface-muted/50">
                  <th className="p-3 text-start font-bold">{t.colFeature}</th>
                  {PLAN_ORDER.map((k) => (
                    <th
                      key={k}
                      className={`w-28 p-3 text-center font-bold ${
                        PLAN_TIERS[k].popular ? "text-primary" : ""
                      }`}
                    >
                      {t.tiers[k].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRICING_MATRIX.map((id) => (
                  <tr key={id} className="border-t border-border">
                    <td className="p-3 font-medium">{t.features[id]}</td>
                    {PLAN_ORDER.map((k) => (
                      <td key={k} className="p-3 text-center">
                        {cell(id, k)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* What we do not have. Deliberately between the comparison table and
            the FAQ: a merchant who has just read what a plan buys should meet
            the gaps before they are asked to decide. */}
        <div className="mx-auto mt-12 max-w-4xl">
          <FeatureRoadmap dict={dict} />
        </div>

        {/* FAQ */}
        <div className="mx-auto mt-16 max-w-2xl">
          <h2 className="text-center text-2xl font-extrabold tracking-tight">
            {t.faqTitle}
          </h2>
          <div className="mt-6 space-y-3">
            {faq.map((f, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-surface p-5"
              >
                <h3 className="font-bold">{f.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
}
