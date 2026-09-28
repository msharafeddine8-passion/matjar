import type { CategoryKey } from "./catalog";
import type { FeatureModuleKey } from "./modules-catalog";
import { categoryModule } from "./modules";

// ===== Public data quality gate =====
//
// What a record must carry before the platform ranks it in discovery. Pure
// functions, no I/O, no dictionary: the same rules run inside a cached server
// loader, on the admin roster, on the merchant's own dashboard and from a
// command-line audit script, and they must agree everywhere.
//
// Three levels, and the middle one is the important one:
//
//   ok          — nothing to say.
//   incomplete  — LISTED, but flagged to the merchant and the admin. Missing
//                 area, missing image, empty catalogue, a stray trailing space.
//                 The UI has honest fallbacks for all of these (a monogram in
//                 place of a logo, "open" in place of hours), so hiding the
//                 store would cost the customer more than the gap does.
//   blocked     — not ranked in explore / search / home rails, still reachable
//                 by its own URL. Reserved for the two things the platform
//                 genuinely cannot present: a name that is not a name, and no
//                 way to reach the business at all.
//
// The levels are deliberately conservative. Measured on production on
// 2026-09-24 (15 active stores) every store has a name, a contact and a
// description, so NOTHING existing becomes blocked; "incomplete" is expected
// for the four with no area, the three with no image and the six with no
// catalogue. The gate is for what arrives next, not a purge of what is here.
//
// Nothing in this file writes. `sanitizeDisplayName` is for RENDER only — the
// stored value stays exactly as the merchant typed it until they change it.

export type QualityLevel = "ok" | "incomplete" | "blocked";

/** `block` lowers the level to `blocked`; `flag` only to `incomplete`. */
export type IssueSeverity = "block" | "flag";

export type IssueCode =
  | "name_missing"
  | "name_placeholder"
  | "name_digits_only"
  | "name_untrimmed"
  | "name_edge_punctuation"
  | "name_garbled"
  | "category_missing"
  | "location_missing"
  | "contact_missing"
  | "contact_invalid"
  | "description_missing"
  | "description_placeholder"
  | "image_missing"
  | "offerings_missing"
  | "price_invalid"
  | "price_zero"
  | "discount_not_lower"
  | "kind_mismatch";

export type Issue = {
  code: IssueCode;
  severity: IssueSeverity;
  /** The column the merchant or admin has to look at. */
  field: string;
};

export type QualityResult = {
  level: QualityLevel;
  issues: Issue[];
};

// ---------------------------------------------------------------------------
// Text rules
// ---------------------------------------------------------------------------

/** Zero-width and BOM characters that survive a paste and render as nothing. */
const INVISIBLE = /[​‌‍﻿]/g;

/**
 * Trim and collapse whitespace for display. Render-only: the one production
 * name with a trailing space ("مركز الضنية الطبي ") keeps its byte in the
 * database and loses it on the card. Never returns the input untouched when a
 * collapse is possible, and never throws on null.
 */
export function sanitizeDisplayName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** Placeholder words a person types when they are not naming anything. Latin
 *  tokens match on word boundaries; Arabic tokens match whole words after
 *  punctuation is stripped, because `\b` does not understand Arabic letters. */
const PLACEHOLDER_LATIN =
  /\b(test|tst|tests|testing|demo|asd|asdf|asdasd|qwe|qwerty|x{3,}|lorem|ipsum|dummy|placeholder|sample|z{3,}|null|undefined)\b/i;
const PLACEHOLDER_ARABIC = new Set([
  "تجربة",
  "تجريبي",
  "تجريبية",
  "اختبار",
  "تست",
  "تيست",
]);

const LATIN_LETTER = /[A-Za-z]/;

function arabicTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.replace(/[^؀-ۿ]/g, ""))
    .filter(Boolean);
}

/** Whether a NAME reads as a placeholder rather than a value.
 *
 *  Names are short, so one placeholder word is the whole story: "Test Store",
 *  "متجر تجريبي". The Arabic check is limited to names of three words or
 *  fewer because "تجربة" is also the ordinary word for "experience" — a real
 *  name like "تجربة الطعم الأصيل" would otherwise be refused. */
export function isPlaceholderText(text: string): boolean {
  const t = sanitizeDisplayName(text);
  if (!t) return false;
  if (PLACEHOLDER_LATIN.test(t)) return true;
  const tokens = arabicTokens(t);
  if (tokens.length <= 3 && tokens.some((tok) => PLACEHOLDER_ARABIC.has(tok))) {
    return true;
  }
  return false;
}

