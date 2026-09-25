import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  buildQueue,
  categoryPriceStats,
  daysUntilExpiry,
  findDuplicates,
  type ModerationListing,
  type SellerFacts,
} from "@/lib/market-moderation";
import {
  AdminMarketQueue,
  type QueueRow,
} from "@/components/admin-market-queue";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Bounded reads. Sunday Market holds a dozen listings today; these ceilings
// are where computing the signals in the page stops being cheap and should
// move into SQL.
const LISTING_ROWS = 1000;
const REPORT_ROWS = 2000;

type Row = {
  id: string;
  seller_id: string;
  store_id: string | null;
  category_id: string | null;
  title: string;
  description: string | null;
  price: number | null;
  images: unknown;
  status: string;
  created_at: string;
  stores: { name: string } | null;
  market_categories: { name_ar: string; name_en: string } | null;
};

type FactsRow = {
  seller_id: string;
  member_since: string | null;
  is_active: boolean;
  listings_total: number;
  listings_live: number;
  listings_rejected: number;
  listings_removed: number;
  reports_open: number;
  reports_total: number;
};

/**
 * The Sunday Market moderation queue (§25).
 *
 * Every pending listing, plus every live listing carrying a signal a human
 * should look at — reported, duplicated, a price far from its category, a
 * phone number in the text, a suspended or often-rejected seller. Sorted by
 * priority (lib/market-moderation.ts). Nothing here acts on its own: the
 * signals order the list; the moderator approves or rejects.
 */
export default async function AdminMarketQueuePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("market", lang);
  const dict = await getDictionary(lang);
  const supabase = await createClient();

  const [{ data: rows }, { data: listingReports }, contentReports] =
    await Promise.all([
      supabase
        .from("listings")
        .select(
          "id, seller_id, store_id, category_id, title, description, price, images, status, created_at, stores(name), market_categories(name_ar, name_en)",
        )
        .is("deleted_at", null)
        .in("status", ["pending", "active", "sold"])
        .order("created_at", { ascending: false })
        .limit(LISTING_ROWS),
      supabase
        .from("listing_reports")
        .select("listing_id")
        .eq("status", "open")
        .limit(REPORT_ROWS),
      // content_reports is its own admin section; a market-only moderator may
      // not read it. An error here just means those reports are not counted.
      supabase
        .from("content_reports")
        .select("entity_id")
        .eq("entity_type", "listing")
        .in("status", ["pending", "reviewing"])
        .limit(REPORT_ROWS),
    ]);

  const listingRows = (rows ?? []) as unknown as Row[];
  const listings: (ModerationListing & { row: Row })[] = listingRows.map((r) => ({
    id: r.id,
    sellerId: r.seller_id,
    title: r.title,
    description: r.description,
    price: r.price != null ? Number(r.price) : null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    categoryId: r.category_id,
    status: r.status,
    createdAt: r.created_at,
    row: r,
  }));

  const openReports = new Map<string, number>();
  const bump = (id: string | null | undefined) => {
    if (id) openReports.set(id, (openReports.get(id) ?? 0) + 1);
  };
  for (const r of (listingReports ?? []) as { listing_id: string }[]) bump(r.listing_id);
  if (!contentReports.error) {
    for (const r of (contentReports.data ?? []) as { entity_id: string }[])
      bump(r.entity_id);
  }

  // Seller history (0313). Missing before the migration → the queue still
  // works on the listing-level signals and says the history is unavailable.
  const sellerIds = Array.from(new Set(listings.map((l) => l.sellerId))).slice(0, 500);
  let sellers: Map<string, SellerFacts> | undefined;
  if (sellerIds.length) {
    const { data: facts, error } = await supabase.rpc("market_seller_facts", {
      p_seller_ids: sellerIds,
    });
    if (!error && Array.isArray(facts)) {
      sellers = new Map(
        (facts as FactsRow[]).map((f) => [
          f.seller_id,
          {
            memberSince: f.member_since,
            isActive: f.is_active,
            listingsTotal: f.listings_total,
            listingsLive: f.listings_live,
            listingsRejected: f.listings_rejected,
            listingsRemoved: f.listings_removed,
            reportsOpen: f.reports_open,
            reportsTotal: f.reports_total,
          },
        ]),
      );
    }
  }

  const now = new Date();
  const priceStats = categoryPriceStats(listings);
  const duplicates = findDuplicates(listings);
  const queue = buildQueue(listings, {
    duplicates,
    priceStats,
    openReports,
    sellers,
    now,
  });

  const titleOf = new Map(listings.map((l) => [l.id, l.title]));
  const items: QueueRow[] = queue.map((q) => {
    const r = q.listing.row;
    const stats = q.listing.categoryId
      ? priceStats.get(q.listing.categoryId)
      : undefined;
    return {
      id: q.listing.id,
      title: q.listing.title,
      price: q.listing.price,
      image: q.listing.images[0] ?? null,
      status: q.listing.status,
      createdAt: q.listing.createdAt,
      storeName: r.stores?.name ?? null,
      isMerchant: Boolean(r.store_id),
      categoryName: r.market_categories
        ? lang === "ar"
          ? r.market_categories.name_ar
          : r.market_categories.name_en
        : null,
      categoryMedian: stats && stats.samples >= 5 ? stats.median : null,
      signals: q.signals,
      reports: q.reports,
      score: q.score,
      duplicateTitles: q.duplicateOf.map((id) => titleOf.get(id) ?? id).slice(0, 3),
      expiresInDays:
        q.listing.status === "active"
          ? daysUntilExpiry(q.listing.createdAt, now)
          : null,
      seller: sellers?.get(q.listing.sellerId) ?? null,
    };
  });

  return (
    <AdminMarketQueue
      lang={lang}
      dict={dict}
      items={items}
      sellerHistoryAvailable={Boolean(sellers)}
    />
  );
}
