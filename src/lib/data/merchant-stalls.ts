import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/now";
import { toCategoryKey, type CategoryKey } from "@/lib/catalog";
import { categoryModule } from "@/lib/modules";
import { resolveStoreModules, sectorPrimarySetup } from "@/lib/sectors";
import { computeCompleteness } from "@/lib/completeness";
import type { FeatureModuleKey } from "@/lib/modules-catalog";
import { waLink } from "@/lib/phone";
import { SITE_URL } from "@/lib/site";
import {
  FETCH_BOUNDS,
  fetchAllByIds,
  fetchAllPages,
} from "@/lib/data/bounds";

// ===== Which merchants are stuck, at what stage, and for how long =====
//
// Counted on production, 2026-08-21, over the 15 ACTIVE stores:
//
//   • 4 have no catalogue at all — a customer who opens them finds a page with
//     nothing on it.
//   • 11 have never had an order, a booking or a request.
//   • every order on the platform belongs to 2 stores; every booking to 1.
//   • 8 of 15 have no map pin. All 15 have a phone number.
//
// None of that appears in an audit row, a report, or the attention queue. The
// queue answers "what is waiting on me" — approvals, unanswered orders, open
// reports — and by construction a merchant who has done nothing at all is
// waiting on nobody, so the one population that never generates an event is the
// one population the dashboard cannot see. Some of these shops signed up in
// June and have not touched their catalogue since; nothing anywhere said so.
//
// Three decisions this module makes, and why:
//
// 1. STAGE, NOT SCORE. "No catalogue" and "full catalogue, no customers" are
//    different problems needing different sentences — a merchant with nothing
//    to sell must never be told to share their link, and a merchant whose shop
//    is finished must not be told to add products they already added. One
//    number would have averaged the two into a message that fits neither. The
//    ladder and its threshold are the merchant dashboard's own, read out of
//    completeness.ts rather than restated here (see CATALOGUE_TARGET).
//
// 2. A GRACE WINDOW PER STAGE. A shop that opened on Tuesday with no products
//    is not stuck, it is new; a shop that opened in June and stopped is. So a
//    store enters the list only once it has been in its stage longer than that
//    stage deserves. Without this the list is 12 rows on a platform with 15
//    stores, which is another way of saying it is not a list at all.
//
// 3. READ-ONLY, ONE TAP. Every row hands the owner a wa.me link with a
//    prefilled Arabic message he can edit before sending. Nothing here writes,
//    nothing here sends, and there is deliberately no bulk action: the value of
//    this surface is that fifteen shopkeepers get fifteen different sentences,
//    which is exactly what a broadcast destroys.

/** How far along the ladder a shop has actually got.
 *
 *  Named for the merchant-facing vocabulary rather than for a severity: the
 *  point of the split is that each stage needs a different sentence, and a
 *  "critical / warning / info" scale cannot carry that. `publishStage` in
 *  store-onboarding.ts answers the neighbouring question — whether the shop is
 *  reachable at all — and is deliberately not duplicated here: this report only
 *  ever looks at stores that are already `live`. */
export type StallStage =
  /** Nothing to sell. A customer opening this store finds an empty page. */
  | "empty"
  /** Started, and stopped short of the size the dashboard calls finished. */
  | "thin"
  /** Catalogue finished, and not one customer has ever arrived. */
  | "quiet";

export type StalledMerchant = {
  id: string;
  name: string;
  stage: StallStage;
  category: CategoryKey;
  /** Products, rooms, ticket types or vehicles — whatever this sector sells. */
  offerings: number;
  /** The size at which the merchant's own checklist calls the catalogue done. */
  target: number;
  /** Whole days in this stage. See `stalledSince` for what starts the clock. */
  days: number;
  /** ISO date the clock started, so the UI can show the actual day. */
  since: string;
  /** Public storefront path, for the owner to open and see what a customer
   *  sees. Relative, so it works against whatever host the panel is on. */
  storePath: string;
  /** The same page as an absolute URL — this one goes INTO the message, so it
   *  has to be tappable from WhatsApp on someone else's phone. */
  storeUrl: string;
  /** wa.me link with the message below prefilled, or null with no usable
   *  number. Never auto-sent: opening WhatsApp is as far as this goes. */
  waHref: string | null;
  /** The sector uses the map AND this store has no pin — a real publish
   *  blocker (completeness.ts MAP_PIN), mentioned as a second ask only. */
  needsPin: boolean;
};

