"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";

// «أسعار مختلفة لنفس الخدمة» (0321). A service's options are product_variants
// rows — the same table goods use for size/colour — edited here as a label,
// a price and an optional duration. Stock does not apply to a service, so it
// is not asked. The rows are the form's own `variants` state, so saving them
// goes through the exact path the goods variants already use.

export type ServiceOptionRow = {
  label: string;
  price: string;
  stock: string;
  duration?: string;
};

const input =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function ServicePriceOptions({
  rows,
  onChange,
  dict,
}: {
  rows: ServiceOptionRow[];
  onChange: (rows: ServiceOptionRow[]) => void;
  dict: Dictionary;
}) {
  const p = dict.merchant.products;
  const set = (i: number, patch: Partial<ServiceOptionRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold">{p.serviceOptionsTitle}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{p.serviceOptionsHint}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...rows, { label: "", price: "", stock: "", duration: "" }])}
          className="flex min-h-9 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-muted"
        >
          <Plus className="h-3.5 w-3.5" />
          {p.addServiceOption}
        </button>
      </div>
      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-stretch gap-2">
              <input
                value={r.label}
                onChange={(e) => set(i, { label: e.target.value })}
                placeholder={p.serviceOptionLabel}
                aria-label={p.serviceOptionLabel}
                maxLength={80}
                className={`${input} w-full min-w-0 sm:w-auto sm:flex-1`}
              />
              <input
                value={r.price}
                onChange={(e) => set(i, { price: e.target.value })}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                placeholder={p.serviceOptionPrice}
                aria-label={p.serviceOptionPrice}
                className={`${input} w-28`}
              />
              <input
                value={r.duration ?? ""}
                onChange={(e) => set(i, { duration: e.target.value })}
                type="number"
                min="5"
                max="480"
                step="5"
                inputMode="numeric"
                dir="ltr"
                placeholder={p.serviceOptionDuration}
                aria-label={p.serviceOptionDuration}
                className={`${input} w-32`}
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={p.remove}
                className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
