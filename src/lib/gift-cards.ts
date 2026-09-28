// Gift cards — the pure half. Migration 0310 is authoritative: it mints the
// code, holds the balance and does every debit under a row lock. This file is
// the same rules, for the screens that format, validate and preview them.
//
// CURRENCY RULES (0310 §10, mirrored exactly by planRedemption below):
//   * Orders, POS sales and payments are USD. A gift card is TENDER against
//     that USD amount — never a discount — so orders.total is never rewritten.
//   * A USD card pays USD 1:1.
//   * An LBP card pays at the rate snapshotted ON THE ORDER / SALE when it was
//     placed (0209's fx_rate) — never today's rate, never a rate the browser
//     sends. No snapshot: refused ("no_rate"), not guessed.
//   * LBP is debited in whole pounds. A card that covers the whole amount due
//     pays it exactly; a card that covers part credits trunc(lbp / rate, 2)
//     dollars — under a cent in the merchant's favour, never taken from the
//     customer's card.

export type GiftCurrency = "USD" | "LBP";

/** 32 characters, none of 0 O 1 I: nothing a customer can misread off a card. */
export const GIFT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const GIFT_CODE_LENGTH = 12;
const CODE_RE = /^[2-9A-HJ-NP-Z]{12}$/;

/** As typed → as stored: spaces and dashes gone, upper case. */
export function normalizeGiftCode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isValidGiftCode(raw: string | null | undefined): boolean {
  return CODE_RE.test(normalizeGiftCode(raw));
}

/** ABCD-EFGH-JKLM — how a code is printed and read aloud. */
export function formatGiftCode(raw: string | null | undefined): string {
  const c = normalizeGiftCode(raw);
  return c.match(/.{1,4}/g)?.join("-") ?? "";
}

/** The last four characters, for a receipt or a payment note. */
export function maskGiftCode(raw: string | null | undefined): string {
  const c = normalizeGiftCode(raw);
  return c.length >= 4 ? `…${c.slice(-4)}` : "";
}

/**
 * A code the way 0310's issue_gift_card mints one: each character is one
 * random byte masked to 5 bits, and because 32 divides 256 exactly every
 * character is equally likely (60 bits in all). The database is the only
 * issuer in production; this exists so the rule has a tested twin.
 */
export function generateGiftCode(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes(GIFT_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < GIFT_CODE_LENGTH; i++) out += GIFT_CODE_ALPHABET[bytes[i] & 31];
  return out;
}

function defaultRandomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

export const GIFT_LIMITS = { USD: 10_000, LBP: 1_000_000_000 } as const;

export type AmountIssue = "invalid" | "tooLarge" | "fractionalLbp" | "tooManyDecimals";

/** Why an initial amount cannot be issued, or null when it can (the same
 *  checks as issue_gift_card and the table's constraint). */
export function giftAmountIssue(amount: number, currency: GiftCurrency): AmountIssue | null {
  if (!Number.isFinite(amount) || amount <= 0) return "invalid";
  if (amount > GIFT_LIMITS[currency]) return "tooLarge";
  if (currency === "LBP" && !Number.isInteger(amount)) return "fractionalLbp";
  if (currency === "USD" && Math.round(amount * 100) !== amount * 100) return "tooManyDecimals";
  return null;
}

