import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarRange, Phone, Users } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { StayStatusControl } from "@/components/stay-status-control";
import { CardList, CardRow } from "@/components/ui/card";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StayRow = {
  id: string;
  guest_name: string;
  phone: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  grand_total: number;
  status: string;
  notes: string | null;
  accommodation_units: { name: string } | null;
};

export default async function StoreStaysPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.stays;

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
    .from("stay_bookings")
    .select(
      "id, guest_name, phone, check_in, check_out, nights, adults, children, grand_total, status, notes, accommodation_units(name)",
    )
    .eq("store_id", storeId)
    .order("check_in", { ascending: true });
  const stays = (data ?? []) as unknown as StayRow[];

  const statusLabels = t.status as Record<string, string>;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      month: "short",
      day: "numeric",
    });

  return (
    <div className="py-10">
      <Container className="max-w-4xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <CalendarRange className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {stays.length ? (
          <CardList className="mt-8">
            {stays.map((s) => (
              <CardRow key={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{s.guest_name}</span>
                      {s.accommodation_units?.name && (
                        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
                          {s.accommodation_units.name}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                      <span>
                        {fmt(s.check_in)} → {fmt(s.check_out)} · {s.nights}{" "}
                        {t.nights}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {s.adults + s.children}
                      </span>
                      <span className="font-bold text-foreground">
                        ${Number(s.grand_total).toLocaleString("en-US")}
                      </span>
                    </p>
                    <a
                      href={`tel:${s.phone}`}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      <span dir="ltr">{s.phone}</span>
                    </a>
                    {s.notes && (
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {s.notes}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <StayStatusControl
                      stayId={s.id}
                      status={s.status}
                      labels={statusLabels}
                      errorLabel={dict.common.actionFailed}
                      copy={{
                        ...dict.booking.statusControl,
                        cancel: dict.common.cancel,
                      }}
                    />
                  </div>
                </div>
              </CardRow>
            ))}
          </CardList>
        ) : (
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="stays"
            title={t.empty}
            className="mt-8"
          />
        )}
      </Container>
    </div>
  );
}
