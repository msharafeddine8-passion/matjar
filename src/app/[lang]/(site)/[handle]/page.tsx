import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
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

async function resolveSlug(handle: string): Promise<string | null> {
  const clean = handle.trim().toLowerCase();
  if (!SLUG_RE.test(clean)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", clean)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

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
}: {
  params: Promise<{ lang: string; handle: string }>;
}) {
  const { lang, handle } = await params;
  if (!isLocale(lang)) notFound();
  const id = await resolveSlug(handle);
  if (!id) notFound();
  return StorePage({ params: Promise.resolve({ lang, id }) });
}
