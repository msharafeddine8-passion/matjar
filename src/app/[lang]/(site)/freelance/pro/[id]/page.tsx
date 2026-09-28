/**
 * `/[lang]/freelance/pro/[id]` — the freelancer, as a person.
 *
 * This route did not exist. The freelance section had gigs and nothing else, so
 * the only freelancer on the platform was three unconnected adverts and there
 * was no URL that meant "him". `/u/[id]` is the generic public-lister card and
 * stays where it is; this is the professional profile, resolved into the same
 * `ProfessionalProfile` shape a craftsman resolves into, and rendered through
 * the same blocks (`src/components/professional/**`) so the two sectors cannot
 * drift into showing the same fact two different ways.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The sparse state IS the design
 *
 * Measured on production: this person has a name, a join date and three
 * services. No photo, no bio, no skills, no languages, not verified, no
 * rating, no completed jobs, no uploaded work samples. `profileBlocks()`
 * therefore returns two blocks — services and coverage — and the page renders
 * exactly two. There is no "0.0 ★", no dashed "add a portfolio" rectangle on a
 * page a buyer is reading, and no invented response time, availability or
 * project count. What is left reads as a new professional, which is the truth.
 *
 * The one thing that IS added where a marketplace would normally show a rating
 * is a sentence saying, plainly, that there are no reviews yet and why — see
 * `freelance.pro.newHereNote`. Silence there reads as a page that failed to
 * load; a stated absence reads as a platform that will not make things up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Money, privacy, RLS
 *
 * Nothing here writes. `public_lister_profile` (0205/0215/0294) is the only
 * route an anonymous visitor has to a profile row — `profiles_select` is
 * own-row-only — and `gigs_select` already exposes active, non-deleted gigs to
 * everyone, so the service list needs no new grant. §36: region names only,
 * never an address, never a phone.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";

import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { dictSlice } from "@/lib/dict-slice";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates } from "@/lib/site";
import { formatUsd } from "@/lib/currency";
import {
  hasRating,
  primaryCtaKey,
  profileBlocks,
  startingPrice,
} from "@/lib/professional";
import {
  countLabel,
  toProfessionalProfile,
  type BrowsedGigRow,
  type ListerProfileRow,
} from "@/lib/data/freelance";
import {
  ProfessionalCompleteness,
  ProfessionalIdentity,
  ProfessionalPortfolio,
  ProfessionalReviews,
  ProfessionalServiceArea,
  ProfessionalServices,
  ProfessionalSkills,
  ProfessionalStickyCta,
} from "@/components/professional";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ContactFreelancerButton } from "@/components/contact-freelancer-button";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns the profile reads. `gigs_select` allows active + not deleted. */
const GIG_COLUMNS =
  "id, title, description, category, price, delivery_days, revisions, includes, " +
  "image_url, gallery, region, created_at, available_until, completed_count, " +
  "rating_avg, rating_count, freelancer_id, freelancer_name";

