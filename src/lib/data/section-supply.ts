import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public-client";
import { MIN_NAV_ITEMS, hasEnough } from "@/lib/rail";
import { beirutYmd } from "@/lib/quick-panel";

// Whether a whole SECTION has enough behind it to be worth linking to.
//
// Matjar ships 65 customer routes. Several of them are verticals that were
// built before the supply existed and then linked from the header dropdown, the
// phone menu, the footer and the home page regardless — so a customer in
// testing could tap "صيانة وحِرَف" from four different places and reach a
// directory with zero tradesmen in it. That is not an empty state problem; four
// entrances to nothing is the platform telling the customer it is bigger than
// it is, and they only have to be disappointed once.
//
// The rule is not new. lib/rail.ts already refuses to draw a home rail under
// three real items; this applies the SAME constant one level up, to the links
// themselves. Nothing is deleted — every route still renders, still answers its
// own URL, and still turns up in search. It simply stops being advertised until
// it can answer.
//
// The counts are public, identical for everyone, and change on the timescale of
// a merchant signing up, so they are cached across requests exactly like the
// USD rate (lib/data/settings.ts) — a page render costs zero queries almost
// always, and at worst one round trip every ten minutes platform-wide.

/** The sections whose navigation entries are supply-gated. */
export type GatedSection =
  | "crafts"
  | "jobs"
  | "freelance"
  | "wholesale"
  | "delivery"
  | "market";

/** `true` = link it. Never used to decide whether the ROUTE exists. */
export type NavSections = Record<GatedSection, boolean>;

/**
 * How many real, browsable rows each gated section can return right now.
 *
 * Every predicate here is the one its own landing page uses, so the number
 * answers "what would the customer see if they tapped it?" and not "what is in
 * the table". Where the page reads through an RPC the filter is named:
 * browse_crafts (0241) and browse_gigs (0215) both select `status = 'active'`.
 */
const countSections = unstable_cache(
  async (): Promise<Record<GatedSection, number>> => {
    const supabase = createPublicClient();
    const n = async (
      table: string,
      column: string,
      value: string | boolean,
    ): Promise<number> => {
      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq(column, value);
      return count ?? 0;
    };

    // Jobs and the market carry more than a status: the board drops deleted
    // postings and ones past their deadline (jobs/(index) liveJobs), and a
    // seller's delete is a soft delete since 0313. Counting status alone kept
    // a section linked on the strength of rows its own page will not show.
    const today = beirutYmd(new Date());
    const liveJobs = async (): Promise<number> => {
      const { count } = await supabase
        .from("job_postings")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .is("deleted_at", null)
        .or(`apply_deadline.is.null,apply_deadline.gte.${today}`);
      return count ?? 0;
    };
    const liveListings = async (): Promise<number> => {
      const { count } = await supabase
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .is("deleted_at", null);
      return count ?? 0;
    };

    const [crafts, jobs, freelance, wholesale, delivery, market] =
      await Promise.all([
        n("craft_providers", "status", "active"),
        liveJobs(),
        n("gigs", "status", "active"),
        n("wholesale_products", "status", "active"),
        n("delivery_companies", "is_active", true),
        liveListings(),
      ]);

    return { crafts, jobs, freelance, wholesale, delivery, market };
  },
  ["nav_section_supply"],
  // Ten minutes. A section crossing the threshold is a good day, not an
  // emergency; the tags let a merchant-facing write bust it sooner where one
  // already exists.
  { revalidate: 600, tags: ["stores", "products", "listings"] },
);

/**
 * Which sections navigation may link to.
 *
 * A failed count reads as 0 and therefore as "do not link" — deliberately the
 * quiet direction. Advertising an empty vertical because a query timed out is
 * the exact failure this exists to prevent, and a missing footer link for ten
 * minutes costs a customer nothing they can notice.
 */
/**
 * The same counts, with the numbers kept, for the one person who needs to see
 * WHY a section is missing rather than just that it is.
 *
 * getNavSections answers a yes/no and throws the count away, which is correct
 * for rendering a header and wrong for everything else. The owner discovered
 * the jobs link had vanished by noticing a gap in his own site — nothing
 * anywhere said a section had been gated, or that it was one posting short.
 * A gate nobody can see is indistinguishable from a bug.
 */
export const getSectionSupply = cache(async function getSectionSupply(): Promise<
  { section: GatedSection; count: number; linked: boolean; needs: number }[]
> {
  const counts = await countSections();
  return (Object.keys(counts) as GatedSection[]).map((section) => ({
    section,
    count: counts[section],
    linked: hasEnough(counts[section]),
    needs: MIN_NAV_ITEMS,
  }));
});

export const getNavSections = cache(async function getNavSections(): Promise<
  NavSections
> {
  const counts = await countSections();
  return {
    // Always on, by the owner's decision on 2026-09-02, and against the rule
    // every other line here follows. The gate exists so a customer is never
    // sent to an empty browse page — and with craft_providers at 0 it hid
    // /crafts from the header, the menu, the footer and Home. That closed a
    // loop: the page where a tradesman signs up was reachable from nowhere,
    // so the count that would have opened the gate could never move.
    //
    // /crafts is also not an empty page the way an empty jobs board is. Its
    // zero state is a working funnel — describe the problem, or register a
    // trade — and it says the count out loud rather than hiding it. Sending
    // people there is the recruitment, not a dead end.
    crafts: true,
    jobs: hasEnough(counts.jobs),
    freelance: hasEnough(counts.freelance),
    wholesale: hasEnough(counts.wholesale),
    delivery: hasEnough(counts.delivery),
    market: hasEnough(counts.market),
  };
});
