// SEO rules in one place — which URLs may be indexed, which go in the
// sitemap, and how every bilingual page states its canonical and hreflang.
//
// Pure: no Supabase, no Next runtime, no "server-only". The sitemap, robots and
// each page's generateMetadata import the SAME predicates, so a URL can never
// be in the sitemap while its own page says noindex (Search Console reports
// that as "Submitted URL marked noindex", and it wastes crawl budget on the
// pages we least want crawled).
//
// THE INVARIANT: sitemap ⊆ indexable. Everything the sitemap lists passes the
// same predicate the page uses to decide `robots`.

import type { Metadata, MetadataRoute } from "next";
import { hasEnough } from "@/lib/rail";
import { SITE_URL, localeAlternates } from "@/lib/site";
import type { GatedSection } from "@/lib/data/section-supply";

export const SEO_LOCALES = ["ar", "en"] as const;
export type SeoLocale = (typeof SEO_LOCALES)[number];

/** The only robots value a public-but-thin page uses: keep it out of the
 *  index, but let the crawler follow its links to the pages that are real. */
export const NOINDEX_FOLLOW = { index: false, follow: true } as const;

/** Landing path of each supply-gated section (lib/data/section-supply.ts). */
export const GATED_SECTION_PATHS: Record<GatedSection, string> = {
  crafts: "/crafts",
  jobs: "/jobs",
  freelance: "/freelance",
  wholesale: "/wholesale",
  delivery: "/delivery",
  market: "/market",
};

/** Public pages that are indexable whatever the inventory, because they are
 *  about the platform rather than a list of its supply. The gated sections are
 *  NOT here — they join the sitemap only when getSectionSupply says they have
 *  something behind them. `/search` is not here either: robots.ts disallows it
 *  (every typo is a new URL). */
export const ALWAYS_INDEXED_PATHS = [
  "",
  "/explore",
  "/categories",
  "/offers",
  "/flash",
  "/clearance",
  "/best-sellers",
  "/map",
  "/merchants",
  "/trust",
  "/hub",
  "/hub/academy",
  "/hub/leaders",
  "/pricing",
  "/about",
  "/help",
  "/contact",
  "/privacy",
  // The tradesman sign-up page is a real page even with zero providers — it
  // is how the count stops being zero.
  "/crafts/join",
] as const;

/** A gated section landing page is indexable once ONE real row sits behind
 *  it — the same bar as the navigation link (rail.ts MIN_NAV_ITEMS), so the
 *  header, the sitemap and the page's robots tag cannot disagree. */
export function sectionIndexable(count: number): boolean {
  return Number.isFinite(count) && hasEnough(count);
}

/** robots metadata for a gated section landing page. */
export function sectionRobots(count: number) {
  return sectionIndexable(count) ? undefined : NOINDEX_FOLLOW;
}

/** A sector page (/category/[slug]) with no merchant is a thin page. */
export function categoryIndexable(storeCount: number): boolean {
  return Number.isFinite(storeCount) && storeCount > 0;
}

/** A crafts trade page (/crafts/[trade]) with no provider is thin; the crafts
 *  pages set `noindex, follow` on the same condition. */
export function craftTradeIndexable(providerCount: number): boolean {
  return Number.isFinite(providerCount) && providerCount > 0;
}

/** Sunday Market: only a live listing is worth indexing. A sold or expired
 *  listing stays reachable (the page shows a label instead of a 404, so old
 *  links keep working) but drops out of the index; draft / pending / rejected
 *  are never public in the first place. */
export function listingIndexable(status: string | null | undefined): boolean {
  return status === "active";
}

export function listingRobots(status: string | null | undefined) {
  return listingIndexable(status) ? undefined : NOINDEX_FOLLOW;
}

/** One address per store. A store with a vanity slug is canonical at
 *  `/<slug>` (what the sitemap has always listed); `/store/<uuid>` of the same
 *  store points its canonical there instead of competing with it. Nothing
 *  moves and nothing redirects — both URLs keep answering. */
export function storeCanonicalPath(
  id: string,
  slug: string | null | undefined,
): string {
  const s = (slug ?? "").trim().toLowerCase();
  return s ? `/${s}` : `/store/${id}`;
}

/** generateMetadata for a store page, shared by /store/[id] and /[handle] so
 *  the two addresses of one store can never state different canonicals.
 *
 *  - canonical + hreflang → storeCanonicalPath (the slug when there is one);
 *  - a demo-catalog store (`isReal: false`, the in-repo sample shops) is
 *    `noindex, follow`: it is a fixture with a fabricated rating, not a
 *    business, and must never reach a search result;
 *  - a missing store says noindex rather than inventing a title. */
