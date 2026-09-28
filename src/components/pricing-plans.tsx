"use client";

import { useState } from "react";
import { Check, Clock, Crown, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { formatLbp } from "@/lib/currency";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { PLAN_ORDER, type PlanConfig, type PlanKey } from "@/lib/plan-tiers";
import {
  FEATURES,
  PLAN_HIGHLIGHTS,
  matrixCell,
  type FeatureId,
} from "@/lib/feature-availability";

// The interactive pricing cards: monthly/annual toggle, promo strikethrough +
// savings, and a live countdown. Prices/flags come from the server (already
// promo-resolved by date); this component only chooses which to show.
//
// The bullet list is no longer copy. It is PLAN_HIGHLIGHTS, and a test asserts
// every id in it is `live` and belongs to that exact tier — so a card cannot
// promise a feature the comparison table below denies, nor one the merchant's
// dashboard would lock. The count rows (products, staff seats) print the number
// PLAN_TIERS holds, which is why "unlimited products" can no longer appear on a
// 200-product plan.
export function PricingPlans({
  lang,
  dict,
  plans,
  promoActive,
  daysLeft,
  trialDays,
  ctaHref,
  lbpRate,
}: {
  lang: Locale;
  dict: Dictionary;
  plans: Record<PlanKey, PlanConfig>;
  promoActive: boolean;
  daysLeft: number;
  /** TRIAL_DAYS from lib/plan — the trial line under each card fills {days}
   *  from it, so the number cannot be typed into the dictionary. */
  trialDays: number;
  ctaHref: string;
  lbpRate: number;
}) {
  const t = dict.pricing;
  // Default to annual during the promo so the discount is the first thing seen.
  const [annual, setAnnual] = useState(promoActive);

  const lbp = (usd: number) =>
    lbpRate > 0 ? formatLbp(usd, lbpRate, lang) : null;

  // A highlight that carries a per-plan number or level (products, staff seats,
  // support) prints it beside the label; everything else is a plain claim.
  const highlightValue = (id: FeatureId, plan: PlanKey): string | null => {
    if (!FEATURES[id].cell) return null;
    const c = matrixCell(id, plan);
    if (c.kind === "count")
      return c.value === null ? t.unlimited : String(c.value);
    if (c.kind === "text")
      return c.token === "zero" ? "0%" : t.support[c.token];
    return null;
  };

  return (
    <div>
      {/* Toggle + countdown */}
      <div className="flex flex-col items-center gap-3">
        <div className="inline-flex rounded-full border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setAnnual(false)}
            className={`rounded-full px-5 py-2 text-sm font-bold transition-colors ${
              !annual
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.monthly}
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            className={`rounded-full px-5 py-2 text-sm font-bold transition-colors ${
              annual
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.yearly}
          </button>
        </div>
        {promoActive && annual && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-sm font-bold text-warning">
            <Clock className="h-4 w-4" />
            {t.countdown.replace("{n}", String(daysLeft))}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="mx-auto mt-10 grid max-w-5xl items-start gap-6 lg:grid-cols-3">
        {PLAN_ORDER.map((key) => {
          const p = plans[key];
          const tier = t.tiers[key];
          const popular = !!p.popular;
          const annualShown = annual ? annualPromoOrStd(p, promoActive) : null;
          const price = annual ? annualShown! : p.monthly;
          const per = annual ? t.yr : t.mo;
          const showStrike = annual && promoActive;
          const prevName =
            key === "pro"
              ? t.tiers.basic.name
              : key === "business"
                ? t.tiers.pro.name
                : null;

          return (
            <div
              key={key}
              className={`relative flex h-full flex-col rounded-3xl border bg-surface p-7 ${
                popular
                  ? "border-2 border-primary shadow-lg shadow-primary/10"
                  : "border-border"
              }`}
            >
              {popular && (
                <span className="absolute -top-3 start-7 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  <Crown className="h-3.5 w-3.5" />
                  {t.popular}
                </span>
              )}

              <h3 className="text-xl font-extrabold tracking-tight">
                {tier.name}
              </h3>
              <p className="mt-1 min-h-[2.5rem] text-sm text-muted-foreground">
                {tier.tagline}
              </p>

              {/* Price */}
              <div className="mt-4">
                <div className="flex items-baseline gap-2">
                  {showStrike && (
                    <span className="text-lg font-bold text-muted-foreground line-through">
                      ${p.annualStandard}
                    </span>
                  )}
                  <span className="text-4xl font-extrabold">${price}</span>
                  <span className="text-sm text-muted-foreground">{per}</span>
                </div>
                <div className="mt-1 flex min-h-[1.5rem] flex-wrap items-center gap-2">
                  {showStrike && (
                    <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success">
                      {t.save.replace("{pct}", String(p.savingsPct))}
                    </span>
                  )}
                  {annual && promoActive && (
                    <span className="text-xs font-semibold text-warning">
                      {t.annualOnly}
                    </span>
                  )}
                  {lbp(price) && (
                    <span className="text-xs text-muted-foreground">
                      {/* formatLbp already prefixes "≈" — the literal one that
                          used to sit here rendered "≈ ≈ 6,727,500 LBP". */}
                      {lbp(price)}
                    </span>
                  )}
                </div>
              </div>

              {/* Commission — key differentiator */}
              <div className="mt-4 flex items-center justify-center gap-1.5 rounded-xl bg-success-soft px-3 py-2 text-sm font-bold text-success">
                <Check className="h-4 w-4 shrink-0" />
                {t.commission}
              </div>

              {/* Features */}
              {prevName && (
                <p className="mt-5 text-sm font-bold text-foreground">
                  {t.everythingIn.replace("{plan}", prevName)}
                </p>
              )}
              <ul className="mt-3 space-y-2.5">
                {PLAN_HIGHLIGHTS[key].map((id) => {
                  const value = highlightValue(id, key);
                  return (
                    <li key={id} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        {t.features[id]}
                        {value && <span className="font-bold"> · {value}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-7 flex-1" />
              <ButtonLink
                href={ctaHref}
                variant={popular ? "primary" : "secondary"}
                size="lg"
                full
              >
                {t.cta}
              </ButtonLink>
              <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {t.trialLine.replace("{days}", String(trialDays))}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function annualPromoOrStd(p: PlanConfig, promoActive: boolean): number {
  return promoActive ? p.annualPromo : p.annualStandard;
}
