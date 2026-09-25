import { Fragment } from "react";
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
  Truck,
  Clock,
  ShoppingBasket,
  Timer,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { categoryStyles, regions } from "@/lib/catalog";
import {
  SLOT_FACTS,
  cardVariant,
  resolveSectorCard,
  storeCardSource,
  type CardStore,
  type SectorCardFact,
  type SectorCardSource,
} from "@/lib/card-facts";
import { formatUsd } from "@/lib/currency";
import { categoryIcons } from "@/components/category-icon";
import { PaidPlanBadge, TrustBadges } from "@/components/trust-badges";
import { resolvePaidStatus, resolveStoreTrust } from "@/lib/trust";
import { NEUTRAL_BLUR } from "@/lib/image-placeholder";
import { FavoriteButton } from "@/components/favorite-button";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CardDict = Dictionary["sectorCards"];

/** Fills `{name}` placeholders with nodes. Values arrive already isolated
 *  (see Ltr) so a "$2–$4" inside an Arabic sentence cannot flip to "$4–$2". */
function fill(
  template: string,
  vars: Record<string, React.ReactNode>,
): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? <span key={i}>{vars[m[1]]}</span> : part;
  });
}

/** Numbers, prices and ranges are left-to-right runs inside an RTL line. */
function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      {children}
    </bdi>
  );
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

function locationText(
  f: Extract<SectorCardFact, { key: "location" }> | undefined,
  lang: Locale,
): string | null {
  if (!f) return null;
  // The merchant's own area line is the more specific of the two; the region
  // is the fallback for the stores that left the area blank.
  if (f.area) return f.area;
  return regions.find((r) => r.key === f.region)?.name[lang] ?? null;
}

