// Browser storage for source attribution. Every read and write is wrapped:
// private mode, a full quota or a blocked storage must cost us the data point,
// never a crash on a storefront. The rules themselves are pure and live in
// src/lib/attribution.ts.
//
//   sessionStorage "matjar-attr-path"   {cur, prev} — the last two pathnames
//                                       this tab showed (AttributionCapture)
//   sessionStorage "matjar-attr-cur"    {id, path} — the store the tab is on
//   sessionStorage "matjar-attr-s-<id>" "1" — this store was touched this visit
//   localStorage   "matjar-attr"        TouchState — first/last touch per store,
//                                       30-day window
//
// Nothing personal is stored: store ids, source tokens, a UTM value or a
// referrer HOST (never a full URL), and timestamps.

import { SITE_URL } from "@/lib/site";
import {
  attributionFor,
  parseTouchState,
  recordTouch,
  resolveSource,
  type Resolved,
} from "@/lib/attribution";

const PATH_KEY = "matjar-attr-path";
const CUR_KEY = "matjar-attr-cur";
const SEEN_PREFIX = "matjar-attr-s-";
const STATE_KEY = "matjar-attr";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* quota / private mode — lose the data point, not the page */
  }
}

function ss(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Called on every client navigation (AttributionCapture). */
export function notePath(pathname: string): void {
  const s = ss();
  if (!s) return;
  const prev = readJson<{ cur?: string; prev?: string | null }>(s, PATH_KEY);
  if (prev?.cur === pathname) return;
  write(s, PATH_KEY, JSON.stringify({ cur: pathname, prev: prev?.cur ?? null }));
}

/** The Matjar page this tab showed before `currentPath`, or null on a
 *  landing page. Works whether or not notePath has already run for the
 *  current page (child effects run before the layout's). */
export function previousPathFor(currentPath: string): string | null {
  const s = ss();
  if (!s) return null;
  const p = readJson<{ cur?: string; prev?: string | null }>(s, PATH_KEY);
  if (!p?.cur) return null;
  if (p.cur === currentPath) return typeof p.prev === "string" ? p.prev : null;
  return p.cur;
}

function ownHosts(): string[] {
  const hosts = ["matjarlb.com"];
  try {
    hosts.push(new URL(SITE_URL).host);
  } catch {
    /* ignore */
  }
  if (typeof location !== "undefined") hosts.push(location.host);
  return hosts;
}

/**
 * A store (or one of its products) is being viewed. Remembers it as the tab's
 * current store and, once per visit per store, records a first/last touch.
 */
export function touchStore(storeId: string): void {
  if (!UUID_RE.test(storeId) || typeof window === "undefined") return;
  const s = ss();
  const path = location.pathname;
  if (s) write(s, CUR_KEY, JSON.stringify({ id: storeId, path }));

  const seenKey = SEEN_PREFIX + storeId;
  try {
    if (s?.getItem(seenKey)) return;
  } catch {
    /* fall through and record */
  }
  if (s) write(s, seenKey, "1");

  const resolved = resolveSource({
    href: location.href,
    referrer: typeof document !== "undefined" ? document.referrer : "",
    previousPath: previousPathFor(path),
    ownHosts: ownHosts(),
  });

  const l = ls();
  if (!l) return;
  let raw: string | null = null;
  try {
    raw = l.getItem(STATE_KEY);
  } catch {
    raw = null;
  }
  const next = recordTouch(parseTouchState(raw), storeId, resolved, Date.now());
  write(l, STATE_KEY, JSON.stringify(next));
}

/** The store the tab is on, with the path it was recorded on. */
export function currentStore(): { id: string; path: string } | null {
  const s = ss();
  if (!s) return null;
  const c = readJson<{ id?: string; path?: string }>(s, CUR_KEY);
  return c?.id && UUID_RE.test(c.id) ? { id: c.id, path: c.path ?? "" } : null;
}

/** What to tag an order or booking at this store with. */
export function attributionForStore(storeId: string): Resolved {
  const l = ls();
  let raw: string | null = null;
  try {
    raw = l ? l.getItem(STATE_KEY) : null;
  } catch {
    raw = null;
  }
  return attributionFor(parseTouchState(raw), storeId, Date.now());
}

/** Runs `fn` once per key per tab session (a re-render, a back button or a
 *  remount of a confirmation screen must not tag or count twice). */
export function oncePerSession(key: string, fn: () => void): void {
  const s = ss();
  try {
    if (s?.getItem(key)) return;
  } catch {
    /* fall through */
  }
  if (s) write(s, key, "1");
  fn();
}
