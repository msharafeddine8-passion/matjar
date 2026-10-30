import { createPublicClient } from "@/lib/supabase/public-client";

/** Stores per sitemap file. Every row is two URLs (ar + en) and Google's limit
 *  is 50,000 per file. */
export const DIRECTORY_SITEMAP_ROWS = 20000;

/** PostgREST `or=` form of the sitemap's quality gate (lib/listing.ts). */
export const directoryIndexableFilter =
  "phone.not.is.null,whatsapp.not.is.null,website.not.is.null";

/** The file ids that exist right now. Always at least 0: an empty sitemap is
 *  valid, and robots.ts must not point at a 404. */
export async function directorySitemapIds(): Promise<number[]> {
  try {
    const { count } = await createPublicClient()
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("deleted_at", null)
      .is("owner_id", null)
      .or(directoryIndexableFilter);
    const files = Math.max(1, Math.ceil((count ?? 0) / DIRECTORY_SITEMAP_ROWS));
    return Array.from({ length: files }, (_, i) => i);
  } catch {
    return [0];
  }
}
