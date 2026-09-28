import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronDown, Wrench } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { ProfessionalCard } from "@/components/professional";
import { CraftEmptyState } from "@/components/crafts/craft-empty-state";
import { CraftProblemAsk } from "@/components/crafts/craft-problem-ask";
import { groupIcon, tradeIcon } from "@/lib/trade-icons";
import {
  browseCraftsAsProfiles,
  countActiveProviders,
  getAreasByRegion,
  getTradeCounts,
  getTradeGroups,
} from "@/lib/data/crafts";
import { localeAlternates } from "@/lib/site";
import { supplyRobots } from "@/lib/professional";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  // Indexable at zero providers, and the only crafts page that is: the
  // symptom index and the full 47-trade taxonomy are content of their own
  // (supplyRobots' `uniqueContent`). The 47 trade pages stay noindex until
  // each has a provider — see crafts/[trade]/page.tsx.
  return {
    title: dict.crafts.title,
    description: dict.crafts.subtitle,
    alternates: localeAlternates(lang, "/crafts"),
    robots: supplyRobots({ supply: 0, uniqueContent: true }),
  };
}

// The jobs Lebanese households actually call about, phrased as the SYMPTOM
// rather than as the profession — "المكيّف ما عم يبرّد", not "صيانة مكيفات".
//
// That is the whole difference between this page and the directory it
// replaced. The customer knows the fridge stopped; working out that this is
// `fridge-repair` and not `appliance-general` is the platform's job, and the
// taxonomy is the only part of this section that is actually finished.
//
// Not "الأكثر طلبًا": there is no request volume to rank by, and a ranking
// backed by nothing is a lie with a chart behind it. Every slug is resolved
// against the live 47-row taxonomy at render time, so a renamed or retired
// trade silently drops out of the row instead of shipping a 404.
const COMMON_PROBLEM_SLUGS = [
  "ac-service",
  "plumber",
  "electrician",
  "washer-repair",
  "water-pump",
  "solar",
  "inverter",
  "fridge-repair",
  "painter",
  "furniture-moving",
  "home-cleaning",
  "waterproofing",
];