/** Whether a DESCRIPTION is placeholder text: every word in it is one. A
 *  sentence that merely contains "demo" or "تجربة" is a sentence, and the
 *  production description this was first run against — "…بتخلّي كل وجبة
 *  تجربة مميزة" — is exactly that. */
export function isPlaceholderDescription(text: string): boolean {
  const t = sanitizeDisplayName(text);
  if (!t) return false;
  const words = t.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (!words.length) return false;
  return words.every(
    (w) => PLACEHOLDER_LATIN.test(w) || PLACEHOLDER_ARABIC.has(w),
  );
}

/** Only digits, spaces and phone-style punctuation: a number, not a name. */
const DIGITS_ONLY = /^[\d\s\-+().٠-٩]+$/;

/** Characters that mean "unfinished" at either end of a name. Deliberately
 *  narrow — "!" and "?" can end a real brand, a dash or a comma cannot. */
const EDGE_PUNCT = /^[\-_.,;:|/\\*+~^"'`«»()[\]{}]|[\-_.,;:|/\\*+~^"'`«»([{]$/;

/** Mojibake: UTF-8 bytes read as Latin-1 ("Ø§Ù„…"), or the replacement
 *  character itself. Cheap and never true of real Arabic or Latin text. */
const MOJIBAKE = /�|[ÃÂØÙ][-¿]/;

/** A Latin run of five or more letters with no vowel is keyboard noise
 *  ("qwrtp", "sdfgh"), not a word in any language a Lebanese business trades
 *  in. Brand initialisms are short; five consonants is past that. */
const LATIN_NO_VOWEL = /\b[b-df-hj-np-tv-z]{5,}\b/i;

/** The same letter four or more times in a row ("aaaa", "xxxxx"). */
const REPEATED_LETTER = /([A-Za-z؀-ۿ])\1{3,}/;

/** Whether a name looks garbled — mixed-script garbage, mojibake or keyboard
 *  noise. Arabic and Latin TOGETHER is not garbled: "صيدلية Al Amal" is how
 *  half of Lebanon signs its shops. */
export function isGarbledName(name: string): boolean {
  const t = sanitizeDisplayName(name);
  if (!t) return false;
  if (MOJIBAKE.test(t)) return true;
  if (REPEATED_LETTER.test(t)) return true;
  if (LATIN_LETTER.test(t) && LATIN_NO_VOWEL.test(t)) return true;
  return false;
}

/** Name rules shared by every public entity. Severity as documented above:
 *  no name, a placeholder, or a bare number blocks; presentation defects flag. */
function nameIssues(raw: string | null | undefined, field = "name"): Issue[] {
  const out: Issue[] = [];
  const clean = sanitizeDisplayName(raw);
  if (!clean) {
    out.push({ code: "name_missing", severity: "block", field });
    return out;
  }
  if (isPlaceholderText(clean)) {
    out.push({ code: "name_placeholder", severity: "block", field });
  }
  if (DIGITS_ONLY.test(clean)) {
    out.push({ code: "name_digits_only", severity: "block", field });
  }
  if (raw !== clean) {
    out.push({ code: "name_untrimmed", severity: "flag", field });
  }
  if (EDGE_PUNCT.test(clean)) {
    out.push({ code: "name_edge_punctuation", severity: "flag", field });
  }
  if (isGarbledName(clean)) {
    out.push({ code: "name_garbled", severity: "flag", field });
  }
  return out;
}

function descriptionIssues(
  raw: string | null | undefined,
  field = "description",
): Issue[] {
  const clean = sanitizeDisplayName(raw);
  if (!clean) return [{ code: "description_missing", severity: "flag", field }];
  // Three characters or only punctuation is somebody getting past a required
  // field, and a placeholder word is the same thing with more letters.
  const letters = clean.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length < 3 || isPlaceholderDescription(clean)) {
    return [{ code: "description_placeholder", severity: "flag", field }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Contact rules
// ---------------------------------------------------------------------------

function digitsOf(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, "");
}

/** A number with fewer than seven digits is not a phone by any reading — the
 *  same floor `phoneIssue` in lib/phone.ts applies at checkout. */
const MIN_PHONE_DIGITS = 7;

/**
 * At least one reachable number. Missing entirely blocks — a directory entry
 * nobody can call is not an entry. A number that is present but too short to
 * dial only flags when another usable one exists; when it is the ONLY one,
 * the store is as unreachable as if the column were empty.
 */
function contactIssues(numbers: (string | null | undefined)[]): Issue[] {
  const present = numbers.filter((n) => (n ?? "").trim() !== "");
  if (!present.length) {
    return [{ code: "contact_missing", severity: "block", field: "phone" }];
  }
  const usable = present.filter((n) => digitsOf(n).length >= MIN_PHONE_DIGITS);
  if (!usable.length) {
    return [{ code: "contact_missing", severity: "block", field: "phone" }];
  }
  if (usable.length < present.length) {
    return [{ code: "contact_invalid", severity: "flag", field: "phone" }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Level
// ---------------------------------------------------------------------------

export function levelOf(issues: Issue[]): QualityLevel {
  if (issues.some((i) => i.severity === "block")) return "blocked";
  if (issues.length) return "incomplete";
  return "ok";
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export type StoreQualityInput = {
  name: string | null | undefined;
  /** The business type slug, or null when the row has none. */
  category?: string | null;
  area?: string | null;
  service_area?: string | null;
  region?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  description?: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
  /** Count of the sector's primary entity (products, rooms, ticket types,
   *  vehicles). `undefined`/`null` means the caller did not count, and the
   *  rule is skipped rather than guessed — a listing loader that fetched
   *  only the store row must not flag every store as empty. */
  offerings?: number | null;
};

export type StoreQualityOptions = {
  sector: CategoryKey;
  /** The store's resolved feature modules, when the caller has them. Without
   *  them the sector defaults decide. */
  modules?: Set<FeatureModuleKey>;
};

/** Sectors whose primary public entity lives outside `products` — the same
 *  three `sectorPrimarySetup` in lib/sectors.ts names (rooms, ticket types,
 *  vehicles). Restated here rather than imported so this module stays free of
 *  the icon imports sectors.ts carries and can run from a plain Node script;
 *  data-quality.test.ts asserts the two lists agree. */
export const PRIMARY_ENTITY_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "hospitality",
  "events",
  "automotive",
]);

/** Sectors that sell things off a list — goods sectors and the three above.
 *  A booking or request sector (clinic, lawyer, contractor) is complete
 *  without a catalogue: the request form is the offering. */
export function sectorRequiresOfferings(sector: CategoryKey): boolean {
  if (PRIMARY_ENTITY_SECTORS.has(sector)) return true;
  return categoryModule[sector]?.kind === "commerce";
}

/** Request-driven sectors serve an AREA rather than sit at an address, so a
 *  `service_area` satisfies them where a shop needs `area`. */
const SERVICE_AREA_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "services",
  "contractors",
  "professional",
]);

export function validateStorePublic(
  input: StoreQualityInput,
  opts: StoreQualityOptions,
): QualityResult {
  const issues: Issue[] = [...nameIssues(input.name)];

  if (!input.category || !input.category.trim()) {
    issues.push({ code: "category_missing", severity: "flag", field: "business_type_id" });
  }

  // Location: skipped only when the store has explicitly switched the module
  // off; sectors without a location module in their defaults (professional,
  // education) are held to the service-area form instead of the address.
  const wantsLocation = opts.modules ? opts.modules.has("location") : true;
  if (wantsLocation) {
    const area = (input.area ?? "").trim();
    const serviceArea = (input.service_area ?? "").trim();
    const satisfied = SERVICE_AREA_SECTORS.has(opts.sector)
      ? area !== "" || serviceArea !== ""
      : area !== "";
    if (!satisfied) {
      issues.push({ code: "location_missing", severity: "flag", field: "area" });
    }
  }

  issues.push(...contactIssues([input.phone, input.whatsapp]));
  issues.push(...descriptionIssues(input.description));

  // The card draws a monogram when both are absent, so this is a gap the
  // customer can live with — flagged, never blocked.
  if (!(input.logo_url ?? "").trim() && !(input.cover_url ?? "").trim()) {
    issues.push({ code: "image_missing", severity: "flag", field: "logo_url" });
  }

  if (
    input.offerings != null &&
    input.offerings <= 0 &&
    sectorRequiresOfferings(opts.sector)
  ) {
    issues.push({ code: "offerings_missing", severity: "flag", field: "products" });
  }

  return { level: levelOf(issues), issues };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type ProductQualityInput = {
  name: string | null | undefined;
  price: number | string | null | undefined;
  discount_price?: number | string | null;
  image_url?: string | null;
  /** `products.item_kind` — product | service | digital. */
  item_kind?: string | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function validateProductPublic(
  input: ProductQualityInput,
  opts: { sector: CategoryKey },
): QualityResult {
  const issues: Issue[] = [...nameIssues(input.name)];

  const price = num(input.price);
  if (price == null || price < 0) {
    issues.push({ code: "price_invalid", severity: "block", field: "price" });
  } else if (price === 0) {
    // A zero is how a quote-only service is stored; on a goods row it is a
    // missing price. Either way the merchant should look, neither is a block.
    issues.push({ code: "price_zero", severity: "flag", field: "price" });
  }

  const discount = num(input.discount_price);
  if (discount != null && price != null && price > 0 && discount >= price) {
    issues.push({ code: "discount_not_lower", severity: "flag", field: "discount_price" });
  }

  // 17 of 44 production products carry an image. Optional, and flagged.
  if (!(input.image_url ?? "").trim()) {
    issues.push({ code: "image_missing", severity: "flag", field: "image_url" });
  }

  // A service row in a goods sector or a product row in a booking sector
  // renders, but through the wrong template (offering.ts branches on this).
  const kind = input.item_kind ?? "product";
  const sectorKind = categoryModule[opts.sector]?.kind;
  if (
    (sectorKind === "commerce" && kind === "service") ||
    (sectorKind === "booking" && kind === "product")
  ) {
    issues.push({ code: "kind_mismatch", severity: "flag", field: "item_kind" });
  }

  return { level: levelOf(issues), issues };
}

// ---------------------------------------------------------------------------
// The other public entities: craft providers, gigs, jobs, market listings
// ---------------------------------------------------------------------------

export type EntryKind = "craft" | "gig" | "job" | "listing";

export type EntryQualityInput = {
  /** name (craft) or title (gig / job / listing). */
  title: string | null | undefined;
  description?: string | null;
  /** Any of the entity's contact columns: phone, whatsapp, how_to_apply,
   *  apply_email. Only crafts and jobs are contact-gated. */
  contacts?: (string | null | undefined)[];
  region?: string | null;
  area?: string | null;
  /** First image, or null. Only gigs and listings are image-flagged. */
  image?: string | null;
  /** Gig / listing price; null is "on request" and is not an issue. */
  price?: number | string | null;
};

const CONTACT_GATED: ReadonlySet<EntryKind> = new Set<EntryKind>(["craft", "job"]);
const IMAGE_FLAGGED: ReadonlySet<EntryKind> = new Set<EntryKind>(["gig", "listing"]);
const LOCATION_FLAGGED: ReadonlySet<EntryKind> = new Set<EntryKind>(["craft", "listing", "job"]);

export function validateEntryPublic(
  kind: EntryKind,
  input: EntryQualityInput,
): QualityResult {
  const issues: Issue[] = [...nameIssues(input.title, kind === "craft" ? "name" : "title")];

  issues.push(...descriptionIssues(input.description, kind === "craft" ? "bio" : "description"));

  if (CONTACT_GATED.has(kind)) {
    // A job's "how to apply" is prose, not a number: present is enough.
    if (kind === "job") {
      const any = (input.contacts ?? []).some((c) => (c ?? "").trim() !== "");
      if (!any) issues.push({ code: "contact_missing", severity: "block", field: "how_to_apply" });
    } else {
      issues.push(...contactIssues(input.contacts ?? []));
    }
  }

  if (LOCATION_FLAGGED.has(kind)) {
    const has = (input.region ?? "").trim() !== "" || (input.area ?? "").trim() !== "";
    if (!has) issues.push({ code: "location_missing", severity: "flag", field: "region" });
  }

  if (IMAGE_FLAGGED.has(kind) && !(input.image ?? "").trim()) {
    issues.push({ code: "image_missing", severity: "flag", field: "image_url" });
  }

  if (input.price !== undefined) {
    const price = num(input.price);
    if (input.price != null && (price == null || price < 0)) {
      issues.push({ code: "price_invalid", severity: "block", field: "price" });
    }
  }

  return { level: levelOf(issues), issues };
}
