import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Tag } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import {
  getMarketCategories,
  getMarketCities,
  getMarketRegions,
} from "@/lib/data/market";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { ListingForm } from "@/components/listing-form";

// A seller-only write screen: never indexed (robots.ts also disallows it).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewListingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const l = lang as Locale;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const [categories, cities, marketRegions, { data: store }] = await Promise.all([
    getMarketCategories(l),
    getMarketCities(l),
    getMarketRegions(l),
    supabase
      .from("stores")
      .select("id")
      .eq("owner_id", user.id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle(),
  ]);
  const storeId = (store as { id?: string } | null)?.id ?? null;

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <PageHeader title={dict.market.form.newTitle} icon={Tag} />
        <div className="mt-2">
          <ListingForm
            lang={lang}
            dict={dict}
            categories={categories}
            cities={cities}
            regions={marketRegions}
            storeId={storeId}
          />
        </div>
      </Container>
    </div>
  );
}
