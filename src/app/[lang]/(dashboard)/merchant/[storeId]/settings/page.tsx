import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import {
  StoreSettingsForm,
  type StoreSettings,
} from "@/components/store-settings-form";
import {
  StoreCouriersManager,
  type CourierCompany,
} from "@/components/store-couriers-manager";
import { TransferOwnership } from "@/components/transfer-ownership";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  CheckoutFieldsManager,
  type CheckoutFieldRow,
} from "@/components/checkout-fields-manager";
import {
  DeliveryZonesManager,
  type ZoneRowM,
} from "@/components/delivery-zones-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreSettingsPage({
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

  // Owner-only.
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, accepts_delivery, accepts_pickup, min_order, prep_time, payment_note, booking_cancel_hours, return_policy, specialties, insurance, lat, lng, commercial_reg_no, commercial_reg_verified, legal_name, tax_no, legal_address, invoice_prefix, vat_rate, vat_inclusive, business_types(slug)")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  const isHealthcare =
    (store as unknown as { business_types: { slug: string } | null })
      .business_types?.slug === "healthcare";

  const { data: zoneData } = await supabase
    .from("store_delivery_zones")
    .select(
      "id, name, name_en, fee, min_order, free_over, eta_min_minutes, eta_max_minutes, active",
    )
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const zones = (zoneData ?? []) as ZoneRowM[];

  const [{ data: companies }, { data: couriers }] = await Promise.all([
    supabase
      .from("delivery_companies")
      .select("id, name, coverage, pricing_note")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("store_couriers")
      .select("company_id, price")
      .eq("store_id", storeId),
  ]);
  const selectedCouriers: Record<string, { price: string }> = {};
  for (const c of (couriers ?? []) as { company_id: string; price: number | null }[]) {
    selectedCouriers[c.company_id] = { price: c.price != null ? String(c.price) : "" };
  }

  const { data: cfData } = await supabase
    .from("store_checkout_fields")
    .select("id, label, label_en, field_type, options, required, active")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const checkoutFields = (cfData ?? []) as unknown as CheckoutFieldRow[];

  const st = store as unknown as Record<string, unknown>;
  const text = (k: string) => (st[k] as string | null) ?? "";

  const initial: StoreSettings = {
    legal_name: text("legal_name"),
    tax_no: text("tax_no"),
    legal_address: text("legal_address"),
    invoice_prefix: text("invoice_prefix"),
    // 0 is a real answer (a shop below the VAT threshold), so it is shown as 0
    // rather than blanked into a placeholder that reads like 11.
    vat_rate: String(st.vat_rate ?? 0),
    vat_inclusive: Boolean(st.vat_inclusive),
    accepts_delivery: (store as { accepts_delivery: boolean }).accepts_delivery,
    accepts_pickup: (store as { accepts_pickup: boolean }).accepts_pickup,
    min_order:
      (store as { min_order: number | null }).min_order != null
        ? String((store as { min_order: number }).min_order)
        : "",
    prep_time: (store as { prep_time: string | null }).prep_time ?? "",
    payment_note: (store as { payment_note: string | null }).payment_note ?? "",
    return_policy:

      (store as { return_policy: string | null }).return_policy ?? "",
    booking_cancel_hours: String(
      (store as { booking_cancel_hours: number | null }).booking_cancel_hours ??
        0,
    ),
    specialties: (store as { specialties: string | null }).specialties ?? "",
    insurance: (store as { insurance: string | null }).insurance ?? "",
    lat:
      (store as { lat: number | null }).lat != null
        ? String((store as { lat: number }).lat)
        : "",
    lng:
      (store as { lng: number | null }).lng != null
        ? String((store as { lng: number }).lng)
        : "",
    commercial_reg_no:
      (store as { commercial_reg_no: string | null }).commercial_reg_no ?? "",
    commercial_reg_verified:
      (store as { commercial_reg_verified: boolean | null })
        .commercial_reg_verified ?? false,
  };

  return (
    <div className="py-10">
      <Container className="max-w-xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.merchant.settings.title}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {dict.merchant.settings.subtitle}
        </p>
        <div className="mt-6">
          <StoreSettingsForm
            storeId={storeId}
            dict={dict}
            initial={initial}
            isHealthcare={isHealthcare}
          />
        </div>
        {/* Google Shopping / Meta catalog feed — its own page (Pro), linked
            here because both policies it needs are store settings. */}
        <Link
          href={`/${lang}/merchant/${storeId}/google-feed`}
          className="mt-6 block rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-primary/40"
        >
          <span className="block font-bold">{dict.googleFeed.settingsLink}</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {dict.googleFeed.settingsLinkHint}
          </span>
        </Link>
        <div className="mt-6">
          <DeliveryZonesManager storeId={storeId} dict={dict} initial={zones} />
        </div>
        <div className="mt-6">
          <StoreCouriersManager
            storeId={storeId}
            dict={dict}
            companies={(companies ?? []) as CourierCompany[]}
            selected={selectedCouriers}
          />
        </div>
        <div className="mt-6">
          <CheckoutFieldsManager
            storeId={storeId}
            dict={dict}
            initial={checkoutFields}
          />
        </div>
        {/* Danger zone: hand the store to another account. Page is already
            owner-only (the query above filters on owner_id). */}
        <div className="mt-10">
          <TransferOwnership
            storeId={storeId}
            storeName={(store as { name: string }).name}
            lang={lang}
            dict={dict}
          />
        </div>
      </Container>
    </div>
  );
}
