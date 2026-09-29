import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// MP-010. The public review projection carries a display name and no account id.
//
// The list used to select `customer_id` so the mapper could stamp `isMine` on
// every row. No component ever read that per-row flag; the only thing derived
// from it was the single `mine` boolean below, which hides the write form from
// someone who has already reviewed this product. Shipping every reviewer's
// account id to satisfy one boolean about the viewer is the wrong way round,
// and it put a stable per-person identifier into a `select using (true)` table.
//
// So the public list no longer names the column at all, and ownership is
// answered by a separate, viewer-scoped count. A signed-out visitor — the
// common case — never issues that second query and never references
// `customer_id` in any form, which is what lets the public read survive the
// revoke.
export type ProductReview = {
  id: string;
  rating: number;
  comment: string | null;
  photos: string[];
  customerName: string | null;
  verified: boolean;
  createdAt: string;
};

export type ProductReviewsData = {
  reviews: ProductReview[];
  avg: number | null;
  count: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Has the viewer already reviewed this product. False for signed-out. */
  mine: boolean;
};

/**
 * Whether the viewer already reviewed this product.
 *
 * `head: true` — the answer is a number, so no row and no column value crosses
 * the wire. product_reviews is unique on (product_id, customer_id), so this is
 * 0 or 1. Returns false without asking anything when there is no viewer: the
 * signed-out path must not reference `customer_id`, and must not pay for a
 * round trip to be told something already known.
 */
async function viewerHasReviewed(
  supabase: SupabaseClient,
  productId: string,
  currentUserId: string | null,
): Promise<boolean> {
  if (!currentUserId) return false;
  // has_reviewed_product (0319) answers for auth.uid(): since 0320 a signed-in
  // user cannot filter product_reviews on customer_id, even their own.
  const { data } = await supabase.rpc("has_reviewed_product", {
    p_product_id: productId,
  });
  return data === true;
}

export async function getProductReviews(
  productId: string,
  currentUserId: string | null,
): Promise<ProductReviewsData> {
  const supabase = await createClient();
  // Same rows, same order, same filter as before — one column fewer.
  const [{ data }, mine] = await Promise.all([
    supabase
      .from("product_reviews")
      .select("id, rating, comment, photos, customer_name, verified, created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(100),
    viewerHasReviewed(supabase, productId, currentUserId),
  ]);

  const rows = (data ?? []) as unknown as {
    id: string;
    rating: number;
    comment: string | null;
    photos: unknown;
    customer_name: string | null;
    verified: boolean;
    created_at: string;
  }[];

  const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  const reviews: ProductReview[] = rows.map((r) => {
    sum += r.rating;
    if (r.rating >= 1 && r.rating <= 5) breakdown[r.rating as 1 | 2 | 3 | 4 | 5]++;
    return {
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
      customerName: r.customer_name,
      verified: r.verified,
      createdAt: r.created_at,
    };
  });

  return {
    reviews,
    count: reviews.length,
    avg: reviews.length ? sum / reviews.length : null,
    breakdown,
    mine,
  };
}
