"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { computeProfit } from "@/lib/hub-calc";
import { trackToolUse } from "@/lib/track-tool";

const field =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

function money(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Deterministic, client-only profit & margin calculator. Live-computes as the
// merchant types; no server, no AI.
export function ProfitCalculator({ dict }: { dict: Pick<Dictionary, "hub"> }) {
  const t = dict.hub.tools.profit;
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");

  const c = parseFloat(cost);
  const p = parseFloat(price);
  const q = Math.max(1, parseInt(qty || "1", 10) || 1);
  const valid = isFinite(c) && isFinite(p);

  const r = useMemo(() => (valid ? computeProfit(c, p, q) : null), [valid, c, p, q]);

  useEffect(() => {
    if (valid) trackToolUse("profit");
  }, [valid]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.cost}</span>
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.price}</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.qty}</span>
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" className={field} />
        </label>
      </div>

      <div className="rounded-2xl border border-border bg-surface-muted/40 p-6">
        {r ? (
          <div className="grid gap-4">
            <div className="flex items-end justify-between gap-3 border-b border-border pb-4">
              <span className="text-sm font-semibold text-muted-foreground">{t.unitProfit}</span>
              <span className={`text-3xl font-extrabold tabular-nums ${r.loss ? "text-danger" : "text-primary"}`}>
                {money(r.unit)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Metric label={t.margin} value={`${money(r.margin)}%`} loss={r.loss} />
              <Metric label={t.markup} value={`${money(r.markup)}%`} loss={r.loss} />
              <Metric label={t.totalRevenue} value={money(r.revenue)} />
              <Metric label={t.totalProfit} value={money(r.profit)} loss={r.loss} strong />
            </div>
            {r.loss && (
              <p className="rounded-xl bg-danger-soft px-3 py-2 text-center text-sm font-bold text-danger">
                {t.loss}
              </p>
            )}
          </div>
        ) : (
          <p className="grid h-full place-items-center text-center text-sm text-muted-foreground">{t.hint}</p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, loss, strong }: { label: string; value: string; loss?: boolean; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? "text-xl font-extrabold" : "text-lg font-bold"} ${loss ? "text-danger" : ""}`}>
        {value}
      </p>
    </div>
  );
}
