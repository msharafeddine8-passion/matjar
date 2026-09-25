/**
 * `/[lang]/freelance` — discovery, people-first.
 *
 * What this page used to be: a grid of gigs. Measured on production that is
 * three adverts, all three belonging to ONE person, shown as three strangers.
 * A buyer choosing a freelancer is choosing a PERSON — so the default view is
 * people, and the services stay one tap away rather than disappearing (§12).
 *
 * The grouping is free: `browse_gigs` already returns `freelancer_id` and
 * already orders verified → available → most completed → newest, so taking
 * first-appearance order while grouping carries the server's ranking onto the
 * people list without a second sort. See `src/lib/data/freelance.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The filters — and the ones deliberately NOT built
 *
 * `lib/freelancer-trust.ts` set the rule and it still holds: a filter that
 * returns nothing says more about the platform than about the query. This page
 * adds one clause for the people view — a control must be able to SPLIT the
 * list, and with one freelancer holding every gig, "verified only" is a switch
 * between the whole page and an empty one. See `visiblePeopleFilters`.
 *
 * NOT BUILT, on purpose:
 *   - **rating / "top rated"** — `rating_count` is 0 on every gig and there is
 *     no freelance review table at all. A star filter would be a control that
 *     empties the marketplace whichever way it is set.
 *   - **price and delivery sliders** — `visibleFilters()` gates both behind
 *     8 listings; there are 3. Two range controls over three rows is furniture.
 *   - **"available today"** — `available_until` is null on all three gigs, so
 *     the facet is 0 and the chip stays hidden until someone sets a date.
 * Each is a data problem, not a design one, and each control appears on its own
 * the day the data does.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Sparkles, Plus, Send } from "lucide-react";

import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { dictSlice } from "@/lib/dict-slice";
import { createClient } from "@/lib/supabase/server";
import { getUsdLbpRate } from "@/lib/data/settings";
import { requestNow } from "@/lib/now";
import { GIG_CATEGORIES } from "@/lib/gigs";
import { regions } from "@/lib/catalog";
import {
  countLabel,
  groupGigsByPerson,
  personToProfile,
  visiblePeopleFilters,
  type BrowsedGigRow,
} from "@/lib/data/freelance";
import { GigCard, type BrowsedGig } from "@/components/gig-card";
import { getSectionSupply } from "@/lib/data/section-supply";
import { localeAlternates } from "@/lib/site";
import { supplyRobots } from "@/lib/professional";
import { FreelanceSearch } from "@/components/freelance/freelance-search";
import { ProfessionalCard } from "@/components/professional/professional-card";
import { Container } from "@/components/ui/container";
import { PageHero } from "@/components/ui/page-hero";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const [dict, sp, supply] = await Promise.all([
    getDictionary(lang),
    searchParams,
    getSectionSupply(),
  ]);
  // The zero-supply rule: the bare /freelance is indexable while at least one
  // active gig exists (the same cached count the header uses), and every
  // filtered, searched or services-tab view is noindex — permutations of one
  // list are not pages. Canonical points every variant at the bare URL.
  const filtered = ["cat", "region", "verified", "available", "q", "view"].some(
    (k) => sp[k] != null && sp[k] !== "",
  );
  return {
    title: dict.freelance.title,
    description: dict.freelance.subtitle,
    alternates: localeAlternates(lang, "/freelance"),
    robots: supplyRobots({
      supply: supply.find((x) => x.section === "freelance")?.count ?? 0,
      filtered,
    }),
  };
}

type Facets = {
  total?: number;
  verified?: number;
  available?: number;
  rated?: number;
  categories?: Record<string, number>;
  regions?: Record<string, number>;
};

type View = "people" | "services";

export default async function FreelancePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    cat?: string;
    region?: string;
    verified?: string;
    available?: string;
    q?: string;
    view?: string;
  }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const dict = await getDictionary(lang);
  const t = dict.freelance;
  const pm = dict.proMarket;

  // Validate every param before it reaches the RPC. An unrecognised category is
  // dropped rather than passed through, so a crawler inventing `?cat=xyz`
  // renders the unfiltered page instead of an empty one it can then index.
  const cat = GIG_CATEGORIES.includes(sp.cat as (typeof GIG_CATEGORIES)[number])
    ? (sp.cat as string)
    : null;
  const region = regions.some((r) => r.key === sp.region) ? (sp.region as string) : null;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const onlyVerified = sp.verified === "1";
  const onlyAvailable = sp.available === "1";
  const view: View = sp.view === "services" ? "services" : "people";

  const supabase = await createClient();

  // browse_gigs returns the whole card — the freelancer's name, photo and
  // verified flag included. profiles is own-row-only under RLS, so a plain
  // select could never reach them and a per-gig lookup would be N+1.
  const [{ data: gigData }, { data: facetData }, lbpRate] = await Promise.all([
    supabase.rpc("browse_gigs", {
      p_category: cat,
      p_region: region,
      p_verified_only: onlyVerified,
      p_available_only: onlyAvailable,
      p_q: q || null,
    }),
    supabase.rpc("gig_facets"),
    getUsdLbpRate(),
  ]);

  const rows = (gigData ?? []) as unknown as BrowsedGigRow[];
  const facets = (facetData ?? {}) as Facets;
  const people = groupGigsByPerson(rows);

  // The population the CONTROLS are sized against is the whole section, not the
  // filtered slice, so the chip row does not appear and vanish as the buyer
  // narrows. `gig_facets()` carries no distinct-person count, so this is the
  // honest lower bound available without a second query.
  const distinctPeople = new Set(rows.map((r) => r.freelancer_id)).size;
  const filters = visiblePeopleFilters({ people: distinctPeople, facets });
  const showCategories = filters.includes("category");
  const showRegions = filters.includes("region");
  const showVerified = filters.includes("verified");
  const showAvailable = filters.includes("available");

  // Beirut, not UTC — "available today" has to mean the merchant's today.
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
  }).format(new Date(requestNow()));

  // Region names live in the catalogue, not the dictionary — one list, two langs.
  const regionLabels = Object.fromEntries(
    regions.map((r) => [r.key, r.name[lang as Locale]]),
  );

  const current: Record<string, string | undefined> = {
    cat: cat ?? undefined,
    region: region ?? undefined,
    verified: onlyVerified ? "1" : undefined,
    available: onlyAvailable ? "1" : undefined,
    q: q || undefined,
    view: view === "services" ? "services" : undefined,
  };

  const href = (next: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...next })) if (v) qs.set(k, v);
    const s = qs.toString();
    return `/${lang}/freelance${s ? `?${s}` : ""}`;
  };

  const briefQs = new URLSearchParams();
  if (cat) briefQs.set("cat", cat);
  if (region) briefQs.set("region", region);
  const briefHref = `/${lang}/freelance/brief${
    briefQs.toString() ? `?${briefQs.toString()}` : ""
  }`;

  const chip = (active: boolean) =>
    `inline-flex h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-muted-foreground hover:border-primary/40"
    }`;

  const tab = (active: boolean) =>
    `inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-bold transition-colors sm:flex-initial ${
      active
        ? "bg-surface text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  const filtered = Boolean(cat || region || onlyVerified || onlyAvailable || q);
  // Arabic inflects a counted noun — "1 مستقل" and "3 خدمة" are both wrong, and
  // with one freelancer holding three gigs they are the only two numbers this
  // page renders today. See countLabel().
  const count =
    view === "people"
      ? countLabel(t.people.peopleCount, people.length)
      : countLabel(t.people.servicesCount, rows.length);

  return (
    <div className="pb-16">
      <PageHero
        title={t.title}
        subtitle={t.subtitle}
        icon={Sparkles}
        actions={
          <ButtonLink
            href={`/${lang}/freelance/new`}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t.offerService}
          </ButtonLink>
        }
      />
      <Container className="py-8">
        <FreelanceSearch
          action={`/${lang}/freelance`}
          q={q}
          hidden={{ ...current, q: undefined }}
          dict={dictSlice(dict, ["freelance"])}
        />

        {(showCategories || showRegions || showVerified || showAvailable) && (
          <div className="mt-4 flex flex-col gap-3">
            {showCategories && (
              <div className="flex flex-wrap gap-2">
                <Link href={href({ cat: undefined })} className={chip(!cat)}>
                  {t.allCategories}
                </Link>
                {GIG_CATEGORIES.filter((c) => (facets.categories ?? {})[c]).map((c) => (
                  <Link
                    key={c}
                    href={href({ cat: cat === c ? undefined : c })}
                    className={chip(cat === c)}
                  >
                    {t.categories[c]}
                  </Link>
                ))}
              </div>
            )}

            {showRegions && (
              <div className="flex flex-wrap gap-2">
                <Link href={href({ region: undefined })} className={chip(!region)}>
                  {t.people.allRegions}
                </Link>
                {regions
                  .filter((r) => (facets.regions ?? {})[r.key])
                  .map((r) => (
                    <Link
                      key={r.key}
                      href={href({ region: region === r.key ? undefined : r.key })}
                      className={chip(region === r.key)}
                    >
                      {r.name[lang as Locale]}
                    </Link>
                  ))}
              </div>
            )}

            {(showVerified || showAvailable) && (
              <div className="flex flex-wrap gap-2">
                {showAvailable && (
                  <Link
                    href={href({ available: onlyAvailable ? undefined : "1" })}
                    className={chip(onlyAvailable)}
                  >
                    {t.filterAvailable}
                  </Link>
                )}
                {showVerified && (
                  <Link
                    href={href({ verified: onlyVerified ? undefined : "1" })}
                    className={chip(onlyVerified)}
                  >
                    {t.filterVerified}
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* People / services. Links rather than the client Tabs component: the
            switch is a different server query, so it is a navigation — and this
            way it survives no-JS, is shareable, and keeps the back button
            meaningful. */}
        {rows.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex w-full gap-1 rounded-xl bg-surface-muted p-1 sm:w-auto">
              <Link
                href={href({ view: undefined })}
                aria-current={view === "people" ? "page" : undefined}
                className={tab(view === "people")}
              >
                {t.people.peopleTab}
              </Link>
              <Link
                href={href({ view: "services" })}
                aria-current={view === "services" ? "page" : undefined}
                className={tab(view === "services")}
              >
                {t.people.servicesTab}
              </Link>
            </div>
            <p className="text-sm font-semibold text-muted-foreground">{count}</p>
          </div>
        )}

        {rows.length === 0 ? (
          filtered ? (
            // A dead end ends the session. Say the filter missed, offer the way
            // back, and offer the way forward — describing the job is what the
            // buyer actually came to do.
            <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center sm:p-10">
              <p className="font-semibold">{t.people.noResultsTitle}</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {t.people.noResultsBody}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <ButtonLink href={briefHref} leftIcon={<Send className="h-4 w-4" />}>
                  {t.people.describeNeed}
                </ButtonLink>
                <ButtonLink href={`/${lang}/freelance`} variant="secondary">
                  {t.people.resetFilters}
                </ButtonLink>
              </div>
            </div>
          ) : (
            <EmptyState
              className="mt-8"
              icon={Sparkles}
              title={t.empty}
              action={{ href: `/${lang}/freelance/new`, label: t.offerService }}
            />
          )
        ) : view === "people" ? (
          <div
            data-animate
            className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {people.map((p) => (
              <ProfessionalCard
                key={p.id}
                profile={personToProfile(p, lang as Locale, t.categories)}
                href={`/${lang}/freelance/pro/${p.id}`}
                dict={dictSlice(dict, ["professional"])}
                lang={lang as Locale}
              />
            ))}
          </div>
        ) : (
          // Services, still grouped by the person who offers them (phase 4):
          // three cards from one freelancer read as three sellers unless they
          // sit under that one name, which links to the profile.
          <div data-animate className="mt-6 space-y-8">
            {people.map((p) => (
              <section key={p.id} aria-label={pm.servicesBy.replace("{name}", p.name || t.freelancer)}>
                {people.length > 1 || p.gigs.length > 1 ? (
                  <h2 className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-base font-extrabold">
                      {pm.servicesBy.replace("{name}", p.name || t.freelancer)}
                    </span>
                    <Link
                      href={`/${lang}/freelance/pro/${p.id}`}
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                    >
                      {t.people.viewProfile}
                    </Link>
                  </h2>
                ) : null}
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {p.gigs.map((g) => (
                    <GigCard
                      key={g.id}
                      gig={g as unknown as BrowsedGig}
                      lang={lang as Locale}
                      dict={dict}
                      todayIso={todayIso}
                      lbpRate={lbpRate}
                      regionLabels={regionLabels}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Even a full page can miss. One quiet line under the results for the
            buyer whose job nobody has listed. */}
        {rows.length > 0 && (
          <p className="mt-8 text-center">
            <Link
              href={briefHref}
              className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              <Send className="h-4 w-4" />
              {t.people.describeNeed}
            </Link>
          </p>
        )}
      </Container>
    </div>
  );
}
