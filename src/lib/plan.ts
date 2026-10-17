// Plan helpers for the Business OS. Which module needs which tier is NOT
// declared here: it lives in OS_MODULE_META (src/lib/sectors.ts, `minPlan`),
// and the tier ranks/limits live in src/lib/plan-tiers.ts. This file only keeps
// the trial length and the rank-based isPro/isBusiness shorthands.

import { hasPlan } from "@/lib/plan-tiers";

export const FREE_PRODUCT_LIMIT = 3;

// NOTE: subscription prices live in ONE place — src/lib/plan-tiers.ts
// (PLAN_TIERS + promoState/annualPrice). Do not re-declare prices here; the old
// PRO_PRICE_* constants were removed to stop the card/subscription/pricing pages
// disagreeing (they showed $15 / $30 / $25 for the same Pro plan).

// Free trial length for new stores (Pro features unlocked, no charge).
export const TRIAL_DAYS = 14;

// Tier checks are rank-based: a Business store also satisfies isPro. Kept here
// (delegating to plan-tiers) so existing `isPro(getStorePlan())` call sites work
// across the new Basic/Pro/Business tiers.
export function isPro(plan: string | null | undefined): boolean {
  return hasPlan(plan, "pro");
}

export function isBusiness(plan: string | null | undefined): boolean {
  return hasPlan(plan, "business");
}

export {
  hasPlan,
  planRank,
  planProductLimit,
  planStaffLimit,
} from "@/lib/plan-tiers";
