// Matjar subscription tiers + the 2026 launch annual promo. Everything is driven
// off PROMO_END — after it passes, annual prices automatically revert to
// standard (monthly × 12) and the promo UI hides itself. No manual flag to flip.
// (Not to be confused with lib/pricing.ts, which is per-PRODUCT pricing.)

export type PlanKey = "basic" | "pro" | "business";

export type PlanConfig = {
  monthly: number;
  annualPromo: number;
  annualStandard: number;
  /** null = unlimited */
  products: number | null;
  staff: number;
  savingsPct: number;
  popular?: boolean;
};

// Extended on 2026-09-02 from 08-31 at the owner's request: the August window
// closed with the promo prices still the ones being advertised to merchants.
// Same prices; only the deadline moved. The copy that names the window reads
// this date through {date}, so nothing else has to change when it moves again.
// Re-opened on 2026-10-17 (it had lapsed on 09-30) and run to the end of the
// year, again at the owner's request — same prices. The offset is +02:00, not
// +03:00: Lebanon leaves summer time on the last Sunday of October, so 31 Dec
// is on EET. With +03:00 the promo would close an hour early, at 23:00 Beirut.
export const PROMO_END = "2026-12-31T23:59:59+02:00"; // Asia/Beirut

export const PLAN_TIERS: Record<PlanKey, PlanConfig> = {
  basic: {
    monthly: 10,
    annualPromo: 75,
    annualStandard: 120,
    products: 30,
    staff: 1,
    savingsPct: 38,
  },
  pro: {
    monthly: 25,
    annualPromo: 150,
    annualStandard: 300,
    products: 200,
    staff: 3,
    savingsPct: 50,
    popular: true,
  },
  business: {
    monthly: 65,
    annualPromo: 300,
    annualStandard: 780,
    products: null,
    staff: 10,
    savingsPct: 62,
  },
};

export const PLAN_ORDER: PlanKey[] = ["basic", "pro", "business"];

// Promo state for a given instant (pass the server's `new Date()` so the page
// re-evaluates per request). daysLeft is ceil'd so "ends in 1 day" shows until
// the final moment.
export function promoState(now: Date): { active: boolean; daysLeft: number } {
  const end = new Date(PROMO_END).getTime();
  const active = now.getTime() <= end;
  const daysLeft = active
    ? Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000))
    : 0;
  return { active, daysLeft };
}

// The annual price to show/charge: promo price during the window, else standard.
export function annualPrice(plan: PlanConfig, promoActive: boolean): number {
  return promoActive ? plan.annualPromo : plan.annualStandard;
}

/**
 * What a manually-recorded payment for `tier` over `period` should default to:
 * the monthly price, or the annual price that is in force at `now` (promo
 * while the window is open, standard after). The admin subscriptions screen
 * used hardcoded $12 / $120 — prices no tier has had since the 2026 repricing.
 */
export function planCharge(
  tier: PlanKey,
  period: "monthly" | "yearly",
  now: Date,
): number {
  const cfg = PLAN_TIERS[tier];
  return period === "yearly"
    ? annualPrice(cfg, promoState(now).active)
    : cfg.monthly;
}

/**
 * The end of one paid period starting at `from`: +1 calendar month or +1 year.
 * Month-end is clamped (31 Jan → 28/29 Feb, not 2/3 Mar), so a monthly plan
 * never silently loses or gains days by rolling into the following month.
 */
export function addPlanPeriod(from: Date, period: "monthly" | "yearly"): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  if (period === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// ── Tier enforcement ─────────────────────────────────────────────────────────
// 'free' is the lapsed/entry floor (never subscribed / trial expired). Paid
// tiers rank above it. A store "has" a tier if its rank meets the requirement.
export type StorePlan = "free" | "basic" | "pro" | "business";

export const PLAN_RANK: Record<string, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  business: 3,
};

export function planRank(plan?: string | null): number {
  return PLAN_RANK[plan ?? "free"] ?? 0;
}

export function hasPlan(
  current: string | null | undefined,
  required: "basic" | "pro" | "business",
): boolean {
  return planRank(current) >= PLAN_RANK[required];
}

/**
 * The plan actually in force for a store.
 *
 * An active 14-day trial grants Pro — but it must never DOWNGRADE a paid plan.
 * The three call sites used to compute `onTrial ? "pro" : plan`, so a store
 * upgraded to Business while a trial was still running was silently served Pro
 * until the trial lapsed: an upgrade that took features away. Taking the higher
 * of the two ranks is the only correct reading, and keeps this in one place.
 */
export function effectivePlan(
  plan: string | null | undefined,
  trialEndsAt: string | Date | null | undefined,
): string {
  const base = plan ?? "free";
  const onTrial =
    trialEndsAt != null && new Date(trialEndsAt).getTime() > Date.now();
  return onTrial && planRank(base) < PLAN_RANK.pro ? "pro" : base;
}

// Catalog size cap by plan: free 3, basic 30, pro 200, business unlimited.
export function planProductLimit(plan?: string | null): number {
  const r = planRank(plan);
  return r >= 3 ? Infinity : r === 2 ? 200 : r === 1 ? 30 : 3;
}

// Staff seats by plan (the owner is always seat #1): free/basic 1, pro 3,
// business 10.
export function planStaffLimit(plan?: string | null): number {
  const r = planRank(plan);
  return r >= 3 ? 10 : r === 2 ? 3 : 1;
}
