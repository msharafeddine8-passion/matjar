"use client";

import { Palette, Plus, Ruler, X } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";

// One product_variants row, expanded: apparel carries color+size; a blank axis
// degrades gracefully (color-only or size-only).
export type ExpandedVariant = {
  color: string | null;
  size: string | null;
  label: string;
  price: string;
  stock: string;
};

// Merchant-facing state: a list of colors, each with its OWN sizes. This models
// "red comes in S,M; blue in M,L,XL" — a per-color size list, not a full grid.
export type ColorGroup = {
  name: string;
  sizes: { name: string; stock: string; price: string }[];
};

const inputSm =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

// Rebuild the merchant grid from stored variant rows (edit form). Rows are
// grouped by color, preserving insertion order. Legacy flat variants (no
// color/size, just a label like "Red / S") keep their label as the size name so
// editing an old product never silently drops its variants.
export function groupsFromVariants(
  rows: {
    color: string | null;
    size: string | null;
    label?: string;
    price: string;
    stock: string;
  }[],
): ColorGroup[] {
  const groups: ColorGroup[] = [];
  const byColor = new Map<string, ColorGroup>();
  for (const r of rows) {
    const key = r.color ?? "";
    let g = byColor.get(key);
    if (!g) {
      g = { name: r.color ?? "", sizes: [] };
      byColor.set(key, g);
      groups.push(g);
    }
    const size = r.size ?? (!r.color ? (r.label ?? "") : "");
    g.sizes.push({ name: size, stock: r.stock, price: r.price });
  }
  return groups;
}

// Flatten the grid into insertable variant rows. A row is emitted per size entry
// (a blank size under a color = the color itself; a blank color = size-only).
export function variantsFromGroups(groups: ColorGroup[]): ExpandedVariant[] {
  const out: ExpandedVariant[] = [];
  for (const g of groups) {
    const color = g.name.trim();
    const sizes = g.sizes.length ? g.sizes : [{ name: "", stock: "", price: "" }];
    for (const s of sizes) {
      const size = s.name.trim();
      const label = [color, size].filter(Boolean).join(" · ");
      if (!label) continue; // nothing identifies this variant
      out.push({
        color: color || null,
        size: size || null,
        label,
        price: s.price,
        stock: s.stock,
      });
    }
  }
  return out;
}

export function VariantMatrix({
  dict,
  groups,
  onChange,
}: {
  dict: Pick<Dictionary, "merchant">;
  groups: ColorGroup[];
  onChange: (next: ColorGroup[]) => void;
}) {
  const t = dict.merchant.products.matrix;

  const setColor = (ci: number, patch: Partial<ColorGroup>) =>
    onChange(groups.map((g, i) => (i === ci ? { ...g, ...patch } : g)));
  const addColor = () =>
    onChange([...groups, { name: "", sizes: [{ name: "", stock: "", price: "" }] }]);
  const removeColor = (ci: number) =>
    onChange(groups.filter((_, i) => i !== ci));
  const setSize = (ci: number, si: number, patch: Partial<ColorGroup["sizes"][number]>) =>
    onChange(
      groups.map((g, i) =>
        i === ci
          ? { ...g, sizes: g.sizes.map((s, j) => (j === si ? { ...s, ...patch } : s)) }
          : g,
      ),
    );
  const addSize = (ci: number) =>
    onChange(
      groups.map((g, i) =>
        i === ci ? { ...g, sizes: [...g.sizes, { name: "", stock: "", price: "" }] } : g,
      ),
    );
  const removeSize = (ci: number, si: number) =>
    onChange(
      groups.map((g, i) =>
        i === ci ? { ...g, sizes: g.sizes.filter((_, j) => j !== si) } : g,
      ),
    );

  return (
    <div className="space-y-3">
      <div>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Palette className="h-4 w-4 text-primary" />
          {t.title}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
      </div>

      {groups.map((g, ci) => (
        <div key={ci} className="rounded-xl border border-border p-3">
          <div className="flex items-center gap-2">
            <input
              value={g.name}
              onChange={(e) => setColor(ci, { name: e.target.value })}
              placeholder={t.colorPlaceholder}
              className={`${inputSm} flex-1 font-semibold`}
            />
            <button
              type="button"
              onClick={() => removeColor(ci)}
              aria-label={t.removeColor}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 space-y-1.5 ps-1">
            {g.sizes.map((s, si) => (
              <div key={si} className="flex items-center gap-1.5">
                <Ruler className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={s.name}
                  onChange={(e) => setSize(ci, si, { name: e.target.value })}
                  placeholder={t.sizePlaceholder}
                  className={`${inputSm} min-w-0 flex-1`}
                />
                <input
                  value={s.stock}
                  onChange={(e) => setSize(ci, si, { stock: e.target.value })}
                  type="number"
                  min="0"
                  step="1"
                  placeholder={t.stock}
                  className={`${inputSm} w-20`}
                />
                <input
                  value={s.price}
                  onChange={(e) => setSize(ci, si, { price: e.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t.priceOptional}
                  className={`${inputSm} w-24`}
                />
                <button
                  type="button"
                  onClick={() => removeSize(ci, si)}
                  aria-label={t.removeSize}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addSize(ci)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-primary transition-opacity hover:opacity-80"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.addSize}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addColor}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-4 w-4" />
        {t.addColor}
      </button>
    </div>
  );
}
