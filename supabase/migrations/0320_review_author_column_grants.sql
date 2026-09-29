-- 0320 — Signed-in users can no longer read who wrote a review.
--
-- The column revoke that 0319 prepares for (read 0319's header for the why).
-- authenticated keeps every review column the app shows; it loses
-- reviews.customer_id, reviews.reply_by and product_reviews.customer_id —
-- the same three anon already could not read.
--
-- DEPLOY ORDER: only AFTER the app build that uses 0319's helpers is live.
-- The previous build filtered on customer_id directly ("have I reviewed this")
-- and upserted reviews with ON CONFLICT, both of which need the column.
--
-- Verification: supabase/tests/0320_review_author_privacy.test.sql runs 0319
-- and 0320 together, rolled back.

-- ---------------------------------------------------------------------------
-- A. Column grants
-- ---------------------------------------------------------------------------
revoke select on table public.reviews from authenticated;
grant select (
  id, store_id, customer_name, rating, comment, created_at, updated_at,
  reply, reply_at, verified_purchase, deleted_at
) on table public.reviews to authenticated;

revoke select on table public.product_reviews from authenticated;
grant select (
  id, product_id, rating, comment, photos, customer_name, verified, created_at
) on table public.product_reviews to authenticated;

