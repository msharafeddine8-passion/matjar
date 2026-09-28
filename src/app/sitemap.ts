import type { MetadataRoute } from "next";
import { categoryKeys } from "@/lib/catalog";
import { createPublicClient } from "@/lib/supabase/public-client";
import { getAcademyGuides } from "@/lib/data/academy";
import { getSectionSupply } from "@/lib/data/section-supply";
import { getDiscoveryCoverage } from "@/lib/data/discovery";
import { beirutYmd } from "@/lib/quick-panel";
import {
  ALWAYS_INDEXED_PATHS,
  GATED_SECTION_PATHS,
  categoryIndexable,
  craftTradeIndexable,
  localizedSitemapEntries,
  sectionIndexable,
  storeCanonicalPath,
} from "@/lib/seo-rules";

// ONE render per hour, shared by every crawler (vercel-cost-guard).
//
// This used to build a cookie-reading Supabase client, which made the route
// dynamic: every fetch of /sitemap.xml by every bot ran nine queries, and a
// signed-in admin opening it got the rows THEIR RLS allows — suspended
// stores' products included. The cookie-less public client keeps it static and
// anon-scoped; the section/category counts come from the same cross-request
// caches the header and the category pages read.
export const revalidate = 3600;

// Hard ceiling per table. Google's limit is 50,000 URLs per sitemap and every
// row becomes two (ar + en); far below that, and far above today's supply.
const ROWS = 5000;

type Supply = Awaited<ReturnType<typeof getSectionSupply>>;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  const asDate = (v: unknown) => (v ? new Date(v as string) : undefined);

  const [supply, coverage] = await Promise.all([
    safe<Supply>(() => getSectionSupply(), []),
    safe(() => getDiscoveryCoverage(), null),
  ]);
  // A failed count reads as 0 → section left out. Same quiet direction as the
  // nav gate: a missing sitemap line for an hour costs nothing; submitting an
  // empty page that says noindex is a Search Console error.
  const count = (s: keyof typeof GATED_SECTION_PATHS) =>
    supply.find((x) => x.section === s)?.count ?? 0;

  for (const path of ALWAYS_INDEXED_PATHS) {
    entries.push(
      ...localizedSitemapEntries(path, {
        changeFrequency: "weekly",
        priority: path === "" ? 1 : 0.6,
      }),
    );
  }
  for (const [section, path] of Object.entries(GATED_SECTION_PATHS)) {
    if (!sectionIndexable(count(section as keyof typeof GATED_SECTION_PATHS)))
      continue;
    entries.push(
      ...localizedSitemapEntries(path, { changeFrequency: "daily", priority: 0.6 }),
    );
  }
  // Only sectors with at least one live merchant — the category page itself
  // says noindex at zero (category/[slug]/page.tsx), so listing it here would
  // be a contradiction. Unknown coverage (DB down) → none rather than all.
  for (const key of categoryKeys) {
    if (!coverage || !categoryIndexable(coverage.bySector[key] ?? 0)) continue;
    entries.push(
      ...localizedSitemapEntries(`/category/${key}`, {
        changeFrequency: "daily",
        priority: 0.7,
      }),
    );
  }

  // Real, public content. Anon client → RLS limits each table to what a
  // logged-out visitor can open.
  try {
    const supabase = createPublicClient();
    const [
      { data: stores },
      { data: products },
      { data: listings },
      { data: jobs },
      { data: gigs },
      { data: wholesale },
      { data: sitePages },
      { data: leaders },
      { data: trades },
      guides,
    ] = await Promise.all([
      supabase
        .from("stores")
        .select("id, slug, updated_at")
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(ROWS),
      supabase
        .from("products")
        .select("id, updated_at")
        .eq("status", "active")
        .eq("is_available", true)
        .is("deleted_at", null)
        .limit(ROWS),
      supabase
        .from("listings")
        .select("id, updated_at")
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(ROWS),
      // jobs/gigs/wholesale/leaders have no updated_at column — id/slug only.
      // The board's own predicate: a deleted posting, or one past its deadline,
      // is a 404-or-closed page a crawler should not be sent to.
      supabase
        .from("job_postings")
        .select("id")
        .eq("status", "active")
        .is("deleted_at", null)
        .or(`apply_deadline.is.null,apply_deadline.gte.${beirutYmd(new Date())}`)
        .limit(ROWS),
      supabase.from("gigs").select("id").eq("status", "active").limit(ROWS),
      supabase
        .from("wholesale_products")
        .select("id")
        .eq("status", "active")
        .limit(ROWS),
      supabase
        .from("site_pages")
        .select("slug, updated_at")
        .eq("published", true)
        .limit(ROWS),
      supabase
        .from("business_leaders")
        .select("slug")
        .eq("published", true)
        .limit(ROWS),
      // Providers per trade (0237). A trade page with none is noindexed by
      // the crafts pages, so it is not submitted here.
      supabase.rpc("trade_provider_counts"),
      // DB-backed academy guides (falls back to the in-repo set when unseeded).
      getAcademyGuides(),
    ]);

    for (const s of stores ?? []) {
      // The canonical address: the vanity slug when the store has one (the
      // store page's canonical says the same — lib/seo-rules storeCanonicalPath).
      entries.push(
        ...localizedSitemapEntries(
          storeCanonicalPath(s.id as string, s.slug as string | null),
          { lastModified: asDate(s.updated_at), changeFrequency: "daily", priority: 0.8 },
        ),
      );
    }
    for (const p of products ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/product/${p.id}`, {
          lastModified: asDate(p.updated_at),
          changeFrequency: "weekly",
          priority: 0.7,
        }),
      );
    }
    for (const li of listings ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/market/${li.id}`, {
          lastModified: asDate(li.updated_at),
          changeFrequency: "daily",
          priority: 0.6,
        }),
      );
    }
    for (const j of jobs ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/jobs/${j.id}`, {
          changeFrequency: "daily",
          priority: 0.7,
        }),
      );
    }
    for (const g of gigs ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/freelance/${g.id}`, {
          changeFrequency: "weekly",
          priority: 0.6,
        }),
      );
    }
    for (const w of wholesale ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/wholesale/${w.id}`, {
          changeFrequency: "weekly",
          priority: 0.6,
        }),
      );
    }
    for (const t of (trades ?? []) as { slug: string; n: number }[]) {
      if (!t?.slug || !craftTradeIndexable(Number(t.n))) continue;
      entries.push(
        ...localizedSitemapEntries(`/crafts/${t.slug}`, {
          changeFrequency: "weekly",
          priority: 0.6,
        }),
      );
    }
    for (const pg of sitePages ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/p/${pg.slug}`, {
          lastModified: asDate(pg.updated_at),
          changeFrequency: "weekly",
          priority: 0.6,
        }),
      );
    }
    for (const g of guides) {
      entries.push(
        ...localizedSitemapEntries(`/hub/academy/${g.slug}`, {
          changeFrequency: "monthly",
          priority: 0.5,
        }),
      );
    }
    for (const ld of leaders ?? []) {
      entries.push(
        ...localizedSitemapEntries(`/hub/leaders/${ld.slug}`, {
          changeFrequency: "monthly",
          priority: 0.5,
        }),
      );
    }
  } catch {
    // If the DB is unreachable at build time, still return the static sitemap.
  }

  return entries;
}
