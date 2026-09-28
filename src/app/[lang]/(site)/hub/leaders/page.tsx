import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crown, User } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { LeaderSubmit } from "@/components/hub/leader-submit";
import { LeadersDirectory } from "@/components/hub/leaders-directory";
import { LEADER_CARD_COLUMNS, type LeaderCard } from "@/lib/leaders";
import { featureCopy } from "@/lib/feature-availability";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.hub.leaders.title,
    description: dict.hub.leaders.subtitle,
    alternates: localeAlternates(lang, "/hub/leaders"),
  };
}

export default async function LeadersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const l = dict.hub.leaders;

  const supabase = await createClient();
  const { data } = await supabase
    .from("business_leaders")
    .select(LEADER_CARD_COLUMNS)
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const leaders = (data ?? []) as LeaderCard[];

  return (
    <div className="pb-16">
      <Container className="pt-10 sm:pt-14">
        <Link
          href={`/${lang}/hub`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.hub.backToHub}
        </Link>

        {/* Gold hero */}
        <div className="mt-5 overflow-hidden rounded-3xl border border-border bg-gradient-to-bl from-accent/12 via-transparent to-transparent p-8 sm:p-12">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-foreground">
            <Crown className="h-4 w-4" />
            {l.heroKicker}
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-extrabold leading-[1.15] tracking-tight sm:text-5xl">
            {l.title}
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground sm:text-lg">
            {l.subtitle}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#submit"
              className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-bold text-accent-strong-foreground shadow-sm transition-colors hover:bg-accent-strong-hover"
            >
              {l.heroSubmit}
            </a>
            {leaders.length > 0 && (
              <a
                href="#directory"
                className="inline-flex h-11 items-center rounded-xl border border-border bg-surface px-5 text-sm font-bold transition-colors hover:border-primary/40"
              >
                {l.heroBrowse}
              </a>
            )}
          </div>
        </div>

        {/* Directory or premium coming-soon */}
        {leaders.length > 0 ? (
          <LeadersDirectory
            leaders={leaders}
            lang={lang}
            t={{
              searchPlaceholder: l.searchPlaceholder,
              allSectors: l.allSectors,
              allRegions: l.allRegions,
              featuredTitle: l.featuredTitle,
              directoryTitle: l.directoryTitle,
              countSuffix: l.countSuffix,
              noResults: l.noResults,
              clearFilters: l.clearFilters,
              viewProfile: l.viewProfile,
              featuredBadge: l.featuredBadge,
            }}
          />
        ) : (
          <div className="relative mt-12 overflow-hidden rounded-3xl border border-border bg-surface-muted/30">
            <div className="grid gap-5 p-6 blur-[3px] sm:grid-cols-3" aria-hidden>
              {[0, 1, 2].map((i) => (
                <SampleCard key={i} />
              ))}
            </div>
            <div className="absolute inset-0 grid place-items-center bg-background/60 p-6 text-center backdrop-blur-[1px]">
              <div className="max-w-md">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-foreground">
                  <Crown className="h-7 w-7" />
                </span>
                {/* The directory has no published profile yet — content
                    supply, resolved by the query above. The word is the
                    registry's canonical "coming soon", not a badge string of
                    this page's own. */}
                <span className="mt-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-[11px] font-bold text-accent-foreground">
                  {featureCopy("coming_soon", dict)}
                </span>
                <h2 className="mt-3 text-2xl font-extrabold tracking-tight">
                  {l.emptyTitle}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  {l.emptyNote}
                </p>
                <a
                  href="#submit"
                  className="mt-5 inline-flex h-11 items-center rounded-xl bg-accent-strong px-6 text-sm font-bold text-accent-strong-foreground shadow-sm transition-colors hover:bg-accent-strong-hover"
                >
                  {l.submitButton}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Submit */}
        <div id="submit" className="mt-16 scroll-mt-24">
          <LeaderSubmit lang={lang} dict={dict} />
        </div>
      </Container>
    </div>
  );
}

function SampleCard() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="h-20 bg-gradient-to-bl from-accent/15 to-primary/10" />
      <div className="px-5 pb-5">
        <div className="-mt-9 mb-3 grid h-16 w-16 place-items-center rounded-full bg-surface-muted text-muted-foreground ring-4 ring-surface">
          <User className="h-6 w-6" />
        </div>
        <div className="h-3.5 w-2/3 rounded bg-surface-muted" />
        <div className="mt-2 h-3 w-1/2 rounded bg-surface-muted/70" />
        <div className="mt-4 h-3 w-full rounded bg-surface-muted/50" />
      </div>
    </div>
  );
}
