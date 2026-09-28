// Customer source attribution — which surface brought a customer to a store.
//
// PURE: no window, no storage, no network. The browser side lives in
// src/lib/attribution-client.ts; the database side in migration 0312
// (orders.source, bookings.source, tag_order_source, tag_booking_source,
// store_attribution_report). This file is the one place the vocabulary and the
// rules are written down, and src/lib/__tests__/attribution.test.ts pins them.
//
// REPORTING ONLY. Matjar charges 0% commission; nothing here computes or
// implies a fee. The point is to show a merchant, honestly, what Matjar did
// for them — so an unknown source stays "unknown" and is never guessed.

export const ATTRIBUTION_SOURCES = [
  "matjar_directory",
  "matjar_search",
  "matjar_map",
  "sunday_market",
  "offers_page",
  "direct_link",
  "instagram",
  "whatsapp",
  "google",
  "unknown",
] as const;

export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

/** The sources that count as "Matjar brought you this customer" — Matjar's own
 *  discovery surfaces. Nothing else does: a direct link, Instagram, WhatsApp
 *  or Google is the merchant's own reach (or Google's), not Matjar's. */
export const MATJAR_SOURCES = [
  "matjar_directory",
  "matjar_search",
  "matjar_map",
  "sunday_market",
  "offers_page",
] as const satisfies readonly AttributionSource[];

export type MatjarSource = (typeof MATJAR_SOURCES)[number];

export function isAttributionSource(v: unknown): v is AttributionSource {
  return (
    typeof v === "string" &&
    (ATTRIBUTION_SOURCES as readonly string[]).includes(v)
  );
}

export function isMatjarSource(v: unknown): v is MatjarSource {
  return (
    typeof v === "string" && (MATJAR_SOURCES as readonly string[]).includes(v)
  );
}

/** First- and last-touch memory lasts 30 days, per store. */
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Stores remembered per browser, most recently touched kept. */
export const MAX_REMEMBERED_STORES = 50;
/** Mirrors the 160-char column CHECK; the client keeps it shorter. */
export const DETAIL_MAX = 120;

// ---------------------------------------------------------------------------
// Detail sanitising — the same character class public.attribution_detail keeps
// ---------------------------------------------------------------------------

/** Keeps only what a UTM value, a host name or a source token needs. Arabic,
 *  spaces, @, quotes and everything else are dropped, which is what makes a
 *  name, a phone with a "+", an email or a sentence impossible to carry. */
export function sanitizeDetail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[^A-Za-z0-9_.:=;,/+-]/g, "").slice(0, DETAIL_MAX);
  return s || null;
}

// ---------------------------------------------------------------------------
// Internal navigation path -> Matjar surface
// ---------------------------------------------------------------------------

/** First path segment after the locale → Matjar surface. The home page is the
 *  directory's front door (it lists stores and sectors), so it counts as the
 *  directory. Anything not listed is NOT a Matjar discovery surface. */
const SURFACE_BY_SEGMENT: Record<string, MatjarSource> = {
  "": "matjar_directory",
  explore: "matjar_directory",
  category: "matjar_directory",
  categories: "matjar_directory",
  merchants: "matjar_directory",
  "best-sellers": "matjar_directory",
  hub: "matjar_directory",
  search: "matjar_search",
  map: "matjar_map",
  market: "sunday_market",
  offers: "offers_page",
  flash: "offers_page",
  clearance: "offers_page",
};

/** The first path segment after an optional /ar or /en prefix, lowercased. */
export function firstSegment(pathname: string): string {
  const clean = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] === "ar" || parts[0] === "en") parts.shift();
  return (parts[0] ?? "").toLowerCase();
}

/** The Matjar surface a same-site page belongs to, or null when it is not one
 *  (a store, a product, the cart, an account page…). */
export function sourceFromInternalPath(pathname: string): MatjarSource | null {
  return SURFACE_BY_SEGMENT[firstSegment(pathname)] ?? null;
}

// ---------------------------------------------------------------------------
// UTM and referrer
// ---------------------------------------------------------------------------

/** utm_source value → source. Only spellings that unambiguously name one of
 *  our buckets; anything else (facebook, tiktok, a newsletter) is not guessed. */
