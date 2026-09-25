import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronNext, ChevronPrev } from "@/components/ui/directional-icon";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/now";
import {
  beirutMonth,
  isMonthKey,
  monthLabel,
  nextMonth,
  previousMonth,
} from "@/lib/attribution";
import { loadAttributionReport } from "@/lib/data/attribution-report";
import {
  SourceBreakdown,
  customersPhrase,
  fill,
  lbpAmount,
  matjarSourceList,
} from "@/components/attribution/attribution-view";
import { ShareSummary } from "@/components/attribution/share-summary";

// The monthly summary a merchant can share as social proof: «هالشهر وصلنا X
// زبون جديد عن طريق متجر».
//
// DECISION — owner/staff-only page, no public tokenized copy. What makes it
// shareable is its content, not its URL: totals only (no customer name, phone
// or id exists anywhere in it — store_attribution_report returns aggregates),
// plus a ready-made sentence the merchant sends from their own phone (wa.me,
// free) or copies into a story. A public link would need a share-token table
// and an anon-readable function that exposes a shop's order volume to anyone
// holding the link — more surface than a screenshot needs.
//
// Every plan (FEATURES.sourceAttribution). Staff need the orders permission
// (the function re-checks it). The page is behind auth and the merchant
// layout, so reading ?month= here costs nothing extra (vercel-cost-guard: it
// was never a static page).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.attribution.summary.metaTitle, robots: { index: false } };
}

export default async function MatjarSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; storeId: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const sp = await searchParams;

  const [dict, supabase] = await Promise.all([getDictionary(lang), createClient()]);
  const t = dict.attribution;
  const current = beirutMonth(new Date(requestNow()));
  const asked = typeof sp.month === "string" ? sp.month : "";
  // A month in the future has nothing in it yet; show the current one.
  const month = isMonthKey(asked) && asked <= current ? asked : current;

  const { data: store } = await supabase
    .from("stores")
    .select("name")
    .eq("id", storeId)
    .maybeSingle();
  const storeName = (store as { name?: string } | null)?.name ?? "";

  const report = await loadAttributionReport(supabase, storeId, month);
  const base = `/${lang}/merchant/${storeId}`;
  const label = monthLabel(month, lang);

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={base}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.summary.back}
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              {fill(t.summary.title, { month: label })}
            </h1>
            {storeName && (
              <p className="mt-1 text-sm text-muted-foreground">
                {fill(t.summary.subtitle, { store: storeName })}
              </p>
            )}
          </div>
          <nav className="flex items-center gap-2 text-sm font-bold">
            <Link
              href={`${base}/reports/matjar-summary?month=${previousMonth(month)}`}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-2 hover:border-primary hover:text-primary"
            >
              <ChevronPrev className="h-4 w-4" />
              {t.summary.prevMonth}
            </Link>
            {month < current && (
              <Link
                href={`${base}/reports/matjar-summary?month=${nextMonth(month)}`}
                className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-2 hover:border-primary hover:text-primary"
              >
                {t.summary.nextMonth}
                <ChevronNext className="h-4 w-4" />
              </Link>
            )}
          </nav>
        </div>

        {!report.ok ? (
          <Card className="mt-6 p-6 text-sm text-muted-foreground">
            {report.reason === "denied" ? t.summary.denied : t.summary.unavailable}
          </Card>
        ) : (
          (() => {
            const s = report.summary;
            const customers = customersPhrase(t, s.matjarNewCustomers);
            const shareText = fill(
              s.matjarNewCustomers > 0 ? t.summary.shareText : t.summary.shareTextZero,
              { month: label, customers, store: storeName },
            );
            const tiles: { label: string; value: React.ReactNode }[] = [
              { label: t.summary.newFromMatjar, value: s.matjarNewCustomers },
              {
                label: t.summary.valueFromMatjar,
                value: (
                  <span className="flex flex-col">
                    <Money value={s.matjarNewValueUsd} cents />
                    {s.matjarNewValueLbp > 0 && (
                      <span className="text-xs font-semibold text-muted-foreground">
                        {fill(t.card.lbpOrders, { amount: lbpAmount(s.matjarNewValueLbp) })}
                      </span>
                    )}
                  </span>
                ),
              },
              { label: t.summary.ordersFromMatjar, value: s.matjarOrders },
              ...(s.matjarBookings !== null && (s.totalBookings ?? 0) > 0
                ? [{ label: t.summary.bookingsFromMatjar, value: s.matjarBookings }]
                : []),
              { label: t.summary.totalOrders, value: s.totalOrders },
              { label: t.summary.totalNew, value: s.totalNewCustomers },
            ];
            return (
              <>
                <Card className="mt-6 bg-gradient-to-br from-primary/10 to-transparent p-6 sm:p-8">
                  <p className="text-sm font-bold text-primary">{storeName}</p>
                  <p className="mt-2 text-2xl font-extrabold leading-snug sm:text-3xl">
                    {s.matjarNewCustomers > 0
                      ? fill(t.card.titleNoValue, { customers })
                      : t.card.zeroTitle}
                  </p>
                  <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {tiles.map((tile) => (
                      <div
                        key={tile.label}
                        className="rounded-2xl border border-border bg-surface p-4"
                      >
                        <dt className="text-xs font-semibold text-muted-foreground">
                          {tile.label}
                        </dt>
                        <dd className="mt-1 text-xl font-extrabold tabular-nums">
                          {tile.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-xs text-muted-foreground">{t.summary.privacy}</p>
                </Card>

                <Card className="mt-6 p-5 sm:p-6">
                  <h2 className="text-sm font-bold">{t.summary.shareTitle}</h2>
                  <p className="mb-3 mt-1 text-xs text-muted-foreground">
                    {t.summary.shareHint}
                  </p>
                  <ShareSummary
                    text={shareText}
                    labels={{
                      shareWa: t.summary.shareWa,
                      copy: t.summary.copy,
                      copied: t.summary.copied,
                    }}
                  />
                </Card>

                <Card className="mt-6 p-5 sm:p-6">
                  <h2 className="mb-3 text-sm font-bold">{t.card.breakdownTitle}</h2>
                  <SourceBreakdown t={t} summary={s} />
                </Card>

                <Card className="mt-6 p-5 text-sm sm:p-6">
                  <h2 className="font-bold">{t.summary.definitionsTitle}</h2>
                  <ul className="mt-2 list-disc space-y-1.5 ps-5 text-muted-foreground">
                    <li>{fill(t.summary.defMatjar, { list: matjarSourceList(t, lang) })}</li>
                    <li>{t.summary.defNew}</li>
                    <li>{t.summary.defUnknown}</li>
                    <li>{t.summary.defMonth}</li>
                    <li>{t.card.noCommission}</li>
                  </ul>
                </Card>
              </>
            );
          })()
        )}
      </Container>
    </div>
  );
}
