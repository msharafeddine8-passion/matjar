import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Clock, ExternalLink, Star, Wrench } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CraftServicesManager,
  type CraftService,
} from "@/components/crafts/craft-services-manager";
import { CraftRequestsList } from "@/components/crafts/craft-requests-list";
import {
  CraftWorksManager,
  type CraftWork,
} from "@/components/crafts/craft-works-manager";
import { dictSlice } from "@/lib/dict-slice";

// The tradesman's own screen.
//
// Leads with status, because until a profile is approved nothing else on this
// page matters, and a tradesman who cannot tell why he is invisible concludes
// the site is broken. Then the work: requests waiting on him, and the services
// that decide whether anyone asks in the first place.
export default async function CraftMePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.crafts;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login?next=/${lang}/crafts/me`);

  const { data: provider } = await supabase
    .from("craft_providers")
    .select(
      `id, name, headline, status, verified, rating_avg, rating_count,
       completed_count,
       craft_services(id, name, description, pricing_type, price, sort_order),
       craft_works(id, title, image_url, sort_order)`,
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Not registered yet — send them to the one page that fixes that.
  if (!provider) redirect(`/${lang}/crafts/join`);

  const p = provider as unknown as {
    id: string;
    name: string;
    headline: string | null;
    status: string;
    verified: boolean;
    rating_avg: number | null;
    rating_count: number | null;
    completed_count: number | null;
    craft_services: CraftService[];
    craft_works: CraftWork[];
  };

  const { data: requestRows } = await supabase
    .from("craft_requests")
    .select(
      "id, customer_name, phone, description, when_pref, status, created_at, photos",
    )
    .eq("provider_id", p.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const services = (p.craft_services ?? []).sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const requests = (requestRows ?? []) as {
    id: string;
    customer_name: string | null;
    phone: string;
    description: string;
    when_pref: string | null;
    status: string;
    created_at: string;
  }[];

  const isLive = p.status === "active";
  const typeLabels = {
    from: t.priceFrom.replace(" {p}", "").replace("{p}", "").trim(),
    fixed: "",
    hourly: t.priceHourly.replace("{p}", "").trim(),
    per_meter: t.pricePerMeter.replace("{p}", "").trim(),
    quote: t.priceQuote,
  };

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {p.name}
        </h1>
        {p.headline && (
          <p className="mt-1 text-muted-foreground">{p.headline}</p>
        )}

        {/* Status first: an unapproved profile is invisible, and saying so is
            the difference between waiting and concluding the site is broken. */}
        <div
          className={`mt-4 rounded-2xl border p-4 ${
            isLive
              ? "border-success/30 bg-success-soft"
              : "border-warning/30 bg-warning-soft"
          }`}
        >
          <p
            className={`flex items-center gap-2 font-bold ${
              isLive ? "text-success" : "text-warning"
            }`}
          >
            {isLive ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
            {isLive ? t.meLive : t.mePending}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLive ? t.meLiveBody : t.mePendingBody}
          </p>
          {isLive && (
            <Link
              href={`/${lang}/crafts/p/${p.id}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              {t.meViewPublic}
            </Link>
          )}
        </div>

        {/* The two numbers a provider is judged on, and neither is editable. */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs font-semibold text-muted-foreground">
              {t.meCompleted}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-extrabold">
              <CheckCircle2 className="h-5 w-5 text-success" />
              {p.completed_count ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs font-semibold text-muted-foreground">
              {t.meRating}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-extrabold">
              {(p.rating_count ?? 0) > 0 ? (
                <>
                  <Star className="h-5 w-5 fill-current text-warning" />
                  {Number(p.rating_avg ?? 0).toFixed(1)}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({p.rating_count})
                  </span>
                </>
              ) : (
                <span className="text-base font-semibold text-muted-foreground">
                  {t.noRating}
                </span>
              )}
            </p>
          </div>
        </div>

        <section className="mt-6">
          <h2 className="font-extrabold">{t.meRequests}</h2>
          {requests.length ? (
            <div className="mt-3">
              <CraftRequestsList
                requests={requests}
                lang={lang}
                labels={{
                  accept: t.reqAccept,
                  start: t.reqStart,
                  complete: t.reqComplete,
                  decline: t.reqDecline,
                  error: dict.auth.errorGeneric,
                  statuses: t.reqStatuses as unknown as Record<string, string>,
                  photos: t.reqPhotosFrom,
                }}
              />
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState icon={Wrench} title={t.meNoRequests} />
            </div>
          )}
        </section>

        <section className="mt-6">
          <CraftServicesManager
            providerId={p.id}
            services={services}
            labels={{
              title: t.meServices,
              body: t.meServicesBody,
              name: t.svcName,
              description: t.svcDescription,
              pricing: t.svcPricing,
              price: t.svcPrice,
              add: t.svcAdd,
              adding: t.svcAdding,
              remove: t.svcRemove,
              needName: t.svcNeedName,
              error: dict.auth.errorGeneric,
              types: typeLabels,
            }}
          />
        </section>

        <section className="mt-6">
          <CraftWorksManager
            providerId={p.id}
            works={(p.craft_works ?? [])
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)}
            dict={dictSlice(dict, ["upload"])}
            labels={{
              title: t.meWorks,
              body: t.meWorksBody,
              photo: t.workPhoto,
              photoHint: t.workPhotoHint,
              caption: t.workCaption,
              captionPlaceholder: t.workCaptionPlaceholder,
              add: t.workAdd,
              adding: t.workAdding,
              remove: t.workRemove,
              needPhoto: t.workNeedPhoto,
              error: dict.auth.errorGeneric,
            }}
          />
        </section>
      </Container>
    </div>
  );
}