export function sourceFromUtm(utmSource: string): AttributionSource | null {
  const v = utmSource.trim().toLowerCase();
  if (!v) return null;
  if (["instagram", "ig", "insta", "instagram_bio", "instagram_story"].includes(v))
    return "instagram";
  if (["whatsapp", "wa", "whats_app", "whatsapp_status", "wa_status"].includes(v))
    return "whatsapp";
  if (["google", "google_ads", "googleads", "gmb", "google_business", "google_maps"].includes(v))
    return "google";
  return null;
}

/** Host (or Android app id from an android-app:// referrer) → source. */
export function sourceFromHost(host: string): AttributionSource | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)google\.[a-z.]+$/.test(h) || h === "com.google.android.googlequicksearchbox")
    return "google";
  if (/(^|\.)instagram\.com$/.test(h) || h === "com.instagram.android")
    return "instagram";
  if (h === "wa.me" || /(^|\.)whatsapp\.(com|net)$/.test(h) || h === "com.whatsapp")
    return "whatsapp";
  return null;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export type Resolved = { source: AttributionSource; detail: string | null };

/**
 * Where did the visitor who is looking at this store page come from?
 *
 *   1. UTM on the store URL itself (a link the merchant shared). A known
 *      utm_source maps to its bucket; an unknown one is `unknown` with the
 *      value kept in the detail.
 *   2. The previous page in this tab, when it was on Matjar: the surface it
 *      belongs to (/search → matjar_search …). A Matjar page that is not a
 *      discovery surface (another store, the cart) is `unknown` — Matjar
 *      probably helped, but "probably" is a guess.
 *   3. document.referrer, on the first page of a visit: Matjar's own host is
 *      treated like 2; Google / Instagram / WhatsApp map; anything else is
 *      `unknown` with the host in the detail.
 *   4. No referrer and no previous page: `direct_link` (typed, bookmarked, or
 *      opened from an app that strips the referrer — WhatsApp often does,
 *      which is why WhatsApp shares should carry utm_source=whatsapp).
 */
export function resolveSource(input: {
  /** The full current URL (location.href). */
  href: string;
  /** document.referrer ('' when none). */
  referrer: string;
  /** The previous same-tab pathname on Matjar, or null on a landing page. */
  previousPath: string | null;
  /** Hosts that are Matjar itself (location.host, matjarlb.com…). */
  ownHosts: readonly string[];
}): Resolved {
  const own = new Set(input.ownHosts.map((h) => h.toLowerCase().replace(/^www\./, "")));

  // 1. UTM
  const here = parseUrl(input.href);
  const utmSource = here?.searchParams.get("utm_source") ?? "";
  if (utmSource.trim()) {
    const campaign = here?.searchParams.get("utm_campaign") ?? "";
    const medium = here?.searchParams.get("utm_medium") ?? "";
    const detail = sanitizeDetail(
      [
        `utm=${utmSource.slice(0, 30)}`,
        medium ? `m=${medium.slice(0, 30)}` : "",
        campaign ? `c=${campaign.slice(0, 40)}` : "",
      ]
        .filter(Boolean)
        .join(";"),
    );
    return { source: sourceFromUtm(utmSource) ?? "unknown", detail };
  }

  // 2. The previous page in this tab
  if (input.previousPath) {
    const s = sourceFromInternalPath(input.previousPath);
    if (s) return { source: s, detail: null };
    return {
      source: "unknown",
      detail: sanitizeDetail(`from=${firstSegment(input.previousPath) || "home"}`),
    };
  }

  // 3. The referrer of a landing page
  const ref = input.referrer ? parseUrl(input.referrer) : null;
  if (ref) {
    const host =
      ref.protocol === "android-app:" ? ref.host || ref.pathname.replace(/^\/+/, "").split("/")[0] : ref.host;
    const bare = (host ?? "").toLowerCase().replace(/^www\./, "");
    if (bare && own.has(bare)) {
      const s = sourceFromInternalPath(ref.pathname);
      if (s) return { source: s, detail: null };
      return {
        source: "unknown",
        detail: sanitizeDetail(`from=${firstSegment(ref.pathname) || "home"}`),
      };
    }
    const s = bare ? sourceFromHost(bare) : null;
    if (s) return { source: s, detail: null };
    return { source: "unknown", detail: sanitizeDetail(bare ? `ref=${bare}` : null) };
  }
  if (input.referrer) {
    // A referrer that is not a URL — say so, never guess.
    return { source: "unknown", detail: null };
  }

  // 4. Nothing at all
  return { source: "direct_link", detail: null };
}

