import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Ticket, Phone } from "lucide-react";
import { formatInstant } from "@/lib/activity";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/staff-access";
import { Container } from "@/components/ui/container";
import { LoadError } from "@/components/load-error";
import {
  TicketTypeManager,
  type TicketTypeRow,
} from "@/components/ticket-type-manager";
import { CardList, CardRow } from "@/components/ui/card";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SaleRow = {
  id: string;
  attendee_name: string;
  phone: string;
  quantity: number;
  status: string;
  created_at: string;
  event_ticket_types: { name: string } | null;
};

export default async function StoreTicketsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.tickets;

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
  // Staff: the module's own permission (owner-only modules: the owner).
  await requireModuleAccess(supabase, storeId, "tickets", lang);

  const { data: typeData, error: typeErr } = await supabase
    .from("event_ticket_types")
    .select("id, name, name_en, description, price, capacity, sold, active")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const types = (typeData ?? []) as TicketTypeRow[];

  const { data: saleData, error: saleErr } = await supabase
    .from("event_tickets")
    .select(
      "id, attendee_name, phone, quantity, status, created_at, event_ticket_types(name)",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  const sales = (saleData ?? []) as unknown as SaleRow[];

  if (typeErr || saleErr) {
    console.error("[tickets] read failed", typeErr ?? saleErr);
  }
  // Beirut calendar day, Western digits.
  const fmt = (d: string) => formatInstant(d, lang);

  return (
    <div className="py-10">
      <Container className="max-w-5xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Ticket className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {/* A failed read must not open a manager that believes there are no
            ticket types (the merchant would re-create them). */}
        {typeErr ? (
          <LoadError title={dict.common.loadError} retryLabel={dict.common.reload} className="mt-6" />
        ) : (
          <TicketTypeManager storeId={storeId} dict={dict} initial={types} />
        )}

        <h2 className="mt-12 text-xl font-extrabold tracking-tight">
          {t.attendees}
        </h2>
        {saleErr ? (
          <LoadError title={dict.common.loadError} retryLabel={dict.common.reload} className="mt-4" />
        ) : sales.length ? (
          <CardList className="mt-4">
            {sales.map((s) => (
              <CardRow key={s.id} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{s.attendee_name}</span>
                    {s.event_ticket_types?.name && (
                      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
                        {s.event_ticket_types.name}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ×{s.quantity} · {fmt(s.created_at)}
                    </span>
                  </div>
                  <a
                    href={`tel:${s.phone}`}
                    className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span dir="ltr">{s.phone}</span>
                  </a>
                </div>
              </CardRow>
            ))}
          </CardList>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-border py-10 sm:py-16 text-center text-muted-foreground">
            {t.noAttendees}
          </div>
        )}
      </Container>
    </div>
  );
}
