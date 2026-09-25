// First-party product analytics (§34) — the client helper.
//
// ZERO RECURRING COST: events go to Matjar's own Postgres through
// public.log_events (migration 0312). No Vercel Analytics custom events, no
// SaaS, no AI. What leaves the browser is an event NAME from a fixed list,
// ids (store, offering), a few slug-like tokens (sector, offering type,
// region, surface) and a random per-tab session id. No phone, email, name,
// search text or any other free text — the helper cannot carry one: every
// value is checked against a UUID or a token pattern and dropped otherwise,
// and the database re-checks the same rules.
//
// Fire-and-forget and batched: `track()` queues; the queue is sent after a
// short pause, when it reaches 10 events, or when the page is hidden — that
// last one with navigator.sendBeacon when the browser has it, so the final
// events of a page survive the page closing. Nothing here ever throws into
// the caller and nothing is awaited on a user's path.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

export const EVENT_NAMES = [
  "search_started",
  "search_submitted",
  "search_result_clicked",
  "zero_result",
  "business_viewed",
  "offering_viewed",
  "favorite_added",
  "contact_clicked",
  "add_to_cart",
  "booking_started",
  "service_request_created",
  "checkout_started",
  "transaction_completed",
  "job_viewed",
  "job_applied",
  "project_posted",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(v: unknown): v is EventName {
  return typeof v === "string" && (EVENT_NAMES as readonly string[]).includes(v);
}

export type EventProps = {
  storeId?: string | null;
  offeringId?: string | null;
  /** Category key, e.g. "restaurant", "healthcare". */
  sector?: string | null;
  /** e.g. "product", "service", "order", "booking". */
  offeringType?: string | null;
  /** Region slug, e.g. "beirut". */
  region?: string | null;
  /** Where on Matjar it happened, e.g. "store", "product", "store:whatsapp". */
  sourceSurface?: string | null;
};

/** The compact shape log_events(text) reads. */
export type WireEvent = {
  n: EventName;
  s: string;
  st?: string;
  o?: string;
  sec?: string;
  ot?: string;
  r?: string;
  src?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same pattern as the CHECKs on public.product_events. */
const TOKEN_RE = /^[a-z0-9][a-z0-9_.:-]{0,39}$/;

export const MAX_BATCH = 20;
const FLUSH_AT = 10;
const FLUSH_DELAY_MS = 4000;

function uuidOrUndef(v: string | null | undefined): string | undefined {
  return v && UUID_RE.test(v) ? v.toLowerCase() : undefined;
}

function tokenOrUndef(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim().toLowerCase();
  return TOKEN_RE.test(t) ? t : undefined;
}

/**
 * Builds the wire event, or null when it must not be sent (unknown name, no
 * session). Values that are not ids or tokens are dropped, not sent — that
 * is the no-PII guarantee on this side of the wire.
 */
export function buildEvent(
  name: string,
  props: EventProps,
  sessionId: string,
): WireEvent | null {
  if (!isEventName(name) || !UUID_RE.test(sessionId)) return null;
  const e: WireEvent = { n: name, s: sessionId.toLowerCase() };
  const st = uuidOrUndef(props.storeId);
  const o = uuidOrUndef(props.offeringId);
  const sec = tokenOrUndef(props.sector);
  const ot = tokenOrUndef(props.offeringType);
  const r = tokenOrUndef(props.region);
  const src = tokenOrUndef(props.sourceSurface);
  if (st) e.st = st;
  if (o) e.o = o;
  if (sec) e.sec = sec;
  if (ot) e.ot = ot;
  if (r) e.r = r;
  if (src) e.src = src;
  return e;
}

/** Splits a queue into request bodies of at most MAX_BATCH events. */
export function toBatches(queue: readonly WireEvent[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < queue.length; i += MAX_BATCH) {
    out.push(JSON.stringify(queue.slice(i, i + MAX_BATCH)));
  }
  return out;
}

/** The PostgREST endpoint. The key rides as a query parameter because
 *  sendBeacon cannot set headers; it is the PUBLIC publishable key that
 *  already ships in the bundle (src/lib/supabase/config.ts). */
export function eventsEndpoint(
  url: string = SUPABASE_URL,
  key: string = SUPABASE_ANON_KEY,
): string {
  return `${url.replace(/\/+$/, "")}/rest/v1/rpc/log_events?apikey=${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

const SESSION_KEY = "matjar-evt-sid";

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // RFC 4122 v4 shape from Math.random — only ever a session label.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let memorySession: string | null = null;

/** A random id per tab session — not the TrackVisit device id, not the account. */
export function sessionId(): string {
  try {
    let v = sessionStorage.getItem(SESSION_KEY);
    if (!v || !UUID_RE.test(v)) {
      v = randomUuid();
      sessionStorage.setItem(SESSION_KEY, v);
    }
    return v;
  } catch {
    if (!memorySession) memorySession = randomUuid();
    return memorySession;
  }
}

let queue: WireEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function send(body: string, closing: boolean): void {
  const url = eventsEndpoint();
  try {
    if (
      closing &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const ok = navigator.sendBeacon(
        url,
        new Blob([body], { type: "text/plain;charset=UTF-8" }),
      );
      if (ok) return;
    }
    // text/plain + no custom header = a CORS "simple" request: no preflight.
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
      keepalive: true,
      credentials: "omit",
    }).then(
      () => {},
      () => {},
    );
  } catch {
    /* analytics never surfaces an error */
  }
}

export function flush(closing = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batches = toBatches(queue);
  queue = [];
  for (const b of batches) send(b, closing);
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const onHide = () => flush(true);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
  });
}

/**
 * Queue one event. Safe to call anywhere on the client, any number of times;
 * does nothing on the server, for automated browsers, or for a name outside
 * EVENT_NAMES.
 */
export function track(name: EventName, props: EventProps = {}): void {
  try {
    if (typeof window === "undefined") return;
    if (typeof navigator !== "undefined" && navigator.webdriver) return;
    const e = buildEvent(name, props, sessionId());
    if (!e) return;
    listen();
    queue.push(e);
    if (queue.length >= FLUSH_AT) {
      flush();
    } else if (!timer) {
      timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
    }
  } catch {
    /* never throw into the caller */
  }
}
