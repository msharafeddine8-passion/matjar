import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { User, Check, Images, ExternalLink } from "lucide-react";
import { ChevronNext, ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates } from "@/lib/site";
import { regions } from "@/lib/catalog";
import { countLabel } from "@/lib/data/freelance";
import type { Gig } from "@/lib/gigs";
import { Container } from "@/components/ui/container";
import { TrustChips } from "@/components/trust-chips";
import { GigCard, type BrowsedGig } from "@/components/gig-card";
import { getUsdLbpRate } from "@/lib/data/settings";
import { requestNow } from "@/lib/now";
import { formatLbp } from "@/lib/currency";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { splitServicesByOwner } from "@/lib/professional";
import { Badge } from "@/components/ui/badge";
import { ContactFreelancerButton } from "@/components/contact-freelancer-button";
import { TrustBadges } from "@/components/trust-badges";
import { resolveProfessionalTrust } from "@/lib/trust";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("gigs")
    .select("title, description, image_url")
    .eq("id", id)
    .maybeSingle();
  if (!data) return {};
  const g = data as { title: string; description: string; image_url: string | null };
  return {
    title: g.title,
    description: g.description.slice(0, 160),
    alternates: localeAlternates(lang, `/freelance/${id}`),
    openGraph: { images: g.image_url ? [g.image_url] : undefined },
  };
}

