// Pure helpers (no server imports) so both server and client components can use
// them. The USD→LBP rate is read from app_settings (admin-editable) and passed in.

import type { Locale } from "@/i18n/config";

/** Options for {@link formatUsd}. */
export type FormatUsdOptions = {
  /** Round to at most 2 decimals before grouping — the money-of-record shape
   *  used by surfaces that settle real amounts (invoice, POS, supplier bills,
   *  merchant dashboard totals) where an unrounded float would leak. Trailing
   *  zeros are still dropped ($12.50 → "$12.5"), matching what those screens
   *  have always rendered; this option exists to centralise their arithmetic,
   *  not to restyle them. Catalog prices leave it off. */
  cents?: boolean;
  /** Always two decimals, grouped: "$12.50", "$1,234.00". For printed
   *  receipts and invoices, where a column of amounts must line up and
   *  "$12.5" reads as a typo. Implies `cents`. */
  fixed?: boolean;
};

/** "$1,200" / "$50" — canonical USD price formatter (thousands separator ≥1000).
 *  Single source of truth; replaces the ad-hoc formatPrice copies across pages.
 *
 *  With `{ cents: true }` the amount is rounded to 2 decimals first, so
 *  1234.5678 renders "$1,234.57" instead of "$1,234.568". */
export function formatUsd(price: number, opts?: FormatUsdOptions): string {
  if (opts?.fixed) {
    const n = Number(Number(price).toFixed(2));
    const abs = Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${n < 0 ? "-" : ""}$${abs}`;
  }
  if (opts?.cents) {
    return `$${Number(Number(price).toFixed(2)).toLocaleString("en-US")}`;
  }
  // Round to cents before rendering, even without the `cents` option.
  //
  // This branch used to interpolate the float directly, and a *computed* total
  // is not a clean float: 7.39 × 3 is 22.169999999999998 in IEEE 754. So a real
  // butcher's cart line, sticky bar, checkout button and the WhatsApp order
  // message sent to the merchant all read "$22.169999999999998". Observed on a
  // live storefront, not constructed.
  //
  // Rounding here changes nothing about how a catalogue price renders, which is
  // what makes it safe: $50 stays "$50", $4.99 stays "$4.99", $12.50 stays
  // "$12.5". The only values it moves are ones that were already wrong. That is
  // the difference from the `cents` option, which additionally groups thousands
  // below 1000 and exists for the surfaces that settle real amounts.
  const rounded = Number(Number(price).toFixed(2));
  return rounded >= 1000
    ? `$${rounded.toLocaleString("en-US")}`
    : `$${rounded}`;
}

/**
 * An amount in its own currency, never converted: "$1,250.00" or
 * "4,475,000 ل.ل." / "4,475,000 LBP". USD keeps two decimals (payroll,
 * advances — amounts of record); LBP has no subunit in practice and is
 * rounded. Western digits in both languages; the sign is kept.
 */
export function formatMoneyAmount(
  amount: number,
  currency: string,
  lang: string,
): string {
  const n = Number(amount) || 0;
  if (currency === "LBP") {
    const r = Math.round(n);
    return `${r.toLocaleString("en-US")} ${lang === "ar" ? "ل.ل." : "LBP"}`;
  }
  return formatUsd(n, { fixed: true });
}

/** "≈ 4,475,000 ل.ل." — an approximate LBP value for a USD amount. */
export function formatLbp(usd: number, rate: number, lang: Locale): string {
  if (!rate || usd <= 0) return "";
  const lbp = Math.round(usd * rate);
  return `≈ ${lbp.toLocaleString("en-US")} ${lang === "ar" ? "ل.ل." : "LBP"}`;
}
