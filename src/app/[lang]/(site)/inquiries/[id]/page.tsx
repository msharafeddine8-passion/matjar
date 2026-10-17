import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { MessageSquare, Package, Phone, Store as StoreIcon } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { labelFor, statusTone } from "@/lib/status-labels";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LeadRow = {
  id: string;
  customer_id: string | null;
  kind: string | null;
  status: string;
  message: string | null;
  created_at: string;
  stores: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp: string | null;
  } | null;
  products: { id: string; name: string } | null;
};

// The customer's side of one inquiry.
//
// This route exists because the activity card said "شوف المحادثة" and pointed
// at /messages, where the inquiry is NOT — a lead is written by create_lead()
// (0190) and never creates a conversation, so the customer arrived at an empty
// message list holding a link that had promised them their own inquiry. All
// three real leads in production are like this. Verified before wiring the deep
// link: zero of them have a conversation with the store they wrote to.
//
// So the destination is the inquiry itself: what they asked, who they asked,
// where it got to, and the two buttons that actually move it — the shop's phone
// and its WhatsApp. No reply box, because there is no thread to reply into; a
// composer here would be a promise the schema cannot keep.
export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.inquiry;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login?next=/${lang}/inquiries/${id}`);

  const { data } = await supabase
    .from("leads")
    .select(
      "id, customer_id, kind, status, message, created_at, stores(id, name, phone, whatsapp), products(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  const lead = data as unknown as LeadRow | null;
  // The store owner can read their own leads; this screen is the customer's.
  if (!lead || lead.customer_id !== user.id) notFound();

  const store = lead.stores;
  const kindLabel = labelFor(dict, "leadKind", lead.kind);
  const waHref = store?.whatsapp
    ? `https://wa.me/${store.whatsapp.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-2xl">
        <Breadcrumbs
          items={[
            { label: dict.activity.title, href: `/${lang}/activity` },
            { label: kindLabel || t.title },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {kindLabel || t.title}
            </h1>
            {store && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <StoreIcon className="h-4 w-4 shrink-0" />
                <Link
                  href={`/${lang}/store/${store.id}`}
                  dir="auto"
                  className="truncate font-semibold hover:text-primary"
                >
                  {store.name}
                </Link>
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {t.sentOn}{" "}
              <span dir="ltr" className="tabular-nums">
                {new Date(lead.created_at).toLocaleDateString(
                  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                  { timeZone: "Asia/Beirut", year: "numeric", month: "short", day: "numeric" },
                )}
              </span>
            </p>
          </div>
          <Badge variant={statusTone("lead", lead.status)}>
            {labelFor(dict, "lead", lead.status)}
          </Badge>
        </div>

        <Card className="mt-6 space-y-3 p-5 text-sm">
          <p className="flex items-start gap-2">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {/* Half the inquiries in this market carry no message at all — the
                customer taps "طلب معاينة" and waits for the phone to ring. Say
                that plainly rather than rendering an empty quote. */}
            {lead.message ? (
              <span dir="auto" className="whitespace-pre-line">
                {lead.message}
              </span>
            ) : (
              <span className="text-muted-foreground">{t.noMessage}</span>
            )}
          </p>
          {lead.products && (
            <p className="flex items-start gap-2">
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="font-semibold">{t.aboutProduct}</span>
              <Link
                href={`/${lang}/product/${lead.products.id}`}
                dir="auto"
                className="font-semibold hover:text-primary"
              >
                {lead.products.name}
              </Link>
            </p>
          )}
        </Card>

        {/* The only two things that move an inquiry forward, and both belong to
            the shop rather than to us. */}
        {store && (store.phone || waHref) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {store.phone && (
              <a
                href={`tel:${store.phone}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
              >
                <Phone className="h-4 w-4" />
                {dict.orders.callStore}
              </a>
            )}
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-whatsapp px-4 text-sm font-bold text-whatsapp-foreground transition-colors hover:bg-whatsapp-hover"
              >
                <MessageSquare className="h-4 w-4" />
                {dict.orders.contactStore}
              </a>
            )}
          </div>
        )}

        <Link
          href={`/${lang}/activity`}
          className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {dict.common.back}
        </Link>
      </Container>
    </div>
  );
}
