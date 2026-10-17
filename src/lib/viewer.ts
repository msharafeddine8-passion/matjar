// ===== The viewer: who is looking at the public chrome =====
//
// The (site) layout used to read the auth cookie itself, which made every
// public page — /about included — dynamic and uncacheable, and cost ~15
// Supabase requests per click just to draw header badges. The layout now
// renders anonymous chrome only; the signed-in bits (name, dashboard link,
// badges, the suspended screen) come from ONE request to /api/me after
// hydration. This file is the pure half of that: the response shape, the
// badge arithmetic and the cookie hint. No I/O, so it is unit-tested.

export type ViewerRole = "super_admin" | "merchant" | "customer";

/** What /api/me returns — exactly what the chrome draws, nothing more. */
export type MeResponse =
  | { signedIn: false }
  | {
      signedIn: true;
      id: string;
      name: string;
      role: ViewerRole | null;
      suspended: boolean;
      unreadNotifications: number;
      unreadMessages: number;
      /** Items waiting on the customer (the طلباتي tab badge). */
      activityCount: number;
      /** Stores the viewer follows — the hearts on cards of static pages
       *  (Home is ISR and cannot know). Newest first, at most
       *  FOLLOWED_STORE_IDS_CAP; see resolveFavorited for what happens past it. */
      followedStoreIds: string[];
    };

/**
 * How many followed store ids /api/me returns (newest follows first).
 *
 * A bound, not a promise: a viewer who follows more than this sees an older
 * follow's heart empty on a static page. Pages that still compute `favorited`
 * server-side (explore, search, map) pass it as the fallback, which wins
 * there; a re-follow of an unlisted store hits the (user_id, store_id) key and
 * FavoriteButton treats that duplicate as "already followed". At today's
 * scale nobody is near it, and it keeps the /api/me body small (≈37 KB max).
 */
export const FOLLOWED_STORE_IDS_CAP = 1000;

export const ANONYMOUS: MeResponse = { signedIn: false };

/** Where the "dashboard" link goes, or null when the viewer has none. */
export function dashboardHrefFor(
  role: ViewerRole | string | null | undefined,
  lang: string,
): string | null {
  if (role === "super_admin") return `/${lang}/admin`;
  if (role === "merchant") return `/${lang}/merchant`;
  return null;
}

export function normaliseRole(v: unknown): ViewerRole | null {
  return v === "super_admin" || v === "merchant" || v === "customer"
    ? v
    : null;
}

/** The name the header prints: full name, else the email, else "". */
export function displayNameOf(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const full = user.user_metadata?.full_name;
  if (typeof full === "string" && full.trim()) return full;
  return user.email ?? "";
}

/**
 * Does the browser hold a Supabase session cookie? `@supabase/ssr` writes
 * `sb-<ref>-auth-token` (chunked as `.0`, `.1` …) readable by script, so this
 * is a cheap, request-free hint: with no cookie there is nobody to look up and
 * /api/me is never called. A stale cookie only costs one request that answers
 * `signedIn: false`.
 */
export function hasAuthCookie(cookie: string | null | undefined): boolean {
  if (!cookie) return false;
  return /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(cookie);
}

/** Same test as hasAuthCookie, as an inline pre-paint script that marks
 *  <html data-auth="1">, so the first paint already shows a neutral account
 *  placeholder instead of a misleading "log in" for a signed-in visitor. */
export const AUTH_HINT_SCRIPT =
  "try{if(/(?:^|;\\s*)sb-[^=;]*-auth-token(?:\\.\\d+)?=/.test(document.cookie))document.documentElement.setAttribute('data-auth','1')}catch(e){}";

/** The pre-paint rules the viewer slots key on (components/viewer.tsx).
 *  Inline in <head>, like APP_MODE_CRITICAL_CSS, so they arrive with the
 *  markup and cannot be dropped by the asset pipeline. */
export const AUTH_HINT_CSS =
  "html[data-auth] [data-anon-only]{display:none!important}html:not([data-auth]) [data-auth-only]{display:none!important}";

/** Defensive parse of a /api/me body — anything unexpected is anonymous. */
export function parseMe(body: unknown): MeResponse {
  if (!body || typeof body !== "object") return ANONYMOUS;
  const b = body as Record<string, unknown>;
  if (b.signedIn !== true || typeof b.id !== "string" || !b.id) return ANONYMOUS;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  return {
    signedIn: true,
    id: b.id,
    name: typeof b.name === "string" ? b.name : "",
    role: normaliseRole(b.role),
    suspended: b.suspended === true,
    unreadNotifications: num(b.unreadNotifications),
    unreadMessages: num(b.unreadMessages),
    activityCount: num(b.activityCount),
    followedStoreIds: Array.isArray(b.followedStoreIds)
      ? b.followedStoreIds
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .slice(0, FOLLOWED_STORE_IDS_CAP)
      : [],
  };
}

// ===== Hearts: the viewer's follows, shared by every FavoriteButton =====
//
// Pure state for the viewer island's follow context. `ids` is the last
// /api/me answer; `overrides` is what the viewer toggled in this tab since,
// and always wins — a later /api/me answer may have been read before the
// write landed, and must not flip a heart the viewer just pressed back.

export type FollowState = {
  ids: ReadonlySet<string>;
  overrides: ReadonlyMap<string, boolean>;
};

export function followStateFrom(
  ids: readonly string[],
  prev?: FollowState | null,
): FollowState {
  return { ids: new Set(ids), overrides: prev?.overrides ?? new Map() };
}

/** The state after the viewer (un)follows one store. Never mutates. */
export function withFollow(
  state: FollowState,
  storeId: string,
  on: boolean,
): FollowState {
  const overrides = new Map(state.overrides);
  overrides.set(storeId, on);
  return { ids: state.ids, overrides };
}

/**
 * Is this heart filled? `state` null = not known (anonymous, or /api/me not
 * answered yet): the server's `fallback` decides. Otherwise this tab's own
 * toggle wins, then the follow list, then the server's `fallback` — which is
 * `false` on static pages and the real per-user answer on dynamic ones, so it
 * also covers a follow past FOLLOWED_STORE_IDS_CAP there.
 */
export function resolveFavorited(
  state: FollowState | null,
  storeId: string,
  fallback: boolean,
): boolean {
  if (!state) return fallback;
  const o = state.overrides.get(storeId);
  if (o !== undefined) return o;
  return state.ids.has(storeId) || fallback;
}
