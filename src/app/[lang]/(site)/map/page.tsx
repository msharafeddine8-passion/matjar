import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { getStoresForListing } from "@/lib/data/stores";
import { Container } from "@/components/ui/container";
import { StoreMapClient } from "@/components/store-map-client";
import type { MapStore } from "@/components/store-map";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.map.title,
    description: dict.map.subtitle,
    alternates: localeAlternates(lang, "/map"),
  };
}

export default async function MapPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const l = lang as Locale;

  const stores = await getStoresForListing();
  // One pin per active branch: multi-branch stores appear once per located
  // branch (popup carries the branch name/area so pins are distinguishable);
  // stores without any located branch fall back to their own lat/lng pin.
  const mapStores: MapStore[] = stores.flatMap((s) => {
    const located = (s.locations ?? []).filter(
      (b) => b.lat != null && b.lng != null,
    );
    if (!located.length) {
      return s.lat != null && s.lng != null
        ? [{ id: s.id, name: s.name[l], lat: s.lat, lng: s.lng }]
        : [];
    }
    const multi = (s.locations?.length ?? 0) >= 2;
    return located.map((b) => ({
      id: s.id,
      name: s.name[l],
      branch: multi ? (b.name ?? b.area) : null,
      lat: b.lat as number,
      lng: b.lng as number,
    }));
  });

  return (
    <div className="py-10">
      <Container>
        <div className="flex items-center gap-2">
          <MapPin className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {dict.map.title}
          </h1>
        </div>
        <p className="mt-2 text-muted-foreground">{dict.map.subtitle}</p>

        <div className="mt-6">
          {mapStores.length ? (
            <StoreMapClient stores={mapStores} lang={l} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border py-10 sm:py-16 text-center text-muted-foreground">
              {dict.map.empty}
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}
