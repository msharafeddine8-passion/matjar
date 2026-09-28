import Link from "next/link";
import Image from "next/image";
import { Clock, ImageIcon } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { CategoryKey } from "@/lib/catalog";
import { formatLbp } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import { localized } from "@/lib/i18n-field";
import { NEUTRAL_BLUR } from "@/lib/image-placeholder";
import {
  offeringPriceLabel,
  resolveOffering,
  type OfferingKind,
} from "@/lib/offering";

/** What a card needs to know to speak about the row correctly — the same two
 *  inputs the offering resolver takes, plus the one merchant-entered fact a
 *  service card shows (its duration). Every loader that feeds this card
 *  selects `item_kind, duration_minutes, stores(business_types(slug))`. */
export type MiniCardOffering = {
  itemKind: OfferingKind;
  category: CategoryKey;
  durationMinutes?: number | null;
};

// Compact offering card used in discovery rows (related, search, flash,
// recently viewed).
//
// `offering` + `copy` are what stop a service card passing for a product: the
// resolver decides whether the card wears a "خدمة" badge, whether a duration
// line belongs on it, and whether an unpriced row says "السعر بعد الاستشارة"
// instead of "$0". Both are optional only so a caller with no kind data still
// renders — it then renders exactly what it rendered before.
export function ProductMiniCard({
  lang,
  id,
  name,
  nameEn,
  price,
  discountPrice,
  imageUrl,
  storeName,
  lbpRate = 0,
  offering,
  copy,
}: {
  lang: Locale;
  id: string;
  name: string;
  nameEn?: string | null;
  price: number;
  discountPrice: number | null;
  imageUrl: string | null;
  storeName?: string;
  lbpRate?: number;
  offering?: MiniCardOffering;
  /** `dict.offering` — the resolver's nouns and price wording. */
  copy?: Dictionary["offering"];
}) {
  const shown = discountPrice ?? price;
  const displayName = localized(name, nameEn, lang);
  const exp = offering
    ? resolveOffering({ category: offering.category, itemKind: offering.itemKind })
    : null;
  const priceLabel = exp
    ? offeringPriceLabel({ variant: exp.variant, price: shown })
    : "fixed";
  const badge = exp?.cardBadge && copy ? copy.cardBadge[exp.cardBadge] : null;
  const duration =
    exp?.showsDuration && copy && offering?.durationMinutes != null
      ? copy.durationShort.replace("{n}", String(offering.durationMinutes))
      : null;
  return (
    <Link
      href={`/${lang}/product/${id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md"
    >
      <div className="relative overflow-hidden">
        {badge && (
          <span className="absolute start-2 top-2 z-[1] rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-bold text-primary backdrop-blur">
            {badge}
          </span>
        )}
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={displayName}
            width={300}
            height={200}
            className="h-32 w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            sizes="(max-width: 640px) 50vw, 25vw"
            placeholder="blur"
            blurDataURL={NEUTRAL_BLUR}
          />
        ) : (
          <div className="flex h-32 w-full items-center justify-center bg-surface-muted">
            <ImageIcon className="h-9 w-9 text-foreground/10 transition-transform duration-500 group-hover:scale-110" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3
          dir="auto"
          className="line-clamp-2 text-sm font-bold leading-tight transition-colors group-hover:text-primary"
        >
          {displayName}
        </h3>
        {storeName ? (
          <p dir="auto" className="mt-0.5 text-xs text-muted-foreground">
            {storeName}
          </p>
        ) : null}
        {duration && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock aria-hidden className="h-3 w-3 shrink-0 text-primary" />
            {duration}
          </p>
        )}
        {priceLabel === "onConsult" && copy ? (
          /* The merchant entered no price for this service. The honest state
             is a sentence, not a zero. */
          <p className="mt-1.5 text-sm font-bold text-primary">
            {copy.priceOnConsult}
          </p>
        ) : (
          <>
            <p className="mt-1.5">
              <span className="text-money text-base font-bold text-primary">
                <Money value={shown} />
              </span>{" "}
              {discountPrice != null && (
                <span className="text-money text-xs text-muted-foreground line-through">
                  <Money value={price} />
                </span>
              )}
            </p>
            {lbpRate > 0 && (
              <p className="text-money mt-0.5 text-[11px] text-muted-foreground">
                {formatLbp(shown, lbpRate, lang)}
              </p>
            )}
          </>
        )}
      </div>
    </Link>
  );
}
