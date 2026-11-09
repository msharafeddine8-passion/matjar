import { Zap } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { formatUsd, formatLbpPrice } from "@/lib/currency";
import { effectivePrice, compareAtPrice, isFlashActive } from "@/lib/pricing";
import type { PricingFields } from "@/lib/pricing";
import {
  unitPricingOf,
  pricePerBase,
  baseMeasure,
  isWholeBaseUnit,
  formatQuantityMeasure,
  MEASURE_LABELS,
  type UnitPricing,
  type UnitPricedRow,
} from "@/lib/unit-pricing";
import { localized } from "@/lib/i18n-field";

// What a price looks like on a card, and nothing else.
//
// Lifted out of store-products.tsx unchanged. These three read props and return
// spans — no cart, no state, no store — so they were the part of that file that
// had no business being in a 900-line client component. They carry no
// "use client" of their own: they are imported BY client components and inherit
// the boundary, and leaving the directive off means a server component can
// render them too.
//
// Nothing about the money changed in the move. `effectivePrice` is still the
// only thing that decides what a customer pays and `formatUsd` is still the
// only thing that prints it.

/** Every product field these components read. Structural, so the callers'
 *  own `Product` types satisfy it without importing anything from them —
 *  which is what keeps store-products.tsx from having to import this file's
 *  types back. */
export type PricedProduct = PricingFields &
  UnitPricedRow & {
    isBundle?: boolean;
    includes?: { name: string; nameEn: string | null; quantity: number }[];
  };

/**
 * "/ كيلو" after the price, and the per-kilo rate when a unit is not a whole
 * one.
 *
 * This is the fix MJ-010 is actually about. The butcher's cards read "$7.50"
 * today, and $7.50 is what he charges for a KILO of minced beef — the unit was
 * never anywhere on the screen, in the database or in the order. Nothing about
 * the money changes here; the unit that was always implied is simply printed.
 *
 * For a unit that is not one whole kilo (say 250 g at $1.88) both are shown:
 * what you pay for one unit, and what that works out to per kilo. The second is
 * the number a shopper compares against the shop down the road, and deriving it
 * for them is the difference between an honest price and an arithmetic puzzle.
 */
export function UnitSuffix({
  unit,
  unitPrice,
  lang,
}: {
  unit: UnitPricing;
  unitPrice: number;
  lang: Locale;
}) {
  const l = lang === "ar" ? "ar" : "en";
  const per = MEASURE_LABELS[unit.measure][l];
  if (isWholeBaseUnit(unit)) {
    return (
      <span className="text-xs font-semibold text-muted-foreground">
        {" / "}
        {per}
      </span>
    );
  }
  const base = baseMeasure(unit);
  return (
    <>
      <span className="text-xs font-semibold text-muted-foreground">
        {" / "}
        {formatQuantityMeasure(unit, 1, l)}
      </span>
      <span className="text-xs font-normal text-muted-foreground">
        {"· "}
        <span className="text-money">{formatUsd(pricePerBase(unitPrice, unit))}</span>
        {` / ${MEASURE_LABELS[base][l]}`}
      </span>
    </>
  );
}

export function PriceTag({
  p,
  lang,
  lbpPriceRate = 0,
}: {
  p: PricedProduct;
  lang: Locale;
  /** 0342: a display-only store that prices in lira passes the USD→LBP rate,
   *  and the amounts here print as lira. 0 (default) keeps USD. */
  lbpPriceRate?: number;
}) {
  const eff = effectivePrice(p);
  const compare = compareAtPrice(p);
  const flash = isFlashActive(p);
  const unit = unitPricingOf(p);
  const money = (usd: number) =>
    (lbpPriceRate > 0 && formatLbpPrice(usd, lbpPriceRate, lang)) || formatUsd(usd);
  return (
    <span className="sf-price inline-flex flex-wrap items-center gap-x-1.5">
      {/* .text-money = tabular numerals + LTR bidi isolation, the house rule
          for currency inside Arabic text (globals.css). */}
      <span
        className={`text-money font-bold ${flash ? "text-warning" : "text-primary"}`}
      >
        {money(eff)}
      </span>
      {/* The unit rides immediately after the amount, before the struck-through
          compare-at price, so "$5 / كيلو  $6" reads as one price and its old
          value rather than as two prices with a unit between them. */}
      {unit && <UnitSuffix unit={unit} unitPrice={eff} lang={lang} />}
      {compare != null && (
        <span className="text-money text-xs font-normal text-muted-foreground line-through">
          {money(compare)}
        </span>
      )}
      {flash && <Zap className="h-3.5 w-3.5 fill-accent text-accent" />}
    </span>
  );
}

// "يشمل: 2× X · 1× Y" under a bundle's name so shoppers see what's inside.
export function BundleIncludes({
  p,
  lang,
  label,
}: {
  p: PricedProduct;
  lang: Locale;
  label: string;
}) {
  if (!p.isBundle || !p.includes?.length) return null;
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      <span className="font-semibold text-primary">{label} </span>
      {p.includes
        .map((it) => `${it.quantity}× ${localized(it.name, it.nameEn, lang)}`)
        .join(" · ")}
    </p>
  );
}
