import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Eye,
  MapPin,
  User,
  BadgeCheck,
  Store as StoreIcon,
  MessageCircle,
  Phone,
} from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { regions as catalogRegions } from "@/lib/catalog";
import { SITE_URL, localeAlternates } from "@/lib/site";
import { NOINDEX_FOLLOW, listingRobots } from "@/lib/seo-rules";
import { jsonLdScript, listingJsonLd } from "@/lib/jsonld";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getListingById, getMarketRegions } from "@/lib/data/market";
import { waLink } from "@/lib/whatsapp";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ProductGallery } from "@/components/product-gallery";
import { ListingFavoriteButton } from "@/components/listing-favorite-button";
import { ListingReport } from "@/components/listing-report";
import { ListingViewTracker } from "@/components/listing-view-tracker";
import { BackButton } from "@/components/back-button";
import { Money } from "@/components/ui/money";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const listing = await getListingById(id, lang as Locale, null);
  // Not found / not public: nothing to describe, and nothing to index.
  if (!listing) return { robots: NOINDEX_FOLLOW };
  // The layout's title template already appends "· متجر"; the old
  // "`${title} | Matjar`" rendered "X | Matjar · متجر".
  const description = listing.description
    ? listing.description.slice(0, 160)
    : undefined;
  return {
    title: listing.title,
    description,
    alternates: localeAlternates(lang, `/market/${id}`),
    openGraph: {
      type: "website",
      title: listing.title,
      description,
      images: listing.image ? [{ url: listing.image, alt: listing.title }] : undefined,
    },
    twitter: {
      card: listing.image ? "summary_large_image" : "summary",
      title: listing.title,
      description,
    },
    // Sold / expired stay reachable (old links keep working) but leave the
    // index; only a live listing is worth ranking (lib/seo-rules).
    robots: listingRobots(listing.status),
  };
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const l = lang as Locale;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const listing = await getListingById(id, l, user?.id ?? null);
  if (!listing) notFound();

  const marketRegions = await getMarketRegions(l);
  const regionName = listing.region
    ? (marketRegions.find((r) => r.key === listing.region)?.name ??
      catalogRegions.find((r) => r.key === listing.region)?.name[l] ??
      listing.region)
    : null;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  // Product + Offer only for an active (InStock) or sold (SoldOut) listing
  // with a real price; null otherwise (lib/jsonld listingJsonLd).
  const structured = listingJsonLd({
    name: listing.title,
    description: listing.description,
    image: listing.image,
    url: `${SITE_URL}/${lang}/market/${id}`,
    price: listing.price,
    status: listing.status,
    storeName: listing.storeId ? listing.storeName : null,
  });

  return (
    <div className="py-8">
      {structured && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(structured) }}
        />
      )}
      <ListingViewTracker listingId={id} />
      <Container>
        <div className="pb-1">
          <BackButton label={dict.common.back} fallbackHref={`/${lang}/market`} />
        </div>
        <Breadcrumbs
          items={[
            { label: dict.common.brand, href: `/${lang}` },
            { label: dict.market.title, href: `/${lang}/market` },
            { label: listing.title },
          ]}
        />

        <div className="mt-4 grid gap-8 lg:grid-cols-2">
          <ProductGallery images={listing.images} alt={listing.title} />

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">
                {listing.title}
              </h1>
              {listing.status === "sold" && (
                <Badge className="bg-foreground text-background">
                  {dict.market.soldBadge}
                </Badge>
              )}
              {listing.status === "expired" && (
                <Badge className="bg-accent-strong text-accent-strong-foreground">
                  {dict.market.expiredBadge}
                </Badge>
              )}
            </div>

            {/* Unavailable notice — a sold/expired listing shows a clear label
                instead of silently 404-ing or looking orderable. */}
            {listing.status !== "active" && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
                {listing.status === "sold"
                  ? dict.market.soldNote
                  : dict.market.unavailableNote}
              </div>
            )}

            {listing.price != null && (
              <p
                className={`mt-3 text-2xl font-extrabold ${listing.status === "active" ? "text-primary" : "text-muted-foreground line-through"}`}
              >
                <Money value={listing.price} />
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {[listing.city, regionName, listing.categoryName]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4" />
                {listing.views} {dict.market.views}
              </span>
              <span>
                {dict.market.postedOn} {fmtDate(listing.createdAt)}
              </span>
            </div>

            {/* Seller + inline actions — the buyer can act right here instead of
                hunting on the store page. */}
            <Card className="mt-5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {listing.storeId ? (
                  <span className="flex items-center gap-1.5 font-bold text-primary">
                    <BadgeCheck className="h-5 w-5" />
                    {listing.storeName || dict.market.sellerMerchant}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-bold">
                    <User className="h-5 w-5 text-muted-foreground" />
                    {dict.market.sellerUser}
                  </span>
                )}
              </div>

              {listing.storeId && listing.status === "active" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {listing.storeWhatsapp && (
                    <a
                      href={waLink(
                        listing.storeWhatsapp,
                        `${dict.market.contactWaGreeting} "${listing.title}"`,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-whatsapp px-4 py-2 text-sm font-bold text-whatsapp-foreground transition-colors hover:bg-whatsapp-hover"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {dict.market.contactWhatsapp}
                    </a>
                  )}
                  {listing.storePhone && (
                    <a
                      href={`tel:${listing.storePhone}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
                    >
                      <Phone className="h-4 w-4" />
                      {dict.market.callSeller}
                    </a>
                  )}
                  <ButtonLink
                    href={
                      listing.storeSlug
                        ? `/${lang}/${listing.storeSlug}`
                        : `/${lang}/store/${listing.storeId}`
                    }
                    size="sm"
                    variant="secondary"
                    leftIcon={<StoreIcon className="h-4 w-4" />}
                  >
                    {dict.market.visitStore}
                  </ButtonLink>
                </div>
              )}
            </Card>

            {listing.description && (
              <p className="mt-5 whitespace-pre-line leading-relaxed">
                {listing.description}
              </p>
            )}

            <div className="mt-6 flex items-center gap-4">
              <ListingFavoriteButton
                listingId={id}
                favorited={listing.isFavorited}
                savesCount={listing.savesCount}
                lang={lang}
                dict={dict}
              />
              <ListingReport listingId={id} lang={lang} dict={dict} />
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}
