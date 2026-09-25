// Loyalty stamp cards and phone-keyed points — the pure half.
//
// Migration 0310 is authoritative: it decides what a purchase earns, keeps the
// balances and refuses what is not allowed. Everything here is display math the
// screens share, mirrored from the SQL so a merchant's preview and the card a
// customer opens can never disagree with what the database will do.
//
// ONE HOLDER PER PURCHASE (the rule 0310's header explains in full):
//   * stamps program — every completed order with a phone and every POS sale
//     the cashier attaches a phone to stamps the PHONE card;
//   * points program — an order WITH an account earns in the existing
//     loyalty_ledger (spendable at checkout, 0110); a guest order or a POS
//     sale earns on the PHONE card. Never both.

import { waNumber } from "@/lib/phone";

export type LoyaltyKind = "stamps" | "points";
export type StampScope = "order" | "product" | "section";

export type LoyaltyProgram = {
  kind: LoyaltyKind;
  isActive: boolean;
  stampsRequired: number;
  stampScope: StampScope;
  scopeProductId: string | null;
  scopeSectionId: string | null;
  pointsPerUsd: number;
  redeemThreshold: number;
  rewardLabel: string | null;
  rewardLabelEn: string | null;
};

/** The bounds the database's check constraints enforce (0310 §1). */
export const LOYALTY_LIMITS = {
  stampsMin: 2,
  stampsMax: 50,
  rateMin: 1,
  rateMax: 100,
  thresholdMin: 1,
  thresholdMax: 1_000_000,
  rewardMax: 120,
  noteMin: 2,
  noteMax: 200,
  adjustMax: 10_000,
} as const;

export const DEFAULT_PROGRAM: LoyaltyProgram = {
  kind: "stamps",
  isActive: true,
  stampsRequired: 10,
  stampScope: "order",
  scopeProductId: null,
  scopeSectionId: null,
  pointsPerUsd: 1,
  redeemThreshold: 100,
  rewardLabel: null,
  rewardLabelEn: null,
};

type ProgramRow = {
  kind?: string | null;
  is_active?: boolean | null;
  stamps_required?: number | string | null;
  stamp_scope?: string | null;
  scope_product_id?: string | null;
  scope_section_id?: string | null;
  points_per_usd?: number | string | null;
  redeem_threshold?: number | string | null;
  reward_label?: string | null;
  reward_label_en?: string | null;
};

/** A loyalty_programs row (or the card RPC's `program` object) as the app's
 *  shape. Null for anything that is not a program — an absent row, or a table
 *  that does not exist yet because 0310 is not applied. */
export function programFromRow(row: ProgramRow | null | undefined): LoyaltyProgram | null {
  if (!row || (row.kind !== "stamps" && row.kind !== "points")) return null;
  const scope = row.stamp_scope;
  return {
    kind: row.kind,
    isActive: row.is_active ?? true,
    stampsRequired: Number(row.stamps_required ?? DEFAULT_PROGRAM.stampsRequired),
    stampScope: scope === "product" || scope === "section" ? scope : "order",
    scopeProductId: row.scope_product_id ?? null,
    scopeSectionId: row.scope_section_id ?? null,
    pointsPerUsd: Number(row.points_per_usd ?? 1),
    redeemThreshold: Number(row.redeem_threshold ?? DEFAULT_PROGRAM.redeemThreshold),
    rewardLabel: row.reward_label ?? null,
    rewardLabelEn: row.reward_label_en ?? null,
  };
}

/** What a program form may be saved as — the same rules the RPC raises on,
 *  checked first so the merchant reads a sentence rather than a SQL code. */
export type ProgramIssue =
  | "stampsRange"
  | "rateRange"
  | "thresholdRange"
  | "scopeProductMissing"
  | "scopeSectionMissing"
  | "rewardTooLong";

export function programIssue(p: LoyaltyProgram): ProgramIssue | null {
  const L = LOYALTY_LIMITS;
  if (p.kind === "stamps") {
    if (!Number.isInteger(p.stampsRequired) || p.stampsRequired < L.stampsMin || p.stampsRequired > L.stampsMax)
      return "stampsRange";
    if (p.stampScope === "product" && !p.scopeProductId) return "scopeProductMissing";
    if (p.stampScope === "section" && !p.scopeSectionId) return "scopeSectionMissing";
  } else {
    if (!Number.isInteger(p.pointsPerUsd) || p.pointsPerUsd < L.rateMin || p.pointsPerUsd > L.rateMax)
      return "rateRange";
    if (!Number.isInteger(p.redeemThreshold) || p.redeemThreshold < L.thresholdMin || p.redeemThreshold > L.thresholdMax)
      return "thresholdRange";
  }
  if ((p.rewardLabel ?? "").length > L.rewardMax || (p.rewardLabelEn ?? "").length > L.rewardMax)
    return "rewardTooLong";
  return null;
}

