import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_INDEXED_PATHS,
  GATED_SECTION_PATHS,
  NOINDEX_FOLLOW,
  PRIVATE_PATH_PREFIXES,
  buildStoreMetadata,
  categoryIndexable,
  craftTradeIndexable,
  hreflangLanguages,
  listingIndexable,
  listingRobots,
  localizedSitemapEntries,
  robotsDisallowList,
  sectionIndexable,
  sectionRobots,
  storeCanonicalPath,
} from "@/lib/seo-rules";
import { localeAlternates } from "@/lib/site";
import { storeJsonLd, productJsonLd, offeringJsonLd } from "@/lib/jsonld";

const BASE = "https://matjarlb.com";

describe("noindex rules — the sitemap may only list what the page indexes", () => {
  it("a gated section is indexable from one real row (rail.ts MIN_NAV_ITEMS)", () => {
    expect(sectionIndexable(0)).toBe(false);
    expect(sectionIndexable(1)).toBe(true);
    expect(sectionIndexable(Number.NaN)).toBe(false);
    expect(sectionRobots(0)).toEqual(NOINDEX_FOLLOW);
    expect(sectionRobots(3)).toBeUndefined();
  });

  it("zero-store categories and zero-provider trades are not indexable", () => {
    expect(categoryIndexable(0)).toBe(false);
    expect(categoryIndexable(2)).toBe(true);
    expect(craftTradeIndexable(0)).toBe(false);
    expect(craftTradeIndexable(1)).toBe(true);
  });

  it("only an active market listing is indexable; sold/expired stay reachable but noindex", () => {
    expect(listingIndexable("active")).toBe(true);
    for (const s of ["sold", "expired", "pending", "draft", "rejected", null]) {
      expect(listingIndexable(s)).toBe(false);
      expect(listingRobots(s)).toEqual(NOINDEX_FOLLOW);
    }
  });

  it("noindex is always noindex,FOLLOW — thin pages still pass link equity", () => {
    expect(NOINDEX_FOLLOW).toEqual({ index: false, follow: true });
  });

  it("the always-indexed list holds no gated section and no private path", () => {
    const gated = Object.values(GATED_SECTION_PATHS);
    for (const path of ALWAYS_INDEXED_PATHS) {
      const p: string = path;
      expect(gated).not.toContain(p);
      expect(PRIVATE_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))).toBe(false);
    }
    expect(ALWAYS_INDEXED_PATHS as readonly string[]).not.toContain("/search");
  });
});

describe("hreflang pairs", () => {
  it("every page states ar, en and x-default (→ ar) with a self canonical", () => {
    const a = localeAlternates("en", "/market");
    expect(a.canonical).toBe("/en/market");
    expect(a.languages).toEqual({
      ar: "/ar/market",
      en: "/en/market",
      "x-default": "/ar/market",
    });
  });

  it("the home page pair has no trailing slash", () => {
    expect(localeAlternates("ar", "").languages).toEqual({
      ar: "/ar",
      en: "/en",
      "x-default": "/ar",
    });
  });

  it("sitemap entries come in reciprocal ar/en pairs with absolute hreflang", () => {
    const [ar, en] = localizedSitemapEntries("/market/abc", { priority: 0.6 }, BASE);
    expect(ar.url).toBe(`${BASE}/ar/market/abc`);
    expect(en.url).toBe(`${BASE}/en/market/abc`);
    const langs = hreflangLanguages("/market/abc", BASE);
    expect(ar.alternates?.languages).toEqual(langs);
    expect(en.alternates?.languages).toEqual(langs);
    expect(langs["x-default"]).toBe(`${BASE}/ar/market/abc`);
  });
});