export function buildStoreMetadata(opts: {
  lang: SeoLocale;
  id: string;
  store: {
    name: string;
    description?: string | null;
    slug?: string | null;
    coverUrl?: string | null;
    logoUrl?: string | null;
    isReal: boolean;
  } | null;
}): Metadata {
  const { lang, id, store } = opts;
  if (!store) return { robots: NOINDEX_FOLLOW };
  const description = (
    store.description?.trim() ||
    (lang === "ar"
      ? `${store.name} على متجر — اطلب أو تواصل مباشرةً.`
      : `${store.name} on Matjar — order or contact directly.`)
  ).slice(0, 160);
  const image = store.coverUrl || store.logoUrl || undefined;
  const path = storeCanonicalPath(id, store.isReal ? store.slug : null);
  return {
    title: store.name,
    description,
    alternates: localeAlternates(lang, path),
    openGraph: {
      type: "website",
      title: store.name,
      description,
      url: `/${lang}${path}`,
      images: image ? [{ url: image, alt: store.name }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: store.name,
      description,
    },
    ...(store.isReal ? {} : { robots: NOINDEX_FOLLOW }),
  };
}

/** The hreflang set for a locale-less path, as absolute URLs (sitemaps need
 *  absolute; page metadata uses localeAlternates' relative form). */
export function hreflangLanguages(
  path: string,
  base: string = SITE_URL,
): Record<string, string> {
  const langs = localeAlternates("ar", path).languages as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(langs)) out[k] = `${base}${v}`;
  return out;
}

type SitemapEntry = MetadataRoute.Sitemap[number];

/** Both locale URLs of one page, each carrying the hreflang pair. */
export function localizedSitemapEntries(
  path: string,
  opts: {
    lastModified?: Date;
    changeFrequency?: SitemapEntry["changeFrequency"];
    priority?: number;
  } = {},
  base: string = SITE_URL,
): SitemapEntry[] {
  const p = path === "/" ? "" : path;
  const languages = hreflangLanguages(p, base);
  return SEO_LOCALES.map((lang) => ({
    url: `${base}/${lang}${p}`,
    ...(opts.lastModified ? { lastModified: opts.lastModified } : {}),
    ...(opts.changeFrequency ? { changeFrequency: opts.changeFrequency } : {}),
    ...(opts.priority != null ? { priority: opts.priority } : {}),
    alternates: { languages },
  }));
}

/** Private, per-user or write surfaces that must never be crawled. Listed
 *  once and expanded for both locales by robots.ts. A disallowed path cannot
 *  show its own `noindex`, which is fine for these: every one of them either
 *  redirects to the login or is one person's data. */
export const PRIVATE_PATH_PREFIXES = [
  "/merchant",
  "/admin",
  "/account",
  "/orders",
  "/bookings",
  "/messages",
  // One customer's own inquiry, reachable only by its uuid (MP-023).
  "/inquiries",
  "/notifications",
  "/wishlist",
  "/favorites",
  "/following",
  "/track",
  "/search",
  "/activity",
  "/clock",
  "/delivery/track",
  "/market/new",
  "/jobs/new",
  "/jobs/mine",
  "/freelance/new",
  "/freelance/mine",
  "/freelance/brief",
  "/wholesale/new",
  "/wholesale/mine",
  "/crafts/me",
  "/crafts/requests",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  // Bearer-token pages: the URL IS the credential (a gift card, a loyalty
  // card, a customer's account statement). Never crawl, never index.
  "/gift",
  "/loyalty",
  "/statement",
] as const;

/** Query-string facets that are unbounded crawl space. `/market?…` reads
 *  searchParams and is rendered on every request (vercel-cost-guard); its
 *  canonical is the bare `/market`, so blocking the facets loses nothing. */
export const DISALLOWED_FACETS = ["/market?"] as const;

/** Wildcard rules (Google/Bing support `*`). An edit screen under any
 *  public detail route. */
export const DISALLOWED_WILDCARDS = [
  "/*/market/*/edit",
  "/*/crafts/p/*/request",
] as const;

export function robotsDisallowList(): string[] {
  const out: string[] = [];
  for (const lang of SEO_LOCALES) {
    for (const p of PRIVATE_PATH_PREFIXES) out.push(`/${lang}${p}`);
    for (const f of DISALLOWED_FACETS) out.push(`/${lang}${f}`);
  }
  out.push(...DISALLOWED_WILDCARDS);
  return out;
}
