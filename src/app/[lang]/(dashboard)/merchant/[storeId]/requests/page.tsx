import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { AutoRefresh } from "@/components/auto-refresh";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  ServiceRequestIntakeSettings,
  ServiceRequestManager,
  type ServiceRequestRow,
} from "@/components/service-request-manager";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreRequestsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.requests;

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
    .select("id, name, owner_id, request_intake, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Staff need the bookings permission to manage service requests.
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

  const { data } = await supabase
    .from("service_requests")
    .select(
      "id, status, description, address, phone, customer_name, quote_amount, quote_note, counter_amount, counter_note, created_at, photos, urgency, budget_range, timeline",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  const requests = (data ?? []) as ServiceRequestRow[];

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <AutoRefresh />
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {/* Which optional questions the public form asks. Sits above the list
            because the answer to "why am I not getting enough detail" (or
            "why are people dropping off") is here, not in the requests. */}
        <div className="mt-6">
          <ServiceRequestIntakeSettings
            storeId={storeId}
            category={
              (store as unknown as { business_types: { slug: string } | null })
                .business_types?.slug ?? null
            }
            initial={(store as unknown as { request_intake: unknown }).request_intake}
            dict={dictSlice(dict, ["common", "os"])}
          />
        </div>

        {requests.length ? (
          <div className="mt-8 space-y-4">
            {requests.map((r) => (
              <ServiceRequestManager
                key={r.id}
                request={r}
                lang={lang}
                dict={dictSlice(dict, ["common", "os"])}
              />
            ))}
          </div>
        ) : (
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="requests"
            title={t.empty}
            className="mt-8"
          />
        )}
      </Container>
    </div>
  );
}
