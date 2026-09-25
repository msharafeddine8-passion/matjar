import Link from "next/link";
import { BadgeCheck, CornerDownLeft, Star } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { ProfileReview } from "@/lib/profile-engine";

/** A calendar date in Beirut with Western digits — never the server's zone,
 *  never Eastern Arabic numerals in a commerce context. */
export function reviewDate(iso: string | null, lang: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Beirut",
  }).format(d);
}

// One review, Reviews 2.0: stars, what it is about, the badge ONLY when the
// row carries evidence of an order (lib/profile-engine reviewVerification), the
// author, the date, the text, and the shop's answer inset beneath it.
export function ReviewCard({
  review,
  lang,
  dict,
}: {
  review: ProfileReview;
  lang: Locale;
  dict: Dictionary;
}) {
  const t = dict.profile.reviews;
  const date = reviewDate(review.createdAt, lang);
  const replyDate = reviewDate(review.replyAt, lang);
  return (
    <article className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span
          className="flex items-center gap-0.5"
          role="img"
          aria-label={t.stars.replace("{n}", String(review.rating))}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              aria-hidden="true"
              className={`h-4 w-4 ${
                review.rating >= n ? "fill-accent text-accent" : "text-border"
              }`}
            />
          ))}
        </span>
        {date && (
          <time
            dateTime={review.createdAt ?? undefined}
            className="text-xs tabular-nums text-muted-foreground"
          >
            {date}
          </time>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {/* dir=auto: customer names may be Latin inside the RTL page. */}
        <span dir="auto" className="text-sm font-bold">
          {review.authorName?.trim() || t.anonymous}
        </span>
        {review.subject ? (
          <Link
            href={`/${lang}/product/${review.subject.id}`}
            className="rounded-full bg-surface-muted px-2 py-0.5 font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            <bdi>{t.about.replace("{name}", review.subject.name)}</bdi>
          </Link>
        ) : (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 font-semibold text-muted-foreground">
            {t.storeReview}
          </span>
        )}
        {review.verification === "orderedOnMatjar" && (
          <span
            title={t.orderedTitle}
            className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-bold text-success"
          >
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t.ordered}
          </span>
        )}
      </div>

      {review.comment?.trim() && (
        <p dir="auto" className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {review.comment}
        </p>
      )}

      {/* An answer, not a second opinion: inset behind a start-edge rule and
          set smaller than the review it belongs to. */}
      {review.reply?.trim() && (
        <div className="mt-3 rounded-e-xl border-s-2 border-primary/40 bg-surface-muted/60 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="flex items-center gap-1 text-xs font-bold text-primary">
              <CornerDownLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
              {dict.reviews.replyFrom}
            </span>
            {replyDate && (
              <time
                dateTime={review.replyAt ?? undefined}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {replyDate}
              </time>
            )}
          </div>
          <p dir="auto" className="mt-1 text-sm text-muted-foreground">
            {review.reply}
          </p>
        </div>
      )}
    </article>
  );
}
