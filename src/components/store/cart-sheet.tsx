"use client";

import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatUsd } from "@/lib/currency";
import { effectivePrice, type PricingFields } from "@/lib/pricing";
import { unitPricingOf, type UnitPricedRow } from "@/lib/unit-pricing";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { QuantityStepper } from "@/components/store/quantity-stepper";
import { UnitSuffix } from "@/components/store/product-price";

// The basket, on demand: lines, quantities and the running total — everything
// the sticky bar summarises but had no room to show.
//
// One customer activity, one module. What it is NOT allowed to do is decide
// anything about the money: the total is handed in already computed by the
// caller, from the same `effectivePrice` the cards print, and this component
// only formats it. The steppers here are the same component the product list
// uses, so a quantity change is one code path, not two that can disagree.

export type CartSheetLine<T> = { product: T; qty: number };

type Line = PricingFields &
  UnitPricedRow & { id: string; name: string; stock?: number | null };

export function CartSheet<T extends Line>({
  open,
  onClose,
  lang,
  dict,
  lines,
  total,
  onSetQty,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "store">;
  lines: readonly CartSheetLine<T>[];
  /** Computed by the caller, which owns the cart. Not recomputed here — two
   *  places that add up a basket are two places that can disagree about it. */
  total: number;
  onSetQty: (id: string, qty: number) => void;
  onCheckout: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={dict.store.yourOrder}
      closeLabel={dict.common.close}
      footer={
        <button
          type="button"
          onClick={onCheckout}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground"
        >
          {dict.store.checkout} · {formatUsd(total)}
        </button>
      }
    >
      <ul className="divide-y divide-border">
        {lines.map(({ product: p, qty }) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.name}</span>
              {/* The rate, with its unit. A weight line's own weight is on
                  the stepper beside it, so repeating it here would say the
                  same thing twice; what the line needs is the price the total
                  was worked out FROM, so the customer can check it.
                  Deliberately NOT the full PriceTag: that would add a
                  struck-through compare-at price and a flash bolt to every
                  piece-priced line too, and this change is not allowed to
                  restyle products that have nothing to do with it. */}
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatUsd(effectivePrice(p))}
                {(() => {
                  const u = unitPricingOf(p);
                  return u ? (
                    <UnitSuffix
                      unit={u}
                      unitPrice={effectivePrice(p)}
                      lang={lang}
                    />
                  ) : null;
                })()}
              </span>
            </span>
            <QuantityStepper
              product={p}
              qty={qty}
              lang={lang}
              onChange={(next) => onSetQty(p.id, next)}
            />
            <span className="w-16 shrink-0 text-end font-bold tabular-nums">
              {formatUsd(effectivePrice(p) * qty)}
            </span>
          </li>
        ))}
      </ul>
      {/* The one honest disclosure, and it is about the CUT, not the money.
          See the long note in src/lib/unit-pricing.ts: the total is exact
          because the ordered weight is what the order says and what the shop
          cuts to. What genuinely varies is the last few grams of a hand-cut
          piece, so that is what this sentence says — and nothing more, because
          a warning that the total might change would be promising a
          correction this platform has no way to make. */}
      {lines.some(({ product }) => unitPricingOf(product) !== null) && (
        <p className="mt-3 rounded-xl bg-surface-muted/60 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {dict.store.weighedNote}
        </p>
      )}
    </BottomSheet>
  );
}
