import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import {
  getMarketCategories,
  getMarketCities,
  getMarketRegions,
} from "@/lib/data/market";
import { Tag } from "lucide-react";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { ListingForm, type ListingInitial } from "@/components/listing-form";

// A seller-only write screen: never indexed (robots.ts also disallows it).
export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) redirect(`/${lang}/account`);
  const dict = await getDictionary(lang);
  const l = lang as Locale;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, store_id, category_id, title, description, price, city, region, images, status")
    .eq("id", id)
    .maybeSingle();
  const row = listing as
    | {
        seller_id: string;
        store_id: string | null;
        category_id: string | null;
        title: string;
        description: string | null;
        price: number | null;
        city: string | null;
        region: string | null;
        images: unknown;
        status: string;
      }
    | null;
  if (!row || row.seller_id !== user.id) redirect(`/${lang}/account`);

  const [categories, cities, marketRegions] = await Promise.all([
    getMarketCategories(l),
    getMarketCities(l),
    getMarketRegions(l),
  ]);
  const initial: ListingInitial = {
    title: row.title,
    description: row.description ?? "",
    price: row.price != null ? String(row.price) : "",
    categoryId: row.category_id ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    images: Array.isArray(row.images) ? (row.images as string[]) : [],
    status: row.status,
  };

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <PageHeader title={dict.market.form.editTitle} icon={Tag} />
        <div className="mt-2">
          <ListingForm
            lang={lang}
            dict={dict}
            categories={categories}
            cities={cities}
            regions={marketRegions}
            storeId={row.store_id}
            initial={initial}
            listingId={id}
          />
        </div>
      </Container>
    </div>
  );
}
