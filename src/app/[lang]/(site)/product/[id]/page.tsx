import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cache, Fragment } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  Store as StoreIcon,
  CalendarCheck,
  Clock,
  Flame,
  ShieldCheck,
  Truck,
  UserRound,
  Wallet,
} from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates, SITE_URL } from "@/lib/site";
import { offeringJsonLd, jsonLdScript } from "@/lib/jsonld";
import {
  getPublicProductView,
  getOwnedProductView,
  type ProductView,
} from "@/lib/data/product-view";
import {
  getCheckoutViewer,
  getStoreCheckoutContext,
  withLoyaltyBalance,
} from "@/lib/data/checkout";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { attributeSummary } from "@/lib/attributes";
import { effectivePrice, compareAtPrice, flashEndsAt } from "@/lib/pricing";
import { FlashCountdown } from "@/components/flash-countdown";
import { getUsdLbpRate } from "@/lib/data/settings";
import {
  getMoreFromStore,
  getSimilarProducts,
  getBoughtTogether,
  getServiceProviders,
  type RelatedProduct,
  type ServiceProvider,
} from "@/lib/data/related";
import { getProductReviews } from "@/lib/data/product-reviews";
import { getProductQuestions } from "@/lib/data/product-qa";
import { ProductReviews } from "@/components/product-reviews";
import { ProductQA } from "@/components/product-qa";
import { RecentlyViewed } from "@/components/recently-viewed";
import { formatUsd, formatLbp } from "@/lib/currency";
import { lowestOptionPrice } from "@/lib/service-options";
import { Money } from "@/components/ui/money";
import { localized } from "@/lib/i18n-field";
import { ProductMiniCard } from "@/components/product-mini-card";
import { Container } from "@/components/ui/container";
import { ProductGallery } from "@/components/product-gallery";
import { ProductOrder } from "@/components/product-order";
import { ProductBuyBar } from "@/components/product-buy-bar";
import { WishlistButton } from "@/components/wishlist-button";
import { ShareButton } from "@/components/share-button";
import { ProductStoryCard } from "@/components/product-story-card";
import { BackButton } from "@/components/back-button";
import { TrackVisit } from "@/components/track-visit";
import { RestockButton } from "@/components/restock-button";
import { ContentReport } from "@/components/listing-report";
import { sectorHasTeam } from "@/lib/sectors";
import {
  offeringPriceLabel,
  offeringSectionSlot,
  resolveOffering,
  type OfferingSectionKey,
} from "@/lib/offering";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// React cache(): generateMetadata and the page both call loadProduct(id) for
// the same request — dedupe into one call. The public product view now comes
// from src/lib/data/product-view.ts (cookie-less + cross-request cached); only
// the owner/staff draft-preview fallback touches the request-scoped client.
const loadProduct = cache(async function loadProduct(
  id: string,
): Promise<ProductView | null> {
  if (!UUID_RE.test(id)) return null;
  // Common case: cached, cookie-less anon view (RLS → active products only).
  const pub = await getPublicProductView(id);
  if (pub) return pub;
  // Owner/staff previewing a not-yet-public product: their RLS grant makes it
  // visible on the request-scoped client. Uncached — visibility is per-user.
  return getOwnedProductView(await createClient(), id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang)) return {};
  const product = await loadProduct(id);
  if (!product) return { title: "Matjar" };
  const name = localized(product.name, product.nameEn, lang);
  const localizedDesc = localized(
    product.description ?? "",
    product.descriptionEn,
    lang,
  );
  const description =
    localizedDesc ||
    (lang === "ar"
      ? `${name} من ${product.storeName} على متجر.`
      : `${name} from ${product.storeName} on Matjar.`);
  const image = product.images[0];
  return {
    title: name,
    description,
    // The URL stays /product/[id] for every offering kind. Route semantics are
    // worth less than the links and search rankings already pointing here.
    alternates: localeAlternates(lang, `/product/${id}`),
    openGraph: {
      title: name,
      description,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: name,
      description,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const product = await loadProduct(id);
  if (!product) notFound();

  const dict = await getDictionary(lang);
  const l = lang as Locale;
  const name = localized(product.name, product.nameEn, l);
  const description = localized(
    product.description ?? "",
    product.descriptionEn,
    l,
  );

  // ===== The offering resolver decides the whole page =====
  // Variant (goods / appointment / menu item), primary CTA, and the ordered
  // sections — all from the store's sector plus this row's own item_kind. The
  // old page branched once on "service or non-commerce sector" and rendered one
  // hardcoded sequence for everything else, which is why a dental cleaning
  // showed a stock badge and "منتجات مشابهة".
  const offering = resolveOffering({
    category: product.category,
    itemKind: product.itemKind,
  });
  const copy = dict.offering[offering.noun];
  const ctaLabel = dict.offering.cta[offering.cta];
  const shows = (key: OfferingSectionKey) => offering.sections.includes(key);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The checkout this page can offer — read exactly as the store page reads it
  // (src/lib/data/checkout.ts). MJ-024: the buy box used to be handed only a
  // saved address and two booleans, so it collected no delivery zone, no
  // coupon, no loyalty opt-in and none of the merchant's own checkout fields,
  // and since 0229 a store with zones could not be ordered from here at all.
  const [checkoutCtx, checkoutViewer] = await Promise.all([
    getStoreCheckoutContext(product.storeId),
    getCheckoutViewer(supabase, user?.id ?? null, l),
  ]);
  const checkout = checkoutCtx
    ? await withLoyaltyBalance(checkoutCtx, supabase, !!user)
    : null;

  let isWishlisted = false;
  if (user) {
    const { data: wl } = await supabase
      .from("wishlist")
      .select("product_id")
      .eq("user_id", user.id)
      .eq("product_id", product.id)
      .maybeSingle();
    isWishlisted = !!wl;
  }

  const basePrice = effectivePrice(product);
  // 0321: a bookable service with several prices shows «من $X» and lists
  // them; the customer picks one in the booking panel.
  const serviceOptions =
    offering.cta === "bookAppointment"
      ? product.variants.filter((v) => v.is_available)
      : [];
  const fromPrice = serviceOptions.length
    ? lowestOptionPrice(
        basePrice,
        serviceOptions.map((v) => ({
          id: v.id,
          label: v.label,
          price: v.price,
          durationMinutes: v.durationMinutes ?? null,
        })),
      )
    : null;
  const compareAt = compareAtPrice(product);
  const flashEnd = flashEndsAt(product);
  // A service the merchant never priced says so; nothing on this page prints a
  // zero for it — not the hero, not the sticky bar, not the story card, not
  // the JSON-LD.
  const priceLabel = offeringPriceLabel({
    variant: offering.variant,
    price: basePrice,
  });
  const priceText =
    priceLabel === "onConsult"
      ? dict.offering.priceOnConsult
      : formatUsd(basePrice);
  const lbpRate = await getUsdLbpRate();
  // Related lists are filtered to this offering's own kind, so a clinic page
  // recommends services and a shop page recommends goods. Sections the variant
  // does not render are not fetched at all.
  const [
    moreFromStore,
    similar,
    boughtTogether,
    productReviews,
    questions,
    soldRes,
    providers,
  ] = await Promise.all([
    shows("moreFromStore")
      ? getMoreFromStore(product.storeId, product.id, 6, offering.relatedKind)
      : Promise.resolve([] as RelatedProduct[]),
    shows("related")
      ? getSimilarProducts(
          product.category,
          product.storeId,
          product.id,
          6,
          offering.relatedKind,
        )
      : Promise.resolve([] as RelatedProduct[]),
    shows("boughtTogether")
      ? getBoughtTogether(product.id)
      : Promise.resolve([] as RelatedProduct[]),
    getProductReviews(product.id, user?.id ?? null),
    // No viewer id: the Q&A projection no longer distinguishes the asker at all
    // (MP-010) — nothing on the page ever rendered that distinction.
    getProductQuestions(product.id),
    supabase.rpc("product_sold_count", { p_product_id: product.id }),
    shows("provider") && sectorHasTeam(product.category)
      ? getServiceProviders(product.storeId, product.id)
      : Promise.resolve([] as ServiceProvider[]),
  ]);
  const soldCount = (soldRes.data as number | null) ?? 0;

  let isStoreOwner = false;
  if (user) {
    const { data: st } = await supabase
      .from("stores")
      .select("owner_id")
      .eq("id", product.storeId)
      .maybeSingle();
    isStoreOwner = (st as { owner_id?: string } | null)?.owner_id === user.id;
  }
  const attrText = attributeSummary(product.category, product.attributes, l);
  // Sold out is a fact about a basket: only an offering that can be put in
  // one can be sold out of. A tracked count of 0 blocks the order on a dish
  // as on a good (the RPC refuses it either way); the BADGE and the waitlist
  // are the retail-only parts, gated on `showsStock` below.
  const soldOut =
    offering.addableToCart && product.stock != null && product.stock <= 0;

  // Back-in-stock: is this signed-in viewer already waiting on this product?
  let onWaitlist = false;
  if (user && soldOut && offering.showsStock) {
    const { data: wl } = await supabase
      .from("stock_waitlist")
      .select("id")
      .eq("product_id", product.id)
      .is("notified_at", null)
      .maybeSingle();
    onWaitlist = !!wl;
  }

  const storeHref = `/${lang}/store/${product.storeId}`;
  const cancelHours = product.bookingCancelHours ?? 0;

  // ===== Sections =====
  // A section is null when it has no data, and a null section is never rendered
  // — no empty shells. The resolver decides ORDER; the data decides PRESENCE.
  const nodes: Partial<Record<OfferingSectionKey, ReactNode>> = {};

  nodes.gallery = <ProductGallery images={product.images} alt={name} />;

  nodes.header = (
    <>
      {product.brand && (
        <Link
          href={`${storeHref}?brand=${encodeURIComponent(product.brand)}`}
          className="inline-block text-sm font-bold uppercase tracking-wide text-primary transition-opacity hover:opacity-80"
        >
          {product.brand}
        </Link>
      )}
      {/* dir=auto: merchant-typed name; Latin names with digits bidi-garble
          inside the RTL document without it. */}
      <h1 dir="auto" className="text-3xl font-extrabold tracking-tight">
        {name}
      </h1>
      <Link
        href={storeHref}
        className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary lg:min-h-0"
      >
        <StoreIcon className="h-4 w-4" />
        {product.storeName}
      </Link>
    </>
  );

  nodes.price =
    priceLabel === "onConsult" ? (
      <>
        <p className="mt-3 text-xl font-extrabold text-primary">
          {dict.offering.priceOnConsult}
        </p>
        {attrText && (
          <p className="mt-3 text-sm text-muted-foreground">{attrText}</p>
        )}
      </>
    ) : (
      <>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* .text-money replaces hand-rolled dir=ltr + tabular-nums and adds
              the bidi isolation the house standard calls for. */}
          <span
            className={`text-money text-2xl font-extrabold ${flashEnd != null ? "text-warning" : "text-primary"}`}
          >
            {fromPrice != null ? (
              dict.booking.fromPrice.replace("{price}", formatUsd(fromPrice))
            ) : (
              <Money value={basePrice} />
            )}
          </span>
          {compareAt != null && fromPrice == null && (
            <span className="text-money text-lg text-muted-foreground line-through">
              <Money value={compareAt} />
            </span>
          )}
          {flashEnd != null && <FlashCountdown endsAt={flashEnd} dict={dict} />}
        </div>
        {lbpRate > 0 && (
          <p dir="ltr" className="mt-1 text-sm tabular-nums text-muted-foreground">
            {formatLbp(basePrice, lbpRate, l)}
          </p>
        )}
        {attrText && (
          <p className="mt-3 text-sm text-muted-foreground">{attrText}</p>
        )}
      </>
    );

  // Duration is real or absent: `duration_minutes` is a merchant-entered column,
  // never inferred. A service with no duration simply has no duration line.
  nodes.duration =
    product.durationMinutes != null ? (
      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
        <Clock className="h-4 w-4 text-primary" />
        {dict.product.durationLabel.replace(
          "{n}",
          String(product.durationMinutes),
        )}
      </p>
    ) : null;

  // The stock BADGE is retail-only (`showsStock`): a dish that ran out is
  // blocked at the buy box, not labelled "نفد المخزون" as if it had shelves.
  // The "طُلب {n} مرة" line is popularity, not inventory, and stays for any
  // offering that reached an order.
  nodes.stock =
    (offering.showsStock && product.stock != null) || soldCount > 0 ? (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {offering.showsStock &&
          product.stock != null &&
          (soldOut ? (
            <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-bold text-danger">
              {dict.product.outOfStock}
            </span>
          ) : product.stock <= 5 ? (
            <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-bold text-warning">
              {dict.product.lowStock.replace("{n}", String(product.stock))}
            </span>
          ) : (
            <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success">
              {dict.product.inStock}
            </span>
          ))}
        {soldCount > 0 && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <Flame className="h-4 w-4 shrink-0" />
            {dict.product.soldCount.replace("{n}", String(soldCount))}
          </span>
        )}
      </div>
    ) : null;

  nodes.included =
    product.isBundle && product.includes.length > 0 ? (
      <div className="mt-5 rounded-2xl border border-primary/20 bg-primary-soft/40 p-4">
        <h2 className="text-sm font-bold text-primary">{copy.includedTitle}</h2>
        <ul className="mt-2 space-y-1">
          {product.includes.map((it, i) => (
            <li key={i} className="flex items-center gap-2 text-sm font-semibold">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                {it.quantity}
              </span>
              {localized(it.name, it.nameEn, l)}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  nodes.description = description ? (
    <div className="mt-5">
      <h2 className="text-sm font-bold text-muted-foreground">
        {copy.descriptionTitle}
      </h2>
      <p className="mt-1.5 whitespace-pre-line leading-relaxed">{description}</p>
    </div>
  ) : null;

  // Who provides it: the roster the merchant entered, filtered by the
  // service_providers mapping (no mapping = anyone on the team, the same rule
  // the booking engine applies). No team, no section.
  nodes.provider =
    providers.length > 0 ? (
      <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <UserRound className="h-4 w-4 text-primary" />
          {dict.offering.providerTitle}
        </h2>
        <ul className="mt-3 space-y-3">
          {providers.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              {p.photo_url ? (
                <Image
                  src={p.photo_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted">
                  <UserRound className="h-5 w-5 text-muted-foreground" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">
                  {p.name}
                </span>
                {p.specialty && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.specialty}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {providers.length > 1 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {dict.offering.providerAny}
          </p>
        )}
      </div>
    ) : null;

  nodes.buyBox = (
    <div
      id="buy-box"
      className="mt-6 rounded-2xl border border-border bg-surface p-5"
    >
      {offering.cta === "bookAppointment" ? (
        /* Routes into the EXISTING booking engine with this service
           preselected — the page states the outcome and hands off; it does not
           re-implement any part of place_booking. */
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {dict.product.bookingLead}
          </p>
          {serviceOptions.length > 0 && (
            <ul className="mb-3 divide-y divide-border rounded-xl border border-border">
              {serviceOptions.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{o.label}</span>
                    {o.durationMinutes != null && (
                      <span className="block text-xs text-muted-foreground">
                        {dict.booking.optionDuration.replace("{n}", String(o.durationMinutes))}
                      </span>
                    )}
                  </span>
                  <span className="text-money shrink-0 font-bold">
                    <Money value={o.price ?? basePrice} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* Same fact, the booking wording. `booking.payOnArrival` is the
              string the booking panel itself uses, so the promise made here and
              the one made at the moment of booking are the same sentence. */}
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-success-soft px-3.5 py-2.5 text-xs font-semibold leading-relaxed text-success">
            <Wallet className="mt-px h-4 w-4 shrink-0" />
            {dict.booking.payOnArrival}
          </p>
          <Link
            href={`${storeHref}?service=${product.id}`}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3.5 font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <CalendarCheck className="h-4.5 w-4.5" />
            {ctaLabel}
          </Link>
          <Link
            href={storeHref}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border px-6 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <StoreIcon className="h-4 w-4" />
            {dict.product.visitStore}
          </Link>
        </>
      ) : offering.cta === "contactStore" ? (
        /* Directory-only sectors have no engine at all — say so instead of
           offering a transaction the platform cannot honour. */
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {dict.offering.contactLead}
          </p>
          <Link
            href={storeHref}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3.5 font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <StoreIcon className="h-4.5 w-4.5" />
            {ctaLabel}
          </Link>
        </>
      ) : offering.addableToCart && checkout ? (
        /* `addableToCart` is the resolver's one cart test — the two branches
           above already caught the booking and contact CTAs, so this is belt
           and braces, and the buy box asserts it again on its own side.
           No checkout context means the store row is not readable to this
           viewer — an owner previewing a not-yet-public store, say. There is
           nothing to order from, so the buy box does not render rather than
           collecting an address for an RPC that would refuse. */
        <>
          <ProductOrder
            lang={lang}
            dict={dict}
            productId={product.id}
            productName={name}
            checkout={checkout}
            viewer={checkoutViewer}
            basePrice={basePrice}
            stock={product.stock}
            variants={product.variants}
            addons={product.addons}
            modifierGroups={product.modifierGroups}
            allowScheduling={offering.variant === "menuItem"}
            category={product.category}
            lbpRate={lbpRate}
            ctaLabel={ctaLabel}
            offering={offering}
            soldOutLabel={dict.offering.soldOut[offering.noun]}
          />
          {soldOut && offering.showsStock && (
            <div className="mt-3 border-t border-border pt-3">
              <RestockButton
                productId={product.id}
                lang={l}
                loggedIn={!!user}
                subscribed={onWaitlist}
                labels={{
                  notify: dict.product.notifyMe,
                  login: dict.product.notifyLogin,
                  on: dict.product.notifyOn,
                  cancel: dict.product.notifyCancel,
                  saved: dict.product.notifySaved,
                  error: dict.common.actionFailed,
                }}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  nodes.share = (
    <>
      <div className="mt-3">
        <WishlistButton
          productId={product.id}
          wishlisted={isWishlisted}
          lang={lang}
          dict={dict}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ShareButton title={name} dict={dict} />
        <ProductStoryCard
          productId={product.id}
          name={name}
          price={basePrice}
          priceText={priceText}
          scanLabel={
            offering.cta === "bookAppointment"
              ? dict.offering.scanToBook
              : dict.share.scanToOrder
          }
          imageUrl={product.images[0] ?? null}
          baseUrl={SITE_URL}
          dict={dict}
        />
      </div>
    </>
  );

  // Policies are merchant data or nothing. A service shows its cancellation
  // window only when the merchant set one (booking_cancel_hours); goods show
  // the delivery/pickup the store actually accepts. Neither is invented, and
  // when there is nothing to say the whole block disappears.
  const policyLines: { icon: ReactNode; text: string }[] = [];
  if (offering.cta === "bookAppointment") {
    if (cancelHours > 0)
      policyLines.push({
        icon: <ShieldCheck className="h-4 w-4 text-primary" />,
        text: dict.offering.policyCancel.replace("{n}", String(cancelHours)),
      });
  } else if (offering.transacts) {
    if (product.acceptsDelivery)
      policyLines.push({
        icon: <Truck className="h-4 w-4 text-primary" />,
        text: dict.offering.fulfillmentDelivery,
      });
    if (product.acceptsPickup)
      policyLines.push({
        icon: <StoreIcon className="h-4 w-4 text-primary" />,
        text: dict.offering.fulfillmentPickup,
      });
  }
  nodes.policies =
    policyLines.length > 0 ? (
      <div className="mt-4 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-bold">
          {offering.cta === "bookAppointment"
            ? dict.offering.policiesTitle
            : dict.offering.fulfillmentTitle}
        </h2>
        <ul className="mt-2 space-y-1.5">
          {policyLines.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0">{line.icon}</span>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const grid = (items: RelatedProduct[], showStore: boolean) => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((p) => (
        <ProductMiniCard
          key={p.id}
          lang={lang}
          id={p.id}
          name={p.name}
          nameEn={p.nameEn}
          price={p.price}
          discountPrice={p.discountPrice}
          imageUrl={p.imageUrl}
          storeName={showStore ? p.storeName : undefined}
          lbpRate={lbpRate}
          offering={{
            itemKind: p.itemKind,
            category: p.category,
            durationMinutes: p.durationMinutes,
          }}
          copy={dict.offering}
        />
      ))}
    </div>
  );

  nodes.boughtTogether =
    boughtTogether.length > 0 ? (
      <section className="mt-12">
        <h2 className="mb-4 text-xl font-bold">{dict.product.boughtTogether}</h2>
        {grid(boughtTogether, true)}
      </section>
    ) : null;

  nodes.reviews = (
    <ProductReviews
      data={productReviews}
      productId={product.id}
      canWrite={!!user}
      lang={l}
      dict={dict}
      copy={{
        title: copy.reviewsTitle,
        empty: copy.reviewsEmpty,
        commentPlaceholder: copy.reviewsPlaceholder,
      }}
    />
  );

  nodes.qa = (
    <ProductQA
      productId={product.id}
      questions={questions}
      canAsk={!!user}
      canAnswer={isStoreOwner}
      dict={dict}
      askPlaceholder={copy.qaPlaceholder}
    />
  );

  nodes.moreFromStore =
    moreFromStore.length > 0 ? (
      <section className="mt-12">
        <h2 className="mb-4 text-xl font-bold">{copy.moreFromStore}</h2>
        {grid(moreFromStore, false)}
      </section>
    ) : null;

  nodes.related =
    similar.length > 0 ? (
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold">{copy.related}</h2>
        {grid(similar, true)}
      </section>
    ) : null;

  nodes.recentlyViewed = (
    <RecentlyViewed currentId={product.id} lang={l} dict={dict} />
  );

  // Fragments, not wrappers: the resolver reorders the page without adding a
  // single box to it, so the two-column hero and the existing spacing survive.
  const inSlot = (slot: ReturnType<typeof offeringSectionSlot>) =>
    offering.sections
      .filter((k) => offeringSectionSlot(k) === slot)
      .map((k) => (nodes[k] ? <Fragment key={k}>{nodes[k]}</Fragment> : null));

  return (
    <div className="py-8">
      {UUID_RE.test(product.storeId) && UUID_RE.test(product.id) && (
        <TrackVisit
          storeId={product.storeId}
          productId={product.id}
          path="product"
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            // Typed by the resolver's noun: a Product with stock for goods, a
            // Service provided by the store for an appointment, a MenuItem for
            // a dish. An unpriced service carries no Offer at all.
            offeringJsonLd({
              noun: offering.noun,
              name,
              description,
              image: product.images[0],
              url: `${SITE_URL}/${lang}/product/${id}`,
              price: priceLabel === "onConsult" ? null : basePrice,
              storeName: product.storeName,
              brand: product.brand,
              available: !soldOut,
              rating: productReviews.avg,
              reviewCount: productReviews.count,
            }),
          ),
        }}
      />
      <Container>
        <div className="pt-4">
          <BackButton label={dict.common.back} fallbackHref={storeHref} />
        </div>
        <Breadcrumbs
          items={[
            { label: dict.common.brand, href: `/${lang}` },
            {
              label: product.storeName || dict.product.backToStore,
              href: storeHref,
            },
            { label: name },
          ]}
        />

        <div className="grid gap-8 lg:grid-cols-2">
          {inSlot("gallery")}
          <div>
            {inSlot("detail")}
            <Link
              href={storeHref}
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline lg:min-h-0"
            >
              <StoreIcon className="h-4 w-4" />
              {dict.product.visitStore}
            </Link>
          </div>
        </div>

        {/* Mobile: the price and CTA follow the thumb once the buy box scrolls
            away.
            Not gated on `offering.transacts` any more. That flag answers "does
            the CART live on this page", and an appointment service answers no —
            so a clinic's أشعة page, 3,040px tall at 390, pinned nothing at all
            and the one control the page exists for was gone after two flicks.
            §22 asks for a sticky `احجز موعدًا` as plainly as §21 asks for a
            sticky `أضف للسلة`. The bar still only SCROLLS BACK to the buy box,
            so the booking hand-off stays in exactly one place.
            Directory-only sectors (contactStore) are still excluded: there is
            no transaction to pin, and pinning a price beside "تواصل مع المتجر"
            would imply one the platform cannot honour. */}
        {(offering.transacts || offering.cta === "bookAppointment") && (
          <ProductBuyBar
            targetId="buy-box"
            price={priceText}
            compareAt={
              priceLabel !== "onConsult" && compareAt != null
                ? formatUsd(compareAt)
                : null
            }
            label={ctaLabel}
            soldOut={soldOut}
            soldOutLabel={dict.offering.soldOut[offering.noun]}
          />
        )}

        {inSlot("page")}

        {/* MJ-026 — see the note on ContentReport. Below everything, on real
            catalogue rows only. */}
        {UUID_RE.test(product.id) && (
          <div className="mt-10 border-t border-border pt-5">
            <ContentReport
              entityType="product"
              entityId={product.id}
              lang={lang}
              dict={dict}
            />
          </div>
        )}

        {/* Room for the buy bar, which is showing by the time the reader is
            this far down the page — the layout's spacer clears the tab bar,
            not the 64px sitting on top of it. */}
        {(offering.transacts || offering.cta === "bookAppointment") && (
          <div aria-hidden className="h-16 lg:hidden" />
        )}
      </Container>
    </div>
  );
}
