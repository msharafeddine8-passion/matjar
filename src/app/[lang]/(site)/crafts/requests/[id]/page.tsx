import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { CalendarClock, MapPin, Wrench } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { labelFor, statusTone } from "@/lib/status-labels";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CraftReviewForm } from "@/components/crafts/craft-review-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestRow = {
  id: string;
  customer_id: string;
  description: string;
  status: string;
  address: string | null;
  when_pref: string | null;
  scheduled_for: string | null;
  created_at: string;
  craft_providers: { id: string; name: string; headline: string | null } | null;
  craft_reviews: { id: string }[];
};

// One service request, on its own screen.
//
// Same gap as bookings (MP-023): the activity row said "شوف طلب الخدمة" and
// then handed the customer the whole list of their requests to search through.
// The list page is still where all of them live; this is where ONE of them
// lives, which is what a tap on a specific row promised.
export default async function CraftRequestDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.crafts;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login?next=/${lang}/crafts/requests/${id}`);

  const { data } = await supabase
    .from("craft_requests")
    .select(
      `id, customer_id, description, status, address, when_pref, scheduled_for, created_at,
       craft_providers(id, name, headline),
       craft_reviews(id)`,
    )
    .eq("id", id)
    .maybeSingle();

  const req = data as unknown as RequestRow | null;
  // The tradesman can read this row too — this screen is the customer's.
  if (!req || req.customer_id !== user.id) notFound();

  const provider = req.craft_providers;
  const reviewed = (req.craft_reviews ?? []).length > 0;
  const whenOptions = t.reqWhenOptions as unknown as Record<string, string>;

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-2xl">
        <Breadcrumbs
          items={[
            { label: t.myRequests, href: `/${lang}/crafts/requests` },
            { label: provider?.name ?? t.title },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {provider ? (
              <Link
                href={`/${lang}/crafts/p/${provider.id}`}
                dir="auto"
                className="text-2xl font-extrabold tracking-tight hover:text-primary"
              >
                {provider.name}
              </Link>
            ) : (
              <h1 className="text-2xl font-extrabold tracking-tight">
                {t.myRequests}
              </h1>
            )}
            {provider?.headline && (
              <p dir="auto" className="mt-1 text-sm text-muted-foreground">
                {provider.headline}
              </p>
            )}
          </div>
          <Badge variant={statusTone("craftRequest", req.status)}>
            {labelFor(dict, "craftRequest", req.status)}
          </Badge>
        </div>

        <Card className="mt-6 space-y-3 p-5 text-sm">
          <p className="flex items-start gap-2">
            <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {/* The customer's own words about their own problem — may be typed
                in either script. */}
            <span dir="auto" className="whitespace-pre-line">
              {req.description}
            </span>
          </p>
          {req.when_pref && (
            <p className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-semibold">{t.reqWhen}</span>
              {whenOptions[req.when_pref] ?? req.when_pref}
            </p>
          )}
          {req.scheduled_for && (
            <p className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
              <span dir="ltr" className="tabular-nums">
                {new Date(req.scheduled_for).toLocaleString(
                  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                  { timeZone: "Asia/Beirut", dateStyle: "medium", timeStyle: "short" },
                )}
              </span>
            </p>
          )}
          {req.address && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span dir="auto">{req.address}</span>
            </p>
          )}
        </Card>

        {/* Only a completed job, and only once — both also enforced by the
            insert policy, so this is the invitation rather than the gate. */}
        {req.status === "completed" && !reviewed && provider && (
          <div className="mt-6">
            <CraftReviewForm
              providerId={provider.id}
              requestId={req.id}
              customerId={user.id}
              labels={{
                title: t.rateTitle,
                comment: t.rateComment,
                commentPlaceholder: t.rateCommentPlaceholder,
                submit: t.rateSubmit,
                sending: t.rateSending,
                thanks: t.rateThanks,
                needRating: t.rateNeedStars,
                error: dict.auth.errorGeneric,
              }}
            />
          </div>
        )}

        {reviewed && (
          <p className="mt-6 text-sm font-semibold text-success">{t.rateDone}</p>
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
