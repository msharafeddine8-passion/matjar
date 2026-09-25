import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, CalendarClock, MapPin, Plus } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates } from "@/lib/site";
import { regions } from "@/lib/catalog";
import { JOB_TYPES, type JobPosting } from "@/lib/jobs";
import { supplyRobots } from "@/lib/professional";
import { requestNow } from "@/lib/now";
import { countLabel } from "@/lib/data/freelance";
import { beirutToday, formatDay, isJobOpen, visibleJobFilters } from "@/lib/pro-market";
import { Container } from "@/components/ui/container";
import { PageHero } from "@/components/ui/page-hero";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JobsEmptyState } from "@/components/jobs/jobs-empty-state";

// ────────────────────────────────────────────────────────────────────────────
// The jobs board.
//
// Phase 4 changes, each because of what production actually holds (two
// active postings, both full-time, one in the north and one in Beirut):
//
//   * "Live" means active AND still taking applications in Beirut's today.
//     job_postings_select already hides closed and soft-deleted rows; a
//     posting whose apply_deadline has passed was still listed here as open.
//   * Filters appear only when they can split the list (visibleJobFilters):
//     the page used to draw five type chips and six region chips over two
//     postings — and over none, above its own empty state.
//   * Unknown ?type= / ?region= values are dropped, not queried, so a crawler
//     cannot mint empty pages; every filtered view is noindex, and so is the
//     bare board while it has no live posting (supplyRobots).
//   * The empty state speaks to both audiences (JobsEmptyState) and does not
//     promise alerts the platform cannot send.
//   * Dates: Beirut calendar day, Western digits, Levantine month names.
// ────────────────────────────────────────────────────────────────────────────

type Search = Promise<{ region?: string; type?: string }>;

const REGION_KEYS: ReadonlySet<string> = new Set(regions.map((r) => r.key));
const TYPE_KEYS: ReadonlySet<string> = new Set(JOB_TYPES);

function cleanFilters(sp: { region?: string; type?: string }) {
  return {
    region: sp.region && REGION_KEYS.has(sp.region) ? sp.region : "",
    type: sp.type && TYPE_KEYS.has(sp.type) ? sp.type : "",
  };
}

/** Every active, non-deleted posting that still takes applications today.
 *  Cached per request: generateMetadata and the page share one query. */
const liveJobs = cache(async function liveJobs(): Promise<JobPosting[]> {
  const supabase = await createClient();
  const today = beirutToday(requestNow());
  const { data } = await supabase
    .from("job_postings")
    .select(
      "id, poster_id, store_id, title, company_name, description, region, job_type, salary_note, how_to_apply, status, created_at, apply_deadline",
    )
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`apply_deadline.is.null,apply_deadline.gte.${today}`)
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as JobPosting[]).filter((j) => isJobOpen(j, today));
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Search;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const [dict, sp, jobs] = await Promise.all([getDictionary(lang), searchParams, liveJobs()]);
  const raw = sp as Record<string, string | undefined>;
  return {
    title: dict.jobs.title,
    description: dict.jobs.subtitle,
    alternates: localeAlternates(lang, "/jobs"),
    // Any query parameter — valid filter or junk — is a non-canonical view.
    robots: supplyRobots({
      supply: jobs.length,
      filtered: Object.values(raw).some((v) => v != null && v !== ""),
    }),
  };
}

export default async function JobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Search;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { region, type } = cleanFilters(await searchParams);
  const dict = await getDictionary(lang);
  const t = dict.jobs;
  const pm = dict.proMarket;

  const all = await liveJobs();
  const jobs = all.filter(
    (j) => (!region || j.region === region) && (!type || j.job_type === type),
  );
  // Sized against the whole live board, not the filtered slice, so the chip
  // rows do not appear and vanish as the visitor narrows.
  const filters = visibleJobFilters(all);
  // An active filter stays tappable even when its value is not in the list
  // (a shared link to a type that has since filled), so it can be undone.
  const typeChips = type && !filters.types.includes(type) ? [...filters.types, type] : filters.types;
  const regionChips =
    region && !filters.regions.includes(region) ? [...filters.regions, region] : filters.regions;

  const chip = (active: boolean) =>
    `inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
      active
        ? "border-primary bg-primary-soft text-primary"
        : "border-border text-muted-foreground hover:border-primary/40"
    }`;
  const qs = (o: { region?: string; type?: string }) => {
    const p = new URLSearchParams();
    const r = o.region ?? region;
    const ty = o.type ?? type;
    if (r) p.set("region", r);
    if (ty) p.set("type", ty);
    const s = p.toString();
    return `/${lang}/jobs${s ? `?${s}` : ""}`;
  };
  const regionName = (key: string | null) =>
    key ? (regions.find((r) => r.key === key)?.name[lang as Locale] ?? key) : null;

  return (
    <div className="pb-16">
      <PageHero
        title={t.title}
        subtitle={t.subtitle}
        icon={Briefcase}
        actions={
          <ButtonLink href={`/${lang}/jobs/new`} leftIcon={<Plus className="h-4 w-4" />}>
            {t.postJob}
          </ButtonLink>
        }
      />
      <Container className="py-8">
        {typeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link href={qs({ type: "" })} className={chip(!type)}>
              {t.allTypes}
            </Link>
            {typeChips.map((ty) => (
              <Link key={ty} href={qs({ type: ty })} className={chip(type === ty)}>
                {t.types[ty as keyof typeof t.types] ?? ty}
              </Link>
            ))}
          </div>
        )}
        {regionChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={qs({ region: "" })} className={chip(!region)}>
              {t.allRegions}
            </Link>
            {regionChips.map((r) => (
              <Link key={r} href={qs({ region: r })} className={chip(region === r)}>
                {regionName(r)}
              </Link>
            ))}
          </div>
        )}

        {jobs.length > 0 && (
          <p className="mt-5 text-sm font-semibold text-muted-foreground">
            {countLabel(pm.jobsCount, jobs.length)}
          </p>
        )}

        {jobs.length ? (
          <div data-animate className="mt-3 grid gap-4 sm:grid-cols-2">
            {jobs.map((j) => {
              const rn = regionName(j.region);
              return (
                <Card key={j.id} variant="interactive" className="group relative p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-bold leading-tight transition-colors group-hover:text-primary">
                        {j.title}
                      </h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">{j.company_name}</p>
                    </div>
                    {j.job_type && (
                      <Badge variant="primary" size="sm" className="shrink-0">
                        {t.types[j.job_type as keyof typeof t.types] ?? j.job_type}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {rn && (
                      <span className="flex items-center gap-1">
                        <MapPin aria-hidden className="h-4 w-4" />
                        {rn}
                      </span>
                    )}
                    {j.salary_note && (
                      <bdi className="font-semibold text-primary">{j.salary_note}</bdi>
                    )}
                    <span>{pm.jobsPosted.replace("{date}", formatDay(j.created_at, lang))}</span>
                    {j.apply_deadline && (
                      <span className="flex items-center gap-1">
                        <CalendarClock aria-hidden className="h-4 w-4" />
                        {pm.jobsDeadline.replace("{date}", formatDay(j.apply_deadline, lang))}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/${lang}/jobs/${j.id}`}
                    aria-label={j.title}
                    className="absolute inset-0"
                  />
                </Card>
              );
            })}
          </div>
        ) : (
          <JobsEmptyState
            className="mt-6"
            lang={lang as Locale}
            dict={{ jobs: t, proMarket: pm }}
            filtered={Boolean(region || type) && all.length > 0}
          />
        )}
      </Container>
    </div>
  );
}