export type MerchantStalls = {
  /** Active, undeleted stores considered. */
  activeStores: number;
  /** Stores that cleared the whole ladder: catalogue done and a customer has
   *  arrived. Shown as a number so the list's absences are explainable. */
  working: number;
  /** Stores in a stage but still inside its grace window — new shops that are
   *  behaving normally. Counted, never listed. */
  inGrace: number;
  /** Everything past its grace window, in the order the owner should work. */
  rows: StalledMerchant[];
};

const DAY_MS = 86_400_000;

/**
 * How long a shop is allowed to sit in a stage before it is worth a phone call.
 *
 * Seven days for the two catalogue stages: a full trading week after the last
 * thing the merchant did is long enough that "they are still working on it" has
 * stopped being the likely explanation. Fourteen for `quiet`, because a shop
 * that finished its catalogue on Thursday and has no orders by Monday has not
 * told us anything — the platform has not had time to send it anybody.
 *
 * These are the one set of numbers here that are a judgement rather than a
 * measurement, and they are the numbers to move first if the list ever reads as
 * either nagging or empty.
 */
const GRACE_DAYS: Record<StallStage, number> = {
  empty: 7,
  thin: 7,
  quiet: 14,
};

/**
 * The catalogue size the merchant dashboard already calls "done".
 *
 * Read out of `computeCompleteness` rather than written down again. The number
 * is 3 today — completeness.ts: "Three is the point where a page stops looking
 * abandoned" — but a copy of it here is a copy that drifts, and the failure
 * mode of drift is the worst one this file has: the owner telling a merchant to
 * add a third item that their own dashboard already ticked off.
 */
export const CATALOGUE_TARGET = ((): number => {
  const blank = {
    logo: false,
    cover: false,
    description: false,
    hours: false,
    whatsapp: false,
    mapPin: false,
    brandColor: false,
    customLink: false,
    offerings: 0,
    offeringsWithCost: 0,
    providers: 0,
  };
  const done = (offerings: number): boolean =>
    computeCompleteness("retail", new Set<FeatureModuleKey>(), {
      ...blank,
      offerings,
    }).items.find((i) => i.key === "products")?.done ?? false;
  for (let n = 1; n <= 20; n++) if (done(n)) return n;
  // Unreachable while the rule is a threshold at all. Falling back to 1 keeps
  // the ladder honest rather than marking every shop permanently unfinished.
  return 1;
})();

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------
//
// Deliberately NOT in the dictionary, and deliberately Arabic in both locales.
//
// Everything else on this screen is read by the owner, who may be browsing in
// either language. This string is read by a Lebanese shopkeeper on WhatsApp. If
// it followed `dict`, an owner who happened to have the panel in English would
// send an English message to a merchant who does not read it — a bilingual
// dictionary would make that bug look like correct i18n. So the UI around it is
// translated properly and the outgoing text has exactly one form.
//
// Every number and name in it comes from a row this module read. Nothing is
// promised that the platform cannot show is true: no traffic figures, no
// ranking claims, no "customers are searching for you".

/** Lebanese plural agreement for the small counts this file actually renders.
 *  Arabic does not take a bare digit in front of a singular noun the way the
 *  English UI does, and "3 غرض" is the kind of sentence that tells a merchant
 *  a machine wrote it. */
function arCount(n: number, forms: [one: string, two: string, many: string]): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  return forms[2].replace("{n}", String(n));
}

function arDays(n: number): string {
  return arCount(n, ["يوم", "يومين", n <= 10 ? "{n} أيّام" : "{n} يوم"]);
}

/** The noun a sector's catalogue is counted in, taken from the two places that
 *  already decide it: `sectorPrimarySetup` for the sectors whose primary entity
 *  is not a product at all, and `categoryModule.itemsKey` — the same key the
 *  merchant's own "add" button is labelled from — for everything else. */
