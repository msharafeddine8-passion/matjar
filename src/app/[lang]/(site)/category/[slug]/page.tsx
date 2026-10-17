import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { categoryKeys, categoryStyles, type CategoryKey } from "@/lib/catalog";
import { localeAlternates, shareImages } from "@/lib/site";
import { discoveryParams, siblingSectors } from "@/lib/discovery";
import { getDiscoveryCoverage } from "@/lib/data/discovery";
import { categoryIcons } from "@/components/category-icon";
import { CountText } from "@/components/ui/count-text";
import {
  DiscoveryPage,
  resolveQuery,
  type RawSearchParams,
} from "@/components/discovery-page";

function isCategoryKey(value: string): value is CategoryKey {
  return (categoryKeys as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang) || !isCategoryKey(slug)) return {};
  const dict = await getDictionary(lang);
  const cat = dict.catalog[slug];
  // The layout template appends the brand to <title>; appending it here too
  // rendered "Health & clinics — Matjar · متجر". The share card has no
  // template, so it keeps the brand in its own title.
  const title = cat.name;
  const shareTitle = `${cat.name} — ${dict.common.brand}`;
  const images = shareImages();
  const query = resolveQuery(await searchParams, slug);
  const coverage = await getDiscoveryCoverage();
  const count = coverage.bySector[slug] ?? 0;

  const alternates = localeAlternates(lang, `/category/${slug}`);
  // The pinned sector is in the path, so it must not also be in the canonical
  // query string — otherwise every category page has two addresses.
  const qs = discoveryParams({ ...query, sector: null }).toString();
  const suffix = qs ? `?${qs}` : "";

  return {
    title,
    description: cat.desc,
    alternates: { ...alternates, canonical: `${alternates.canonical}${suffix}` },
    openGraph: {
      title: shareTitle,
      description: cat.desc,
      images: images.openGraph,
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: cat.desc,
      images: images.twitter,
    },
    // A category with no merchant yet is a real page for a visitor who followed
    // a link, and a thin, empty one for a crawler. Same for a free-text search.
    robots: count === 0 || query.q ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { lang, slug } = await params;
  if (!isLocale(lang) || !isCategoryKey(slug)) notFound();

  const dict = await getDictionary(lang);
  const query = resolveQuery(await searchParams, slug);
  const coverage = await getDiscoveryCoverage();

  const cat = dict.catalog[slug];
  const Icon = categoryIcons[slug];
  const style = categoryStyles[slug];
  const count = coverage.bySector[slug] ?? 0;
  // Sideways links, but only to sectors that would not land the buyer on an
  // empty page. At today's inventory this means most categories show none —
  // which is the correct amount of navigation to an empty room.
  const siblings = siblingSectors(slug, coverage);

  return (
    <div className="pb-16">
      <DiscoveryPage
        lang={lang}
        dict={dict}
        base={`/${lang}/category/${slug}`}
        query={query}
        pinned={slug}
        header={
          <header className="mb-6">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${style.iconWrap}`}
              >
                <Icon aria-hidden className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {cat.name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                  {cat.desc}
                </p>
                {/* The live count, not a boast. It is the one number that tells
                    a buyer whether this category is worth their scroll. */}
                <p className="mt-1.5 text-sm text-muted-foreground">
                  <CountText forms={dict.discovery.storesCount} n={count} />
                </p>
              </div>
            </div>

            {siblings.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-label text-muted-foreground">
                  {dict.discovery.alsoIn}
                </span>
                {siblings.map((s) => (
                  <Link
                    key={s}
                    href={`/${lang}/category/${s}`}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-semibold transition-colors hover:border-primary/40"
                  >
                    {dict.catalog[s].name}
                    <span className="text-xs font-medium tabular-nums opacity-70">
                      {coverage.bySector[s] ?? 0}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </header>
        }
      />
    </div>
  );
}