// ---------------------------------------------------------------------------
// Earning — mirrors loyalty_earn() in 0310
// ---------------------------------------------------------------------------

/** One line of a purchase, from order_items or pos_sale_items. */
export type PurchaseLine = {
  productId: string | null;
  sectionId: string | null;
  quantity: number;
};

/** Stamps one purchase earns: 1 per purchase for the 'order' scope, else one per
 *  qualifying unit — capped at five cards' worth, as the database caps it. */
export function stampsForPurchase(
  program: Pick<LoyaltyProgram, "stampsRequired" | "stampScope" | "scopeProductId" | "scopeSectionId">,
  total: number,
  lines: readonly PurchaseLine[],
): number {
  let n: number;
  if (program.stampScope === "order") {
    n = total > 0 ? 1 : 0;
  } else {
    n = lines
      .filter((l) =>
        program.stampScope === "product"
          ? l.productId != null && l.productId === program.scopeProductId
          : l.sectionId != null && l.sectionId === program.scopeSectionId,
      )
      .reduce((s, l) => s + Math.max(0, Math.trunc(l.quantity)), 0);
  }
  return Math.max(0, Math.min(n, program.stampsRequired * 5));
}

/** Points one purchase earns: X per WHOLE dollar of the total (1 per $1 when
 *  the store runs no points program — the rule every store had before 0310). */
export function pointsForPurchase(total: number, pointsPerUsd = 1): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Math.floor(total) * Math.max(1, Math.trunc(pointsPerUsd)), 1_000_000);
}

// ---------------------------------------------------------------------------
// Progress — what the card and the members list show
// ---------------------------------------------------------------------------

export type CardProgress = {
  /** Filled slots on the card being filled now (0..perCard). */
  current: number;
  /** Slots on one card (N stamps, or the points threshold). */
  perCard: number;
  /** Whole rewards the balance can pay for right now. */
  rewardsReady: number;
  /** How many more until the next reward. */
  toNext: number;
  /** 0..1 fill of the current card. */
  ratio: number;
};

/**
 * Balance → card progress. With a reward ready the card shows as FULL (not as
 * an empty new card), because "you have a free coffee waiting" is the thing
 * the customer must see; the stamps beyond it are the next card's.
 */
export function cardProgress(balance: number, perCard: number): CardProgress {
  const per = Math.max(1, Math.trunc(perCard));
  const bal = Math.max(0, Math.trunc(balance));
  const rewardsReady = Math.floor(bal / per);
  const current = rewardsReady > 0 ? per : bal;
  return {
    current,
    perCard: per,
    rewardsReady,
    toNext: rewardsReady > 0 ? 0 : per - bal,
    ratio: current / per,
  };
}

/** The balance a program reads: stamps for a stamps card, points otherwise. */
export function programBalance(
  kind: LoyaltyKind,
  balances: { stamps: number; points: number },
): number {
  return kind === "stamps" ? balances.stamps : balances.points;
}

/** Stamps or points that one reward costs. */
export function rewardCost(p: Pick<LoyaltyProgram, "kind" | "stampsRequired" | "redeemThreshold">): number {
  return p.kind === "stamps" ? p.stampsRequired : p.redeemThreshold;
}

/** The reward wording in the viewer's language, falling back to the other. */
export function rewardLabel(
  p: Pick<LoyaltyProgram, "rewardLabel" | "rewardLabelEn">,
  lang: string,
): string | null {
  const ar = p.rewardLabel?.trim() || null;
  const en = p.rewardLabelEn?.trim() || null;
  return lang === "en" ? (en ?? ar) : (ar ?? en);
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

export function isCardToken(token: string | null | undefined): token is string {
  return !!token && TOKEN_RE.test(token);
}

/** The public card page for one member. */
export function loyaltyCardPath(lang: string, token: string): string {
  return `/${lang}/loyalty/${token}`;
}

/**
 * A member's wa.me number, from the stored matching key. The key is the
 * national number for a Lebanese phone (0309's wa_phone_key), which waNumber
 * turns back into 961…; a foreign key has no dialable form here and the
 * button hides rather than open a dead chat.
 */
export function memberWaNumber(phoneKey: string | null | undefined): string | null {
  return waNumber(phoneKey);
}

/** A phone key shown to STAFF (never on the public card): 3 123 456. */
export function displayPhoneKey(phoneKey: string): string {
  const d = phoneKey.replace(/\D/g, "");
  if (d.length === 7) return `0${d[0]} ${d.slice(1, 4)} ${d.slice(4)}`;
  if (d.length === 8) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
  return d;
}
