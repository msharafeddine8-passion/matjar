"use client";

import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { CategoryKey } from "@/lib/catalog";
import { effectivePrice } from "@/lib/pricing";
import {
  attrControl,
  attrFacetOptions,
  attrRangeBounds,
  attributeFilterFields,
  priceRangeBounds,
  type AttrField,
} from "@/lib/attributes";
import {
  EMPTY_RANGE,
  emptyFilters,
  filtersActive,
  type CatalogueFilterState,
  type FilterableProduct,
  type RangeInput,
} from "@/lib/catalogue-filters";

// ===========================================================================
// Narrowing a catalogue — MJ-013
// ===========================================================================
//
// This is the half of MJ-013 that never existed. `lib/attributes.ts` has had
// `range: true`, attrRangeBounds() and attributeFilterFields() for a while; the
// CONTROL that consumes them lived in store-products.tsx, which is to say it
// did not live anywhere, and the registry carried a note saying so.
//
// WHY A RANGE NEEDED ITS OWN CONTROL, which is the whole reason the flag sat
// unrendered: the only filter control that existed turned every filterable
// field into a <select> of the distinct values present in the catalogue. For a
// purpose or a gearbox that is right — two options, both meaningful. For a
// mileage it is one option per car: a dropdown of four hundred numbers, sorted,
// that nobody can use. Nobody picks a mileage off a list. They say "under
// 100,000" and mean it as a span.
//
// Two things changed as this moved out of store-products.tsx, and both are
// MJ-013 rather than accidents of the move:
//
//   1. The dropdowns are now built by attrFacetOptions() instead of by a local
//      helper that returned a `select` field's DECLARED options whether or not
//      a single row carried one of them. That local helper is the exact defect
//      lib/attributes.ts was written to fix — a "Condition: new / used" control
//      over a catalogue that records no condition, where either setting empties
//      the grid. It affects no live store today: only realEstate and automotive
//      declare filterable fields and neither has a catalogue row.
//
//   2. Price joined the filters. It is not an attribute — it is a column, and
//      the only range on the platform with real data behind it — so it is gated
//      by priceRangeBounds() rather than by the attribute registry, and it is
//      offered on every layout rather than only on the card grids, because
//      "show me the cheap ones" is not a question about a sector.
//
// The state lives in the parent, not here. The parent is the thing that needs
// the FILTERED list, so a component that owned the answer and not the question
// would have to hand its result back up through a callback on every keystroke.
// `value` + `onChange` is one controlled pair, which is the ordinary shape.
//
// What the filters DECIDE is in lib/catalogue-filters.ts, so that it can be
// read and tested without rendering anything — the same split checkout already
// has between lib/checkout.ts and checkout/checkout-form.tsx.

