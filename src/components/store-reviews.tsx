import Link from "next/link";
import { Star, CornerDownLeft } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ReviewForm } from "@/components/review-form";

// MP-010: no account id. This list is public and renders on a `select using
// (true)` table, so a customer_id here was a stable per-person identifier handed
// to every anonymous visitor. The one thing it was used for — finding the
// viewer's own review to prefill the form — is now answered server-side and
// arrives as `myReview`.
export type Review = {
  id: string;
  customer_name: string | null;
  rating: number;
  comment: string | null;
  // The shop's answer (0276). Only the owner can write it, and `reply_at` is
  // stamped by the trigger — so a reply sent three months late can never be
  // dressed up as same-day.
  reply: string | null;
  reply_at: string | null;
};

/** The viewer's own review of this store, or null — including when signed out. */
export type MyReview = { rating: number; comment: string | null };

export function StoreReviews({
  storeId,
  lang,
  dict,
  reviews,
  currentUser,
  myReview,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  reviews: Review[];
  currentUser: { id: string; name: string } | null;
  myReview: MyReview | null;
}) {
  const mine = currentUser ? myReview : null;

  return (
    <div className="mt-12">
      <h2 className="mb-4 text-xl font-bold">{dict.reviews.title}</h2>

      {currentUser ? (
        <ReviewForm
          storeId={storeId}
          dict={dict}
          customerName={currentUser.name}
          initialRating={mine?.rating}
          initialComment={mine?.comment ?? undefined}
        />
      ) : (
        <Link
          href={`/${lang}/login`}
          // 42px tall, which is 42 — two short of the minimum, and short
          // enough that four passes of "the header and nav are fine" never
          // caught it. The two pixels come from the hit box, not the pill.
          className="relative inline-block rounded-xl border border-border px-5 py-2.5 text-sm font-semibold transition-colors before:absolute before:-inset-y-px before:content-[''] hover:border-primary hover:text-primary"
        >
          {dict.reviews.loginToReview}
        </Link>
      )}

      <div className="mt-6 space-y-4">
        {reviews.length ? (
          reviews.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-border bg-surface p-5"
            >
              <div className="flex items-center justify-between gap-3">
                {/* dir=auto: customer names may be Latin inside the RTL page. */}
                <span dir="auto" className="font-bold">
                  {r.customer_name ?? "—"}
                </span>
                <span className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-4 w-4 ${
                        r.rating >= n
                          ? "fill-accent text-accent"
                          : "text-border"
                      }`}
                    />
                  ))}
                </span>
              </div>
              {r.comment && (
                <p className="mt-2 text-muted-foreground">{r.comment}</p>
              )}
              {/* An answer, not a second opinion: inset behind a start-edge rule
                  and set smaller than the review it belongs to, so a reader
                  never mistakes the shop's voice for another customer's. */}
              {r.reply?.trim() && (
                <div className="mt-3 rounded-e-xl border-s-2 border-primary/40 bg-surface-muted/60 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="flex items-center gap-1 text-xs font-bold text-primary">
                      <CornerDownLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
                      {dict.reviews.replyFrom}
                    </span>
                    {r.reply_at && (
                      <time
                        dateTime={r.reply_at}
                        dir="ltr"
                        className="text-xs tabular-nums text-muted-foreground"
                      >
                        {new Date(r.reply_at).toLocaleDateString(
                          lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                          { timeZone: "Asia/Beirut", year: "numeric", month: "short", day: "numeric" },
                        )}
                      </time>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.reply}</p>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">{dict.reviews.noReviews}</p>
        )}
      </div>
    </div>
  );
}
