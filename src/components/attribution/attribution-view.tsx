import {
  MATJAR_SOURCES,
  countForm,
  isMatjarSource,
  type ReportSummary,
} from "@/lib/attribution";
import type { Dictionary } from "@/i18n/get-dictionary";

// Shared, presentational pieces of the attribution card and the monthly
// summary page. Server-safe (no hooks), dictionary-driven, logical CSS only.

type T = Dictionary["attribution"];

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

/** "3 زباين جداد" / "3 new customers". */
export function customersPhrase(t: T, n: number): string {
  return fill(t.customers[countForm(n)], { n });
}

/** «دليل متجر، البحث على متجر، …» — exactly which sources count. */
export function matjarSourceList(t: T, lang: "ar" | "en"): string {
  return MATJAR_SOURCES.map((s) => t.sources[s]).join(lang === "ar" ? "، " : ", ");
}

export function sourceLabel(t: T, src: string): string {
  return (t.sources as Record<string, string>)[src] ?? src;
}

/** Western digits in both locales. */
export function lbpAmount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** The per-source table: every source seen this month, Matjar's first. */
export function SourceBreakdown({
  t,
  summary,
}: {
  t: T;
  summary: ReportSummary;
}) {
  if (summary.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.card.empty}</p>;
  }
  const showBookings = summary.totalBookings !== null && summary.totalBookings > 0;
  const rows = [...summary.rows].sort(
    (a, b) => Number(isMatjarSource(b.src)) - Number(isMatjarSource(a.src)),
  );
  const max = Math.max(1, ...rows.map((r) => r.orders + (r.bookings ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-2 text-start font-semibold">{t.card.colSource}</th>
            <th className="pb-2 text-end font-semibold">{t.card.colOrders}</th>
            {showBookings && (
              <th className="pb-2 text-end font-semibold">{t.card.colBookings}</th>
            )}
            <th className="pb-2 text-end font-semibold">{t.card.colNew}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const matjar = isMatjarSource(r.src);
            const width = ((r.orders + (r.bookings ?? 0)) / max) * 100;
            return (
              <tr key={r.src} className="border-t border-border">
                <td className="py-2 pe-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{sourceLabel(t, r.src)}</span>
                    {matjar && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {t.card.matjarBadge}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={`h-full rounded-full ${matjar ? "bg-primary" : "bg-muted-foreground/40"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </td>
                <td className="py-2 text-end tabular-nums">{r.orders}</td>
                {showBookings && (
                  <td className="py-2 text-end tabular-nums">{r.bookings ?? 0}</td>
                )}
                <td className="py-2 text-end font-bold tabular-nums">{r.newCustomers}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