// ---------------------------------------------------------------------------
// First- and last-touch memory, per store (a pure reducer over plain JSON)
// ---------------------------------------------------------------------------

export type Touch = { s: AttributionSource; d: string | null; t: number };
export type StoreTouches = { f: Touch; l: Touch };
export type TouchState = Record<string, StoreTouches>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isTouch(v: unknown): v is Touch {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    isAttributionSource(o.s) &&
    (o.d === null || typeof o.d === "string") &&
    typeof o.t === "number" &&
    Number.isFinite(o.t)
  );
}

/** Parses what localStorage held. Anything malformed is dropped entry by
 *  entry; garbage in the whole value is an empty state, never an error. */
export function parseTouchState(raw: string | null | undefined): TouchState {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: TouchState = {};
  for (const [id, entry] of Object.entries(v as Record<string, unknown>)) {
    if (!UUID_RE.test(id) || !entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (isTouch(e.f) && isTouch(e.l)) out[id] = { f: e.f, l: e.l };
  }
  return out;
}

const WEAK: readonly AttributionSource[] = ["direct_link", "unknown"];

/**
 * Records a touch for a store.
 *
 *   first touch — the first touch inside the 30-day window; kept until it
 *                 ages out.
 *   last touch  — the latest touch, EXCEPT that a weak touch (direct_link or
 *                 unknown) does not overwrite a specific one still inside the
 *                 window: someone who found the shop through Matjar search
 *                 and came back a week later from a bookmark was still brought
 *                 by search ("last non-direct touch").
 *
 * Expired entries are pruned and at most MAX_REMEMBERED_STORES are kept.
 */
export function recordTouch(
  state: TouchState,
  storeId: string,
  resolved: Resolved,
  now: number,
): TouchState {
  if (!UUID_RE.test(storeId)) return state;
  const cutoff = now - ATTRIBUTION_WINDOW_MS;
  const touch: Touch = {
    s: resolved.source,
    d: sanitizeDetail(resolved.detail),
    t: now,
  };

  const next: TouchState = {};
  for (const [id, e] of Object.entries(state)) {
    if (e.l.t >= cutoff) next[id] = e;
  }

  const prev = next[storeId];
  if (!prev) {
    next[storeId] = { f: touch, l: touch };
  } else {
    const f = prev.f.t >= cutoff ? prev.f : touch;
    const keepLast = WEAK.includes(touch.s) && !WEAK.includes(prev.l.s);
    next[storeId] = { f, l: keepLast ? prev.l : touch };
  }

  const ids = Object.keys(next);
  if (ids.length <= MAX_REMEMBERED_STORES) return next;
  const keep = ids
    .sort((a, b) => next[b].l.t - next[a].l.t)
    .slice(0, MAX_REMEMBERED_STORES);
  const capped: TouchState = {};
  for (const id of keep) capped[id] = next[id];
  return capped;
}

/**
 * What to tag an order or booking at this store with: the last touch, with
 * the first touch appended to the detail when it differs. No touch in the
 * window means `unknown` — never a guess.
 */
export function attributionFor(
  state: TouchState,
  storeId: string,
  now: number,
): Resolved {
  const e = state[storeId];
  if (!e || e.l.t < now - ATTRIBUTION_WINDOW_MS) {
    return { source: "unknown", detail: "no_touch" };
  }
  const firstValid = e.f.t >= now - ATTRIBUTION_WINDOW_MS;
  const parts = [
    e.l.d ?? "",
    firstValid && e.f.s !== e.l.s ? `first=${e.f.s}` : "",
  ].filter(Boolean);
  return { source: e.l.s, detail: sanitizeDetail(parts.join(";")) };
}

// ---------------------------------------------------------------------------
// The Beirut month
// ---------------------------------------------------------------------------

const BEIRUT_YM = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Beirut",
  year: "numeric",
  month: "2-digit",
});