function offeringNoun(category: CategoryKey): [string, string, string] {
  const primary = sectorPrimarySetup(category);
  if (primary?.labelKey === "units") return ["غرفة وحدة", "غرفتين", "{n} غِرَف"];
  if (primary?.labelKey === "tickets")
    return ["نوع تذكرة واحد", "نوعين تذاكر", "{n} أنواع تذاكر"];
  if (primary?.labelKey === "vehicles")
    return ["سيّارة وحدة", "سيّارتين", "{n} سيّارات"];
  switch (categoryModule[category].itemsKey) {
    case "menu":
      return ["صنف واحد", "صنفين", "{n} أصناف"];
    case "services":
      return ["خدمة وحدة", "خدمتين", "{n} خدمات"];
    case "listings":
      return ["إعلان واحد", "إعلانين", "{n} إعلانات"];
    default:
      return ["غرض واحد", "غرضين", "{n} أغراض"];
  }
}

const PIN_LINE =
  "وكمان محلّك مش محدّد عالخريطة — ابعتلي اللوكيشن وبثبّتو، هيك بتطلع للناس يلي عم يدوّرو عالأقرب إلهن.";

/**
 * The prefilled WhatsApp text for one merchant, in Lebanese Arabic.
 *
 * One shopkeeper to another: it opens with what was noticed, says the one thing
 * worth doing, and offers to do it with them. It is not a notification and does
 * not read like one.
 *
 * The map pin is appended to `thin` and `quiet` only. A merchant with an empty
 * page is asked for exactly one thing — the same rule `isFirstRun` follows in
 * store-onboarding.ts, for the same reason: a person handed two tasks when they
 * have done none does neither.
 */
