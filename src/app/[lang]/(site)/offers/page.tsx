import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Tag, ImageIcon } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { getOffers } from "@/lib/data/offers";
import { getUsdLbpRate } from "@/lib/data/settings";
import { formatLbp } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import { localized } from "@/lib/i18n-field";
import { Container } from "@/components/ui/container";
import { PageHero } from "@/components/ui/page-hero";
import { EmptyState } from "@/components/ui/empty-state";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.offers.title,
    description: dict.offers.subtitle,
    openGraph: { title: dict.offers.title, description: dict.offers.subtitle },
    alternates: localeAlternates(lang, "/offers"),
  };
}

export default async function OffersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const offers = await getOffers();
  const lbpRate = await getUsdLbpRate();
  const l = lang as Locale;

  return (
    <div className="pb-16">
      <PageHero
        title={dict.offers.title}
        subtitle={dict.offers.subtitle}
        icon={Tag}
      />
      <Container className="py-8">

        {offers.length ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {offers.map((p) => (
              <Link
                key={p.id}
                href={`/${lang}/product/${p.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="relative">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={localized(p.name, p.nameEn, l)}
                      width={300}
                      height={200}
                      className="h-36 w-full object-cover"
                      sizes="(max-width: 640px) 50vw, 25vw"
                    />
                  ) : (
                    <div className="flex h-36 w-full items-center justify-center bg-surface-muted">
                      <ImageIcon className="h-10 w-10 text-foreground/10" />
                    </div>
                  )}
                  {p.off > 0 && (
                    <span className="absolute end-2 top-2 rounded-full bg-danger-strong px-2 py-0.5 text-xs font-bold text-danger-strong-foreground">
                      -{p.off}% {dict.offers.off}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-2 font-bold leading-tight group-hover:text-primary">
                    {localized(p.name, p.nameEn, l)}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.storeName}
                  </p>
                  <p className="mt-2">
                    <span className="font-bold text-primary">
                      <Money value={p.discountPrice ?? p.price} />
                    </span>{" "}
                    {p.discountPrice != null && (
                      <span className="text-xs text-muted-foreground line-through">
                        <Money value={p.price} />
                      </span>
                    )}
                  </p>
                  {lbpRate > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatLbp(p.discountPrice ?? p.price, lbpRate, l)}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            className="mt-10"
            icon={Tag}
            title={dict.offers.empty}
            action={{ href: `/${lang}/explore`, label: dict.common.explore }}
          />
        )}
      </Container>
    </div>
  );
}