/** The calendar month in Lebanon as 'YYYY-MM' — a shop's month is Beirut's,
 *  not the server's UTC month (the same rule as beirutClock in hours.ts). */
export function beirutMonth(now: Date): string {
  let y = "";
  let m = "";
  for (const p of BEIRUT_YM.formatToParts(now)) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
  }
  return `${y}-${m}`;
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 'YYYY-MM' → the month before it. */
export function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** 'YYYY-MM' → the month after it. */
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** "أيلول 2026" / "September 2026", Western digits in both locales. */
export function monthLabel(month: string, lang: "ar" | "en"): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Which Arabic count form a number of customers takes (English uses "one"
 *  and "many" only; the dictionary gives it the same text for the rest). */
export function countForm(n: number): "one" | "two" | "few" | "many" {
  if (n === 1) return "one";
  if (n === 2) return "two";
  if (n >= 3 && n <= 10) return "few";
  return "many";
}

// ---------------------------------------------------------------------------
// The report, as the dashboard reads it
// ---------------------------------------------------------------------------

/** One row of public.store_attribution_report, as PostgREST returns it
 *  (numeric can arrive as a string). */
export type ReportRowRaw = {
  src: string;
  n_orders: number | string | null;
  n_bookings: number | string | null;
  new_customers: number | string | null;
  returning_count: number | string | null;
  unidentified_count: number | string | null;
  new_value_usd: number | string | null;
  new_value_lbp: number | string | null;
  value_usd: number | string | null;
  value_lbp: number | string | null;
};

export type ReportRow = {
  /** A known source, or "untagged" for rows placed before tagging existed. */
  src: AttributionSource | "untagged";
  orders: number;
  bookings: number | null;
  newCustomers: number;
  returning: number;
  unidentified: number;
  newValueUsd: number;
  newValueLbp: number;
  valueUsd: number;
  valueLbp: number;
};

export type ReportSummary = {
  /** Only MATJAR_SOURCES. */
  matjarNewCustomers: number;
  matjarNewValueUsd: number;
  matjarNewValueLbp: number;
  matjarOrders: number;
  matjarBookings: number | null;
  totalOrders: number;
  totalBookings: number | null;
  totalNewCustomers: number;
  rows: ReportRow[];
};

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function summarizeReport(raw: readonly ReportRowRaw[]): ReportSummary {
  const rows: ReportRow[] = [];
  for (const r of raw) {
    const src = isAttributionSource(r.src) ? r.src : r.src === "untagged" ? "untagged" : null;
    if (!src) continue;
    rows.push({
      src,
      orders: num(r.n_orders),
      bookings: r.n_bookings === null || r.n_bookings === undefined ? null : num(r.n_bookings),
      newCustomers: num(r.new_customers),
      returning: num(r.returning_count),
      unidentified: num(r.unidentified_count),
      newValueUsd: num(r.new_value_usd),
      newValueLbp: num(r.new_value_lbp),
      valueUsd: num(r.value_usd),
      valueLbp: num(r.value_lbp),
    });
  }
  rows.sort(
    (a, b) =>
      b.newCustomers - a.newCustomers ||
      b.orders + (b.bookings ?? 0) - (a.orders + (a.bookings ?? 0)) ||
      a.src.localeCompare(b.src),
  );

  const matjar = rows.filter((r) => isMatjarSource(r.src));
  const bookingsKnown = rows.some((r) => r.bookings !== null);
  const sum = (list: ReportRow[], f: (r: ReportRow) => number) =>
    list.reduce((acc, r) => acc + f(r), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    matjarNewCustomers: sum(matjar, (r) => r.newCustomers),
    matjarNewValueUsd: round2(sum(matjar, (r) => r.newValueUsd)),
    matjarNewValueLbp: Math.round(sum(matjar, (r) => r.newValueLbp)),
    matjarOrders: sum(matjar, (r) => r.orders),
    matjarBookings: bookingsKnown ? sum(matjar, (r) => r.bookings ?? 0) : null,
    totalOrders: sum(rows, (r) => r.orders),
    totalBookings: bookingsKnown ? sum(rows, (r) => r.bookings ?? 0) : null,
    totalNewCustomers: sum(rows, (r) => r.newCustomers),
    rows,
  };
}
