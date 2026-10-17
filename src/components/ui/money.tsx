import type { ComponentProps } from "react";

import { formatUsd, type FormatUsdOptions } from "@/lib/currency";

// The one way to put a price on screen.
//
// This does NOT format money — src/lib/currency.ts does, and stays the single
// source of truth for what "$1,234.57" looks like. Nor does it define the
// typography: globals.css already ships `.text-money`
// (tabular-nums + direction:ltr + unicode-bidi:isolate). What was missing was
// anything that made a caller USE both together, and the numbers say so: 66
// places render a USD amount and only 16 carry `.text-money`. Two files had
// even re-implemented the formatter locally as `formatPrice`.
//
// The two rules the class encodes, restated because they are the reason this
// component exists rather than a bare `{formatUsd(n)}`:
//
// 1. LTR isolate. "$1,200" inside an Arabic paragraph is a run of neutral and
//    number characters in an RTL paragraph, so bidi resolves it against the
//    surrounding direction: the leading "$" is a neutral and gets pushed to
//    whichever end the RTL run wants, and a range ("$10 - $20") reorders
//    outright. The isolate pins the amount to one visual order whatever text
//    surrounds it.
//
// 2. Tabular figures. Tajawal's default figures are proportional, so a column
//    of prices in a table or an order list has its decimal points wandering by
//    a digit width per row. Tabular figures give every glyph the same advance,
//    which is what makes a money column scannable.
//
// Renders a <span>. Extra props (className, title, …) pass through; wrap it
// rather than trying to render it as a <td>.

export function Money({
  value,
  cents,
  fixed,
  prefix,
  className = "",
  ...props
}: {
  /** USD amount. */
  value: number;
  /** Round to 2 decimals first — for surfaces that settle real amounts
   *  (invoices, POS, supplier bills). See formatUsd's `cents` option. */
  cents?: FormatUsdOptions["cents"];
  /** Always two decimals ("$12.50") — printed receipts. See formatUsd. */
  fixed?: FormatUsdOptions["fixed"];
  /** A sign or symbol that belongs to the amount — "−" on a discount row, "+"
   *  on a surcharge. It has to be rendered INSIDE the isolate: order summaries
   *  were writing `−{formatUsd(x)}`, which leaves the sign outside as a bidi
   *  neutral, and in Arabic the RTL run then puts it on the wrong end — the
   *  discount line reads "$12−". */
  prefix?: string;
} & Omit<ComponentProps<"span">, "children">) {
  return (
    <span className={`text-money ${className}`} {...props}>
      {prefix}
      {formatUsd(
        value,
        fixed ? { fixed: true } : cents ? { cents: true } : undefined,
      )}
    </span>
  );
}
