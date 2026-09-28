import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/now";
import { beirutMonth } from "@/lib/attribution";
import { loadAttributionReport } from "@/lib/data/attribution-report";
import {
  SourceBreakdown,
  customersPhrase,
  fill,
  lbpAmount,
  matjarSourceList,
} from "@/components/attribution/attribution-view";

// «متجر جابلك X زبون جديد هالشهر بقيمة $Y» — the merchant dashboard card.
//
// X counts only customers who were NEW to this shop (no earlier non-cancelled
// order or booking by the same account or phone) and whose first interaction
// this Beirut month came from a Matjar surface: the directory, search, the
// map, Sunday Market, the offers page. Instagram, WhatsApp, Google and direct
// links are the merchant's own reach and are shown in the breakdown, never in
// X. Y is the total of those customers' first orders (USD; lira orders are
// listed beside it, never converted into it).
//
// Self-contained async server component so the dashboard home needs ONE line
// to mount it. Every plan (FEATURES.sourceAttribution). Before migration 0312
// is applied it renders a one-line "not available yet" card; for a staff
// member without the orders permission it renders nothing.
export async function MatjarBroughtCard({
  storeId,
  lang,
}: {
  storeId: string;
  lang: Locale;
}) {
  const [dict, supabase] = await Promise.all([getDictionary(lang), createClient()]);
  const t = dict.attribution;
  const month = beirutMonth(new Date(requestNow()));
  const report = await loadAttributionReport(supabase, storeId, month);
  const summaryHref = `/${lang}/merchant/${storeId}/reports/matjar-summary`;

  if (!report.ok && report.reason === "denied") return null;

  return (
    <Card as="section" className="mt-6 p-5 sm:p-6">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        {t.card.heading}
      </h2>

      {!report.ok ? (
        <p className="mt-3 text-sm text-muted-foreground">{t.card.unavailable}</p>
      ) : (
        <>
          {(() => {
            const s = report.summary;
            const customers = customersPhrase(t, s.matjarNewCustomers);
            if (s.matjarNewCustomers === 0) {
              return (
                <p className="mt-3 text-lg font-extrabold">{t.card.zeroTitle}</p>
              );
            }
            const [before, after] = (
              s.matjarNewValueUsd > 0 ? t.card.title : t.card.titleNoValue
            )
              .replace("{customers}", customers)
              .split("{value}");
            return (
              <div className="mt-3">
                <p className="text-xl font-extrabold leading-snug sm:text-2xl">
                  {before}
                  {s.matjarNewValueUsd > 0 && (
                    <>
                      <Money value={s.matjarNewValueUsd} cents className="text-primary" />
                      {after}
                    </>
                  )}
                </p>
                {s.matjarNewValueLbp > 0 && (
                  <p className="mt-1 text-sm font-semibold text-muted-foreground">
                    {fill(t.card.lbpOrders, { amount: lbpAmount(s.matjarNewValueLbp) })}
                  </p>
                )}
                {s.matjarNewValueUsd > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{t.card.valueHint}</p>
                )}
              </div>
            );
          })()}

          <p className="mt-2 text-xs text-muted-foreground">
            {fill(t.card.countsFrom, { list: matjarSourceList(t, lang) })}{" "}
            {t.card.howNew}
          </p>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold">{t.card.breakdownTitle}</h3>
            <SourceBreakdown t={t} summary={report.summary} />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">{t.card.noCommission}</p>
            <Link
              href={summaryHref}
              className="text-sm font-bold text-primary hover:underline"
            >
              {t.card.summaryLink}
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
