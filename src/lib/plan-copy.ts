// Plan facts inside COPY. A dictionary string that names a plan price, the
// trial length or a product cap does not carry the number itself — it carries a
// placeholder ({days}, {basicProducts}, {proAnnual}…) and the number is filled
// in here, from plan-tiers / plan.ts, at render time. That is the only way the
// FAQ, the upsell card, the /merchants reassurance line and the price cards can
// never disagree: src/lib/__tests__/plan-price-ssot.test.ts fails the build if a
// literal plan number gets typed back into a dictionary or a component.
//
// Pure module (no server-only import) so client components — the pricing cards,
// the product form — can fill the same strings the server pages fill.

import { TRIAL_DAYS } from "./plan";
import {
  PLAN_ORDER,
  PLAN_TIERS,
  annualPrice,
  planProductLimit,
  promoState,
} from "./plan-tiers";

export type PlanCopyVars = Record<string, string | number>;

/**
 * Every placeholder a plan-fact string may use, resolved for `now` (so the
 * annual prices follow the promo window exactly like the price cards do):
 *
 *   {days}                            free-trial length
 *   {freeProducts}                    products an unsubscribed store may list
 *   {basicProducts} {proProducts}     each tier's product cap
 *   {basicStaff} {proStaff} {businessStaff}
 *   {basicMonthly} {proMonthly} {businessMonthly}
 *   {basicAnnual} {proAnnual} …       promo price while the promo runs, else standard
 *   {basicSavings} …                  the promo savings percentage
 */
export function planCopyVars(now: Date = new Date()): PlanCopyVars {
  const promoActive = promoState(now).active;
  const vars: PlanCopyVars = {
    days: TRIAL_DAYS,
    freeProducts: planProductLimit("free"),
  };
  for (const key of PLAN_ORDER) {
    const tier = PLAN_TIERS[key];
    vars[`${key}Products`] = tier.products ?? "∞";
    vars[`${key}Staff`] = tier.staff;
    vars[`${key}Monthly`] = tier.monthly;
    vars[`${key}Annual`] = annualPrice(tier, promoActive);
    vars[`${key}Savings`] = tier.savingsPct;
  }
  return vars;
}

/** Replace every `{name}` in `text` that `vars` knows. Unknown placeholders are
 *  left as-is so a typo shows up on screen instead of silently vanishing. */
export function fillPlanCopy(text: string, vars: PlanCopyVars): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** One-shot: fill with the standard vars plus any page-specific extras. */
export function planCopy(
  text: string,
  extra?: PlanCopyVars,
  now: Date = new Date(),
): string {
  return fillPlanCopy(text, { ...planCopyVars(now), ...extra });
}
