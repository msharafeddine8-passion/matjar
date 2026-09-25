// Zero-result demand capture — the pure half.
//
// A search that returned nothing is a customer naming a merchant Matjar has not
// recruited yet. `search_logs` already records THAT it happened; this is the
// optional second step where the person tells us what they wanted, where, and
// (only if they choose) how to reach them when it turns up.
//
// Every limit below is ALSO written into migration 0306 (`submit_demand` and the
// table's check constraints). The two must agree: if the form lets someone type
// 150 characters and the RPC refuses 121, the person sees a failure for doing
// what the form invited. `demand.test.ts` reads the migration file and fails if
// the numbers drift apart — change them in both places or neither.

import { categoryKeys, regions, type RegionKey } from "@/lib/catalog";

export const DEMAND_LIMITS = {
  /** Same cap `log_search` applies to `search_logs.q`. */
  q: 120,
  /** Normalised length below which a query is a keystroke, not a request. */
  qMin: 2,
  contact: 80,
  note: 300,
  area: 60,
  /** Per signed-in user AND per normalised contact, rolling 24h. */
  perDay: 5,
  /** Anonymous, no contact: same q_norm + region, rolling 60s. */
  anonSameQueryPerMinute: 3,
  /** Anonymous, no contact: platform-wide flood guard, rolling 60s. */
  anonGlobalPerMinute: 30,
  /** Contacts, notes and user ids are cleared after this many days. */
  retentionDays: 180,
} as const;

/** The surfaces a search can come from (search_logs' set plus /search). */
export const DEMAND_SURFACES = [
  "search",
  "stores",
  "products",
  "freelance",
  "jobs",
  "market",
  "wholesale",
] as const;

/** A section is either a surface or a sector (catalog category key). */
export const DEMAND_SECTIONS: readonly string[] = [
  ...DEMAND_SURFACES,
  ...categoryKeys,
];

const SECTION_SET: ReadonlySet<string> = new Set(DEMAND_SECTIONS);
const REGION_SET: ReadonlySet<string> = new Set(regions.map((r) => r.key));

export const CONTACT_KINDS = ["whatsapp", "phone", "email"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const DEMAND_STATUSES = [
  "new",
  "contacted",
  "fulfilled",
  "dismissed",
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export function isDemandStatus(v: unknown): v is DemandStatus {
  return (
    typeof v === "string" && (DEMAND_STATUSES as readonly string[]).includes(v)
  );
}

/** Unknown sections become null rather than an error — a stale URL param must
 *  never be the reason somebody's request is refused. Mirrors the RPC. */
export function normalizeSection(v: unknown): string | null {
  return typeof v === "string" && SECTION_SET.has(v) ? v : null;
}

export function normalizeRegion(v: unknown): RegionKey | null {
  return typeof v === "string" && REGION_SET.has(v) ? (v as RegionKey) : null;
}

// Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII. A Lebanese phone typed
// on an Arabic keyboard arrives as ٠٣١٢٣٤٥٦; refusing it would be refusing the
// most natural way to type a number here.
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function toAsciiDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const a = ARABIC_DIGITS.indexOf(ch);
    const p = PERSIAN_DIGITS.indexOf(ch);
    out += a >= 0 ? String(a) : p >= 0 ? String(p) : ch;
  }
  return out;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

export type ContactResult =
  | { ok: true; contact: string | null; kind: ContactKind | null }
  | { ok: false; error: "invalid_contact" };

/**
 * Empty → no contact (allowed). Otherwise the kind is taken as given, or
 * inferred ('@' means email, anything else a phone). Phones lose spaces,
 * dashes, dots and brackets; a leading 00 becomes +. Emails are lower-cased.
 * Exactly the steps `submit_demand` performs, in the same order.
 */
export function normalizeContact(
  raw: string | null | undefined,
  kind?: string | null,
): ContactResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, contact: null, kind: null };

  const k =
    kind && kind.length > 0
      ? kind
      : trimmed.includes("@")
        ? "email"
        : "phone";
  if (!(CONTACT_KINDS as readonly string[]).includes(k)) {
    return { ok: false, error: "invalid_contact" };
  }

  if (k === "email") {
    const v = trimmed.toLowerCase();
    if (v.length > DEMAND_LIMITS.contact || !EMAIL_RE.test(v)) {
      return { ok: false, error: "invalid_contact" };
    }
    return { ok: true, contact: v, kind: "email" };
  }

  let v = toAsciiDigits(trimmed).replace(/[\s().-]/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (v.length > DEMAND_LIMITS.contact || !PHONE_RE.test(v)) {
    return { ok: false, error: "invalid_contact" };
  }
  return { ok: true, contact: v, kind: k as ContactKind };
}

