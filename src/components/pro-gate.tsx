import Link from "next/link";
import { Crown, Lock, Check } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { PLAN_TIERS, promoState, annualPrice } from "@/lib/plan-tiers";
import { PLAN_HIGHLIGHTS } from "@/lib/feature-availability";

// Upsell shown in place of a Pro-only module when a free store opens it. Also
// used inline when the free product limit is hit (compact variant).
//
// The benefit list used to be a fixed six-line array in the dictionary, shown
// for both tiers, and it had drifted badly: it promised "unlimited products" on
// a plan capped at 200, listed inventory, suppliers and accounting (all
// Business screens) as Pro, and offered a "verified Pro badge" — which paying
// has never granted and which /trust says has not been awarded to anyone. It
// now renders the same PLAN_HIGHLIGHTS the price cards render, for the tier
// actually being asked for, so the upsell and /pricing cannot disagree.
export function ProGate({
  lang,
  dict,
  storeId,
  title,
  body,
  compact = false,
  requiredPlan = "pro",
}: {
  lang: string;
  dict: Dictionary;
  storeId: string;
  title?: string;
  body?: string;
  compact?: boolean;
  requiredPlan?: "pro" | "business";
}) {
  const t = dict.os.pro;
  // Business-only modules get their own headline/upsell so a Pro store knows it
  // needs the higher tier (not a generic "go Pro").
  const isBiz = requiredPlan === "business";
  const headline = title ?? (isBiz ? t.lockedTitleBusiness : t.lockedTitle);
  const blurb = body ?? (isBiz ? t.lockedBodyBusiness : t.lockedBody);
  // Price the ACTUAL required tier from the single source of truth (plan-tiers),
  // promo-aware — not a hardcoded string (the numbers live only in PLAN_TIERS).
  const tier = PLAN_TIERS[requiredPlan];
  const promoActive = promoState(new Date()).active;
  const priceLine = `$${tier.monthly}${dict.pricing.perMonth} · $${annualPrice(
    tier,
    promoActive,
  )}${dict.pricing.perYear}`;
  const card = (
    <div className="mx-auto max-w-lg rounded-3xl border border-accent/40 bg-gradient-to-b from-accent-soft to-transparent p-7 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-foreground">
        {compact ? <Lock className="h-7 w-7" /> : <Crown className="h-7 w-7" />}
      </span>
      <h2 className="mt-4 text-xl font-extrabold tracking-tight">
        {headline}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {blurb}
      </p>

      <ul className="mx-auto mt-5 max-w-xs space-y-2 text-start">
        {PLAN_HIGHLIGHTS[requiredPlan]
          .filter((id) => id !== "products")
          .map((id) => (
            <li key={id} className="flex items-start gap-2 text-sm font-medium">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {dict.pricing.features[id]}
            </li>
          ))}
      </ul>

      <div className="mt-6">
        <Link
          href={`/${lang}/merchant/${storeId}/subscription`}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-strong px-6 py-3 text-sm font-extrabold text-accent-strong-foreground transition-colors hover:bg-accent-strong-hover"
        >
          <Crown className="h-4 w-4" />
          {isBiz ? t.upgradeBusiness : t.upgrade}
        </Link>
        <p className="mt-2 text-xs font-bold text-warning" dir="ltr">
          {priceLine}
        </p>
      </div>
    </div>
  );

  if (compact) return card;

  return (
    <div className="py-12">
      <Container>{card}</Container>
    </div>
  );
}
