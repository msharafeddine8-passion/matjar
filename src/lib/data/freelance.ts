/**
 * Freelance, resolved person-first.
 *
 * The database models this section gig-first: `gigs` carries `freelancer_id`
 * AND a denormalised `freelancer_name`, and hangs `rating_avg`,
 * `rating_count` and `completed_count` off the SERVICE. Measured on production
 * today that produces exactly one visible consequence — the only freelancer on
 * the platform ("باشن", 8b6f9cdc…) appears as three unconnected adverts, in
 * three different regions, with no thread between them.
 *
 * Nothing in the schema has to change to fix that. The person is already in
 * `profiles`; the three gigs already point at them. This module is the join the
 * pages were missing: it resolves a lister into the shared
 * {@link ProfessionalProfile} shape from `src/lib/professional.ts` so the
 * freelance profile page and the crafts profile page render through the same
 * blocks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two rules, and they are the whole file
 *
 * 1. **Absent is absent.** `professional.ts` states it and every mapping here
 *    obeys it: a 0 completed_count becomes `null`, not `0`; a NULL rating_avg
 *    stays null; an empty `gallery` produces an empty portfolio and therefore
 *    no portfolio block. Nothing is filled in with a plausible default, because
 *    a plausible default on a trust surface is a lie the platform told.
 *
 * 2. **`profiles` is the identity, the gig copy is the fallback.**
 *    `gigs.freelancer_name` is a denormalised snapshot taken when the gig was
 *    posted. If the person renames themself, three adverts keep the old name.
 *    So the profile row wins wherever it has anything to say, exactly as
 *    `browse_gigs` already does server-side with its
 *    `coalesce(nullif(btrim(p.full_name), ''), g.freelancer_name)`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What is deliberately NOT mapped
 *
 * - `headline` — nothing in the schema holds one. Deriving "مصمّم" from the
 *   `design` category would be the platform putting words in someone's mouth.
 *   Their categories become `specialties`, which is a fact about their
 *   listings, and the headline stays null until they write one.
 * - `reviews` — there is no freelance review table at all. `craft_reviews`
 *   exists; nothing equivalent does here. So the array is empty, always, and
 *   the reviews block never renders.
 * - `yearsExperience`, `hours`, `trust.phoneVerified`, `trust.credentialVerified`,
 *   `trust.businessRegistered` — no columns behind any of them.
 * - The gig's cover `image_url` is NOT folded into the portfolio. It is the
 *   service's own thumbnail and the services block already shows it; copying it
 *   into a "أعمالي" grid would manufacture a portfolio out of three product
 *   photos. Only `gallery` — genuinely uploaded work samples — counts.
 */

import type {
  PortfolioItem,
  ProfessionalProfile,
  ProfessionalService,
} from "@/lib/professional";
import type { Locale } from "@/i18n/config";
import { regions } from "@/lib/catalog";

/** The row shape `browse_gigs` returns (migration 0215, re-stated in 0294). */
export type BrowsedGigRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  price: number | string | null;
  delivery_days: number | null;
  revisions: number | null;
  includes: string[] | null;
  image_url: string | null;
  gallery: string[] | null;
  region: string | null;
  created_at: string;
  available_until: string | null;
  completed_count: number | null;
  rating_avg: number | string | null;
  rating_count: number | null;
  freelancer_id: string;
  freelancer_name: string | null;
  freelancer_avatar: string | null;
  freelancer_verified: boolean | null;
  freelancer_since: string | null;
};

/** The row `public_lister_profile(uuid)` returns. */
export type ListerProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  skills: string[] | null;
  gig_count: number | null;
  languages: string[] | null;
  freelancer_verified: boolean | null;
  member_since: string | null;
};

/** numeric(…) arrives from PostgREST as a string. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A jsonb column that should hold string[] but can hold anything. */
function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/** Never render a zero — see rule 1. */
function positiveOrNull(n: number | null | undefined): number | null {
  return n != null && n > 0 ? n : null;
}

/**
 * Arabic counted nouns ("3 خدمة" → "3 خدمات"). The platform's one freelancer
 * has exactly 3 services and there is exactly 1 of him, so the two numbers on
 * screen were precisely the two the naive template rendered wrong. The helper
 * now lives in lib/plural.ts (pure, so client components can use it too) and
 * is re-exported here for the existing callers.
 */
export { countLabel, type CountForms } from "@/lib/plural";

/** Region key → the catalogue's label. One list, two languages. */
export function regionLabel(key: string | null, lang: Locale): string | null {
  if (!key) return null;
  return regions.find((r) => r.key === key)?.name[lang] ?? key;
}

/**
 * One gig → one service.
 *
 * The price is `from`, not `fixed`, because that is literally what the gig form
 * asks for ("السعر يبدأ من") and what every card has always labelled it. A gig
 * with no price yields `quote_required` rather than $0.
 */