/** "$25" / "250,000 ل.ل." — a card amount in its OWN currency. */
export function formatGiftAmount(amount: number, currency: GiftCurrency, lang: string): string {
  const n = Number(amount);
  if (currency === "LBP") {
    return `${Math.round(n).toLocaleString("en-US")} ${lang === "ar" ? "ل.ل." : "LBP"}`;
  }
  return `$${Number(n.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Redemption — mirrors gift_card_debit() in 0310
// ---------------------------------------------------------------------------

export type RedemptionRefusal = "nothing_due" | "card_empty" | "no_rate";

export type RedemptionPlan =
  | {
      ok: true;
      /** Debited from the card, in the card's currency. */
      cardAmount: number;
      /** Credited to the order / sale, in USD. */
      usdAmount: number;
      cardBalanceAfter: number;
      dueAfterUsd: number;
    }
  | { ok: false; reason: RedemptionRefusal };

const cents = (n: number) => Math.round(n * 100) / 100;
const truncCents = (n: number) => Math.trunc(n * 100 + 1e-9) / 100;

/**
 * What spending a card on an amount due would do. `fxRate` is the ORDER's
 * (or sale's) own snapshot — pass it, not today's rate; it is ignored for a
 * USD card and required for an LBP one.
 */
export function planRedemption({
  currency,
  balance,
  dueUsd,
  fxRate,
}: {
  currency: GiftCurrency;
  balance: number;
  dueUsd: number;
  fxRate: number | null | undefined;
}): RedemptionPlan {
  if (!(balance > 0)) return { ok: false, reason: "card_empty" };
  if (!(dueUsd > 0)) return { ok: false, reason: "nothing_due" };
  const due = cents(dueUsd);

  if (currency === "USD") {
    const take = cents(Math.min(balance, due));
    if (take <= 0) return { ok: false, reason: "nothing_due" };
    return {
      ok: true,
      cardAmount: take,
      usdAmount: take,
      cardBalanceAfter: cents(balance - take),
      dueAfterUsd: cents(due - take),
    };
  }

  if (!fxRate || !(fxRate > 0)) return { ok: false, reason: "no_rate" };
  const dueLbp = Math.round(dueUsd * fxRate);
  const take = Math.min(balance, dueLbp);
  const usd = take >= dueLbp ? due : truncCents(take / fxRate);
  if (take <= 0 || usd <= 0) return { ok: false, reason: "nothing_due" };
  return {
    ok: true,
    cardAmount: take,
    usdAmount: usd,
    cardBalanceAfter: balance - take,
    dueAfterUsd: cents(Math.max(due - usd, 0)),
  };
}

// ---------------------------------------------------------------------------
// Status and the liability report
// ---------------------------------------------------------------------------

export type GiftCardRow = {
  id: string;
  code: string;
  token: string;
  currency: GiftCurrency;
  initial_amount: number | string;
  balance: number | string;
  recipient_name: string | null;
  note: string | null;
  expires_on: string | null;
  status: "active" | "void";
  created_at: string;
};

export type GiftStatus = "active" | "void" | "expired" | "spent";

/** Today in Beirut as YYYY-MM-DD — the calendar a card's expiry is read in. */
export function beirutToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A card is good THROUGH its expiry date (Beirut), as in 0310. */
export function giftCardStatus(
  card: Pick<GiftCardRow, "status" | "expires_on" | "balance">,
  today: string = beirutToday(),
): GiftStatus {
  if (card.status === "void") return "void";
  if (card.expires_on && card.expires_on < today) return "expired";
  if (Number(card.balance) <= 0) return "spent";
  return "active";
}

export type LiabilityLine = {
  currency: GiftCurrency;
  issuedCount: number;
  /** Sum of initial amounts of every card ever issued. */
  issued: number;
  /** What has been spent (initial − balance), across all cards. */
  redeemed: number;
  /** What the shop still owes: balances of active, unexpired cards. */
  outstanding: number;
  /** Balances left on expired cards — no longer spendable. */
  expired: number;
  /** Balances left on voided cards — no longer spendable. */
  voided: number;
};

/**
 * Issued / redeemed / outstanding per currency. Never summed ACROSS
 * currencies: a USD figure and an LBP figure added together mean nothing.
 */
export function giftCardReport(
  cards: readonly Pick<GiftCardRow, "currency" | "initial_amount" | "balance" | "status" | "expires_on">[],
  today: string = beirutToday(),
): LiabilityLine[] {
  const by = new Map<GiftCurrency, LiabilityLine>();
  for (const c of cards) {
    const cur = c.currency === "LBP" ? "LBP" : "USD";
    const line =
      by.get(cur) ??
      { currency: cur, issuedCount: 0, issued: 0, redeemed: 0, outstanding: 0, expired: 0, voided: 0 };
    const initial = Number(c.initial_amount);
    const bal = Number(c.balance);
    line.issuedCount += 1;
    line.issued += initial;
    line.redeemed += initial - bal;
    const st = giftCardStatus(c, today);
    if (st === "void") line.voided += bal;
    else if (st === "expired") line.expired += bal;
    else line.outstanding += bal;
    by.set(cur, line);
  }
  return (["USD", "LBP"] as const)
    .filter((k) => by.has(k))
    .map((k) => {
      const l = by.get(k)!;
      const r = k === "LBP" ? Math.round : cents;
      return {
        ...l,
        issued: r(l.issued),
        redeemed: r(l.redeemed),
        outstanding: r(l.outstanding),
        expired: r(l.expired),
        voided: r(l.voided),
      };
    });
}

// ---------------------------------------------------------------------------
// Errors from the RPCs → the dictionary key that explains them
// ---------------------------------------------------------------------------

export type GiftErrorKey =
  | "notFound"
  | "void"
  | "expired"
  | "empty"
  | "nothingDue"
  | "noRate"
  | "orderClosed"
  | "notAllowed"
  | "planRequired"
  | "setupPending"
  | "generic";

export function giftErrorKey(message: string | null | undefined): GiftErrorKey {
  const m = (message ?? "").toLowerCase();
  if (!m) return "generic";
  if (m.includes("card_not_found") || m.includes("not_found")) return "notFound";
  if (m.includes("card_void") || m === "void") return "void";
  if (m.includes("card_expired") || m === "expired") return "expired";
  if (m.includes("card_empty") || m === "empty") return "empty";
  if (m.includes("nothing_due")) return "nothingDue";
  if (m.includes("no_rate")) return "noRate";
  if (m.includes("order_not_open") || m.includes("sale_too_old")) return "orderClosed";
  if (m.includes("plan_required")) return "planRequired";
  if (m.includes("not allowed") || m.includes("permission denied")) return "notAllowed";
  if (m.includes("could not find the function") || m.includes("does not exist") || m.includes("schema cache"))
    return "setupPending";
  return "generic";
}

/** The public page for one card (balance only — never the code). */
export function giftCardPath(lang: string, token: string): string {
  return `/${lang}/gift/${token}`;
}
