import Image from "next/image";
import { Star, BadgeCheck } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { ProductReviewsData } from "@/lib/data/product-reviews";
import { Card, CardList, CardRow } from "@/components/ui/card";
import { ProductReviewForm } from "@/components/product-review-form";

/** Wording the offering resolver picks per variant, so a clinic's page says
 *  "تقييمات الخدمة" and a restaurant's "تقييمات الطبق" instead of speaking about
 *  a product the customer never bought. Omitted = the product wording. */
export type ReviewsCopy = {
  title: string;
  empty: string;
  commentPlaceholder: string;
};

export function ProductReviews({
  data,
  productId,
  canWrite,
  lang,
  dict,
  copy,
}: {
  data: ProductReviewsData;
  productId: string;
  canWrite: boolean;
  lang: Locale;
  dict: Dictionary;
  copy?: ReviewsCopy;
}) {
  const t = dict.productReviews;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
      timeZone: "Asia/Beirut",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-2xl font-extrabold tracking-tight">
        {copy?.title ?? t.title}
      </h2>

      {data.count > 0 && (
        <Card className="mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="text-center sm:w-40">
            <div className="text-4xl font-extrabold">
              {data.avg!.toFixed(1)}
            </div>
            <div className="mt-1 flex justify-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={`h-4 w-4 ${
                    n <= Math.round(data.avg!)
                      ? "fill-accent text-accent"
                      : "text-border"
                  }`}
                />
              ))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {data.count} {t.count}
            </div>
          </div>
          <div className="flex-1 space-y-1">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const n = data.breakdown[star];
              const pct = data.count ? (n / data.count) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="w-3 font-semibold">{star}</span>
                  <Star className="h-3 w-3 fill-accent text-accent" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-end text-muted-foreground">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {canWrite && !data.mine && (
        <div className="mb-6">
          <ProductReviewForm
            productId={productId}
            dict={dict}
            commentPlaceholder={copy?.commentPlaceholder}
          />
        </div>
      )}

      {data.count === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-muted-foreground">
          {copy?.empty ?? t.empty}
        </p>
      ) : (
        <CardList>
          {data.reviews.map((r) => (
            <CardRow key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.customerName ?? "—"}</span>
                {r.verified && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold text-success">
                    <BadgeCheck className="h-3 w-3" />
                    {t.verified}
                  </span>
                )}
                <span className="ms-auto text-xs text-muted-foreground">
                  {fmtDate(r.createdAt)}
                </span>
              </div>
              <div className="mt-1 flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`h-3.5 w-3.5 ${
                      n <= r.rating
                        ? "fill-accent text-accent"
                        : "text-border"
                    }`}
                  />
                ))}
              </div>
              {r.comment && (
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
                  {r.comment}
                </p>
              )}
              {r.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.photos.map((p, i) => (
                    <div
                      key={i}
                      className="relative h-20 w-20 overflow-hidden rounded-lg border border-border"
                    >
                      <Image src={p} alt="" fill className="object-cover" sizes="80px" />
                    </div>
                  ))}
                </div>
              )}
            </CardRow>
          ))}
        </CardList>
      )}
    </section>
  );
}