export function gigToService(g: {
  id: string;
  title: string;
  description?: string | null;
  price: number | string | null;
  delivery_days: number | null;
  revisions?: number | null;
  includes?: string[] | null;
}): ProfessionalService {
  const amount = num(g.price);
  return {
    id: g.id,
    name: g.title,
    description: g.description?.trim() || null,
    price:
      amount != null && amount > 0
        ? { mode: "from", amount }
        : { mode: "quote_required" },
    deliveryDays: positiveOrNull(g.delivery_days),
    revisions: positiveOrNull(g.revisions ?? null),
    includes: strings(g.includes),
  };
}

/**
 * Their gigs' galleries → one portfolio, oldest gig first so the grid is
 * stable between renders. `viaMatjar` is never set: every one of these is a
 * self-uploaded image, and `professional.ts` reserves that flag for work that
 * came out of a completed Matjar job.
 */
export function gigsToPortfolio(
  gigs: { id: string; title: string; gallery?: string[] | null }[],
): PortfolioItem[] {
  const out: PortfolioItem[] = [];
  for (const g of gigs) {
    strings(g.gallery).forEach((url, i) => {
      out.push({ id: `${g.id}:${i}`, title: g.title, imageUrl: url });
    });
  }
  return out;
}

/**
 * The aggregate rating across a person's services.
 *
 * Weighted by each service's own count, so a 5.0 from one review cannot
 * outweigh a 4.2 from forty. Returns nulls when there is nothing — which is
 * every freelancer on the platform today.
 */
export function aggregateRating(
  gigs: { rating_avg: number | string | null; rating_count: number | null }[],
): { ratingAvg: number | null; ratingCount: number } {
  let weighted = 0;
  let count = 0;
  for (const g of gigs) {
    const avg = num(g.rating_avg);
    const n = g.rating_count ?? 0;
    if (avg != null && avg > 0 && n > 0) {
      weighted += avg * n;
      count += n;
    }
  }
  if (count === 0) return { ratingAvg: null, ratingCount: 0 };
  return { ratingAvg: Math.round((weighted / count) * 100) / 100, ratingCount: count };
}

/**
 * Resolve one person plus their gigs into the shared profile shape.
 *
 * `profile` may be null: `public_lister_profile` returns no row for a user with
 * no active gig, and it is also the only path an anonymous visitor has to a
 * profile row at all (profiles' RLS is own-row-only). When it is null the gigs
 * still carry a name, so the page can still be a page.
 */
export function toProfessionalProfile(
  id: string,
  profile: ListerProfileRow | null,
  gigs: BrowsedGigRow[],
  lang: Locale,
  /**
   * Category key → label, from `dict.freelance.categories`. Passed in rather
   * than imported: dictionaries are `server-only` and this module is also read
   * by the unit tests. Without it `specialties` would render the raw keys —
   * "design", "acting" — as English chips on an Arabic profile.
   */
  categoryLabels: Record<string, string> = {},
): ProfessionalProfile {
  const ordered = [...gigs].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );

  // Rule 2: the profile row is the identity; the denormalised gig copy is only
  // a fallback for a lister whose profile row we could not read.
  const name =
    profile?.full_name?.trim() ||
    ordered.find((g) => g.freelancer_name?.trim())?.freelancer_name?.trim() ||
    "";

  // Their own categories, most-listed first — a fact about what they offer,
  // not a headline the platform wrote for them.
  const catCounts = new Map<string, number>();
  for (const g of ordered) {
    if (g.category) catCounts.set(g.category, (catCounts.get(g.category) ?? 0) + 1);
  }
  const specialties = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => categoryLabels[c] ?? c);

  // Each gig names the region that service covers. The union is where this
  // person works — which is NOT an address, and §36 keeps it that way: region
  // labels only, never a street, never a phone.
  const areaKeys = [...new Set(ordered.map((g) => g.region).filter(Boolean))] as string[];
  const areas = areaKeys
    .map((k) => regionLabel(k, lang))
    .filter((s): s is string => Boolean(s));

  const { ratingAvg, ratingCount } = aggregateRating(ordered);
  const completed = ordered.reduce((sum, g) => sum + (g.completed_count ?? 0), 0);

  return {
    kind: "freelance",
    id,
    name,
    headline: null,
    bio: profile?.bio?.trim() || null,
    photoUrl: profile?.avatar_url ?? null,
    specialties,
    skills: strings(profile?.skills),
    languages: strings(profile?.languages),
    yearsExperience: null,
    trust: {
      // The one badge that exists without a transaction behind it. A paid plan
      // is not verification and is deliberately not merged in here.
      identityVerified: Boolean(profile?.freelancer_verified),
    },
    area: { areas },
    services: ordered.map((g) => gigToService(g)),
    portfolio: gigsToPortfolio(ordered),
    reviews: [],
    ratingAvg,
    ratingCount,
    completedCount: positiveOrNull(completed),
    hours: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Discovery: the same rows, grouped by person rather than listed as adverts.  */

export type FreelancePerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  memberSince: string | null;
  /** Distinct gig categories, most-listed first. */
  categories: string[];
  /** Distinct region keys across their services. */
  regionKeys: string[];
  /** Their services, newest first — the card shows the first two. */
  gigs: BrowsedGigRow[];
  /** Cheapest honest starting price across their services, or null. */
  fromPrice: number | null;
  /** Aggregated across their services. Null / 0 when nothing is earned yet. */
  ratingAvg: number | null;
  ratingCount: number;
  completedCount: number | null;
  /** Cover images of their services, used as the card's proof strip. */
  covers: string[];
};

