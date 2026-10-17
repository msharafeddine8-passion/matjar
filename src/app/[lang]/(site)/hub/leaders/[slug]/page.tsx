import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Award,
  BadgeCheck,
  Building2,
  ExternalLink,
  Link2,
  MapPin,
  Tag,
} from "lucide-react";
import { ArrowPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { LEADER_PROFILE_ROBOTS } from "@/lib/seo-rules";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { InitialsAvatar } from "@/components/hub/initials-avatar";
import {
  LEADER_CARD_COLUMNS,
  LEADER_COLUMNS,
  type Leader,
  type LeaderCard,
  type LeaderCompany,
  type LeaderSocials,
} from "@/lib/leaders";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_leaders")
    .select(LEADER_COLUMNS)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (!data) return {};
  const leader = data as unknown as Leader;
  const name =
    lang === "en" ? leader.name_en || leader.name : leader.name;
  const fallback = dict.hub?.leaders?.title;
  const title = fallback ? `${name} · ${fallback}` : name;
  const description =
    leader.headline ||
    (leader.bio ? leader.bio.slice(0, 150) : undefined) ||
    undefined;
  return {
    title,
    description,
    alternates: localeAlternates(lang, `/hub/leaders/${slug}`),
    // A templated page about a real person: reachable, links followed, not
    // indexed — and not in the sitemap (lib/seo-rules).
    robots: LEADER_PROFILE_ROBOTS,
  };
}

