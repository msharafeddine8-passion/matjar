"use client";

import type { Dictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import { fieldClass } from "@/components/ui/field";
import { formatUsd } from "@/lib/currency";
import {
  SOLD_BY_MEASURES,
  MEASURE_LABELS,
  baseMeasure,
  pricePerBase,
  unitPricingOf,
  type UnitMeasure,
  type UnitPricingValue,
} from "@/lib/unit-pricing";

const label = "text-sm font-semibold";

/**
 * "How is this item sold?" — the merchant half of MJ-010.
 *
 * The live per-kilo readout at the bottom is the point of the whole control,
 * not decoration. `products.price` is the price of ONE unit, so changing the
 * unit from a kilo to a half kilo without also halving the price doubles what
 * the shop charges per kilo — silently, on every item, with no error anywhere.
 * Showing the derived figure while the merchant types is what makes that
 * arithmetic visible at the moment it can still be got wrong.
 */
export function UnitPricingFields({
  dict,
  lang,
  value,
  onChange,
  /** Current contents of the form's price input, so the readout is live. */
  priceInput,
}: {
  dict: Pick<Dictionary, "merchant">;
  lang: Locale;
  value: UnitPricingValue;
  onChange: (v: UnitPricingValue) => void;
  priceInput: string;
}) {
  const p = dict.merchant.products;
  const l = lang === "ar" ? "ar" : "en";
  const measures = value.soldBy ? SOLD_BY_MEASURES[value.soldBy] : [];

  const price = Number(priceInput);
  const unit = unitPricingOf({
    soldBy: value.soldBy || null,
    unitMeasure: value.measure,
    unitAmount: Number(value.amount),
  });
  const readout =
    unit && Number.isFinite(price) && price > 0
      ? p.unitPerBase
          .replace("{price}", formatUsd(pricePerBase(price, unit)))
          .replace("{measure}", MEASURE_LABELS[baseMeasure(unit)][l])
      : null;

  return (
    <div>
      <span className={label}>{p.soldByLabel}</span>
      <div className="mt-1.5 flex gap-2">
        {(["", "weight", "volume"] as const).map((k) => (
          <button
            key={k || "piece"}
            type="button"
            aria-pressed={value.soldBy === k}
            onClick={() =>
              onChange({
                ...value,
                soldBy: k,
                // Kilos for weight, litres for volume — never carry a measure
                // across that its new kind cannot use.
                measure: k === "volume" ? "l" : "kg",
              })
            }
            className={`relative flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] ${
              value.soldBy === k
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-muted-foreground hover:border-primary/40"
            }`}
          >
            {k === "" ? p.soldByPiece : k === "weight" ? p.soldByWeight : p.soldByVolume}
          </button>
        ))}
      </div>

      {value.soldBy && (
        <div className="mt-3 rounded-xl border border-border/70 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="unit_amount">
                {p.unitAmount}
              </label>
              <input
                id="unit_amount"
                type="number"
                min="0"
                step="0.001"
                dir="ltr"
                value={value.amount}
                onChange={(e) => onChange({ ...value, amount: e.target.value })}
                className={`${fieldClass} mt-1.5 tabular-nums`}
              />
            </div>
            <div>
              <label className={label} htmlFor="unit_measure">
                {p.unitMeasure}
              </label>
              <select
                id="unit_measure"
                value={value.measure}
                onChange={(e) =>
                  onChange({ ...value, measure: e.target.value as UnitMeasure })
                }
                className={`${fieldClass} mt-1.5`}
              >
                {measures.map((m) => (
                  <option key={m} value={m}>
                    {MEASURE_LABELS[m][l]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{p.unitHint}</p>
          {readout && (
            <p
              className="mt-2 text-sm font-bold text-primary"
              // The merchant's confirmation that they have not just doubled
              // every price. It updates as they type, so it is announced.
              aria-live="polite"
            >
              {readout}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
