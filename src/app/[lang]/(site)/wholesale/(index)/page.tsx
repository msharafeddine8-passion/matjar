import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Boxes, Plus, ImageIcon } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates } from "@/lib/site";
import { WHOLESALE_CATEGORIES, type WholesaleProduct } from "@/lib/wholesale";
import { Container } from "@/components/ui/container";
import { PageHero } from "@/components/ui/page-hero";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    title: dict.wholesale.title,
    description: dict.wholesale.subtitle,
    alternates: localeAlternates(lang, "/wholesale"),
  };
}

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

export default async function WholesalePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { cat } = await searchParams;
  const dict = await getDictionary(lang);
  const t = dict.wholesale;

  const supabase = await createClient();
  let q = supabase
    .from("wholesale_products")
    .select("id, title, category, price, unit, moq, image_url")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(100);
  if (cat) q = q.eq("category", cat);
  const { data } = await q;
  const items = (data ?? []) as WholesaleProduct[];

  const chip = (active: boolean) =>
    `inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
      active
        ? "border-primary bg-primary-soft text-primary"
        : "border-border text-muted-foreground hover:border-primary/40"
    }`;

  return (
    <div className="pb-16">
      <PageHero
        title={t.title}
        subtitle={t.subtitle}
        icon={Boxes}
        actions={
          <ButtonLink
            href={`/${lang}/wholesale/new`}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t.listProduct}
          </ButtonLink>
        }
      />
      <Container className="py-8">
        <div className="flex flex-wrap gap-2">
          <Link href={`/${lang}/wholesale`} className={chip(!cat)}>
            {t.allCategories}
          </Link>
          {WHOLESALE_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/${lang}/wholesale?cat=${c}`}
              className={chip(cat === c)}
            >
              {t.categories[c]}
            </Link>
          ))}
        </div>

        {items.length ? (
          <div
            data-animate
            className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            {items.map((w) => (
              <Card
                key={w.id}
                variant="interactive"
                className="group relative flex flex-col overflow-hidden"
              >
                <div className="relative overflow-hidden">
                  {w.image_url ? (
                    <Image
                      src={w.image_url}
                      alt={w.title}
                      width={300}
                      height={200}
                      className="h-36 w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      sizes="(max-width: 640px) 50vw, 25vw"
                    />
                  ) : (
                    <div className="flex h-36 w-full items-center justify-center bg-surface-muted">
                      <ImageIcon className="h-9 w-9 text-foreground/10" />
                    </div>
                  )}
                  {w.moq != null && (
                    <Badge
                      variant="neutral"
                      size="sm"
                      className="absolute start-2 top-2 bg-surface/90 backdrop-blur"
                    >
                      {t.moqShort}: {w.moq} {w.unit ?? ""}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h2 className="line-clamp-2 text-sm font-bold leading-tight transition-colors group-hover:text-primary">
                    {w.title}
                  </h2>
                  <div className="mt-auto pt-2">
                    {w.price != null && (
                      <p className="text-sm font-extrabold text-primary">
                        {money(Number(w.price))}
                        {w.unit ? ` / ${w.unit}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <Link
                  href={`/${lang}/wholesale/${w.id}`}
                  aria-label={w.title}
                  className="absolute inset-0 z-0"
                />
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            className="mt-8"
            icon={Boxes}
            // «ما في بضاعة مطابقة» claimed a filter that was not there:
            // with no category picked, nothing matched because nothing exists.
            title={cat ? t.empty : t.emptyAll}
            action={{ href: `/${lang}/wholesale/new`, label: t.listProduct }}
          />
        )}
      </Container>
    </div>
  );
}
