import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { regions } from "@/lib/catalog";
import { Container } from "@/components/ui/container";
import { EditStoreForm } from "@/components/edit-store-form";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BusinessTypeRow = { id: string; name_ar: string; name_en: string };

type StoreRow = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  announcement: string | null;
  storefront_theme: string | null;
  business_type_id: string | null;
  region: string | null;
  area: string | null;
  phone: string | null;
  whatsapp: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cover_position: number | null;
  hours: unknown;
  booking_slot_minutes: number | null;
  instagram: string | null;
  facebook: string | null;
  website: string | null;
  accent_color: string | null;
  storefront_layout: string | null;
  lat: number | null;
  lng: number | null;
};

export default async function EditStorePage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: store } = await supabase
    .from("stores")
    .select(
      "id, name, slug, description, announcement, storefront_theme, business_type_id, region, area, phone, whatsapp, logo_url, cover_url, cover_position, hours, booking_slot_minutes, instagram, facebook, website, accent_color, storefront_layout, lat, lng",
    )
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const { data: types } = await supabase
    .from("business_types")
    .select("id, name_ar, name_en")
    .order("sort_order");
  const businessTypes = ((types ?? []) as BusinessTypeRow[]).map((t) => ({
    value: t.id,
    label: lang === "ar" ? t.name_ar : t.name_en,
  }));
  const regionOptions = regions.map((r) => ({
    value: r.key,
    label: r.name[lang as Locale],
  }));

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        {/* The way back. This is where the setup checklist sends a merchant for
            four of its items, and it was the one destination in that loop with
            no link home — the items screen has had one all along. */}
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as StoreRow).name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.merchant.editTitle}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {dict.merchant.editSubtitle}
        </p>
        <div className="mt-6">
          <EditStoreForm
            storeId={storeId}
            lang={lang}
            dict={dictSlice(dict, ["auth", "merchant", "os", "store", "upload"])}
            businessTypes={businessTypes}
            regions={regionOptions}
            initial={store as StoreRow}
          />
        </div>
      </Container>
    </div>
  );
}
