import Link from "next/link";
import { Briefcase, Info, Sparkles, Store, Wrench } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { buttonVariants } from "@/components/ui/button";

// ────────────────────────────────────────────────────────────────────────────
// The jobs board with nothing on it — or nothing under the current filter.
//
// Two people land here and they want opposite things, so the card speaks to
// each of them once instead of offering one "انشر وظيفة" button to both:
//
//   * a business that could post a job → «انشر وظيفة» (the form itself gates
//     on owning a store, as job_postings_insert does);
//   * a person looking for work → the two sections where they can be FOUND
//     today without waiting for an employer: a freelance profile and a trade
//     registration. Both are real, working flows.
//
// What it deliberately does not offer: «خبّرني لما تنزل فرص جديدة». There is
// no job-alert infrastructure — saved_searches (0048) stores market filters
// and nothing reads it to send anything; push_subscriptions has an admin
// broadcast and no per-topic fan-out. A subscribe button with nothing behind
// it is a promise the platform cannot keep, so the card says plainly that
// there are no alerts yet.
// ────────────────────────────────────────────────────────────────────────────

export function JobsEmptyState({
  lang,
  dict,
  filtered,
  className = "",
}: {
  lang: Locale;
  dict: Pick<Dictionary, "jobs" | "proMarket">;
  /** A filter emptied the list — offer the way back first. */
  filtered: boolean;
  className?: string;
}) {
  const pm = dict.proMarket;
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-border bg-surface ${className}`}
    >
      <div className="border-b border-border bg-primary-soft/60 p-5 sm:p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface text-primary">
          <Briefcase aria-hidden className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-xl font-extrabold tracking-tight">
          {filtered ? pm.jobsEmptyFilteredTitle : pm.jobsEmptyTitle}
        </h2>
        {!filtered && (
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{pm.jobsEmptyLead}</p>
        )}
        {filtered && (
          <Link
            href={`/${lang}/jobs`}
            className={`${buttonVariants({ variant: "secondary" })} mt-4`}
          >
            {pm.jobsShowAll}
          </Link>
        )}
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
        <div className="min-w-0 rounded-xl border border-border p-4">
          <p className="flex items-center gap-2 font-bold">
            <Store aria-hidden className="h-4 w-4 shrink-0 text-primary" />
            {pm.jobsBizTitle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{pm.jobsBizBody}</p>
          <Link
            href={`/${lang}/jobs/new`}
            className={`${buttonVariants({ variant: "primary" })} mt-3`}
          >
            {dict.jobs.postJob}
          </Link>
        </div>

        <div className="min-w-0 rounded-xl border border-border p-4">
          <p className="flex items-center gap-2 font-bold">
            <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-primary" />
            {pm.jobsSeekerTitle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{pm.jobsSeekerBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/${lang}/freelance/new`}
              className={buttonVariants({ variant: "secondary" })}
            >
              {pm.jobsSeekerFreelance}
            </Link>
            <Link
              href={`/${lang}/crafts/join`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Wrench aria-hidden className="h-4 w-4" />
              {pm.jobsSeekerCrafts}
            </Link>
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground sm:px-6">
        <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {pm.jobsNoAlerts}
      </p>
    </section>
  );
}