// ────────────────────────────────────────────────────────────────────────────
// The crafts landing page.
//
// Reading order at 390, and the reason for each step:
//
//   1. One question — "شو خربان؟" — and the box that takes the answer. Not
//      "which trade do you want", because the customer does not know and
//      should not have to.
//   2. Common problems, as symptoms. Twelve taps that skip the typing.
//   3. Whoever exists. Today: nobody, so this is the empty state — which makes
//      it the main screen of this page rather than its failure mode.
//   4. The taxonomy, folded. Nine groups, all 47 trades in the HTML.
//
// Nothing above renders a fact the database does not hold. The provider grid
// appears the day browse_crafts returns rows and not one day earlier, and the
// counters in the empty state print whatever the count is, zero included.
// ────────────────────────────────────────────────────────────────────────────
export default async function CraftsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.crafts;
  const ar = lang === "ar";

  const [groups, counts, areasByRegion, featured, providerCount] = await Promise.all([
    getTradeGroups(),
    getTradeCounts(),
    getAreasByRegion(),
    browseCraftsAsProfiles({ limit: 8 }, lang),
    countActiveProviders(),
  ]);

  const allTrades = groups.flatMap((g) => g.trades);
  const problems = COMMON_PROBLEM_SLUGS.map((slug) => {
    const trade = allTrades.find((tr) => tr.slug === slug);
    const label = (t.problems as Record<string, string>)[slug];
    // Both halves have to exist: a slug the taxonomy dropped, or a phrase the
    // dictionary has not been given, drops the chip rather than rendering half
    // of one or falling back to the raw slug.
    return trade && label ? { trade, label } : null;
  }).filter((p) => p !== null);

  const areaCount = Object.values(areasByRegion).reduce((n, a) => n + a.length, 0);
  const regionNames = t.regionNames as unknown as Record<string, string>;

  return (
    <div className="py-8 sm:py-10">
      <Container>
        {/* 1 — the question. Three short lines, so that on a 360px phone the
            heading, the box and the first chips share one viewport. */}
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary">
            <Wrench aria-hidden className="h-3.5 w-3.5" />
            {t.badge}
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t.askTitle}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            {t.askLead}
          </p>
        </div>

        <div className="mt-4 max-w-2xl">
          <CraftProblemAsk
            lang={lang}
            areasByRegion={areasByRegion}
            regionNames={regionNames}
            labels={{
              placeholder: t.askPlaceholder,
              where: t.askWhere,
              anywhere: t.anywhere,
              submit: t.askSubmit,
              didYouMean: t.askDidYouMean,
              needProblem: t.askNeedProblem,
              understood: dict.proMarket.askUnderstood,
            }}
          />
        </div>

        {/* 2 — the same question, pre-answered. One scrolling row on a phone,
            wrapping on desktop. `-mx-5` matches Container's px-5 exactly, so
            the row bleeds to the screen edge and no further, and the scroll
            container is what keeps the chips off the document's own width. */}
        {problems.length > 0 && (
          <section className="mt-5">
            <h2 className="text-xs font-semibold text-muted-foreground">
              {t.commonTitle}
            </h2>
            <div className="-mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {problems.map(({ trade, label }) => {
                const Icon = tradeIcon(trade.slug, trade.group_slug);
                return (
                  <Link
                    key={trade.slug}
                    href={`/${lang}/crafts/${trade.slug}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
                  >
                    <Icon aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* 3 — whoever exists. Exactly one of these two renders: either there
            are tradesmen and they are the section, or there are none and the
            empty state is. There is no third arrangement where a heading sits
            over an empty grid certifying the emptiness. */}
        {featured.length > 0 ? (
          <section className="mt-8 sm:mt-10">
            <h2 className="text-lg font-extrabold">{t.providers}</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {featured.map((p) => (
                <ProfessionalCard
                  key={p.id}
                  profile={p}
                  href={`/${lang}/crafts/p/${p.id}`}
                  dict={dict}
                  lang={lang}
                />
              ))}
            </div>
          </section>
        ) : (
          <CraftEmptyState
            lang={lang}
            t={t}
            className="mt-8 sm:mt-10"
            stats={{
              trades: allTrades.length,
              areas: areaCount,
              providers: providerCount,
            }}
          />
        )}

        {/* 4 — the taxonomy. Nine compact cards, each expandable in place; all
            47 trade links are in the HTML either way, so nothing is hidden
            from a crawler, only folded away from a first glance.

            `min-w-0` on the <details> is load-bearing and not a tidy-up. A grid
            item's automatic minimum size is its MIN-CONTENT width, and the
            preview line inside the summary is `truncate` — i.e. white-space:
            nowrap, whose min-content is the whole untruncated Arabic string.
            Without this the single implicit column below `sm` was floored at
            442px and took the entire document sideways with it: 103px of
            horizontal scroll at 360, 72 at 390, 32 at 430, and none at all at
            768, because `sm:grid-cols-2` compiles to minmax(0,1fr) and that
            explicit 0 minimum overrides the automatic one. `grid-cols-1` at the
            base does the same job for the one-column case; both are here
            because either alone leaves the other route open. */}
        <section className="mt-8 sm:mt-10">
          <h2 className="text-lg font-extrabold">{t.browseTitle}</h2>
          <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => {
              const GIcon = groupIcon(g.slug);
              const preview = g.trades
                .slice(0, 4)
                .map((tr) => (ar ? tr.name_ar : tr.name_en))
                .join(" · ");
              return (
                <details
                  key={g.slug}
                  className="group min-w-0 rounded-2xl border border-border bg-surface"
                >
                  <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <GIcon aria-hidden className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <h3 className="truncate font-bold">
                          {ar ? g.name_ar : g.name_en}
                        </h3>
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                          {t.tradesCount.replace("{n}", String(g.trades.length))}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {preview}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="flex min-w-0 flex-wrap gap-2 border-t border-border p-4 pt-3">
                    {g.trades.map((tr) => (
                      <Link
                        key={tr.slug}
                        href={`/${lang}/crafts/${tr.slug}`}
                        className="inline-flex min-h-11 min-w-0 items-center rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                      >
                        <span className="truncate">
                          {ar ? tr.name_ar : tr.name_en}
                        </span>
                        {/* A count only where there is one to show — a "0"
                            beside every trade would be the emptiness said
                            forty-seven more times. */}
                        {(counts[tr.slug] ?? 0) > 0 && (
                          <span
                            dir="ltr"
                            className="ms-1.5 text-xs font-normal tabular-nums text-muted-foreground"
                          >
                            {counts[tr.slug]}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      </Container>
    </div>
  );
}