export default async function LeaderProfilePage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();

  const dict = await getDictionary(lang);
  const supabase = await createClient();

  const { data } = await supabase
    .from("business_leaders")
    .select(LEADER_COLUMNS)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (!data) notFound();

  const leader = data as unknown as Leader;
  const socials = (leader.socials as LeaderSocials) ?? {};
  const companies = (leader.companies as LeaderCompany[]) ?? [];
  const achievementsAr = (leader.achievements as string[]) ?? [];
  const achievementsEn = (leader.achievements_en as string[]) ?? [];
  const achievements =
    lang === "en" && achievementsEn.length > 0 ? achievementsEn : achievementsAr;
  const sources = (leader.source_urls as string[]) ?? [];

  const name = lang === "en" ? leader.name_en || leader.name : leader.name;
  const headline =
    lang === "en" ? leader.headline_en || leader.headline : leader.headline;
  const company =
    lang === "en" ? leader.company_en || leader.company : leader.company;
  // Prefer the long bio, fall back to the short one; prefer the current locale.
  const bio =
    lang === "en"
      ? leader.long_bio_en || leader.bio_en || leader.long_bio || leader.bio
      : leader.long_bio || leader.bio;
  const t = dict.hub.leaders;

  // Related leaders (other published profiles).
  const { data: relatedData } = await supabase
    .from("business_leaders")
    .select(LEADER_CARD_COLUMNS)
    .eq("published", true)
    .neq("slug", slug)
    .limit(6);
  const related = (relatedData ?? []) as unknown as LeaderCard[];

  // Render socials as labelled pills — this lucide version dropped the brand
  // icons, and a wrong-metaphor icon is worse than an honest text label.
  const socialLinks: {
    key: keyof LeaderSocials;
    href: string | undefined;
    label: string;
  }[] = [
    { key: "linkedin", href: socials.linkedin, label: "LinkedIn" },
    { key: "instagram", href: socials.instagram, label: "Instagram" },
    { key: "x", href: socials.x, label: "X" },
    { key: "facebook", href: socials.facebook, label: "Facebook" },
    { key: "youtube", href: socials.youtube, label: "YouTube" },
  ];
  const presentSocials = socialLinks.filter((s) => s.href);

  return (
    <div className="pb-16">
      {/* Cover banner */}
      <Container>
        <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface shadow-xs">
          <div className="relative h-48 sm:h-64">
            {leader.cover_url ? (
              // The page's own banner: it is the LCP element on this route, so
              // it is the one image here that must not be lazy.
              <Image
                src={leader.cover_url}
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 1024px"
                className="object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-bl from-accent/15 via-transparent to-primary/10" />
            )}
          </div>

          {/* Header */}
          <div className="px-5 pb-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end">
                {leader.photo_url ? (
                  <Image
                    src={leader.photo_url}
                    alt={name}
                    width={112}
                    height={112}
                    sizes="112px"
                    className="-mt-14 h-28 w-28 shrink-0 rounded-full object-cover ring-4 ring-surface"
                  />
                ) : (
                  <InitialsAvatar
                    name={name}
                    size="xl"
                    className="-mt-14 ring-4 ring-surface"
                  />
                )}
                <div className="min-w-0">
                  <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
                    {name}
                    <BadgeCheck className="h-6 w-6 shrink-0 text-accent-foreground" />
                  </h1>
                  {headline && (
                    <p className="mt-1 font-semibold text-primary">{headline}</p>
                  )}
                  {company && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Building2 className="h-4 w-4 shrink-0" />
                      {company}
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {leader.sector && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        <Tag className="h-3.5 w-3.5" />
                        {leader.sector}
                      </span>
                    )}
                    {leader.location && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        {leader.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Website + socials */}
            {(leader.website || presentSocials.length > 0) && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {leader.website && (
                  <a
                    href={leader.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent-strong px-4 py-2 text-sm font-semibold text-accent-strong-foreground transition-colors hover:bg-accent-strong-hover"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t.website}
                  </a>
                )}
                {presentSocials.map(({ key, href, label }) => (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Link2 className="h-4 w-4" />
                    {label}
                  </a>
                ))}
              </div>
            )}

            {/* Photo attribution (only for freely-licensed images). */}
            {leader.photo_url && leader.photo_credit && (
              <p className="mt-4 text-[11px] text-muted-foreground/70">
                {leader.photo_source_url ? (
                  <a
                    href={leader.photo_source_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="hover:text-muted-foreground hover:underline"
                  >
                    {leader.photo_credit}
                  </a>
                ) : (
                  leader.photo_credit
                )}
              </p>
            )}
          </div>
        </div>

        {/* Bio */}
        {bio && (
          <section className="mt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t.bio}
            </h2>
            <p className="mt-3 max-w-2xl whitespace-pre-line leading-relaxed">
              {bio}
            </p>
          </section>
        )}

        {/* Companies */}
        {companies.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t.companies}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {companies.map((c, i) => (
                <li
                  key={`${c.name}-${i}`}
                  className="flex items-start gap-3 rounded-3xl border border-border bg-surface p-4 shadow-xs"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold">{c.name}</p>
                    {(c.role || c.year) && (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {[c.role, c.year].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t.achievements}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {achievements.map((a, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Award className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground" />
                  <span className="leading-relaxed">{a}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t.sources}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {sources.map((src, i) => (
                <li key={`${src}-${i}`}>
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Link2 className="h-4 w-4" />
                    {sourceHost(src) || t.sourceLink}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t.related}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {related.map((r) => {
                const rName =
                  lang === "en" ? r.name_en || r.name : r.name;
                return (
                  <Link
                    key={r.id}
                    href={`/${lang}/hub/leaders/${r.slug}`}
                    className="group flex flex-col items-center gap-3 rounded-3xl border border-border bg-surface p-5 text-center shadow-xs transition-colors hover:border-primary/40 hover:bg-surface-muted"
                  >
                    {r.photo_url ? (
                      <Image
                        src={r.photo_url}
                        alt={rName}
                        width={64}
                        height={64}
                        sizes="64px"
                        className="h-16 w-16 rounded-full object-cover ring-2 ring-surface"
                      />
                    ) : (
                      <InitialsAvatar
                        name={rName}
                        size="md"
                        className="ring-2 ring-surface"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-bold group-hover:text-primary">
                        {rName}
                      </p>
                      {r.headline && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {r.headline}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Back link */}
        <div className="mt-12">
          <Link
            href={`/${lang}/hub/leaders`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowPrev className="h-4 w-4" />
            {t.backToLeaders}
          </Link>
        </div>
      </Container>
    </div>
  );
}

// Show a clean host label for a source link (e.g. "forbesmiddleeast.com").
function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