export function stallMessage(row: {
  name: string;
  stage: StallStage;
  category: CategoryKey;
  offerings: number;
  target: number;
  days: number;
  storeUrl: string | null;
  needsPin: boolean;
}): string {
  const noun = offeringNoun(row.category);
  const have = arCount(row.offerings, noun);
  const goal = arCount(row.target, noun);
  const days = arDays(row.days);
  const hi = `مرحبا ${row.name.trim()}، أنا من منصّة متجر.`;

  if (row.stage === "empty") {
    return [
      hi,
      `صفحتكن عنّا مفتوحة صار إلها ${days} وبعدها فاضية — يعني يلي بيفوت عليها ما بيلاقي شي يشوفو.`,
      `${arCount(1, noun)} بيكفّي لتبلّش: صورة، اسم، وسعر.`,
      "إذا ما عندك وقت، ابعتلي الصور والأسعار عالواتساب وأنا بجهّزلك ياهن.",
    ].join("\n");
  }

  if (row.stage === "thin") {
    return [
      hi,
      `عندك ${have} عالصفحة، وآخر شي ضفتو صارلو ${days}.`,
      `كمّلها لـ${goal} وبتبطّل الصفحة تبيّن فاضية — هيدا يلي منحسبو عنّا متجر جاهز.`,
      "في شي واقفك؟ قلّي وبساعدك تخلّصها.",
      row.needsPin ? PIN_LINE : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    hi,
    `صفحتكن جاهزة وعليها ${have}. صار ${days} من آخر شي ضفتو، ولسا ما وصلكن ولا زبون من عنّا.`,
    row.storeUrl ? `هيدا رابط محلّك: ${row.storeUrl}` : "",
    "حطّو بستوري الواتساب وبالبيو تبع الإنستغرام — الزباين يلي بيعرفوكن هنّي أوّل يلي بيطلبو. ونحنا عم نشتغل من جهتنا نجيبلكن ناس جداد.",
    row.needsPin ? PIN_LINE : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * What an afternoon of the owner's time is worth at each stage.
 *
 *   thin  — one or two items short of the line the platform itself draws.
 *           Somebody is demonstrably still there; the owner adding two photos
 *           with them turns a half-shop into a shop. Best return there is.
 *   quiet — nothing is missing on the merchant's side at all. The bottleneck is
 *           demand, which is the platform's problem more than the shopkeeper's,
 *           and no amount of phoning fixes it faster. Worth a message, not an
 *           afternoon.
 *   empty — never added a thing. Lowest chance that any call changes it, and
 *           the most expensive to change if it does.
 */
const STAGE_RANK: Record<StallStage, number> = { thin: 0, quiet: 1, empty: 2 };

// Within a stage: longest stuck first. The tempting alternative — freshest
// first, because a merchant who was active last week is likelier to answer —
// reproduces exactly the blindness this page exists to fix. The shops nobody
// has called are the old ones, and they are old precisely because every surface
// so far has sorted them to the bottom.
export function compareStalls(
  a: Pick<StalledMerchant, "stage" | "days" | "name">,
  b: Pick<StalledMerchant, "stage" | "days" | "name">,
): number {
  const s = STAGE_RANK[a.stage] - STAGE_RANK[b.stage];
  if (s !== 0) return s;
  if (b.days !== a.days) return b.days - a.days;
  return a.name.localeCompare(b.name, "ar");
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

type StoreRow = {
  id: string;
  name: string;
  slug: string | null;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  status_changed_at: string | null;
  business_types: { slug: string } | null;
};

type OfferingRow = { store_id: string; created_at: string };

/** Whatever this sector's catalogue actually lives in. Spelled out as literals
 *  rather than passed around as a string so that every one of the four reads
 *  below is a `.from("…")` the data-contract test can see and check the bound
 *  on — a `.from(table)` is invisible to it, and an invisible query is exactly
 *  what that test exists to prevent. */
type OfferingTable =
  | "products"
  | "accommodation_units"
  | "event_ticket_types"
  | "rental_vehicles";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Catalogue rows for a set of stores that share one primary table.
 *
 *  `products` is the only one of the four that is soft-deleted, and it is
 *  counted the way store-readiness.ts counts it — every non-deleted row,
 *  whatever its publication status — so the number the owner reads here and the
 *  number on the merchant's own dashboard can never disagree. */
function readOfferings(
  supabase: Supabase,
  table: OfferingTable,
  ids: string[],
): Promise<OfferingRow[]> {
  return fetchAllByIds<OfferingRow>(
    ids,
    (chunk, from, to) => {
      const cols = "store_id, created_at";
      if (table === "accommodation_units") {
        return supabase
          .from("accommodation_units")
          .select(cols)
          .in("store_id", chunk)
          .order("store_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
      }
      if (table === "event_ticket_types") {
        return supabase
          .from("event_ticket_types")
          .select(cols)
          .in("store_id", chunk)
          .order("store_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
      }
      if (table === "rental_vehicles") {
        return supabase
          .from("rental_vehicles")
          .select(cols)
          .in("store_id", chunk)
          .order("store_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
      }
      return supabase
        .from("products")
        .select(cols)
        .in("store_id", chunk)
        .is("deleted_at", null)
        .order("store_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    },
    FETCH_BOUNDS.adminStallOfferings,
    `${table} (admin stall report)`,
  );
}

/** Every store id that has ever had a customer arrive through the platform.
 *
 *  Three tables. `orders` and `bookings` are the two the owner measures on;
 *  `service_requests` is here because leaving it out made one live store — a
 *  salon with a real request sitting in its inbox — read as "nobody has ever
 *  come", which is the one thing a message must never say to a merchant who
 *  knows better.
 *
 *  Not counted, and deliberately: pos_sales (a sale the merchant rang up in the
 *  shop, not one the platform sent them), stay_bookings, rental_bookings,
 *  event_tickets, craft_requests, delivery_requests. Checked on production on
 *  2026-08-21: not one row in any of them belongs to an active store, so today
 *  the omission changes no row on this screen. The day a hotel or a car-rental
 *  yard goes active, this is the list that has to grow.
 *
 *  Only the id is read, never a count: the question is "has anyone ever
 *  arrived", and a shop's second order is not this screen's business. */
async function readServedStores(
  supabase: Supabase,
  ids: string[],
): Promise<Set<string>> {
  // Written out three times rather than looped over a table name, for the same
  // reason as readOfferings above: `.from(table)` hides the query from the
  // data-contract test that checks every read in this layer is bounded.
  const [orders, bookings, requests] = await Promise.all([
    fetchAllByIds<{ store_id: string }>(
      ids,
      (chunk, from, to) =>
        supabase
          .from("orders")
          .select("store_id")
          .in("store_id", chunk)
          .order("store_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      FETCH_BOUNDS.adminStallDemand,
      "orders (admin stall report)",
    ),
    fetchAllByIds<{ store_id: string }>(
      ids,
      (chunk, from, to) =>
        supabase
          .from("bookings")
          .select("store_id")
          .in("store_id", chunk)
          .order("store_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      FETCH_BOUNDS.adminStallDemand,
      "bookings (admin stall report)",
    ),
    fetchAllByIds<{ store_id: string }>(
      ids,
      (chunk, from, to) =>
        supabase
          .from("service_requests")
          .select("store_id")
          .in("store_id", chunk)
          .order("store_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      FETCH_BOUNDS.adminStallDemand,
      "service_requests (admin stall report)",
    ),
  ]);

  return new Set([...orders, ...bookings, ...requests].map((r) => r.store_id));
}

/**
 * The stalled-merchant report, or null when the caller may not be shown one.
 *
 * SUPER ADMIN ONLY, and not for tidiness. RLS on `orders`, `bookings` and
 * `service_requests` grants a platform-wide read to `is_super_admin()` and to
 * nobody else — a sub-admin granted the `stores` section reads those tables and
 * gets an empty set back, with no error and no flag, which would render every
 * shop on the platform as "not one customer has ever arrived". A quietly wrong
 * answer on a screen whose whole output is messages to real merchants is worse
 * than no screen, so the section is withheld instead. Matjar has exactly one
 * super admin today (the owner), so in practice nothing is hidden from anyone.
 */
export async function getMerchantStalls(
  lang: string,
): Promise<MerchantStalls | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "super_admin") return null;

  // Active stores only. A pending store is already the first thing on this
  // page and its problem is ours, not the merchant's; a suspended one has a
  // reason for being down that is not a missing product.
  const stores = await fetchAllPages<StoreRow>(
    (from, to) =>
      supabase
        .from("stores")
        .select(
          "id, name, slug, phone, whatsapp, lat, lng, created_at, status_changed_at, business_types(slug)",
        )
        .eq("status", "active")
        .is("deleted_at", null)
        .not("owner_id", "is", null) // a directory row has no merchant to stall
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        // supabase-js types every embed as an array; PostgREST returns a plain
        // object for a to-one FK, which is why `business_types` is read as one
        // here and at every other call site in this repo (admin/page.tsx,
        // store-readiness.ts). The cast is the shape correction, not a widening.
        .range(from, to) as unknown as PromiseLike<{ data: StoreRow[] | null }>,
    FETCH_BOUNDS.adminStores,
    "stores (admin stall report)",
  );

  if (stores.length === 0) {
    return { activeStores: 0, working: 0, inGrace: 0, rows: [] };
  }

  const ids = stores.map((s) => s.id);
  const category = new Map<string, CategoryKey>(
    stores.map((s) => [
      s.id,
      toCategoryKey(s.business_types?.slug, `store ${s.id}`),
    ]),
  );

  // Per-store module overrides, so a store that switched `location` off is not
  // told its map pin is missing. Public-readable, one bounded round trip.
  const moduleRows = await fetchAllByIds<{
    store_id: string;
    module_key: string;
    enabled: boolean;
  }>(
    ids,
    (chunk, from, to) =>
      supabase
        .from("store_modules")
        .select("store_id, module_key, enabled")
        .in("store_id", chunk)
        .order("store_id", { ascending: true })
        .order("module_key", { ascending: true })
        .range(from, to),
    FETCH_BOUNDS.adminStallModules,
    "store_modules (admin stall report)",
  );
  const overrides = new Map<string, Partial<Record<FeatureModuleKey, boolean>>>();
  for (const m of moduleRows) {
    const bag = overrides.get(m.store_id) ?? {};
    bag[m.module_key as FeatureModuleKey] = m.enabled;
    overrides.set(m.store_id, bag);
  }

  // Offerings. Most sectors sell `products`; a hotel's catalogue is its rooms,
  // an organiser's its ticket types, a rental yard's its vehicles — the same
  // rule store-readiness.ts follows, so a hotel with eight rooms is never told
  // it has an empty page. One read per table that is actually in play: with no
  // active store in those three sectors today, that is exactly one read.
  const byTable = new Map<OfferingTable, string[]>();
  for (const s of stores) {
    const primary = sectorPrimarySetup(category.get(s.id)!);
    const table = (primary?.table ?? "products") as OfferingTable;
    byTable.set(table, [...(byTable.get(table) ?? []), s.id]);
  }

  const offerings = new Map<string, { count: number; last: string }>();
  const catalogues = await Promise.all(
    [...byTable].map(([table, tableIds]) =>
      readOfferings(supabase, table, tableIds),
    ),
  );
  for (const r of catalogues.flat()) {
    const seen = offerings.get(r.store_id);
    offerings.set(r.store_id, {
      count: (seen?.count ?? 0) + 1,
      // The LAST thing this merchant added, which is what "when did they stop"
      // means. String compare is safe on ISO-8601 with a fixed offset, which is
      // what PostgREST returns for timestamptz.
      last: seen && seen.last > r.created_at ? seen.last : r.created_at,
    });
  }

  const served = await readServedStores(supabase, ids);

  const now = requestNow();
  const rows: StalledMerchant[] = [];
  let working = 0;
  let inGrace = 0;

  for (const s of stores) {
    const cat = category.get(s.id)!;
    const have = offerings.get(s.id);
    const count = have?.count ?? 0;

    const stage: StallStage =
      count === 0 ? "empty" : count < CATALOGUE_TARGET ? "thin" : "quiet";

    // A finished catalogue that has served somebody has cleared the ladder.
    // A thin or empty one still has a real, fixable gap whether or not a
    // customer happened to find it, so those stay listed either way — and
    // their message says nothing about orders, so nothing there can be wrong.
    if (stage === "quiet" && served.has(s.id)) {
      working++;
      continue;
    }

    // What started the clock. For a shop with nothing on it, the day customers
    // could first open it — because that is the day the empty page went up. For
    // the other two, the day the merchant last added anything: literally when
    // they stopped, which is the fact the owner said nobody had ever told him.
    const sinceMs =
      stage === "empty"
        ? Date.parse(s.status_changed_at ?? s.created_at)
        : Date.parse(have!.last);
    const days = Math.max(0, Math.floor((now - sinceMs) / DAY_MS));

    if (days < GRACE_DAYS[stage]) {
      inGrace++;
      continue;
    }

    const modules = resolveStoreModules(cat, overrides.get(s.id));
    const needsPin = modules.has("location") && (s.lat == null || s.lng == null);
    // Same fallback store-readiness.ts uses: the slug when there is one, the id
    // route when there is not. Every store here is active, so the page exists.
    const suffix = s.slug ?? `store/${s.id}`;
    // The owner opens the page in whatever locale he is reading the panel in;
    // the link INSIDE the message is pinned to Arabic, because it is a Lebanese
    // shopkeeper's own shop link and it will be forwarded on to their
    // customers. An English storefront reaching them because the admin happened
    // to have the panel in English is a bug that would look like correct i18n.
    const storePath = `/${lang}/${suffix}`;
    const storeUrl = `${SITE_URL}/ar/${suffix}`;

    const partial = {
      name: s.name,
      stage,
      category: cat,
      offerings: count,
      target: CATALOGUE_TARGET,
      days,
      storeUrl,
      needsPin,
    };

    const text = stallMessage(partial);
    rows.push({
      id: s.id,
      ...partial,
      storePath,
      since: new Date(sinceMs).toISOString().slice(0, 10),
      // WhatsApp number first, the shop line second — phone.ts returns null for
      // anything that cannot be dialled (all 15 active stores have a number
      // today, and several store it as 03709064, which is exactly the local
      // form waLink exists to fix), and the button is simply not rendered then.
      waHref: waLink(s.whatsapp, text) ?? waLink(s.phone, text),
    });
  }

  rows.sort(compareStalls);
  return { activeStores: stores.length, working, inGrace, rows };
}