export function StoreCard({
  store,
  lang,
  dict,
  facts,
  factsDict,
  cardDict,
}: {
  store: CardStore;
  lang: Locale;
  dict: Pick<Dictionary, "catalog" | "explore" | "featured" | "trust">;
  /** Real, per-store data for the facts line. Defaults to `store.facts` when
   *  the loader attached them (lib/data/stores.ts, lib/data/discovery.ts).
   *  Nothing here is estimated: a field with no data renders nothing. */
  facts?: SectorCardSource;
  /** Both dictionaries are needed for the facts line; without them the card
   *  still renders its honest badge, rating and place, just no facts line —
   *  which keeps the pages that show a plain card (favourites) unchanged. */
  factsDict?: Dictionary["discovery"];
  cardDict?: CardDict;
}) {
  const Icon = categoryIcons[store.category];
  const cat = dict.catalog[store.category];
  const style = categoryStyles[store.category];
  const isReal = UUID_RE.test(store.id);
  const variant = cardVariant(store.category);

  // The sector-aware part of the card. A clinic, a restaurant and a shop share
  // this component and this markup; lib/card-facts.ts decides which facts a
  // buyer of the sector reads and in what order, and the data decides whether
  // each one has anything to say. The store-derived fields go LAST so the open
  // claim is always governed by `hoursKnown`, whatever a caller passed.
  const source: SectorCardSource = {
    ...(facts ?? store.facts ?? {}),
    ...storeCardSource(store, lang),
  };
  const all = resolveSectorCard(store.category, source);
  const open = all.find((f) => f.key === "open");
  const rating = all.find((f) => f.key === "rating");
  const where = locationText(
    all.find((f) => f.key === "location") as
      | Extract<SectorCardFact, { key: "location" }>
      | undefined,
    lang,
  );
  const line =
    factsDict && cardDict ? all.filter((f) => !SLOT_FACTS.has(f.key)) : [];
  // Services-style cards lead with one sentence — «يبدأ من $30 · 3 خدمات» —
  // rather than a row of chips; everything else is a compact facts row.
  const pricedLead = variant === "clinic" || variant === "service";
  const lead: SectorCardFact[] = pricedLead
    ? line.filter((f) => f.key === "startingPrice" || f.key === "serviceCount")
    : [];
  const rest = pricedLead ? line.filter((f) => !lead.includes(f)) : line;

  // Paid status and trust status, resolved apart and drawn apart. `verified`
  // (stores.is_verified) is handed in and ignored by the resolver on purpose —
  // see lib/trust.ts for what that column turned out to mean.
  const trust = resolveStoreTrust({
    isVerified: store.verified,
    commercialRegVerified: store.registered,
  });
  const paid = resolvePaidStatus(store.plan);

  const servicesWord = (n: number) => {
    if (!cardDict) return String(n);
    // Arabic has six plural forms and uses four of them here: خدمة وحدة،
    // خدمتين، ٣ خدمات، ١١ خدمة. Intl knows which one a count takes.
    const form = new Intl.PluralRules(lang).select(n) as keyof CardDict["services"];
    const tpl = cardDict.services[form] ?? cardDict.services.other;
    return fill(tpl, { n: <Ltr>{n}</Ltr> });
  };

  /** «3 منتجات», «منتج واحد», «11 منتج» — the same Intl plural choice as
   *  servicesWord, for every catalogue noun and for reviews. Null when the
   *  card has no card dictionary, so callers keep their plain wording. */
  const countWord = (
    noun: keyof CardDict["counts"],
    n: number,
  ): React.ReactNode | null => {
    const forms = cardDict?.counts?.[noun];
    if (!forms) return null;
    const form = new Intl.PluralRules(lang).select(n) as keyof typeof forms;
    return fill(forms[form] ?? forms.other, { n: <Ltr>{n}</Ltr> });
  };

  /** «يبدأ من $30» and «3 خدمات» — the services-style lead sentence. */
  function leadNode(f: SectorCardFact): React.ReactNode {
    if (!cardDict) return null;
    if (f.key === "startingPrice")
      return (
        <span className="inline-flex items-center gap-1">
          {cardDict.startsFrom}
          <span className="font-bold text-foreground">
            <Ltr>{formatUsd(f.amount)}</Ltr>
          </span>
        </span>
      );
    if (f.key === "serviceCount") return <span>{servicesWord(f.count)}</span>;
    return null;
  }

  function renderFact(f: SectorCardFact): React.ReactNode {
    if (!factsDict || !cardDict) return null;
    const chip = (
      key: string,
      Glyph: typeof Package,
      body: React.ReactNode,
    ) => (
      <li key={key} className="inline-flex items-center gap-1">
        <Glyph aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>{body}</span>
      </li>
    );
    switch (f.key) {
      case "fulfilment":
        return chip(
          "fulfilment",
          Truck,
          [f.delivery && cardDict.delivery, f.pickup && cardDict.pickup]
            .filter(Boolean)
            .join(" · "),
        );
      case "deliveryFee": {
        const body =
          f.max === 0
            ? cardDict.deliveryFree
            : f.min === f.max
              ? fill(cardDict.deliveryFee, { fee: <Ltr>{formatUsd(f.min)}</Ltr> })
              : fill(cardDict.deliveryFeeRange, {
                  range: (
                    <Ltr>
                      {formatUsd(f.min)}–{formatUsd(f.max)}
                    </Ltr>
                  ),
                });
        return chip("deliveryFee", Truck, body);
      }
      case "deliveryEta":
        return chip(
          "deliveryEta",
          Clock,
          f.min === f.max
            ? fill(cardDict.etaSingle, { n: <Ltr>{f.min}</Ltr> })
            : fill(cardDict.eta, {
                range: (
                  <Ltr>
                    {f.min}–{f.max}
                  </Ltr>
                ),
              }),
        );
      case "minOrder":
        return chip(
          "minOrder",
          ShoppingBasket,
          fill(cardDict.minOrder, { amount: <Ltr>{formatUsd(f.amount)}</Ltr> }),
        );
      case "prepTime":
        return chip(
          "prepTime",
          Timer,
          fill(cardDict.prepTime, { text: <bdi>{clip(f.text, 24)}</bdi> }),
        );
      case "insurance":
        return chip(
          "insurance",
          ShieldCheck,
          fill(cardDict.insurance, { text: <bdi>{clip(f.text, 32)}</bdi> }),
        );
      case "startingPrice":
      case "serviceCount":
        // Listings show their entry price in the compact row.
        return (
          <li key={f.key} className="inline-flex items-center gap-1">
            {leadNode(f)}
          </li>
        );
      case "offers":
        return (
          <li
            key="offers"
            className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-bold text-success"
          >
            <Percent aria-hidden className="h-3 w-3" />
            {factsDict.offersBadge}
          </li>
        );
      case "catalog":
      case "providers":
      case "sections": {
        const Glyph =
          f.key === "providers"
            ? Users
            : f.key === "sections"
              ? LayoutGrid
              : Package;
        const phrase =
          f.key === "catalog" ? countWord(f.noun, f.count) : null;
        const word =
          f.key === "providers"
            ? factsDict.teamLabel
            : f.key === "sections"
              ? factsDict.sectionsLabel
              : factsDict.nouns[f.noun];
        return (
          <li key={f.key} className="inline-flex items-center gap-1">
            <Glyph aria-hidden className="h-3.5 w-3.5" />
            {phrase ? (
              <span className="tabular-nums">{phrase}</span>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-foreground">
                  {f.count}
                </span>
                {word}
              </>
            )}
          </li>
        );
      }
      default:
        return null;
    }
  }

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
        {/* Open/closed only when the store published hours. `isOpen` is TRUE
            by default for a store with none (lib/hours.ts: never turn a
            customer away over a blank field) — that default decides whether a
            store is listed, but it is not a fact, and a green «مفتوح» badge
            drawn from it was a claim nobody made. */}
        {open?.key === "open" && (
          <span
            className={`absolute start-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold text-white ${
              open.open ? "bg-success-strong" : "bg-muted-foreground"
            }`}
          >
            {open.open ? dict.featured.open : dict.featured.closed}
          </span>
        )}
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
        {/* Positioned by a wrapper, not by className: FavoriteButton's own
            classes include `relative`, which competed with the `absolute`
            passed in and dropped the heart into flow — on top of the
            open/closed badge at the START corner instead of the end one. */}
        {isReal && (
          <span className="absolute end-3 top-3 z-10">
            <FavoriteButton
              storeId={store.id}
              favorited={store.favorited ?? false}
              lang={lang}
            />
          </span>
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
        {/* The sector, then the place. A clinic is chosen by where it is, so
            its place gets a line of its own; everywhere else it rides after
            the sector. A store with no area and no region gets no trailing
            «·» — the old line printed one for four live stores. */}
        <p className="mt-1 text-[13px] text-muted-foreground">
          {cat.name}
          {where && variant !== "clinic" && (
            <>
              {" · "}
              <bdi>{where}</bdi>
            </>
          )}
        </p>
        {where && variant === "clinic" && (
          <p className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
            <bdi className="truncate">{where}</bdi>
          </p>
        )}
        {store.distanceKm != null && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
            <Navigation className="h-3 w-3" />
            {store.distanceKm.toFixed(1)} {dict.explore.km}
          </span>
        )}
        {lead.length > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {lead.map((f, i) => (
              <Fragment key={f.key}>
                {i > 0 && <span aria-hidden>·</span>}
                {leadNode(f)}
              </Fragment>
            ))}
          </p>
        )}
        {rest.length > 0 && (
          <ul
            aria-label={cardDict?.factsLabel}
            className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground"
          >
            {rest.map(renderFact)}
          </ul>
        )}
        {/* Rating, or the honest thing to say instead of one.
            Five reviews exist across the whole marketplace, so on almost every
            card there is no rating fact — resolveSectorCard emits one only at
            ≥1 review and a non-zero average — and this slot used to be simply
            blank. A blank is not neutral: the card beside it has a star row, so
            the gap reads as "we withheld the score", which is worse than the
            truth. The truth is that nobody has reviewed this store yet, and
            «جديد» says it in the one word a shopper already knows how to
            discount. No number is invented and none is implied. */}
        {rating?.key === "rating" ? (
          <div className="mt-3 flex items-center gap-1.5 text-sm">
            <Star className="h-4 w-4 fill-accent text-accent" />
            <span className="font-bold tabular-nums">
              {rating.avg.toFixed(1)}
            </span>
            <span className="text-muted-foreground">
              ({countWord("reviews", rating.count) ?? (
                <>
                  {rating.count} {dict.featured.reviews}
                </>
              )})
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
