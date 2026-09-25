import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Briefcase,
  MapPin,
  Phone,
  FileText,
  Mail,
  CalendarClock,
  GraduationCap,
} from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates, SITE_URL } from "@/lib/site";
import { jobPostingJsonLd, jsonLdScript } from "@/lib/jsonld";
import { regions } from "@/lib/catalog";
import type { JobPosting } from "@/lib/jobs";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { JobApplyForm } from "@/components/job-apply-form";
import { ButtonLink } from "@/components/ui/button";
import { requestNow } from "@/lib/now";
import { beirutToday, formatDay, isJobOpen } from "@/lib/pro-market";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_postings")
    .select("title, company_name, description, status, apply_deadline")
    .eq("id", id)
    .maybeSingle();
  if (!data) return {};
  const j = data as {
    title: string;
    company_name: string;
    description: string;
    status: string;
    apply_deadline: string | null;
  };
  // A posting past its deadline (Beirut's today) is kept reachable for the
  // people who applied, but it is no longer a page to send searchers to.
  const open = isJobOpen(j, beirutToday(requestNow()));
  return {
    title: `${j.title} — ${j.company_name}`,
    description: j.description.slice(0, 160),
    alternates: localeAlternates(lang, `/jobs/${id}`),
    ...(open ? {} : { robots: { index: false, follow: true } }),
  };
}

type Applicant = {
  id: string;
  cover_note: string | null;
  phone: string | null;
  cv_url: string | null;
  profiles: { full_name: string | null } | null;
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.jobs;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("job_postings")
    .select(
      "id, poster_id, title, company_name, description, region, job_type, salary_note, how_to_apply, apply_email, apply_deadline, experience_level, status, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const job = data as JobPosting;
  const isPoster = user?.id === job.poster_id;

  // Applicants (poster only) or my-application state.
  let applicants: Applicant[] = [];
  let alreadyApplied = false;
  if (isPoster) {
    const { data: apps } = await supabase
      .from("job_applications")
      .select("id, cover_note, phone, cv_url, profiles(full_name)")
      .eq("job_id", id)
      .order("created_at", { ascending: false });
    applicants = (apps ?? []) as unknown as Applicant[];
  } else if (user) {
    const { data: mine } = await supabase
      .from("job_applications")
      .select("id")
      .eq("job_id", id)
      .eq("applicant_id", user.id)
      .maybeSingle();
    alreadyApplied = !!mine;
  }

  const regionName =
    regions.find((r) => r.key === job.region)?.name[lang] ?? job.region;
  // Deadline compared date-only against BEIRUT's today, so the last day is
  // open until Lebanese midnight — UTC would close it at 2 or 3 am.
  const deadlinePassed = !isJobOpen(
    { apply_deadline: job.apply_deadline },
    beirutToday(requestNow()),
  );
  const expLabel = job.experience_level
    ? (
        {
          entry: t.expEntry,
          mid: t.expMid,
          senior: t.expSenior,
        } as Record<string, string>
      )[job.experience_level]
    : null;

  return (
    <div className="py-10">
      {/* Structured data only for a posting that still takes applications —
          a JobPosting past its deadline is exactly what Google penalises. */}
      {job.status === "active" && !deadlinePassed && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              jobPostingJsonLd({
                title: job.title,
                description: job.description,
                datePosted: job.created_at,
                companyName: job.company_name,
                url: `${SITE_URL}/${lang}/jobs/${id}`,
                region: regionName,
                jobType: job.job_type,
                validThrough: job.apply_deadline,
              }),
            ),
          }}
        />
      )}
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/jobs`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>

        <Card className="mt-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {job.title}
              </h1>
              <p className="mt-1 font-semibold text-muted-foreground">
                {job.company_name}
              </p>
            </div>
            {job.job_type && (
              <Badge variant="primary" className="shrink-0">
                {t.types[job.job_type as keyof typeof t.types] ?? job.job_type}
              </Badge>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {regionName && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {regionName}
              </span>
            )}
            {job.salary_note && (
              <span className="font-semibold text-primary">{job.salary_note}</span>
            )}
            {expLabel && (
              <span className="flex items-center gap-1">
                <GraduationCap className="h-4 w-4" />
                {expLabel}
              </span>
            )}
            {job.apply_deadline && (
              <span
                className={`flex items-center gap-1 ${
                  deadlinePassed ? "font-semibold text-danger" : ""
                }`}
              >
                <CalendarClock className="h-4 w-4" />
                {deadlinePassed
                  ? t.deadlinePassed
                  : dict.proMarket.jobsDeadline.replace(
                      "{date}",
                      formatDay(job.apply_deadline, lang),
                    )}
              </span>
            )}
          </div>
          <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-muted-foreground">
            {job.description}
          </p>
          {job.apply_email && (
            <a
              href={`mailto:${job.apply_email}?subject=${encodeURIComponent(job.title)}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              dir="ltr"
            >
              <Mail className="h-4 w-4" />
              {job.apply_email}
            </a>
          )}
          {job.how_to_apply && (
            <p className="mt-3 text-sm">
              <span className="font-bold">{t.howToApply}:</span> {job.how_to_apply}
            </p>
          )}
        </Card>

        {/* Poster sees applicants; others see the apply form */}
        {isPoster ? (
          <div className="mt-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
              <Briefcase className="h-5 w-5 text-primary" />
              {t.applicants} ({applicants.length})
            </h2>
            {/* The poster sees the applicants panel where a visitor sees the
                apply form — spell that out so an empty list doesn't read as
                "there is no way to apply". */}
            <p className="mb-3 rounded-xl bg-surface-muted px-4 py-2.5 text-sm text-muted-foreground">
              {t.ownerPreviewNote}
            </p>
            {applicants.length ? (
              <div className="space-y-3">
                {applicants.map((a) => (
                  <Card key={a.id} className="p-4">
                    <p className="font-bold">
                      {a.profiles?.full_name ?? t.applicant}
                    </p>
                    {a.cover_note && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {a.cover_note}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      {a.phone && (
                        <a
                          href={`tel:${a.phone}`}
                          className="flex items-center gap-1 font-semibold text-primary"
                          dir="ltr"
                        >
                          <Phone className="h-4 w-4" />
                          <span dir="ltr">{a.phone}</span>
                        </a>
                      )}
                      {a.cv_url && (
                        <a
                          href={a.cv_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 font-semibold text-primary"
                        >
                          <FileText className="h-4 w-4" />
                          {t.viewCv}
                        </a>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState icon={Briefcase} title={t.noApplicants} />
            )}
          </div>
        ) : deadlinePassed ? (
          // Closed, and a way on: the board, not a dead end.
          <div className="mt-6 rounded-2xl border border-border bg-surface p-5 text-center">
            <CalendarClock aria-hidden className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 font-bold">{dict.proMarket.jobClosedTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{dict.proMarket.jobClosedBody}</p>
            <ButtonLink href={`/${lang}/jobs`} variant="secondary" className="mt-4">
              {dict.proMarket.jobsShowAll}
            </ButtonLink>
          </div>
        ) : (
          <div className="mt-6">
            <JobApplyForm
              jobId={job.id}
              lang={lang as Locale}
              dict={dict}
              applied={alreadyApplied}
            />
          </div>
        )}
      </Container>
    </div>
  );
}
