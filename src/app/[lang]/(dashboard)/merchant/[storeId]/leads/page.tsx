import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Inbox, Phone } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/staff-access";
import { Container } from "@/components/ui/container";
import { LeadStatusControl } from "@/components/lead-status-control";
import { CardList, CardRow } from "@/components/ui/card";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LeadRow = {
  id: string;
  kind: string;
  name: string;
  phone: string;
  message: string | null;
  status: string;
  created_at: string;
};

// Merchant leads inbox — the follow-up surface for directory-only listing
// sectors (real estate, automotive). Reads leads via RLS (managers only, 0190).
export default async function StoreLeadsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.leads;

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
  await requireModuleAccess(supabase, storeId, "leads", lang);

  const { data } = await supabase
    .from("leads")
    .select("id, kind, name, phone, message, status, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  const leads = (data ?? []) as LeadRow[];

  const statusLabels = t.status as Record<string, string>;
  const kindLabels = t.kinds as Record<string, string>;

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
          <Inbox className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {leads.length ? (
          <CardList className="mt-8">
            {leads.map((l) => (
              <CardRow key={l.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{l.name}</span>
                      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
                        {kindLabels[l.kind] ?? l.kind}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(l.created_at).toLocaleDateString(
                          lang === "ar" ? "ar" : "en",
                        )}
                      </span>
                    </div>
                    <a
                      href={`tel:${l.phone}`}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      <span dir="ltr">{l.phone}</span>
                    </a>
                    {l.message && (
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {l.message}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <LeadStatusControl
                      leadId={l.id}
                      status={l.status}
                      labels={statusLabels}
                      errorLabel={dict.common.actionFailed}
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
            module="leads"
            title={t.empty}
            className="mt-8"
          />
        )}
      </Container>
    </div>
  );
}
