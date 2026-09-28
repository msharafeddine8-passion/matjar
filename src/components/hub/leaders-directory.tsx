"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  Crown,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { ArrowNext } from "@/components/ui/directional-icon";
import type { LeaderCard } from "@/lib/leaders";
import { InitialsAvatar } from "@/components/hub/initials-avatar";

export type DirectoryLabels = {
  searchPlaceholder: string;
  allSectors: string;
  allRegions: string;
  featuredTitle: string;
  directoryTitle: string;
  countSuffix: string;
  noResults: string;
  clearFilters: string;
  viewProfile: string;
  featuredBadge: string;
};

export function LeadersDirectory({
  leaders,
  lang,
  t,
}: {
  leaders: LeaderCard[];
  lang: string;
  t: DirectoryLabels;
}) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [region, setRegion] = useState("");

  const displayName = (p: LeaderCard) =>
    lang === "en" ? p.name_en || p.name : p.name;
  const displayCompany = (p: LeaderCard) =>
    lang === "en" ? p.company_en || p.company : p.company;

  // Distinct sectors + regions, ordered by frequency (most common first).
  const sectors = useMemo(() => byFrequency(leaders.map((l) => l.sector)), [leaders]);
  const regions = useMemo(() => byFrequency(leaders.map((l) => l.location)), [leaders]);

  const q = query.trim().toLowerCase();
  const active = q.length > 0 || sector !== "" || region !== "";

  const filtered = useMemo(() => {
    return leaders.filter((p) => {
      if (sector && p.sector !== sector) return false;
      if (region && p.location !== region) return false;
      if (q) {
        const hay = [
          p.name,
          p.name_en,
          p.headline,
          p.company,
          p.company_en,
          p.sector,
          p.location,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leaders, sector, region, q]);

  const featured = useMemo(
    () => leaders.filter((l) => l.featured).slice(0, 6),
    [leaders],
  );

  return (
    <div id="directory" className="mt-12 scroll-mt-24">
      {/* Featured strip — only when the user hasn't started filtering */}
      {!active && featured.length > 0 && (
        <section className="mb-12">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <Crown className="h-5 w-5 text-accent-foreground" />
            {t.featuredTitle}
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p) => (
              <LeaderCardView
                key={p.id}
                p={p}
                lang={lang}
                t={t}
                name={displayName(p)}
                company={displayCompany(p)}
                highlight
              />
            ))}
          </div>
        </section>
      )}

      {/* Search + filters */}
      <div className="rounded-3xl border border-border bg-surface-muted/30 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4.5 w-4.5 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="h-11 w-full rounded-xl border border-border bg-surface ps-10 pe-3 text-sm outline-none transition-colors focus:border-primary/50"
            />
          </div>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="h-11 rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-colors focus:border-primary/50"
          >
            <option value="">{t.allSectors}</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Region quick chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={region === ""} onClick={() => setRegion("")}>
            {t.allRegions}
          </Chip>
          {regions.map((r) => (
            <Chip key={r} active={region === r} onClick={() => setRegion(r)}>
              {r}
            </Chip>
          ))}
        </div>
      </div>

      {/* Results header */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {t.directoryTitle}
          <span className="ms-2 text-foreground">
            {filtered.length} {t.countSuffix}
          </span>
        </h2>
        {active && (
          <button
            onClick={() => {
              setQuery("");
              setSector("");
              setRegion("");
            }}
            className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t.clearFilters}
          </button>
        )}
      </div>

      {/* Results grid */}
      {filtered.length > 0 ? (
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <LeaderCardView
              key={p.id}
              p={p}
              lang={lang}
              t={t}
              name={displayName(p)}
              company={displayCompany(p)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid place-items-center rounded-3xl border border-dashed border-border bg-surface-muted/20 p-12 text-center">
          <p className="text-muted-foreground">{t.noResults}</p>
        </div>
      )}
    </div>
  );
}

function LeaderCardView({
  p,
  lang,
  t,
  name,
  company,
  highlight,
}: {
  p: LeaderCard;
  lang: string;
  t: DirectoryLabels;
  name: string;
  company: string | null;
  highlight?: boolean;
}) {
  return (
    <Link
      href={`/${lang}/hub/leaders/${p.slug}`}
      className={`group flex flex-col rounded-3xl border bg-surface p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
        highlight
          ? "border-accent/40 bg-gradient-to-b from-accent/[0.06] to-transparent"
          : "border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-start gap-3.5">
        {p.photo_url ? (
          <Image
            src={p.photo_url}
            alt={name}
            width={64}
            height={64}
            sizes="64px"
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-surface"
          />
        ) : (
          <InitialsAvatar name={name} size="md" className="ring-2 ring-surface" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 font-bold leading-snug transition-colors group-hover:text-primary">
            <span className="truncate">{name}</span>
          </h3>
          {p.headline && (
            <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-primary">
              {p.headline}
            </p>
          )}
          {company && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{company}</span>
            </p>
          )}
        </div>
      </div>

      {/* Meta badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {p.sector && (
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            {p.sector}
          </span>
        )}
        {p.location && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {p.location}
          </span>
        )}
        {p.featured && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent-foreground">
            <Crown className="h-3 w-3" />
            {t.featuredBadge}
          </span>
        )}
      </div>

      {/* No "verified" mark: business_leaders has no verification field, and an
          admin publishing a profile is curation, not a check. See lib/trust.ts. */}
      <div className="mt-4 flex items-center justify-end border-t border-border/60 pt-3">
        <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
          {t.viewProfile} <ArrowNext className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
        active
          ? "bg-accent-strong text-accent-strong-foreground"
          : "border border-border bg-surface text-muted-foreground hover:border-accent/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// Distinct non-empty values ordered by how often they appear.
function byFrequency(values: (string | null)[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