/**
 * A stored phone (already normalised) → the digits wa.me wants. People type
 * Lebanese numbers locally: 03 123 456 (leading 0) or 70 123 456 (8 digits).
 * wa.me needs the country code, so those gain 961; an explicit +CC is kept.
 */
export function waDigits(phone: string): string {
  const v = phone.replace(/[^\d+]/g, "");
  if (v.startsWith("+")) return v.slice(1);
  if (v.startsWith("961")) return v;
  if (v.startsWith("0")) return `961${v.slice(1)}`;
  if (v.length === 8) return `961${v}`;
  return v;
}

/** Whitespace-collapsed trim; the SQL side additionally folds Arabic letter
 *  variants for q_norm, which never changes the length check's verdict except
 *  for a query made only of diacritics — and that is refused on both sides. */
function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export type DemandInput = {
  q: string;
  section?: string | null;
  region?: string | null;
  area?: string | null;
  contact?: string | null;
  contactKind?: string | null;
  note?: string | null;
};

export type DemandError =
  | "query_too_short"
  | "query_too_long"
  | "area_too_long"
  | "note_too_long"
  | "invalid_contact"
  | "rate_limited"
  | "failed";

export type DemandPayload = {
  p_q: string;
  p_section: string | null;
  p_region: string | null;
  p_area: string | null;
  p_contact: string | null;
  p_contact_kind: ContactKind | null;
  p_note: string | null;
};

export type ValidationResult =
  | { ok: true; payload: DemandPayload }
  | { ok: false; field: "q" | "area" | "contact" | "note"; error: DemandError };

/** Client-side mirror of `submit_demand`'s checks, producing its argument
 *  object. The RPC re-checks everything; this exists so the form can say what
 *  is wrong next to the field instead of after a round trip. */
export function validateDemand(input: DemandInput): ValidationResult {
  const q = clean(input.q);
  if (q.replace(/[ً-ْـ]/g, "").length < DEMAND_LIMITS.qMin) {
    return { ok: false, field: "q", error: "query_too_short" };
  }
  if (q.length > DEMAND_LIMITS.q) {
    return { ok: false, field: "q", error: "query_too_long" };
  }

  const area = clean(input.area);
  if (area.length > DEMAND_LIMITS.area) {
    return { ok: false, field: "area", error: "area_too_long" };
  }

  const note = (input.note ?? "").trim();
  if (note.length > DEMAND_LIMITS.note) {
    return { ok: false, field: "note", error: "note_too_long" };
  }

  const c = normalizeContact(input.contact, input.contactKind);
  if (!c.ok) return { ok: false, field: "contact", error: c.error };

  return {
    ok: true,
    payload: {
      p_q: q,
      p_section: normalizeSection(input.section),
      p_region: normalizeRegion(input.region),
      p_area: area || null,
      p_contact: c.contact,
      p_contact_kind: c.kind,
      p_note: note || null,
    },
  };
}

/** Maps a PostgREST error message from `submit_demand` to a form error. The
 *  RPC raises `demand_<code>`; anything else is a generic failure. */
export function demandErrorFromMessage(message: string | null | undefined): DemandError {
  const m = message ?? "";
  if (m.includes("demand_rate_limited")) return "rate_limited";
  if (m.includes("demand_invalid_contact")) return "invalid_contact";
  if (m.includes("demand_query_too_short")) return "query_too_short";
  if (m.includes("demand_query_too_long")) return "query_too_long";
  if (m.includes("demand_area_too_long")) return "area_too_long";
  if (m.includes("demand_note_too_long")) return "note_too_long";
  return "failed";
}
