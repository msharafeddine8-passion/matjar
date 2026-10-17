import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { MapPin, User, Package, Images } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { displayTitle, localeAlternates, shareImages } from "@/lib/site";
import { regions } from "@/lib/catalog";
import type { WholesaleProduct, PriceTier } from "@/lib/wholesale";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StartChatButton } from "@/components/start-chat-button";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("wholesale_products")
    .select("title, description, image_url")
    .eq("id", id)
    .maybeSingle();
  if (!data) return {};
  const w = data as { title: string; description: string; image_url: string | null };
  const title = displayTitle(w.title);
  const description = w.description.slice(0, 160);
  return {
    title,
    description,
    alternates: localeAlternates(lang, `/wholesale/${id}`),
    // Replaces the layout's openGraph whole, so title, description and a card
    // (the platform's when the product has no picture) are restated.
    openGraph: {
      title,
      description,
      images: shareImages(w.image_url, title).openGraph,
    },
  };
}

export default async function WholesaleDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.wholesale;

  const supabase = await createClient();
  const { data } = await supabase
    .from("wholesale_products")
    .select(
      "id, seller_id, seller_name, title, description, category, image_url, unit, moq, price, tiers, region, gallery",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const w = data as WholesaleProduct;
  const tiers = (Array.isArray(w.tiers) ? w.tiers : []) as PriceTier[];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwn = user?.id === w.seller_id;
  const regionName =
    regions.find((r) => r.key === w.region)?.name[lang] ?? w.region;

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/wholesale`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>

        {w.image_url && (
          <Image
            src={w.image_url}
            alt={w.title}
            width={800}
            height={450}
            className="mt-4 aspect-video w-full rounded-2xl object-cover"
            sizes="(max-width: 768px) 100vw, 672px"
          />
        )}

        <Card className="mt-4 p-6">
          {w.category && (
            <Badge variant="primary" size="sm">
              {t.categories[w.category as keyof typeof t.categories] ??
                w.category}
            </Badge>
          )}
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
            {w.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="h-4 w-4" />
              {w.seller_name || t.seller}
            </span>
            {regionName && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {regionName}
              </span>
            )}
            {w.moq != null && (
              <span className="flex items-center gap-1 font-semibold text-foreground">
                <Package className="h-4 w-4" />
                {t.moq}: {w.moq} {w.unit ?? ""}
              </span>
            )}
          </div>

          <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-muted-foreground">
            {w.description}
          </p>

          {/* Pricing: base + tiers */}
          <div className="mt-5 border-t border-border pt-5">
            <h2 className="mb-2 font-bold">{t.pricing}</h2>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start font-semibold">
                      {t.quantity}
                    </th>
                    <th className="px-4 py-2 text-end font-semibold">
                      {t.pricePerUnit}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {w.price != null && (
                    <tr>
                      <td className="px-4 py-2">
                        {w.moq != null ? `${w.moq}+ ${w.unit ?? ""}` : t.base}
                      </td>
                      <td className="px-4 py-2 text-end font-bold text-primary">
                        {money(Number(w.price))}
                      </td>
                    </tr>
                  )}
                  {tiers
                    .slice()
                    .sort((a, b) => a.qty - b.qty)
                    .map((tier, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">
                          {tier.qty}+ {w.unit ?? ""}
                        </td>
                        <td className="px-4 py-2 text-end font-bold text-primary">
                          {money(Number(tier.price))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {isOwn ? (
            <p className="mt-5 rounded-xl bg-surface-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
              {t.ownerPreviewNote}
            </p>
          ) : (
            <div className="mt-5">
              <StartChatButton
                userId={w.seller_id}
                label={t.contact}
                lang={lang as Locale}
              />
            </div>
          )}
        </Card>

        {/* Extra product shots. */}
        {Array.isArray(w.gallery) && w.gallery.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <Images className="h-5 w-5 text-primary" />
              {t.gallery}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {w.gallery.map((url) => (
                <Image
                  key={url}
                  src={url}
                  alt={w.title}
                  width={400}
                  height={400}
                  className="aspect-square w-full rounded-xl object-cover"
                  sizes="(max-width: 640px) 50vw, 220px"
                />
              ))}
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}