// ---------------------------------------------------------------------------

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors ${
    on
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:border-primary/40"
  }`;

/** One "from / to" pair. The bounds the catalogue actually spans are the
 *  placeholders, so a shopper can see the real span without a slider — and
 *  without the control lying about a maximum nothing reaches. */
function RangePair({
  label,
  bounds,
  value,
  onChange,
  dict,
  step,
}: {
  label: string;
  bounds: { min: number; max: number };
  value: RangeInput;
  onChange: (r: RangeInput) => void;
  dict: Pick<Dictionary, "store">;
  step?: string;
}) {
  // Numbers are LTR with tabular figures inside Arabic text, the same house
  // rule money follows: "من ٥٠٠٠٠" otherwise resolves its digits against the
  // surrounding direction. h-11 is 44px — these are typed at, not just tapped,
  // so the box itself is the touch target rather than a pseudo-element.
  const box =
    "h-11 w-24 rounded-xl border border-border bg-surface px-3 text-sm font-semibold tabular-nums outline-none transition-colors focus:border-primary";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-semibold text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        dir="ltr"
        step={step}
        min={bounds.min}
        max={bounds.max}
        value={value.min}
        onChange={(e) => onChange({ ...value, min: e.target.value })}
        placeholder={String(bounds.min)}
        aria-label={`${label} — ${dict.store.rangeFrom}`}
        className={box}
      />
      <span className="text-sm text-muted-foreground">–</span>
      <input
        type="number"
        inputMode="decimal"
        dir="ltr"
        step={step}
        min={bounds.min}
        max={bounds.max}
        value={value.max}
        onChange={(e) => onChange({ ...value, max: e.target.value })}
        placeholder={String(bounds.max)}
        aria-label={`${label} — ${dict.store.rangeTo}`}
        className={box}
      />
    </div>
  );
}

export function CatalogueFilters({
  lang,
  dict,
  category,
  products,
  showAttributeFilters,
  value,
  onChange,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "store">;
  category: CategoryKey;
  /** The WHOLE catalogue, never the filtered list. Deriving the controls from
   *  the filtered rows would shrink the options as the shopper narrows, so the
   *  last choice they made would remove every alternative to it. */
  products: readonly FilterableProduct[];
  /** The attribute half was only ever drawn on the card grids; the menu list
   *  has no room for it. Brand and price are drawn on every layout. */
  showAttributeFilters: boolean;
  value: CatalogueFilterState;
  onChange: (next: CatalogueFilterState) => void;
}) {
  const brands = [
    ...new Set(
      products.map((p) => p.brand?.trim()).filter((b): b is string => !!b),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const priceBounds = priceRangeBounds(products.map((p) => effectivePrice(p)));

  const rows = products.map((p) => ({ attributes: p.attributes }));
  const fields: AttrField[] = showAttributeFilters
    ? attributeFilterFields(category, rows)
    : [];
  const facets = fields.filter((f) => attrControl(f) === "select");
  const spans = fields
    .map((f) => ({ f, bounds: attrRangeBounds(f, rows) }))
    .filter((x): x is { f: AttrField; bounds: { min: number; max: number } } =>
      x.bounds !== null,
    );

  const anything =
    brands.length > 1 || priceBounds !== null || fields.length > 0;
  if (!anything) return null;

  const label = (f: AttrField) => (lang === "ar" ? f.ar : f.en);

  return (
    <div className="mb-5 space-y-3">
      {brands.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...value, brand: null })}
            className={chip(value.brand === null)}
          >
            {dict.store.allBrands}
          </button>
          {brands.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onChange({ ...value, brand: b })}
              className={chip(value.brand === b)}
            >
              {b}
            </button>
          ))}
        </div>
      )}

      {(priceBounds || facets.length > 0 || spans.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {priceBounds && (
            <RangePair
              label={dict.store.priceRange}
              bounds={priceBounds}
              value={value.price}
              onChange={(price) => onChange({ ...value, price })}
              dict={dict}
              step="0.01"
            />
          )}
          {spans.map(({ f, bounds }) => (
            <RangePair
              key={f.key}
              label={label(f)}
              bounds={bounds}
              value={value.ranges[f.key] ?? EMPTY_RANGE}
              onChange={(r) =>
                onChange({ ...value, ranges: { ...value.ranges, [f.key]: r } })
              }
              dict={dict}
            />
          ))}
          {facets.map((f) => (
            <select
              key={f.key}
              value={value.attrs[f.key] ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  attrs: { ...value.attrs, [f.key]: e.target.value },
                })
              }
              className="h-11 rounded-full border border-border bg-surface px-3.5 text-sm font-semibold outline-none transition-colors focus:border-primary"
            >
              <option value="">{label(f)}</option>
              {attrFacetOptions(f, rows).map((o) => (
                <option key={o.value} value={o.value}>
                  {lang === "ar" ? o.ar : o.en}
                </option>
              ))}
            </select>
          ))}
          {/* Clears the brand too, which the old button did not. It appears
              whenever ANYTHING is narrowing the grid, and a "clear filters"
              that leaves one filter standing is worse than no button. */}
          {filtersActive(value) && (
            <button
              type="button"
              onClick={() => onChange(emptyFilters())}
              className="relative rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-foreground"
            >
              {dict.store.clearFilters}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
