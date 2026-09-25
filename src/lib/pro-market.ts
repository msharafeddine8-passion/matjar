// ===========================================================================
// Professional marketplace — pure helpers for crafts and jobs (prelaunch
// phase 4). No IO, no React, no Supabase: everything here is testable with a
// fixture and none of it can invent a fact the database does not hold.
// ===========================================================================

import { AREA_BY_SLUG, TRADE_SLUGS, parseSearchIntent } from "@/lib/search-intent";

// ---------------------------------------------------------------------------
// Crafts — «شو خربان؟»
// ---------------------------------------------------------------------------

export type CraftProblemIntent = {
  /** A real public.trades slug, or null when the words named no trade. */
  trade: string | null;
  /** A real public.lb_areas slug, or null. */
  area: string | null;
};

/**
 * What a customer's own sentence says about the job, read with the SAME
 * lexicon the site search uses (src/lib/search-intent.ts) — not a second copy
 * of it. «بدي سنكري بطرابلس» → plumber + tripoli; «المكيف ما عم يبرد» →
 * ac-service; «etumax» → nothing, and nothing is guessed.
 *
 * It knows only what the lexicon knows. «الكهربا مقطوعة» resolves to no trade
 * today because «كهربا» is not an electrician trigger there — a lexicon entry
 * to add in search-intent.ts, not a synonym list to grow here.
 *
 * Only a trade slug in the 47-row taxonomy and an area slug in the 45-row
 * lb_areas list are returned, so the result can be put straight into a URL or
 * an RPC argument. A sector that is not a craft (a restaurant, a clinic) is
 * not a trade and yields null.
 */
export function craftIntentFromProblem(text: string | null | undefined): CraftProblemIntent {
  const raw = (text ?? "").trim();
  if (raw.length < 2) return { trade: null, area: null };
  const first = pick(parseSearchIntent(raw));
  if (first.trade && first.area) return first;
  // A second reading for the prepositions a problem SENTENCE carries and a
  // search box rarely does: «بطرابلس», «بالميناء», «عالبترون», «للبيت». The
  // attached prefix is split off as an extra copy of the word, and only the
  // fields the first reading left EMPTY are taken from this second reading, so
  // anything already understood keeps priority — «براد» is still a fridge, not
  // «راد». The copies go first because parseSearchIntent reads 100 characters.
  const words = raw.split(/\s+/);
  const extra: string[] = [];
  for (const w of words) {
    const m = /^(?:بال|عال|لل|ب|ع)(.{3,})$/.exec(w);
    if (m) extra.push(w.startsWith("بال") || w.startsWith("عال") ? `ال${m[1]}` : m[1]);
  }
  if (!extra.length) return first;
  const second = pick(parseSearchIntent([...extra, ...words].join(" ")));
  return { trade: first.trade ?? second.trade, area: first.area ?? second.area };
}

function pick(intent: { trade?: string; area?: string }): CraftProblemIntent {
  return {
    trade: intent.trade && TRADE_SLUGS.has(intent.trade) ? intent.trade : null,
    area: intent.area && AREA_BY_SLUG.has(intent.area) ? intent.area : null,
  };
}

// ---------------------------------------------------------------------------
// Jobs — dates, liveness, and which filters are worth drawing
// ---------------------------------------------------------------------------

/** Today's date in Beirut as YYYY-MM-DD. A deadline "today" is still open. */
export function beirutToday(now: number | Date = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/**
 * Whether a posting still takes applications. `apply_deadline` is a DATE
 * column (no time), compared as a string against Beirut's today — never
 * against UTC, which would close a Lebanese posting at 2 or 3 in the morning
 * of its own last day.
 */
export function isJobOpen(
  job: { status?: string | null; apply_deadline?: string | null },
  today: string,
): boolean {
  if (job.status != null && job.status !== "active") return false;
  const d = (job.apply_deadline ?? "").slice(0, 10);
  return !d || d >= today;
}

/**
 * A day as a Lebanese reader expects it: Western digits (the brief's rule —
 * `toLocaleDateString("ar")` can print Eastern Arabic ones), the Levantine
 * month names ar-LB carries (تموز, not يوليو), and the Beirut calendar day.
 *
 * Accepts a timestamp or a bare YYYY-MM-DD. A bare date is pinned to noon UTC
 * so the Beirut offset can never roll it onto the previous or next day.
 */
export function formatDay(iso: string, lang: string): string {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(bare ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    timeZone: "Asia/Beirut",
    day: "numeric",
    month: "short",
  }).format(d);
}

/**
 * Which filter rows the jobs board should draw.
 *
 * The rule the freelance page already follows (lib/data/freelance.ts,
 * visiblePeopleFilters): a control must be able to SPLIT the list. Five type
 * chips and six region chips over two postings — or over none, which is what
 * the page used to draw above its empty state — are eleven taps that lead to
 * the same list or to nothing. A row appears only when the live postings
 * carry at least two distinct values for it, and only values that have a
 * posting behind them are offered.
 */
export function visibleJobFilters(
  jobs: { job_type?: string | null; region?: string | null }[],
): { types: string[]; regions: string[] } {
  const distinct = (key: "job_type" | "region") => {
    const out: string[] = [];
    for (const j of jobs) {
      const v = j[key];
      if (v && !out.includes(v)) out.push(v);
    }
    return out.length >= 2 ? out : [];
  };
  return { types: distinct("job_type"), regions: distinct("region") };
}