/**
 * Group `browse_gigs` rows into people, preserving the RPC's own ordering.
 *
 * The RPC already sorts verified → available → most completed → newest. Taking
 * first-appearance order therefore carries that ranking onto the people list
 * for free, which is what keeps "person-first" from meaning "re-sorted by
 * something arbitrary in JavaScript".
 */
export function groupGigsByPerson(rows: BrowsedGigRow[]): FreelancePerson[] {
  const byId = new Map<string, FreelancePerson>();

  for (const g of rows) {
    let p = byId.get(g.freelancer_id);
    if (!p) {
      p = {
        id: g.freelancer_id,
        name: g.freelancer_name?.trim() || "",
        avatarUrl: g.freelancer_avatar,
        verified: Boolean(g.freelancer_verified),
        memberSince: g.freelancer_since,
        categories: [],
        regionKeys: [],
        gigs: [],
        fromPrice: null,
        ratingAvg: null,
        ratingCount: 0,
        completedCount: null,
        covers: [],
      };
      byId.set(g.freelancer_id, p);
    }
    p.gigs.push(g);
    if (g.category && !p.categories.includes(g.category)) p.categories.push(g.category);
    if (g.region && !p.regionKeys.includes(g.region)) p.regionKeys.push(g.region);
    if (g.image_url && !p.covers.includes(g.image_url)) p.covers.push(g.image_url);
  }

  for (const p of byId.values()) {
    const prices = p.gigs
      .map((g) => num(g.price))
      .filter((n): n is number => n != null && n > 0);
    p.fromPrice = prices.length ? Math.min(...prices) : null;
    const agg = aggregateRating(p.gigs);
    p.ratingAvg = agg.ratingAvg;
    p.ratingCount = agg.ratingCount;
    p.completedCount = positiveOrNull(
      p.gigs.reduce((sum, g) => sum + (g.completed_count ?? 0), 0),
    );
  }

  return [...byId.values()];
}

/**
 * A grouped person → the shared profile shape, for the person card.
 *
 * `browse_gigs` has already done the coalesce that rule 2 describes — its
 * `freelancer_name` column IS `profiles.full_name` when the profile row has
 * one — so the row's freelancer_* fields are a faithful stand-in for the
 * profile row here, and the list page does not need N calls to
 * `public_lister_profile` to render N cards.
 *
 * Bio, skills and languages are genuinely not in the list payload, so they stay
 * empty and the card simply has less to show than the profile page. That is the
 * correct outcome: a card that invented a bio would be a card that lies.
 */
export function personToProfile(
  p: FreelancePerson,
  lang: Locale,
  categoryLabels: Record<string, string> = {},
): ProfessionalProfile {
  return toProfessionalProfile(
    p.id,
    {
      id: p.id,
      full_name: p.name || null,
      avatar_url: p.avatarUrl,
      bio: null,
      skills: null,
      gig_count: p.gigs.length,
      languages: null,
      freelancer_verified: p.verified,
      member_since: p.memberSince,
    },
    p.gigs,
    lang,
    categoryLabels,
  );
}

/**
 * Which discovery filters are worth offering.
 *
 * `lib/freelancer-trust.ts` already answers this for the gig list and its rule
 * is the right one — a filter that returns nothing says more about the platform
 * than about the query. This is the person-first restatement of it, and it is
 * deliberately stricter in one place: a control only appears once it can
 * actually SPLIT the list. With one freelancer holding every gig, "verified
 * only" either keeps everyone or empties the page; neither is a filter.
 */
export type PeopleFilterKey = "category" | "region" | "verified" | "available";

export function visiblePeopleFilters(input: {
  /** Distinct people in the unfiltered list. */
  people: number;
  facets: {
    verified?: number;
    available?: number;
    categories?: Record<string, number>;
    regions?: Record<string, number>;
  };
}): PeopleFilterKey[] {
  const { people, facets } = input;
  const out: PeopleFilterKey[] = [];
  if (Object.keys(facets.categories ?? {}).length >= 2) out.push("category");
  if (Object.keys(facets.regions ?? {}).length >= 2) out.push("region");
  // Both of these partition PEOPLE, so they need at least two people to
  // partition. A "موثّق فقط" chip on a page with one freelancer is a switch
  // between the whole list and an empty one.
  if (people >= 2 && (facets.verified ?? 0) >= 1) out.push("verified");
  if (people >= 2 && (facets.available ?? 0) >= 1) out.push("available");
  return out;
}
