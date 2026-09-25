"use client";

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isWaLocale,
  pluralForm,
  sinceParts,
  type WaLocale,
  type WaTargetType,
  type WaTemplateKey,
} from "@/lib/wa-templates";

// The browser half of the WhatsApp actions: which language the message goes
// out in, the tap log, and «آخر إرسال». Everything here is optional to the
// tap itself — none of it can stop WhatsApp from opening.

// ---------------------------------------------------------------------------
// Message language: the merchant's choice, remembered on this device.
// ---------------------------------------------------------------------------
// A Lebanese merchant with the dashboard in English may still write to
// customers in Arabic (or the other way round), so the MESSAGE language is its
// own setting. It defaults to the dashboard language, and one toggle on any
// screen switches every button on every screen.

const LOCALE_KEY = "matjar.waLocale";
const LOCALE_EVENT = "matjar:wa-locale";

function readStoredLocale(): WaLocale | null {
  try {
    const v = window.localStorage.getItem(LOCALE_KEY);
    return isWaLocale(v) ? v : null;
  } catch {
    return null;
  }
}

function subscribeLocale(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(LOCALE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(LOCALE_EVENT, cb);
  };
}

export function setWaLocale(locale: WaLocale) {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  window.dispatchEvent(new Event(LOCALE_EVENT));
}

/** The message language: the stored choice, else the dashboard language. */
export function useWaLocale(uiLang: string): WaLocale {
  const fallback: WaLocale = uiLang === "en" ? "en" : "ar";
  const stored = useSyncExternalStore(
    subscribeLocale,
    readStoredLocale,
    () => null,
  );
  return stored ?? fallback;
}

// ---------------------------------------------------------------------------
// The page origin, for links inside messages.
// ---------------------------------------------------------------------------
// Links point at wherever this app is being served from — the same choice the
// ledger's statement link makes. "" during server render; the real origin
// once hydrated (a link line renders only then).
const noopSubscribe = () => () => {};

export function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
}

// ---------------------------------------------------------------------------
// A clock that ticks once a minute, client-only (no hydration mismatch).
// ---------------------------------------------------------------------------
let nowSnapshot = 0;
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(cb: () => void) {
  nowListeners.add(cb);
  if (!nowTimer) {
    nowTimer = setInterval(() => {
      nowSnapshot = Date.now();
      nowListeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    nowListeners.delete(cb);
    if (nowListeners.size === 0 && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

/** Milliseconds since the epoch, refreshed each minute; 0 on the server. */
export function useMinuteNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => {
      if (nowSnapshot === 0) nowSnapshot = Date.now();
      return nowSnapshot;
    },
    () => 0,
  );
}

/** Tell the clock something just happened, so «آخر إرسال» reads «هلّق». */
export function touchNow() {
  nowSnapshot = Date.now();
  nowListeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// «آخر إرسال: من 3 أيام»
// ---------------------------------------------------------------------------
type Forms = { one: string; two: string; few: string; many: string };
export type AgoLabels = {
  now: string;
  minutes: Forms;
  hours: Forms;
  days: Forms;
};

export function formatSince(
  iso: string,
  now: number,
  ago: AgoLabels,
  uiLang: string,
): string | null {
  if (!now) return null;
  const p = sinceParts(iso, new Date(now));
  if (!p) return null;
  if (p.unit === "now") return ago.now;
  const form = pluralForm(p.n, uiLang === "en" ? "en" : "ar");
  return ago[p.unit][form].split("{n}").join(String(p.n));
}

// ---------------------------------------------------------------------------
// The tap log — fire and forget.
// ---------------------------------------------------------------------------
/**
 * Records that a WhatsApp action was opened. Never awaited by the caller and
 * never throws: before 0309 is applied the table does not exist and the insert
 * simply fails, silently. It must never delay or block opening WhatsApp.
 */
export function logWaAction(entry: {
  storeId: string;
  key: WaTemplateKey;
  targetType: WaTargetType;
  targetId: string;
}): void {
  try {
    void Promise.resolve(
      createClient()
        .from("wa_action_log")
        .insert({
          store_id: entry.storeId,
          key: entry.key,
          target_type: entry.targetType,
          target_id: entry.targetId,
        }),
    ).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    /* logging is best-effort */
  }
}
