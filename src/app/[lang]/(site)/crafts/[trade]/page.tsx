import { createElement } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wrench } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { ProfessionalCard } from "@/components/professional";
import { CraftEmptyState } from "@/components/crafts/craft-empty-state";
import { tradeIcon } from "@/lib/trade-icons";
import {
  browseCraftsAsProfiles,
  countActiveProviders,
  getAreasByRegion,
  getTrade,
  getTradeCounts,
  getTradeGroups,
  type AreaRef,
} from "@/lib/data/crafts";
import { localeAlternates } from "@/lib/site";
import { supplyRobots } from "@/lib/professional";

type Params = Promise<{ lang: string; trade: string }>;
type Search = Promise<{ area?: string; q?: string; sort?: string }>;

/** "all" is the escape hatch for a free-text search that matched no trade. */
const ALL = "all";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const { lang, trade } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  // The free-text catch-all is a search results view, never a landing page.
  if (trade === ALL) {
    return { title: dict.crafts.title, robots: supplyRobots({ supply: 0, filtered: true }) };
  }

  const [t, counts, sp] = await Promise.all([getTrade(trade), getTradeCounts(), searchParams]);
  if (!t) return {};
  const name = lang === "ar" ? t.name_ar : t.name_en;
  // The zero-supply rule (lib/professional.ts → supplyRobots). A trade page
  // with no active provider is the same empty state 47 times over, so it is
  // `noindex, follow` until trade_provider_counts says someone is listed — the
  // page still renders, still links to the request flow and the sibling
  // trades, and still sits in the /crafts taxonomy. Any area / q / sort
  // permutation is noindex regardless: the canonical below points at the bare
  // trade URL. The sitemap applies the same rule (SEO track, sitemap.ts).
  const robots = supplyRobots({
    supply: counts[t.slug] ?? 0,
    filtered: Boolean(sp.area || sp.q || (sp.sort && sp.sort !== "rating")),
  });
  // A real title for a real page: "كهربائي في لبنان — متجر".
  return {
    title: dict.crafts.metaTitle.replace("{trade}", name),
    description: dict.crafts.metaDesc.replace("{trade}", name),
    alternates: localeAlternates(lang, `/crafts/${t.slug}`),
    robots,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// One trade, filtered by area.
//
// This is the page that should rank: someone searching "كهربائي طرابلس" is not
// browsing, they have a problem right now. So it opens with the answer — the
// tradesmen when there are any, and when there are none, the same empty state
// the landing page uses, which routes to describing the problem rather than to
// a dead end. Sibling trades sit below as chips, because "سبّاك" and "عزل
// ورطوبة" are frequently the same leak.
//
// Every one of the 47 of these renders the empty state today. That is the
// argument for the empty state being a component and being good.
// ────────────────────────────────────────────────────────────────────────────
export default async function TradePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { lang, trade } = await params;
  if (!isLocale(lang)) notFound();
  const { area = "", q = "", sort = "rating" } = await searchParams;
  const dict = await getDictionary(lang);
  const t = dict.crafts;
  const ar = lang === "ar";

  const isAll = trade === ALL;
  const tradeRow = isAll ? null : await getTrade(trade);
  if (!isAll && !tradeRow) notFound();

  const [providers, areasByRegion, groups, providerCount] = await Promise.all([
    browseCraftsAsProfiles(
      {
        trade: isAll ? null : trade,
        area: area || null,
        q: q || null,
        sort,
        limit: 60,
      },
      lang,
    ),
    getAreasByRegion(),
    getTradeGroups(),
    countActiveProviders(),
  ]);

  const tradeName = tradeRow
    ? ar
      ? tradeRow.name_ar
      : tradeRow.name_en
    : q || t.allTrades;

  const allAreas: AreaRef[] = Object.values(areasByRegion).flat();
  const activeArea = allAreas.find((a) => a.slug === area);
  const activeAreaName = activeArea
    ? ar
      ? activeArea.name_ar
      : activeArea.name_en
    : null;

  const siblings = tradeRow
    ? (groups.find((g) => g.slug === tradeRow.group_slug)?.trades ?? []).filter(
        (tr) => tr.slug !== tradeRow.slug,
      )
    : [];
  const tradeTotal = groups.reduce((n, g) => n + g.trades.length, 0);

  // Resolve to an element up front. Binding the looked-up component to a
  // capitalised const inside render trips react/no-unstable-components; the
  // lookup is a plain function, so build the node with createElement and render
  // the node, not the type.
  const tradeIconNode = createElement(
    tradeRow ? tradeIcon(tradeRow.slug, tradeRow.group_slug) : Wrench,
    { "aria-hidden": true, className: "h-6 w-6" },
  );

  /** Keeps the other filters while changing one. */
  const hrefWith = (next: { area?: string; sort?: string }) => {
    const p = new URLSearchParams();
    const a = next.area ?? area;
    const s = next.sort ?? sort;
    if (a) p.set("area", a);
    if (q) p.set("q", q);
    if (s && s !== "rating") p.set("sort", s);
    return `/${lang}/crafts/${trade}${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div className="py-8 sm:py-10">
      <Container>
        <Link
          href={`/${lang}/crafts`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>

        <div className="mt-2 flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            {tradeIconNode}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              {tradeName}
              {activeAreaName && (
                <span className="text-muted-foreground"> — {activeAreaName}</span>
              )}
            </h1>
            {providers.length > 0 && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t.resultCount.replace("{n}", String(providers.length))}
              </p>
            )}
          </div>
        </div>

        {/* Area — the filter that decides everything in this section. Shown
            only where filtering could change the answer: with nobody listed at
            all, fourteen area chips are fourteen taps that lead to the same
            empty page. */}
        {providers.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={hrefWith({ area: "" })}
              aria-current={!area ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                !area
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface hover:border-primary/40"
              }`}
            >
              {t.anywhere}
            </Link>
            {allAreas.slice(0, 14).map((a) => (
              <Link
                key={a.slug}
                href={hrefWith({ area: a.slug })}
                aria-current={area === a.slug ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                  area === a.slug
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                {ar ? a.name_ar : a.name_en}
              </Link>
            ))}
          </div>
        )}

        {/* Sorting exists only when there is something to sort. "الأكثر طلبًا"
            is deliberately absent — there is no request volume behind it, and a
            sort that ranks on nothing is a lie told in a dropdown. */}
        {providers.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t.sortBy}</span>
            {(
              [
                ["rating", t.sortRating],
                ["reviews", t.sortReviews],
                ["completed", t.sortCompleted],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={hrefWith({ sort: key })}
                className={`inline-flex min-h-11 items-center rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                  sort === key
                    ? "bg-surface-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        {providers.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {providers.map((p) => (
              <ProfessionalCard
                key={p.id}
                profile={p}
                href={`/${lang}/crafts/p/${p.id}`}
                dict={dict}
                lang={lang}
              />
            ))}
          </div>
        ) : (
          <>
            {/* When the AREA filter is what emptied the page, widening it is
                the cheaper next tap than describing the whole job — so it is
                offered first, and only then the general route. */}
            {activeArea && (
              <p className="mt-6 text-sm text-muted-foreground">
                {t.tryAnywhere}{" "}
                <Link
                  href={hrefWith({ area: "" })}
                  className="font-bold text-primary underline-offset-4 hover:underline"
                >
                  {t.showAllAreas}
                </Link>
              </p>
            )}
            <CraftEmptyState
              lang={lang}
              t={t}
              className="mt-4"
              stats={{
                trades: tradeTotal,
                areas: allAreas.length,
                providers: providerCount,
              }}
              trade={tradeRow ? { slug: tradeRow.slug, name: tradeName } : null}
              areaName={activeAreaName}
              askQuery={{
                ...(q ? { problem: q } : {}),
                ...(area ? { area } : {}),
              }}
            />
          </>
        )}

        {/* The same leak is often another trade's job. */}
        {siblings.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-extrabold text-muted-foreground">
              {t.relatedTrades}
            </h2>
            <div className="mt-2 flex min-w-0 flex-wrap gap-2">
              {siblings.map((tr) => (
                <Link
                  key={tr.slug}
                  href={`/${lang}/crafts/${tr.slug}`}
                  className="inline-flex min-h-11 min-w-0 items-center rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                >
                  <span className="truncate">{ar ? tr.name_ar : tr.name_en}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </Container>
    </div>
  );
}
