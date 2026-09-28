import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates, SITE_URL } from "@/lib/site";
import { siteJsonLd, jsonLdScript } from "@/lib/jsonld";
import { Hero } from "@/components/hero";
import { WorldsShowcase } from "@/components/worlds-showcase";
import { FeaturedStores } from "@/components/featured-stores";
import { BestSellersTeaser } from "@/components/best-sellers-teaser";
import { ForYouStrip } from "@/components/for-you-strip";
import { HomeMore } from "@/components/home-more";
import { HomeLocation } from "@/components/home/home-location";
import { SectorGateways } from "@/components/home/sector-gateways";
import { OpenNowRail } from "@/components/home/open-now-rail";
import { CraftsDoor } from "@/components/home/crafts-door";
import { MerchantCta } from "@/components/merchant-cta";
import { SectionSkeleton } from "@/components/section-skeleton";
import { dictSlice } from "@/lib/dict-slice";
import { getNavSections } from "@/lib/data/section-supply";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  // The layout default is one bilingual string for both locales; /en was
  // served an Arabic-first title and a half-Arabic description. `absolute`
  // keeps the template from appending the brand a second time.
  const title =
    lang === "ar"
      ? "متجر — كل متاجر لبنان وخدماته بمكان واحد"
      : "Matjar — every shop and service in Lebanon, in one place";
  const description =
    lang === "ar"
      ? "اكتشف المتاجر والمطاعم والعيادات والخدمات في منطقتك، اطلب أو احجز أو تواصل مباشرةً عبر واتساب."
      : "Discover shops, restaurants, clinics and services near you in Lebanon — order, book or message them directly on WhatsApp.";
  return {
    title: { absolute: title },
    description,
    alternates: localeAlternates(lang, ""),
    openGraph: {
      type: "website",
      siteName: "متجر · Matjar",
      title,
      description,
      locale: lang === "ar" ? "ar_LB" : "en_US",
      alternateLocale: lang === "ar" ? ["en_US"] : ["ar_LB"],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const dict = await getDictionary(lang);
  // Cached and shared with the header and footer (MP-026), so the tiles at the
  // bottom of this page and the navigation at the top of it cannot disagree
  // about which verticals have anything in them.
  const sections = await getNavSections();

  // V2 answered one question, in order: what is this (hero + search) → what can
  // I browse (categories) → who is actually here (recommended, then real
  // stores) → what is moving (one highlight) → what else exists (compact) →
  // and only then, the merchant door.
  //
  // V3 keeps that spine and puts two things in front of it, because the first
  // two questions a customer arriving on a phone actually has are narrower than
  // "what is this":
  //
  //   which half of this marketplace am I here for   → SectorGateways
  //   what can I get from it right now               → OpenNowRail
  //
  // Both sit above the nine-tile category rail rather than replacing it: the
  // gateways cover the four sectors that carry most of the intent, and the rail
  // below still covers the other five for everyone whose errand is not one of
  // those four.
  //
  // Phones and desktop read the same sequence, so the CSS `order` shuffle an
  // earlier pass needed is gone with the sections that made it necessary. What
  // does differ by width is the hero's own contents (see components/hero.tsx).
  // Everything the merchant-software pitch used to say on this page is on
  // /merchants; the FAQ is on /help; the region index is on /explore.
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            siteJsonLd({
              siteUrl: SITE_URL,
              lang,
              name: dict.common.brand,
              description: dict.hero.subtitle,
            }),
          ),
        }}
      />

      {/* Below `lg` this section is the location row and nothing else — the
          headline is announced but not drawn and the rest is desktop-only, so
          the phone's first viewport reads: search (in the sticky header) →
          location → gateways → open now. The location row reads the discovery
          coverage, so it is streamed rather than awaited — the fallback
          reserves its exact height (h-11 under mt-3) so nothing below it moves
          when it lands. */}
      <Hero lang={lang} dict={dict}>
        <Suspense fallback={<div className="h-11" />}>
          <HomeLocation
            lang={lang}
            labels={{
              byArea: dict.home.byArea,
              allRegions: dict.explore.allRegions,
            }}
          />
        </Suspense>
      </Hero>

      {/* The four doors. Sits directly under the location row — and under the
          header's search field, which is where search lives below `lg` — so
          the phone's first viewport is: search → location → gateways →
          open now. Static and cheap: four links, no data read, never streamed,
          so it can never be the thing that keeps the fold empty. */}
      <SectorGateways lang={lang} dict={dictSlice(dict, ["home"])} />

      {/* Stores a customer can act on at this exact moment. Above the category
          rail on purpose: "open now" answers a question the customer already
          has, and browsing by sector is what you do when you do not have one.
          Streamed — it reads the store listing — with the standard skeleton
          holding its place. */}
      <Suspense fallback={<SectionSkeleton cards={4} />}>
        <OpenNowRail lang={lang} dict={dict} />
      </Suspense>

      {/* The craftsmen section. Static, no data read — it links to a page
          whose zero state is itself the funnel. See crafts-door.tsx for why
          this is a strip and not a fifth gateway tile. */}
      <CraftsDoor lang={lang} dict={dictSlice(dict, ["crafts"])} />

      {/* Reads group coverage to drop tiles with no stores behind them, so it
          is streamed rather than blocking the fold. The fallback is null, not a
          skeleton: the row is `hidden lg:block`, and a phone would otherwise
          reserve space for a section it will never show. */}
      <Suspense fallback={null}>
        <WorldsShowcase lang={lang} dict={dict} />
      </Suspense>

      {/* Per-user recommendations. Client island: fetches its own data in the
          browser after load, so it adds no per-user server read and keeps this
          page cacheable. Renders nothing for anon / no-history users — which
          is why it can sit above the real-store rail without risking a gap. */}
      <ForYouStrip
        lang={lang}
        dict={dictSlice(dict, ["home", "catalog", "explore", "featured", "trust"])}
      />

      {/* Not "near you": only a minority of live stores have coordinates and
          nothing here sorts by distance. This is the real store list, labelled
          as exactly that. */}
      <Suspense fallback={<SectionSkeleton cards={4} />}>
        <FeaturedStores lang={lang} dict={dict} />
      </Suspense>

      {/* The one marketplace highlight. Best sellers is the only product rail
          backed by enough real rows to clear MIN_RAIL_ITEMS on a phone; offers
          and the restaurant rail currently hold one item each, which is a
          section that hides itself on the device most customers arrive on. */}
      <Suspense fallback={<SectionSkeleton cards={4} />}>
        <BestSellersTeaser lang={lang} dict={dict} />
      </Suspense>

      <HomeMore lang={lang} dict={dict} sections={sections} />

      <MerchantCta lang={lang} dict={dict} />
    </>
  );
}
