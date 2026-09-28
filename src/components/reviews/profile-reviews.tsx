import Link from "next/link";
import { Star } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { MyReview } from "@/components/store-reviews";
import { ReviewForm } from "@/components/review-form";
import {
  sortReviews,
  summarizeReviews,
  type ProfileReview,
} from "@/lib/profile-engine";
import { ReviewCard } from "@/components/reviews/review-card";

// Reviews 2.0 on the business profile.
//
// What changed from StoreReviews: the store's own reviews and the reviews of
// its products / services are one list, newest first, each saying what it is
// about and when it was written; a review carries «طلبه عبر متجر» only when the
// row itself proves an order (product_reviews.verified), and the legend says
// what the badge means and — as plainly — what its absence means. No review is
// called verified because of the section it sits in.
//
// Presence is decided by the engine: the page renders this only when there is
// something to read or the signed-in viewer can write the first one.
export function ProfileReviews({
  storeId,
  lang,
  dict,
  reviews,
  currentUser,
  myReview,
  viewerCanReview,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  reviews: ProfileReview[];
  currentUser: { id: string; name: string } | null;
  myReview: MyReview | null;
  viewerCanReview: boolean;
}) {
  const t = dict.profile.reviews;
  const list = sortReviews(reviews);
  const sum = summarizeReviews(list);
  const mine = currentUser ? myReview : null;

  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold">{dict.reviews.title}</h2>

      {(sum.storeAverage != null || sum.itemCount > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {sum.storeAverage != null && (
            <span className="flex items-center gap-1 font-semibold">
              <Star className="h-4 w-4 fill-accent text-accent" aria-hidden="true" />
              {t.summaryStore
                .replace("{avg}", sum.storeAverage.toFixed(1))
                .replace("{n}", String(sum.storeCount))}
            </span>
          )}
          {sum.itemCount > 0 && (
            <span className="text-muted-foreground">
              {t.summaryItems.replace("{n}", String(sum.itemCount))}
            </span>
          )}
        </div>
      )}

      <div className="mt-4">
        {currentUser ? (
          <>
            {list.length === 0 && viewerCanReview && (
              <p className="mb-3 text-sm text-muted-foreground">{t.firstReview}</p>
            )}
            <ReviewForm
              storeId={storeId}
              dict={dict}
              customerName={currentUser.name}
              initialRating={mine?.rating}
              initialComment={mine?.comment ?? undefined}
            />
          </>
        ) : (
          <Link
            href={`/${lang}/login`}
            className="relative inline-flex min-h-11 items-center rounded-xl border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
          >
            {dict.reviews.loginToReview}
          </Link>
        )}
      </div>

      {list.length > 0 && (
        <>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {t.legend}
          </p>
          <div className="mt-3 space-y-3">
            {list.map((r) => (
              <ReviewCard key={`${r.source}-${r.id}`} review={r} lang={lang} dict={dict} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
