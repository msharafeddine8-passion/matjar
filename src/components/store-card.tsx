import Link from "next/link";
import Image from "next/image";
import {
  Star,
  Navigation,
  Sparkles,
  Package,
  Percent,
  Users,
  LayoutGrid,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { categoryStyles, type FeaturedStore } from "@/lib/catalog";
import { resolveCardFacts, type StoreFactSource } from "@/lib/discovery";
import { categoryIcons } from "@/components/category-icon";
import { PaidPlanBadge, TrustBadges } from "@/components/trust-badges";
import { resolvePaidStatus, resolveStoreTrust } from "@/lib/trust";
import { NEUTRAL_BLUR } from "@/lib/image-placeholder";
import { FavoriteButton } from "@/components/favorite-button";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function StoreCard({
  store,
  lang,
  dict,
  facts,
  factsDict,
}: {
  store: FeaturedStore;
  lang: Locale;
  dict: Pick<Dictionary, "catalog" | "explore" | "featured" | "trust">;
  /** Real, per-store counts. A card renders a decision field only when the
   *  page has actually counted one — there is no placeholder and no estimate. */
  facts?: StoreFactSource;
  /** Supplied together with `facts`; keeping it separate means the pages that
   *  show a plain card (favourites, rails) need no new dictionary slice. */
  factsDict?: Dictionary["discovery"];
}) {
  const Icon = categoryIcons[store.category];
  const cat = dict.catalog[store.category];
  const style = categoryStyles[store.category];
  const isReal = UUID_RE.test(store.id);
  // The sector-aware part of the card. A clinic, a restaurant and a shop share
  // this component and this markup; the registry decides which lines exist and
  // what the catalogue is called, and the data decides whether each one has
  // anything to say. Nothing here is invented — an absent field is absent.
  const cardFacts =
    facts && factsDict ? resolveCardFacts(store.category, facts) : [];
  // Paid status and trust status, resolved apart and drawn apart. `verified`
  // (stores.is_verified) is handed in and ignored by the resolver on purpose —
  // see lib/trust.ts for what that column turned out to mean.
  const trust = resolveStoreTrust({
    isVerified: store.verified,
    commercialRegVerified: store.registered,
  });
  const paid = resolvePaidStatus(store.plan);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-border bg-surface transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md">
      {/* 3:1 — the one banner shape, shared with the store page and the upload
          box in the merchant form. It used to be a fixed 128px against a
          variable card width, so the same photo was framed differently here
          than it was inside the store. */}
      <div className={`relative aspect-[3/1] bg-gradient-to-br ${style.cover}`}>
        <div className="absolute inset-0 overflow-hidden">
          {store.coverUrl ? (
            <Image
              src={store.coverUrl}
              alt={store.name[lang]}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              // The merchant's own crop, the same one the store page uses.
              style={{ objectPosition: `50% ${store.coverPosition ?? 50}%` }}
              sizes="(max-width: 640px) 100vw, 320px"
              // A flat neutral tone while the cover loads, not a preview of it —
              // these are remote Storage URLs with no per-image hash. See
              // lib/image-placeholder.ts for exactly what that is and is not.
              placeholder="blur"
              blurDataURL={NEUTRAL_BLUR}
            />
          ) : (
            <Icon className="absolute end-4 top-4 h-16 w-16 text-foreground/[0.08] transition-transform duration-500 group-hover:scale-110" />
          )}
          {store.coverUrl && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-black/0 to-transparent" />
          )}
        </div>
        <span
          className={`absolute start-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold text-white ${
            store.isOpen ? "bg-success-strong" : "bg-muted-foreground"
          }`}
        >
          {store.isOpen ? dict.featured.open : dict.featured.closed}
        </span>
        {store.featured && (
          <span className="absolute bottom-3 start-3 inline-flex items-center gap-1 rounded-full bg-accent-strong px-2.5 py-1 text-xs font-bold text-accent-strong-foreground shadow-sm">
            <Sparkles className="h-3 w-3" />
            {dict.featured.featured}
          </span>
        )}
        {store.tag && !store.featured && (
          <span className="absolute bottom-3 start-3 rounded-full bg-surface/90 px-2.5 py-1 text-xs font-semibold backdrop-blur">
            {store.tag[lang]}
          </span>
        )}
        {isReal && (
          <FavoriteButton
            storeId={store.id}
            favorited={store.favorited ?? false}
            lang={lang}
            className="absolute end-3 top-3 z-10"
          />
        )}
        <span className="absolute -bottom-6 end-4 z-10 flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border-2 border-surface bg-surface shadow-md">
          {store.logoUrl ? (
            <Image
              src={store.logoUrl}
              alt={store.name[lang]}
              width={48}
              height={48}
              sizes="48px"
              className="h-full w-full rounded-[10px] object-cover"
              placeholder="blur"
              blurDataURL={NEUTRAL_BLUR}
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center rounded-[10px] ${style.iconWrap}`}
            >
              <Icon className="h-5 w-5" />
            </span>
          )}
        </span>
      </div>

      <div className="p-4 pt-7">
        <div className="flex items-center gap-2">
          {/* dir=auto: a Latin store name ending in a digit bidi-garbles
              inside the RTL page ("Let's meat 2" → "2 Let's meat") without it. */}
          <h3
            dir="auto"
            className="font-bold leading-tight transition-colors group-hover:text-primary"
          >
            {store.name[lang]}
          </h3>
          {paid.showsProMarker && <PaidPlanBadge dict={dict} lang={lang} />}
          <TrustBadges signals={trust} dict={dict} lang={lang} />
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {cat.name} · {store.area[lang]}
        </p>
        {store.distanceKm != null && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
            <Navigation className="h-3 w-3" />
            {store.distanceKm.toFixed(1)} {dict.explore.km}
          </span>
        )}
        {cardFacts.length > 0 && factsDict && (
          <ul className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {cardFacts.map((f) => {
              if (f.key === "offers")
                return (
                  <li
                    key="offers"
                    className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-bold text-success"
                  >
                    <Percent aria-hidden className="h-3 w-3" />
                    {factsDict.offersBadge}
                  </li>
                );
              const Glyph =
                f.key === "providers"
                  ? Users
                  : f.key === "sections"
                    ? LayoutGrid
                    : Package;
              const word =
                f.key === "providers"
                  ? factsDict.teamLabel
                  : f.key === "sections"
                    ? factsDict.sectionsLabel
                    : factsDict.nouns[f.noun];
              return (
                <li key={f.key} className="inline-flex items-center gap-1">
                  <Glyph aria-hidden className="h-3.5 w-3.5" />
                  <span className="font-semibold tabular-nums text-foreground">
                    {f.count}
                  </span>
                  {word}
                </li>
              );
            })}
          </ul>
        )}
        {/* Rating, or the honest thing to say instead of one.
            Five reviews exist across the whole marketplace, so on almost every
            card `rating` is undefined — rowToStore leaves it undefined at zero
            reviews rather than writing a 0 — and this slot used to be simply
            blank. A blank is not neutral: the card beside it has a star row, so
            the gap reads as "we withheld the score", which is worse than the
            truth. The truth is that nobody has reviewed this store yet, and
            «جديد» says it in the one word a shopper already knows how to
            discount. No number is invented and none is implied. */}
        {store.rating != null ? (
          <div className="mt-3 flex items-center gap-1.5 text-sm">
            <Star className="h-4 w-4 fill-accent text-accent" />
            <span className="font-bold tabular-nums">
              {store.rating.toFixed(1)}
            </span>
            <span className="text-muted-foreground">
              ({store.reviews} {dict.featured.reviews})
            </span>
          </div>
        ) : (
          <span className="mt-3 inline-flex items-center rounded-full bg-tint-7-soft px-2 py-0.5 text-xs font-bold text-tint-7">
            {dict.featured.newStore}
          </span>
        )}
      </div>

      <Link
        href={`/${lang}/store/${store.id}`}
        aria-label={store.name[lang]}
        className="absolute inset-0 z-0"
      />
    </article>
  );
}