async function load(id: string) {
  const supabase = await createClient();
  const [{ data: profRows }, { data: gigRows }] = await Promise.all([
    supabase.rpc("public_lister_profile", { p_user: id }),
    supabase
      .from("gigs")
      .select(GIG_COLUMNS)
      .eq("freelancer_id", id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
  ]);
  const profile = ((profRows ?? []) as ListerProfileRow[])[0] ?? null;
  // The RPC has no freelancer_* columns; the resolver treats them as optional
  // and falls back to the denormalised gig name only when the profile row is
  // unreachable.
  const gigs = (gigRows ?? []) as unknown as BrowsedGigRow[];
  return { profile, gigs };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const dict = await getDictionary(lang);
  const { profile, gigs } = await load(id);
  if (!profile && !gigs.length) return {};
  const name = profile?.full_name?.trim() || gigs[0]?.freelancer_name?.trim() || "";
  if (!name) return {};
  return {
    title: name,
    description:
      profile?.bio?.trim().slice(0, 160) ||
      dict.freelance.pro.metaDescription
        .replace("{name}", name)
        .replace(
          "{services}",
          countLabel(dict.freelance.pro.servicesCount, gigs.length),
        ),
    alternates: localeAlternates(lang, `/freelance/pro/${id}`),
    openGraph: {
      images: profile?.avatar_url
        ? [profile.avatar_url]
        : gigs[0]?.image_url
          ? [gigs[0].image_url]
          : undefined,
    },
  };
}

export default async function FreelancerProfilePage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.freelance;
  const locale = lang as Locale;

  const { profile, gigs } = await load(id);
  // `public_lister_profile` returns no row for someone with no active gig, and
  // a person with neither a profile row nor a listing is not a professional —
  // that is a 404, not an empty page.
  if (!profile && gigs.length === 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwn = user?.id === id;

  const p = toProfessionalProfile(id, profile, gigs, locale, t.categories);
  const blocks = profileBlocks(p);
  const from = startingPrice(p.services);
  const briefHref = `/${lang}/freelance/brief?to=${id}`;
  // «اطلب عرض» primary, «راسل» secondary (phase 4). The shared key still
  // decides WHICH action a sector leads with (a trade is asked to come, a
  // freelancer to quote); freelance words it as asking for an offer.
  const ctaLabel =
    primaryCtaKey(p.kind) === "requestQuote"
      ? dict.proMarket.requestOffer
      : dict.professional.cta[primaryCtaKey(p.kind)];
  const proDict = dictSlice(dict, ["professional"]);

  // A true one-line fact for the sticky bar. FSI/PDI isolates the amount so an
  // Arabic line cannot bidi-reorder "$5" into "5$".
  const stickyNote =
    from != null ? `${t.from} ⁨${formatUsd(from)}⁩` : null;

  // The gig page carries what a service row cannot: the cover, the gallery, the
  // per-service contact. So each service gets a way through — as a thumbnail
  // strip rather than a second price list, which would be the same facts twice.
  const openable = gigs.filter((g) => g.image_url);

  return (
    <div className="py-8 pb-28 lg:pb-8">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/freelance`}
          className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.pro.backToList}
        </Link>

        <Card className="mt-1 p-5 sm:p-6">
          <ProfessionalIdentity profile={p} dict={proDict} lang={locale} />

          <p className="mt-4 text-xs text-muted-foreground">
            {countLabel(t.pro.servicesCount, p.services.length)}
            {profile?.member_since && (
              <>
                {" · "}
                {t.pro.onMatjarSince.replace(
                  "{year}",
                  String(new Date(profile.member_since).getFullYear()),
                )}
              </>
            )}
          </p>

          {/* The primary action. Desktop keeps it inline; the sticky bar below
              covers the phone, where nearly every visitor is. */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-5">
            {isOwn ? (
              <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                {t.pro.ownerNote}
              </p>
            ) : (
              <>
                <ButtonLink href={briefHref}>{ctaLabel}</ButtonLink>
                <ContactFreelancerButton
                  freelancerId={id}
                  lang={locale}
                  dict={dict}
                  label={dict.proMarket.message}
                  variant="secondary"
                />
              </>
            )}
          </div>
        </Card>

        {/* Where a marketplace would put a star row. Stated, not left blank:
            an empty space there reads as a page that failed to load. */}
        {!hasRating(p) && !p.completedCount && p.reviews.length === 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-surface-muted p-4 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="font-bold text-foreground">{t.pro.newHere}</span>
              {" — "}
              {t.pro.newHereNote}
            </span>
          </p>
        )}

        {/* Order comes from profileBlocks(): for freelance the evidence leads.
            A block with nothing to say is never in this list. */}
        <div className="mt-8 space-y-8">
          {blocks.map((block) => {
            switch (block) {
              case "about":
                return (
                  <section key={block}>
                    <p dir="auto" className="whitespace-pre-wrap leading-relaxed">
                      {p.bio}
                    </p>
                  </section>
                );
              case "portfolio":
                return (
                  <ProfessionalPortfolio key={block} items={p.portfolio} dict={proDict} />
                );
              case "services":
                return (
                  <div key={block}>
                    {/* The covers, above the price list rather than beside it.
                        `ProfessionalServices` takes neither a per-service image
                        nor a per-service href, and it is another agent's file —
                        so the strip is how a service's own page (its gallery,
                        its "what's included", its per-service contact) stays
                        reachable from the person. No captions: the titles are
                        in the list directly below, and printing them twice on a
                        page this short reads as a bug. */}
                    {openable.length > 0 && (
                      <ul className="mb-3 grid grid-cols-3 gap-3">
                        {openable.map((g) => (
                          <li key={g.id}>
                            <Link
                              href={`/${lang}/freelance/${g.id}`}
                              aria-label={g.title}
                              title={g.title}
                              className="group block overflow-hidden rounded-xl border border-border bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                              <Image
                                src={g.image_url as string}
                                alt=""
                                width={220}
                                height={220}
                                sizes="(max-width: 640px) 33vw, 210px"
                                className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
                              />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <ProfessionalServices
                      id="services"
                      services={p.services}
                      dict={proDict}
                      quoteHref={isOwn ? undefined : briefHref}
                    />
                  </div>
                );
              case "skills":
                return <ProfessionalSkills key={block} skills={p.skills} dict={proDict} />;
              case "experience":
                // yearsExperience has no column on this side of the platform, so
                // profileBlocks() never selects it for a freelancer today.
                return null;
              case "reviews":
                return (
                  <ProfessionalReviews
                    key={block}
                    reviews={p.reviews}
                    dict={proDict}
                    lang={locale}
                    ratingAvg={p.ratingAvg}
                    ratingCount={p.ratingCount}
                    name={p.name}
                  />
                );
              case "area":
                return (
                  <ProfessionalServiceArea key={block} area={p.area} dict={proDict} />
                );
              default:
                return null;
            }
          })}
        </div>

        {/* Coaching, and only for the person themself. A completeness score
            shown to CUSTOMERS rates a professional on paperwork rather than on
            work — see the note on completeness() in lib/professional.ts. */}
        {isOwn && (
          <ProfessionalCompleteness
            className="mt-10"
            profile={p}
            dict={proDict}
            hrefs={{
              bio: `/${lang}/freelance/mine`,
              skills: `/${lang}/freelance/mine`,
              services: `/${lang}/freelance/new`,
              portfolio: `/${lang}/freelance/new`,
            }}
          />
        )}
      </Container>

      {!isOwn && (
        <ProfessionalStickyCta
          label={ctaLabel}
          href={briefHref}
          note={stickyNote}
        />
      )}
    </div>
  );
}