describe("store canonical — one address per store, nothing moves", () => {
  it("prefers the lower-cased slug, falls back to the uuid route", () => {
    expect(storeCanonicalPath("u-1", "Passion")).toBe("/passion");
    expect(storeCanonicalPath("u-1", null)).toBe("/store/u-1");
    expect(storeCanonicalPath("u-1", "  ")).toBe("/store/u-1");
  });

  it("buildStoreMetadata points /store/<id> at the slug and pairs hreflang", () => {
    const m = buildStoreMetadata({
      lang: "en",
      id: "u-1",
      store: { name: "Passion", slug: "passion", isReal: true },
    });
    expect(m.alternates?.canonical).toBe("/en/passion");
    expect(m.alternates?.languages).toMatchObject({ ar: "/ar/passion", en: "/en/passion" });
    expect(m.robots).toBeUndefined();
  });

  it("a demo-catalog store is noindex and keeps its own route", () => {
    const m = buildStoreMetadata({
      lang: "ar",
      id: "demo-1",
      store: { name: "Demo", slug: "ignored", isReal: false },
    });
    expect(m.robots).toEqual(NOINDEX_FOLLOW);
    expect(m.alternates?.canonical).toBe("/ar/store/demo-1");
  });

  it("a missing store is noindex with no invented title", () => {
    const m = buildStoreMetadata({ lang: "ar", id: "x", store: null });
    expect(m).toEqual({ robots: NOINDEX_FOLLOW });
  });

  it("descriptions are capped for the snippet", () => {
    const m = buildStoreMetadata({
      lang: "ar",
      id: "u",
      store: { name: "S", description: "x".repeat(400), isReal: true },
    });
    expect((m.description as string).length).toBe(160);
  });
});

describe("robots.txt disallow list", () => {
  const list = robotsDisallowList();

  it("covers every private prefix in both locales", () => {
    for (const p of PRIVATE_PATH_PREFIXES) {
      expect(list).toContain(`/ar${p}`);
      expect(list).toContain(`/en${p}`);
    }
  });

  it("blocks the bearer-token pages and the market facets, never a public section", () => {
    for (const p of ["/ar/gift", "/en/loyalty", "/ar/statement", "/ar/market?"]) {
      expect(list).toContain(p);
    }
    for (const p of ["/ar/market", "/en/jobs", "/ar/crafts", "/ar/store", "/ar/product"]) {
      expect(list).not.toContain(p);
    }
  });

  it("robots.ts uses the shared list", () => {
    const src = readFileSync(join(process.cwd(), "src/app/robots.ts"), "utf8");
    expect(src).toContain("robotsDisallowList()");
  });
});

describe("sitemap.ts follows the rules", () => {
  // LF-normalised: a Windows checkout (core.autocrlf) has CRLF on disk, and
  // the query-splitting regex below is written against "\n".
  const src = readFileSync(join(process.cwd(), "src/app/sitemap.ts"), "utf8").replace(/\r\n/g, "\n");

  it("is cached, not per-request (vercel-cost-guard)", () => {
    expect(src).toMatch(/export const revalidate = \d+/);
    expect(src).not.toContain("@/lib/supabase/server");
    expect(src).toContain("createPublicClient");
  });

  it("gates sections, categories and crafts trades on the shared predicates", () => {
    expect(src).toContain("sectionIndexable(");
    expect(src).toContain("categoryIndexable(");
    expect(src).toContain("craftTradeIndexable(");
    expect(src).toContain("storeCanonicalPath(");
  });

  it("every table read is bounded", () => {
    const froms = src.match(/\.from\("[a-z_]+"\)[\s\S]*?(?=,\n\s{6}(?:supabase|\/\/|getAcademyGuides)|\]\);)/g) ?? [];
    expect(froms.length).toBeGreaterThan(5);
    for (const q of froms) expect(q, q).toContain(".limit(");
  });
});

describe("no AggregateRating without reviews — every builder", () => {
  it.each([
    ["store", () => storeJsonLd({ name: "S", url: "u", rating: 4.5, reviewCount: 0 })],
    ["store null", () => storeJsonLd({ name: "S", url: "u", rating: null, reviewCount: null })],
    ["product", () => productJsonLd({ name: "P", url: "u", price: 5, rating: 4, reviewCount: 0 })],
    ["service", () => offeringJsonLd({ noun: "service", name: "S", url: "u", price: 5, rating: 4 })],
  ])("%s", (_label, build) => {
    expect(build()).not.toHaveProperty("aggregateRating");
  });
});