export default async function GigDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.freelance;

  const supabase = await createClient();
  const { data } = await supabase
    .from("gigs")
    .select(
      "id, freelancer_id, freelancer_name, title, description, category, price, delivery_days, image_url, region, gallery, includes, revisions, portfolio_link, available_until, completed_count, rating_avg, rating_count",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const gig = data as Gig & {
    available_until: string | null;
    completed_count: number | null;
    rating_avg: number | null;
    rating_count: number | null;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwn = user?.id === gig.freelancer_id;

  // The buyer is choosing a PERSON, not a listing. profiles is own-row-only
  // under RLS, so this goes through the security-definer view added in 0205 and
  // extended in 0215.
  const { data: profRows } = await supabase.rpc("public_lister_profile", {
    p_user: gig.freelancer_id,
  });
  const profile = ((profRows ?? []) as {
    full_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    skills: string[] | null;
    gig_count: number | null;
    languages: string[] | null;
    freelancer_verified: boolean | null;
    member_since: string | null;
  }[])[0];

  // A gig belongs to somebody. This page is the service, so the person gets a
  // row of their own at the top rather than a name in a metadata line, and it
  // goes to the profile — /freelance/pro/[id] — not to the generic /u/[id]
  // card. The whole point of the change is that three adverts are one person.
  const personName = profile?.full_name?.trim() || gig.freelancer_name || t.freelancer;
  const gigCount = profile?.gig_count ?? 1;

  // Same shape the grid uses, so the cards below are the cards above.
  //
  // Split by owner (phase 4). browse_gigs by category returned this same
  // person's other gigs as "related services" — with one freelancer on the
  // platform, that was the same person presented as two more sellers. Their
  // own services now sit under their name; "related" is other people only.
  const [{ data: relData }, { data: ownData }] = await Promise.all([
    supabase.rpc("browse_gigs", { p_category: gig.category, p_limit: 8 }),
    supabase
      .from("gigs")
      .select("id, title, price, freelancer_id")
      .eq("freelancer_id", gig.freelancer_id)
      .eq("status", "active")
      .neq("id", gig.id)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  const related = splitServicesByOwner(
    (relData ?? []) as unknown as (BrowsedGig & { freelancer_id: string })[],
    gig.freelancer_id,
    gig.id,
  ).others.slice(0, 2);
  const moreFromPerson = (ownData ?? []) as {
    id: string;
    title: string;
    price: number | null;
    freelancer_id: string;
  }[];
  const briefHref = `/${lang}/freelance/brief?to=${gig.freelancer_id}${
    gig.category ? `&cat=${encodeURIComponent(gig.category)}` : ""
  }`;
  const pm = dict.proMarket;

  const lbpRate = await getUsdLbpRate();
  // Beirut, not UTC — "available today" has to mean the buyer's today.
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
  }).format(new Date(requestNow()));
  const regionLabels = Object.fromEntries(
    regions.map((r) => [r.key, r.name[lang]]),
  );

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/freelance`}
          className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>

        {gig.image_url && (
          <Image
            src={gig.image_url}
            alt={gig.title}
            width={800}
            height={450}
            className="mt-4 aspect-video w-full rounded-2xl object-cover"
            sizes="(max-width: 768px) 100vw, 672px"
          />
        )}

        <Card className="mt-4 p-6">
          {/* The person, first and whole. This used to be a name in the
              metadata row, which is how one freelancer with three listings read
              as three strangers. */}
          <Link
            href={`/${lang}/freelance/pro/${gig.freelancer_id}`}
            className="-m-2 mb-1 flex min-h-11 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-surface-muted"
          >
            {profile?.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                <User className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span
                dir="auto"
                className="flex items-center gap-1 text-sm font-bold"
              >
                <span className="truncate">{personName}</span>
                {/* Inside a Link, so an icon mark rather than a badge link. */}
                <TrustBadges
                  variant="mark"
                  signals={resolveProfessionalTrust({
                    identityVerified: Boolean(profile?.freelancer_verified),
                  })}
                  dict={dict}
                  lang={lang}
                />
              </span>
              <span className="block text-xs text-muted-foreground">
                {gigCount > 1
                  ? countLabel(t.people.servicesCount, gigCount)
                  : t.people.viewProfile}
              </span>
            </span>
            <ChevronNext className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          {gig.category && (
            <Badge variant="primary" size="sm">
              {t.categories[gig.category as keyof typeof t.categories] ??
                gig.category}
            </Badge>
          )}
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
            {gig.title}
          </h1>
          {/* Same evidence the card showed. Identical component, so the listing
              and this page can never claim different things about one person.
              The hand-rolled region + delivery row that used to sit above this
              was removed rather than kept: TrustChips already renders both, so
              the page was printing "الشمال" and "تسليم ٢ أيام" twice, once in
              each style. */}
          <div className="mt-3">
            <TrustChips
              gig={{
                ratingAvg: gig.rating_avg,
                ratingCount: gig.rating_count,
                completedCount: gig.completed_count,
                availableUntil: gig.available_until,
                deliveryDays: gig.delivery_days,
                revisions: gig.revisions,
                gallery: gig.gallery,
                region: gig.region,
              }}
              dict={dict}
              todayIso={todayIso}
              regionLabels={regionLabels}
              max={4}
              size="md"
            />
          </div>

          <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-muted-foreground">
            {gig.description}
          </p>

          {/* Who they are, in the buyer's order of interest: what they say about
              themselves, what they can do, and how long they have been here. */}
          {(profile?.bio ||
            profile?.skills?.length ||
            profile?.member_since) && (
            <div className="mt-4 border-t border-border pt-4">
              {profile?.bio && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {profile.bio}
                </p>
              )}
              {Array.isArray(profile?.skills) && profile.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {profile.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {profile?.member_since && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t.memberSince.replace(
                    "{year}",
                    String(new Date(profile.member_since).getFullYear()),
                  )}
                </p>
              )}
            </div>
          )}

          {/* What the starting price covers — the buyer's first question. */}
          {Array.isArray(gig.includes) && gig.includes.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <h2 className="text-sm font-bold">{t.includesLabel}</h2>
              <ul className="mt-2 space-y-1.5">
                {gig.includes.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gig.revisions != null && (
            <p className="mt-3 text-sm font-semibold">
              {t.revisions}:{" "}
              <span className="text-primary">{gig.revisions}</span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            {gig.price != null && (
              <div>
                <span className="text-xs text-muted-foreground">{t.from}</span>
                <p className="text-2xl font-extrabold text-primary">
                  {money(Number(gig.price))}
                </p>
                {/* Both currencies, like everywhere else on Matjar. Making the
                    buyer convert in their head is friction at the last step. */}
                {lbpRate > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatLbp(Number(gig.price), lbpRate, lang)}
                  </p>
                )}
              </div>
            )}
            {isOwn ? (
              // The owner can't see the visitor CTA, which reads as "there is no
              // way to contact me" — state plainly what a visitor sees instead.
              <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                {t.ownerPreviewNote}
              </p>
            ) : (
              // «اطلب عرض» leads: the buyer describes the job once and it reaches
              // this person as a structured brief. «راسل» is the open chat.
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={briefHref}>{pm.requestOffer}</ButtonLink>
                <ContactFreelancerButton
                  freelancerId={gig.freelancer_id}
                  lang={lang as Locale}
                  dict={dict}
                  label={pm.message}
                  variant="secondary"
                />
              </div>
            )}
          </div>
        </Card>

        {/* The same person's other services, under their name — not as
            strangers in a "related" grid. */}
        {moreFromPerson.length > 0 && (
          <section className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-extrabold tracking-tight">
                {pm.moreFrom.replace("{name}", personName)}
              </h2>
              <Link
                href={`/${lang}/freelance/pro/${gig.freelancer_id}`}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
              >
                {pm.allServicesOf.replace("{name}", personName)}
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-surface">
              {moreFromPerson.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/${lang}/freelance/${g.id}`}
                    className="flex min-h-11 min-w-0 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold">{g.title}</span>
                    <span className="flex shrink-0 items-center gap-1 text-sm">
                      {g.price != null && (
                        <>
                          <span className="text-xs text-muted-foreground">{t.from}</span>
                          <bdi className="font-bold text-primary">{money(Number(g.price))}</bdi>
                        </>
                      )}
                      <ChevronNext className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Work samples gallery — the strongest signal a service listing has. */}
        {Array.isArray(gig.gallery) && gig.gallery.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <Images className="h-5 w-5 text-primary" />
              {t.workSamples}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {gig.gallery.map((url) => (
                <Image
                  key={url}
                  src={url}
                  alt={gig.title}
                  width={400}
                  height={400}
                  className="aspect-square w-full rounded-xl object-cover"
                  sizes="(max-width: 640px) 50vw, 220px"
                />
              ))}
            </div>
          </div>
        )}

        {gig.portfolio_link && (
          <a
            href={gig.portfolio_link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            dir="ltr"
          >
            <ExternalLink className="h-4 w-4" />
            {t.portfolioLink}
          </a>
        )}

        {/* Somewhere to go that isn't back. A buyer who bounces off one listing
            usually still wants the job done. */}
        {related.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-extrabold tracking-tight">
              {pm.relatedOthers}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {related.map((g) => (
                <GigCard
                  key={g.id}
                  gig={g}
                  lang={lang as Locale}
                  dict={dict}
                  todayIso={todayIso}
                  lbpRate={lbpRate}
                  regionLabels={regionLabels}
                />
              ))}
            </div>
          </div>
        )}
      </Container>

      {/* Mobile only. Nearly every visitor is on a phone, and the contact button
          sat at the end of a long page — reachable only by deciding to look for
          it. Here it is in reach from anywhere in the listing. Desktop keeps the
          inline button; a bar there would be noise. */}
      {!isOwn && (
        <div className="sticky bottom-0 z-30 flex gap-2 border-t border-border bg-surface/95 p-3 backdrop-blur-sm sm:hidden">
          <ButtonLink href={briefHref} className="flex-1">
            {pm.requestOffer}
          </ButtonLink>
          <ContactFreelancerButton
            freelancerId={gig.freelancer_id}
            lang={lang as Locale}
            dict={dict}
            label={pm.message}
            variant="secondary"
            className="flex-1"
          />
        </div>
      )}
    </div>
  );
}
