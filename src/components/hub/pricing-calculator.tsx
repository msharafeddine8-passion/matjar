"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { computePrice } from "@/lib/hub-calc";
import { trackToolUse } from "@/lib/track-tool";

const field =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

function money(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// From cost + target margin (+ optional fees/tax) → the price to sell at, and
// the resulting profit per unit. The inverse of the profit calculator.
export function PricingCalculator({ dict }: { dict: Pick<Dictionary, "hub"> }) {
  const t = dict.hub.tools.pricing;
  const [cost, setCost] = useState("");
  const [margin, setMargin] = useState("30");
  const [extra, setExtra] = useState("");

  const c = parseFloat(cost);
  const m = parseFloat(margin);
  const e = parseFloat(extra) || 0;
  // Margin must be < 100 (a 100% margin implies infinite price).
  const valid = isFinite(c) && c > 0 && isFinite(m) && m >= 0 && m < 100;

  const r = useMemo(() => (valid ? computePrice(c, m, e) : null), [valid, c, m, e]);

  useEffect(() => {
    if (valid) trackToolUse("pricing");
  }, [valid]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.cost}</span>
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.marginPct}</span>
          <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="30" className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.extraPct}</span>
          <input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" className={field} />
        </label>
      </div>

      <div className="rounded-2xl border border-border bg-surface-muted/40 p-6">
        {r ? (
          <div className="grid gap-4">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">{t.suggested}</p>
              <p className="mt-1 text-4xl font-extrabold tabular-nums text-primary">{money(r.final)}</p>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold text-muted-foreground">{t.profitPerUnit}</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{money(r.profit)}</p>
            </div>
          </div>
        ) : (
          <p className="grid h-full place-items-center text-center text-sm text-muted-foreground">{t.hint}</p>
        )}
      </div>
    </div>
  );
}
