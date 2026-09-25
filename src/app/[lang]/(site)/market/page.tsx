import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus, Store as StoreIcon, PackageSearch } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import {
  getMarketCategories,
  getMarketCities,
  getMarketRegions,
  getActiveListings,
  type ListingFilters,
} from "@/lib/data/market";
import { Container } from "@/components/ui/container";
import { PageHero } from "@/components/ui/page-hero";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MarketFilters } from "@/components/market-filters";
import { MarketListingCard } from "@/components/market-listing-card";
import { localeAlternates } from "@/lib/site";
import { getSectionSupply } from "@/lib/data/section-supply";
import { sectionRobots } from "@/lib/seo-rules";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const [dict, supply] = await Promise.all([
    getDictionary(lang),
    getSectionSupply().catch(() => []),
  ]);
  const live = supply.find((s) => s.section === "market")?.count ?? 0;
  return {
    title: dict.market.title,
    description: dict.market.subtitle,
    // Every filter combination (?q=, ?category=, ?sort=…) canonicalises to the
    // bare /market — the facets are disallowed in robots.ts and are rendered
    // per request, so they must not compete with the section page.
    alternates: localeAlternates(lang, "/market"),
    openGraph: {
      type: "website",
      title: dict.market.title,
      description: dict.market.subtitle,
    },
    // No live listing → a thin page for a crawler (lib/seo-rules; the sitemap
    // leaves it out on the same count).
    robots: sectionRobots(live),
  };
}

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const l = lang as Locale;
  const sp = await searchParams;

  const filters: ListingFilters = {
    q: sp.q,
    category: sp.category,
    region: sp.region,
    city: sp.city,
    priceMin: sp.min ? Number(sp.min) : undefined,
    priceMax: sp.max ? Number(sp.max) : undefined,
    datePosted: sp.date as ListingFilters["datePosted"],
    sort: (sp.sort as ListingFilters["sort"]) ?? "newest",
  };

  const PAGE_SIZE = 24;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [categories, cities, marketRegions, listings] = await Promise.all([
    getMarketCategories(l),
    getMarketCities(l),
    getMarketRegions(l),
    getActiveListings(l, filters, PAGE_SIZE, offset),
  ]);
  const hasMore = listings.length === PAGE_SIZE;

  // Preserve active filters across page links (drop the page param itself).
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "page") params.set(k, v);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/${lang}/market${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="pb-16">
      <PageHero
        title={dict.market.title}
        subtitle={dict.market.subtitle}
        icon={StoreIcon}
        actions={
          <ButtonLink
            href={`/${lang}/market/new`}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {dict.market.publish}
          </ButtonLink>
        }
      />
      <Container className="py-8">
        <div className="mt-2">
          <MarketFilters
            lang={lang}
            dict={dict}
            categories={categories}
            cities={cities}
            regions={marketRegions}
            initial={{
              q: sp.q ?? "",
              category: sp.category ?? "all",
              region: sp.region ?? "all",
              city: sp.city ?? "",
              priceMin: sp.min ?? "",
              priceMax: sp.max ?? "",
              datePosted: sp.date ?? "any",
              sort: sp.sort ?? "newest",
            }}
          />
        </div>

        <div className="mb-4 mt-8 flex items-center justify-between">
          <h2 className="text-xl font-bold">{dict.market.newest}</h2>
          {page > 1 && (
            <span className="text-sm text-muted-foreground">
              {dict.market.page} {page}
            </span>
          )}
        </div>
        {listings.length > 0 ? (
          <div
            data-animate
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            {listings.map((x) => (
              <MarketListingCard key={x.id} listing={x} lang={lang} dict={dict} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={PackageSearch}
            title={page > 1 ? dict.market.noMore : dict.market.empty}
            action={{ href: `/${lang}/market/new`, label: dict.market.publish }}
          />
        )}

        {(page > 1 || hasMore) && (
          <div className="mt-8 flex items-center justify-center gap-3">
            {page > 1 ? (
              <ButtonLink href={pageHref(page - 1)} variant="secondary">
                {dict.market.prevPage}
              </ButtonLink>
            ) : (
              <span />
            )}
            {hasMore && (
              <ButtonLink href={pageHref(page + 1)}>
                {dict.market.nextPage}
              </ButtonLink>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}
