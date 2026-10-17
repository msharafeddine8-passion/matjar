import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Car } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import {
  VehicleManager,
  type VehicleRow,
} from "@/components/rental/vehicle-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The rental fleet (MJ-003, migration 0298). Deliberately the same page as
// merchant/[storeId]/units — one bookable thing per row, because the
// double-booking guard's grain is the individual vehicle, not the model.
export default async function StoreVehiclesPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.vehicles;

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
    .select("name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const { data } = await supabase
    .from("rental_vehicles")
    .select(
      "id, name, vehicle_type, transmission, fuel, seats, model_year, base_daily_price, weekend_price, min_days, delivery_fee, deposit_amount, min_driver_age, daily_km_limit, extra_km_price, insurance_included, insurance_note, pickup_location, active",
    )
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const vehicles = (data ?? []) as VehicleRow[];

  return (
    <div className="py-10">
      <Container className="max-w-5xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="relative inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Car className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>
        <VehicleManager storeId={storeId} dict={dict} initial={vehicles} />
      </Container>
    </div>
  );
}
