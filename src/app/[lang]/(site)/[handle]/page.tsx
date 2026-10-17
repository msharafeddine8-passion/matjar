import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createPublicClient } from "@/lib/supabase/public-client";
import StorePage, {
  generateMetadata as storeMetadata,
} from "../store/[id]/page";

// Vanity store handle: matjarlb.com/<slug> (e.g. /passion). This dynamic segment
// sits alongside the named site routes (/explore, /market, ...), which Next
// always matches first — so only an unmatched top-level path reaches here. We
// resolve the slug to a store id and delegate to the real store page + metadata,
// so there is zero duplication and the pretty URL stays in the address bar.

// Loose guard before hitting the DB — the real format/reserved rules are enforced
// on write (migration 0115); here we just skip obvious non-slugs.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

// Public data, so the anon client and a shared cache: this ran uncached, twice
// per view (metadata + page), and mostly for bots probing /ar/terms and the
// like. cache() folds the two calls of one request; unstable_cache shares the
// answer across requests (busted with every other store read on "stores").
const lookupSlug = unstable_cache(
  async (clean: string): Promise<string | null> => {
    const { data } = await createPublicClient()
      .from("stores")
      .select("id")
      .eq("slug", clean)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  },
  ["store-slug"],
  { revalidate: 300, tags: ["stores"] },
);

const resolveSlug = cache(async (handle: string): Promise<string | null> => {
  const clean = handle.trim().toLowerCase();
  if (!SLUG_RE.test(clean)) return null;
  return lookupSlug(clean);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; handle: string }>;
}) {
  const { lang, handle } = await params;
  if (!isLocale(lang)) return {};
  const id = await resolveSlug(handle);
  if (!id) return {};
  // The store's metadata already canonicalises to its slug (lib/seo-rules
  // buildStoreMetadata) — the stored, lower-case slug, not whatever casing
  // arrived in the URL, so /Passion and /passion state one canonical.
  return storeMetadata({ params: Promise.resolve({ lang, id }) });
}

export default async function StoreHandlePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; handle: string }>;
  searchParams?: Promise<{ brand?: string; service?: string }>;
}) {
  const { lang, handle } = await params;
  if (!isLocale(lang)) notFound();
  const id = await resolveSlug(handle);
  if (!id) notFound();
  // Pass the query on: /<slug>?service=… and ?brand=… were silently dropped.
  return StorePage({ params: Promise.resolve({ lang, id }), searchParams });
}
