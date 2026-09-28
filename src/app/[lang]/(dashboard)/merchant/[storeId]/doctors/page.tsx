import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { DoctorManager, type Doctor } from "@/components/doctor-manager";
import {
  ProviderHours,
  type HourRule,
  type HourException,
} from "@/components/provider-hours";
import { sectorHasTeam, sectorTeamMeta } from "@/lib/sectors";
import { toCategoryKey } from "@/lib/catalog";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { beirutYmd } from "@/lib/quick-panel";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreDoctorsPage({
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
  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isPro(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }
  const category = toCategoryKey(
    (store as unknown as { business_types: { slug: string } | null })
      .business_types?.slug,
    `store ${storeId}`,
  );
  // Providers (team) are available to every sector that has a team roster.
  if (!sectorHasTeam(category)) redirect(`/${lang}/merchant/${storeId}`);

  // Staff need the bookings permission to manage the doctors roster.
  const isOwner =
    (store as unknown as { owner_id: string }).owner_id === user.id;
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms =
      (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.bookings ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  const { data: doctorsData } = await supabase
    .from("doctors")
    .select("id, name, specialty, photo_url, bio")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true });
  const doctors = (doctorsData ?? []) as Doctor[];

  // The store's bookable services + which provider currently offers each, so a
  // merchant can assign services to each provider.
  const { data: servicesData } = await supabase
    .from("products")
    .select("id, name, name_en")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true });
  const services = ((servicesData ?? []) as {
    id: string;
    name: string;
    name_en: string | null;
  }[]).map((s) => ({ id: s.id, name: s.name, nameEn: s.name_en }));

  // Per-provider weekly hours + day-off blocks (booking engine v2).
  const today = beirutYmd(new Date());
  const [{ data: rulesData }, { data: exceptionsData }] = await Promise.all([
    supabase
      .from("provider_availability_rules")
      .select("id, doctor_id, weekday, start_time, end_time")
      .eq("store_id", storeId)
      .eq("active", true),
    supabase
      .from("provider_availability_exceptions")
      .select("id, doctor_id, on_date, reason")
      .eq("store_id", storeId)
      .gte("on_date", today)
      .order("on_date", { ascending: true }),
  ]);
  const hourRules = (rulesData ?? []) as HourRule[];
  const hourExceptions = (exceptionsData ?? []) as HourException[];

  const { data: spData } = await supabase
    .from("service_providers")
    .select("product_id, doctor_id")
    .eq("store_id", storeId);
  const assignments: Record<string, string[]> = {};
  for (const row of (spData ?? []) as {
    product_id: string;
    doctor_id: string;
  }[]) {
    (assignments[row.doctor_id] ??= []).push(row.product_id);
  }

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        {/* The sector's own word for its roster — a salon's people are not
            "الفريق / مقدّمو الخدمة", they are فريق الصالون. */}
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.os.team[sectorTeamMeta(category).labelKey]}
        </h1>
        <div className="mt-6">
          <DoctorManager
            storeId={storeId}
            dict={dict}
            doctors={doctors}
            services={services}
            assignments={assignments}
            lang={lang}
          />
          <ProviderHours
            storeId={storeId}
            dict={dict}
            doctors={doctors.map((d) => ({ id: d.id, name: d.name }))}
            initialRules={hourRules}
            initialExceptions={hourExceptions}
          />
        </div>
      </Container>
    </div>
  );
}
