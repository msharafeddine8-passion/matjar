import { createPublicClient } from "@/lib/supabase/public-client";
import { FETCH_BOUNDS, fetchAllPages } from "@/lib/data/bounds";
import { SITE_URL } from "@/lib/site";
import {
  buildGoogleFeedXml,
  feedServes,
  toFeedItem,
  type FeedItem,
  type FeedProductRow,
  type FeedStore,
} from "@/lib/google-feed";

// Google free-listings feed for one store — /feeds/<slug>/google.xml (the
// store id is accepted in place of the slug, for stores that never set one).
//
// Outside [lang] on purpose: a feed has no locale, and the proxy's matcher
// excludes /feeds/ (and any path with a dot) so Google's fetcher is never
// redirected to /ar/feeds/..., which it would treat as a failed fetch.
//
// COST (vercel-cost-guard): this URL is fetched by crawlers, so it must never
// render per request. It reads no searchParams, no cookies and no headers, and
// is forced static with a one-hour revalidate: the first hit renders it, every
// hit for the next hour is served from the cache, and turning the feed on or
// off busts it explicitly (merchant/[storeId]/google-feed/actions.ts). The
// Cache-Control header says the same to any CDN in front of `next start`.
//
// Reads go through the cookie-less ANON client, so RLS decides visibility the
// way it does for every visitor: only an active, non-deleted store and only its
// active, non-hidden products are readable at all. Never a service-role key.
export const dynamic = "force-static";
export const revalidate = 3600;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A slug is lower-case letters, digits and hyphens (validate_store_slug).
// Anything else cannot match a store, so it is refused before a query is made.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const PRODUCT_COLUMNS =
  "id, name, description, price, discount_price, flash_price, flash_start, flash_end, image_url, gallery, stock, is_available, status, deleted_at, hidden_by_plan, item_kind, brand, sku, attributes";

// Selecting a column the deployed database does not have fails the whole
// SELECT (see lib/data/store-view.ts). Before migration 0308 is applied that
// is exactly what happens here — and the answer is the right one: no
// `google_feed_enabled` column means no store has turned the feed on, so 404.
const STORE_COLUMNS =
  "id, name, slug, status, deleted_at, plan, trial_ends_at, return_policy, shipping_policy, google_feed_enabled, business_types(slug)";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug: raw } = await params;
  const key = decodeURIComponent(raw).trim().toLowerCase();
  const byId = UUID_RE.test(key);
  if (!byId && !SLUG_RE.test(key)) return notFound();

  const supabase = createPublicClient();
  const { data: storeRow, error } = await supabase
    .from("stores")
    .select(STORE_COLUMNS)
    .eq(byId ? "id" : "slug", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !storeRow) return notFound();

  const s = storeRow as unknown as Record<string, unknown> & {
    business_types: { slug: string } | null;
  };
  const store: FeedStore = {
    id: s.id as string,
    name: s.name as string,
    slug: (s.slug as string | null) ?? null,
    sectorSlug: s.business_types?.slug ?? null,
    status: s.status as string,
    deletedAt: (s.deleted_at as string | null) ?? null,
    plan: (s.plan as string | null) ?? null,
    trialEndsAt: (s.trial_ends_at as string | null) ?? null,
    returnPolicy: (s.return_policy as string | null) ?? null,
    shippingPolicy: (s.shipping_policy as string | null) ?? null,
    googleFeedEnabled: s.google_feed_enabled === true,
  };
  // Pro/Business (effective plan, trial included), switched on by the owner,
  // both policies still written. Anything else is a plain 404 — the feed does
  // not advertise that it exists.
  if (!feedServes(store)) return notFound();

  const rows = await fetchAllPages<FeedProductRow>(
    (from, to) =>
      supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("store_id", store.id)
        .eq("status", "active")
        .eq("is_available", true)
        .eq("hidden_by_plan", false)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: FeedProductRow[] | null;
      }>,
    FETCH_BOUNDS.storeProducts,
    `google feed products (store ${store.id})`,
  );

  const now = Date.now();
  const items = rows
    .map((row) => toFeedItem(row, store, { siteUrl: SITE_URL, now }))
    .filter((item): item is FeedItem => item !== null);

  const xml = buildGoogleFeedXml({
    storeName: store.name,
    storeUrl: `${SITE_URL}/ar/store/${store.id}`,
    items,
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
