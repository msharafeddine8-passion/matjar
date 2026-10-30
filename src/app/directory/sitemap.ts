import type { MetadataRoute } from "next";
import { createPublicClient } from "@/lib/supabase/public-client";
import { fetchAllPages } from "@/lib/data/bounds";
import {
  DIRECTORY_SITEMAP_ROWS,
  directoryIndexableFilter,
  directorySitemapIds,
} from "@/lib/data/directory-sitemap";
import { localizedSitemapEntries, storeCanonicalPath } from "@/lib/seo-rules";

// Unclaimed directory stores (0338), kept out of the main /sitemap.xml so that
// thousands of them cannot push real merchants past its row ceiling. Served at
// /directory/sitemap/<id>.xml and listed by robots.ts. One render an hour, shared
// by every crawler, on the anon client (vercel-cost-guard).
//
// The quality gate is the sitemap half of directoryPageIndexable: a row with no
// phone, WhatsApp or website is not submitted. It may still be indexable when it
// has an address, which anon cannot filter on (lib/listing.ts) — the harmless
// direction of sitemap ⊆ indexable.
export const revalidate = 3600;

export async function generateSitemaps() {
  return (await directorySitemapIds()).map((id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  if (!Number.isInteger(id) || id < 0) return [];
  const offset = id * DIRECTORY_SITEMAP_ROWS;
  const supabase = createPublicClient();
  type Row = { id: string; slug: string | null; updated_at: string | null };
  const rows = await fetchAllPages<Row>(
    (from, to) =>
      supabase
        .from("stores")
        .select("id, slug, updated_at")
        .eq("status", "active")
        .is("deleted_at", null)
        .is("owner_id", null)
        .or(directoryIndexableFilter)
        .order("id", { ascending: true })
        .range(offset + from, offset + to) as unknown as PromiseLike<{
        data: Row[] | null;
      }>,
    // A full file is the normal case here, not a truncation: the next id holds
    // the rest. One past the page keeps the bound's warning quiet.
    DIRECTORY_SITEMAP_ROWS + 1,
    `directory sitemap ${id}`,
  );
  return rows.slice(0, DIRECTORY_SITEMAP_ROWS).flatMap((s) =>
    localizedSitemapEntries(storeCanonicalPath(s.id, s.slug), {
      lastModified: s.updated_at ? new Date(s.updated_at) : undefined,
      changeFrequency: "monthly",
      priority: 0.4,
    }),
  );
}
