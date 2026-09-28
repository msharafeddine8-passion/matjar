// A product cross-posted to the Sunday Market (P2-MARKET-CROSSPOST).
//
// The product form can also publish the item as a pending market listing.
// It used to insert that listing WITHOUT a category — 7 of the 10 cross-posts
// in production have none — while the listing form itself requires one: a
// listing without a category is missing from every category filter and from
// the per-category price check the moderation queue runs (the `noCategory`
// signal in src/lib/market-moderation.ts).
//
// The category cannot be derived from the store's sector. Market categories
// are item types (phones, laptops, furniture, clothing …); a sector is a kind
// of business, and one "retail" shop sells phones and clothing both. Guessing
// would file real items under the wrong heading, so the form asks the merchant
// and this refuses to build a listing without an answer.

export type CrossPostInput = {
  sellerId: string;
  storeId: string;
  categoryId: string | null | undefined;
  title: string;
  description: string | null | undefined;
  price: number;
  discountPrice: number | null | undefined;
  images: readonly (string | null | undefined)[];
};

export type CrossPostListing = {
  seller_id: string;
  store_id: string;
  category_id: string;
  title: string;
  description: string | null;
  price: number;
  images: string[];
  status: "pending";
};

/**
 * The listings row to insert, or the reason there is none. Pure.
 * The discounted price is what a shopper would pay, so it is the one listed.
 */
export function buildCrossPostListing(
  input: CrossPostInput,
): { ok: true; listing: CrossPostListing } | { ok: false; reason: "category" | "title" } {
  const categoryId = (input.categoryId ?? "").trim();
  if (!categoryId) return { ok: false, reason: "category" };
  const title = input.title.trim();
  if (!title) return { ok: false, reason: "title" };
  const discount =
    input.discountPrice != null && Number.isFinite(input.discountPrice) && input.discountPrice > 0
      ? input.discountPrice
      : null;
  const price = Number.isFinite(input.price) && input.price > 0 ? input.price : 0;
  return {
    ok: true,
    listing: {
      seller_id: input.sellerId,
      store_id: input.storeId,
      category_id: categoryId,
      title,
      description: input.description?.trim() || null,
      price: discount ?? price,
      images: input.images.filter((u): u is string => typeof u === "string" && u !== ""),
      status: "pending",
    },
  };
}
