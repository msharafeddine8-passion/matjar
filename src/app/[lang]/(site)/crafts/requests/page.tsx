import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { dictSlice } from "@/lib/dict-slice";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { CardListUl } from "@/components/ui/card";
import { CraftReviewForm } from "@/components/crafts/craft-review-form";
import {
  CraftRequestFlow,
  type FlowArea,
  type FlowTrade,
} from "@/components/crafts/craft-request-flow";

type RequestRow = {
  id: string;
  provider_id: string;
  description: string;
  status: string;
  created_at: string;
  craft_providers: { id: string; name: string; headline: string | null } | null;
  craft_reviews: { id: string }[];
};

const TONE: Record<string, string> = {
  pending: "bg-warning-soft text-warning",
  accepted: "bg-primary-soft text-primary",
  in_progress: "bg-primary-soft text-primary",
  completed: "bg-success-soft text-success",
  declined: "bg-surface-muted text-muted-foreground",
  cancelled: "bg-surface-muted text-muted-foreground",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  // Not indexable: it is a form with the customer's own history under it.
  return {
    title: dict.crafts.flowTitle,
    description: dict.crafts.flowLead,
    robots: { index: false, follow: true },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Asking for a tradesman — and, underneath, the requests you already sent.
//
// This route used to `redirect(/login)` for anyone signed out, which made the
// single most important action in a section with zero supply reachable only by
// people who had already committed to an account. It does not any more, and
// that is not a relaxation of anything: `craft_requests_insert` is a `{public}`
// policy whose WITH CHECK is `(customer_id is null or customer_id = auth.uid())
// and craft_request_within_limits(...)`, and `anon` holds INSERT on the table.
// Both read off production, not assumed. A guest could always file a request;
// the page was the thing stopping them.
//
// The signed-in customer keeps everything they had — the account menu still
// links here as "طلباتي" — it just now sits below the form instead of being
// the whole page.
// ────────────────────────────────────────────────────────────────────────────
export default async function CraftRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ problem?: string; trade?: string; area?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { problem = "", trade = "", area = "" } = await searchParams;
  const dict = await getDictionary(lang);
  const t = dict.crafts;
  const ar = lang === "ar";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: groupRows }, { data: tradeRows }, { data: areaRows }] =
    await Promise.all([
      supabase
        .from("trade_groups")
        .select("slug, name_ar, name_en")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("trades")
        .select("slug, name_ar, name_en, group_slug")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("lb_areas")
        .select("id, slug, region, name_ar, name_en")
        .order("sort_order"),
    ]);

  const groupName = new Map(
    ((groupRows ?? []) as { slug: string; name_ar: string; name_en: string }[]).map(
      (g) => [g.slug, ar ? g.name_ar : g.name_en],
    ),
  );

  const trades: FlowTrade[] = (
    (tradeRows ?? []) as {
      slug: string;
      name_ar: string;
      name_en: string;
      group_slug: string;
    }[]
  ).map((tr) => ({
    slug: tr.slug,
    name: ar ? tr.name_ar : tr.name_en,
    group: groupName.get(tr.group_slug) ?? tr.group_slug,
  }));

  const areas: FlowArea[] = (
    (areaRows ?? []) as {
      id: string;
      slug: string;
      region: string;
      name_ar: string;
      name_en: string;
    }[]
  ).map((a) => ({
    id: a.id,
    slug: a.slug,
    region: a.region,
    name: ar ? a.name_ar : a.name_en,
  }));

  // Prefill from the account so a signed-in customer never retypes what we
  // already hold. A guest just gets empty fields.
  let defaultName = "";
  let defaultPhone = "";
  let rows: RequestRow[] = [];
  if (user) {
    const [{ data: profile }, { data: mine }] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      supabase
        .from("craft_requests")
        .select(
          `id, provider_id, description, status, created_at,
           craft_providers(id, name, headline),
           craft_reviews(id)`,
        )
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    const pr = profile as { full_name: string | null; phone: string | null } | null;
    defaultName = pr?.full_name ?? "";
    defaultPhone = pr?.phone ?? "";
    rows = (mine ?? []) as unknown as RequestRow[];
  }

  const statuses = t.reqStatuses as unknown as Record<string, string>;

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/crafts`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>

        <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {t.flowTitle}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t.flowLead}</p>

        <div className="mt-6">
          <CraftRequestFlow
            lang={lang}
            // Only the slice ProfessionalCard reads. The whole dictionary is
            // ~175KB and would be serialised into the page for this one prop.
            dict={dictSlice(dict, ["professional"])}
            trades={trades}
            areas={areas}
            userId={user?.id ?? null}
            defaultName={defaultName}
            defaultPhone={defaultPhone}
            initial={{ problem, trade, area }}
            // The zero-result demand form's own copy, with the crafts wording
            // laid over the five lines that talk about shops.
            demandDict={{ demand: { ...dict.demand, ...dict.proMarket.craftsDemand } }}
            labels={{
              stepProblem: t.flowStepProblem,
              stepWho: t.flowStepWho,
              stepDetails: t.flowStepDetails,
              what: t.reqWhat,
              whatPlaceholder: t.reqWhatPlaceholder,
              trade: t.flowTrade,
              tradeAuto: t.flowTradeAuto,
              where: t.reqWhere,
              wherePlaceholder: t.anywhere,
              when: t.reqWhen,
              whenOptions: t.reqWhenOptions as unknown as Record<string, string>,
              next: t.flowNext,
              back: t.flowBack,
              finding: t.flowFinding,
              matchTitle: t.flowMatchTitle,
              matchLead: t.flowMatchLead,
              choose: t.flowChoose,
              noMatchTitle: t.flowNoMatchTitle,
              // Phase 4: the brief CAN now be left with the team (demand
              // form below), so the line that said it could not is replaced.
              noMatchBody: dict.proMarket.flowNoMatchBody,
              waCta: t.flowWaCta,
              waMessage: t.flowWaMessage,
              unknown: t.flowUnknown,
              recruitCta: t.emptyRecruitCta,
              summary: t.flowSummary,
              edit: t.flowEdit,
              name: t.reqName,
              phone: t.reqPhone,
              address: t.reqAddress,
              photos: t.reqPhotos,
              photosHint: t.reqPhotosHint,
              photosGuest: t.reqPhotosGuest,
              guestNote: t.flowGuestNote,
              submit: t.reqSubmit,
              sending: t.reqSending,
              sentTitle: t.reqSentTitle,
              sentBody: t.reqSentBody,
              needProblem: t.askNeedProblem,
              inferred: dict.proMarket.flowInferred,
              inferredArea: dict.proMarket.flowInferredArea,
              error: dict.auth.errorGeneric,
              regions: t.regionNames as unknown as Record<string, string>,
              myRequests: t.myRequests,
            }}
          />
        </div>

        {/* The customer's own history. Renders only when there is any: an
            empty "طلباتي" heading under the form would be the third empty
            container on a section that already has none. */}
        {rows.length > 0 && user && (
          <section className="mt-10">
            <h2 className="text-lg font-extrabold">{t.flowMineTitle}</h2>
            <CardListUl className="mt-3">
              {rows.map((r) => {
                const provider = r.craft_providers;
                const reviewed = (r.craft_reviews ?? []).length > 0;
                return (
                  <li key={r.id} className="min-w-0 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {provider ? (
                        <Link
                          href={`/${lang}/crafts/p/${provider.id}`}
                          className="min-w-0 font-bold hover:text-primary"
                        >
                          {provider.name}
                          {provider.headline && (
                            <span className="ms-2 text-sm font-normal text-muted-foreground">
                              {provider.headline}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="font-bold">—</span>
                      )}
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          TONE[r.status] ?? "bg-surface-muted text-muted-foreground"
                        }`}
                      >
                        {statuses[r.status] ?? r.status}
                      </span>
                    </div>

                    <p className="mt-2 whitespace-pre-line break-words text-sm text-muted-foreground">
                      {r.description}
                    </p>

                    {/* Only a completed job, and only once — both also enforced
                        by the insert policy, so this is the invitation rather
                        than the gate. */}
                    {r.status === "completed" && !reviewed && provider && (
                      <div className="mt-3">
                        <CraftReviewForm
                          providerId={provider.id}
                          requestId={r.id}
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
                      <p className="mt-3 text-sm font-semibold text-success">
                        {t.rateDone}
                      </p>
                    )}
                  </li>
                );
              })}
            </CardListUl>
          </section>
        )}
      </Container>
    </div>
  );
}
