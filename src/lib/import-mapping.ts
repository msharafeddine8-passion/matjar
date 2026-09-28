// ===== Spreadsheet import — pure rules for products, customers and ledger =====
//
// One importer, three things a Lebanese shop keeps in a spreadsheet:
//
//   products  → public.import_products (0214, generalised by 0311)
//   customers → public.store_customers, inserted under the caller's own RLS
//   ledger    → «رصيد افتتاحي»: one ledger line per customer PER CURRENCY,
//               written through public.record_customer_transaction (0307)
//
// Everything here is pure — no React, no Supabase, no dictionary — so the rules
// that decide whether a merchant's file imports, and what it turns into, are
// pinned by vitest (src/lib/__tests__/import-mapping.test.ts). The component
// only reads the file and calls the database.
//
// The product rules deliberately REUSE src/lib/product-import.ts (its row
// validation mirrors parse_numeric_cell() in the database, and the two must
// never disagree); this file adds column detection in both languages, the
// customer and ledger rules, and duplicate detection for all three.

import { normalizeDigits, parseAmountInput, type LedgerCurrency, type LedgerKind } from "./ledger";
import { phoneIssue } from "./phone";
import { phoneKey } from "./wa-templates";
import { IMPORT_COLUMNS, normalizeHeader, validateRow, type ImportKey, type RawRow } from "./product-import";

export type ImportEntity = "products" | "customers" | "ledger";
export const IMPORT_ENTITIES: readonly ImportEntity[] = ["products", "customers", "ledger"];

export function isImportEntity(v: unknown): v is ImportEntity {
  return v === "products" || v === "customers" || v === "ledger";
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
// Parsing happens in the merchant's browser (see import-wizard.tsx for why).
// These keep that honest on a mid-range phone: 5 MB of xlsx is far more than
// 2,000 rows of text, and 2,000 rows is a whole shop's catalogue or notebook.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const PREVIEW_ROWS = 20;

/** The label every imported opening balance carries on the ledger. Arabic in
 *  both UI languages: it is what the merchant's notebook says, and it is also
 *  how a second upload recognises the first (see planLedger). */
export const OPENING_LABEL = "رصيد افتتاحي";

// ---------------------------------------------------------------------------
// Fields and header detection
// ---------------------------------------------------------------------------

export type CustomerKey = "name" | "phone" | "notes";
export type LedgerKey =
  | "name"
  | "phone"
  | "balance"
  | "currency"
  | "balance_usd"
  | "balance_lbp"
  | "date";
export type FieldKey = ImportKey | CustomerKey | LedgerKey;

export type FieldSpec = {
  key: FieldKey;
  /** Header written into the template (row 1 Arabic, row 2 English). */
  ar: string;
  en: string;
  /** Other spellings merchants actually use, matched after normalisation. */
  aliases: string[];
  required?: boolean;
};

// Extra spellings for the product columns. The template's own ar/en headers
// (IMPORT_COLUMNS) are always accepted too.
const PRODUCT_ALIASES: Partial<Record<ImportKey, string[]>> = {
  sku: ["sku", "code", "product code", "item code", "الرمز", "رمز", "كود", "الكود"],
  name: ["name", "product", "product name", "item", "item name", "اسم", "اسم المنتج", "المنتج", "الصنف"],
  price: ["price", "unit price", "سعر", "سعر المبيع", "سعر البيع"],
  stock: ["stock", "qty", "quantity", "inventory", "الكميه", "المخزون", "العدد"],
  discount_price: ["sale price", "discount price", "offer price", "سعر العرض"],
  cost: ["cost", "cost price", "purchase price", "الكلفه", "كلفه", "سعر الشراء"],
  section: ["section", "category", "الفئه", "التصنيف"],
  brand: ["brand", "الماركه"],
  description: ["description", "details", "الوصف", "وصف"],
  image_url: ["image", "image url", "image link", "photo", "صوره", "الصوره"],
  name_en: ["name (english)", "english name", "name en", "name_en"],
  description_en: ["description (english)", "english description", "description_en"],
};

export const PRODUCT_FIELDS: FieldSpec[] = IMPORT_COLUMNS.map((c) => ({
  key: c.key,
  ar: c.ar,
  en: c.en,
  aliases: PRODUCT_ALIASES[c.key] ?? [],
  required: c.required,
}));

export const CUSTOMER_FIELDS: FieldSpec[] = [
  {
    key: "name",
    ar: "الاسم",
    en: "Name",
    aliases: ["name", "customer", "customer name", "full name", "اسم", "اسم الزبون", "الزبون", "العميل", "اسم العميل"],
    required: true,
  },
  {
    key: "phone",
    ar: "الهاتف",
    en: "Phone",
    aliases: ["phone", "mobile", "whatsapp", "phone number", "tel", "telephone", "التلفون", "تلفون", "رقم الهاتف", "الرقم", "رقم", "الموبايل", "موبايل", "واتساب", "الخلوي"],
  },
  {
    key: "notes",
    ar: "ملاحظات",
    en: "Notes",
    aliases: ["notes", "note", "comment", "comments", "ملاحظه", "الملاحظات"],
  },
];

export const LEDGER_FIELDS: FieldSpec[] = [
  CUSTOMER_FIELDS[0],
  CUSTOMER_FIELDS[1],
  {
    key: "balance",
    ar: "الرصيد",
    en: "Balance",
    aliases: ["balance", "amount", "debt", "owed", "المبلغ", "الدين", "رصيد", "المستحق"],
  },
  {
    key: "currency",
    ar: "العملة",
    en: "Currency",
    aliases: ["currency", "curr", "عمله", "العمله"],
  },
  {
    key: "balance_usd",
    ar: "الرصيد بالدولار",
    en: "Balance (USD)",
    aliases: ["balance usd", "usd", "usd balance", "dollars", "$", "دولار", "بالدولار", "الدين بالدولار"],
  },
  {
    key: "balance_lbp",
    ar: "الرصيد بالليرة",
    en: "Balance (LBP)",
    aliases: ["balance lbp", "lbp", "lbp balance", "ll", "l.l.", "ليره", "بالليره", "الدين بالليره", "ل.ل"],
  },
  {
    key: "date",
    ar: "التاريخ",
    en: "Date",
    aliases: ["date", "as of", "since", "تاريخ", "من تاريخ"],
  },
];

export const FIELDS: Record<ImportEntity, FieldSpec[]> = {
  products: PRODUCT_FIELDS,
  customers: CUSTOMER_FIELDS,
  ledger: LEDGER_FIELDS,
};

/** normalizeHeader (product-import) plus the punctuation people decorate a
 *  header with: "الاسم *", "Phone:", "Balance ($)". */
export function headerKey(raw: unknown): string {
  return normalizeHeader(raw)
    .replace(/[*:؛;]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function spellings(f: FieldSpec): Set<string> {
  return new Set([f.ar, f.en, ...f.aliases].map(headerKey).filter(Boolean));
}

/** field → 0-based column index, or null when no column was recognised. */
export type Mapping = Partial<Record<FieldKey, number | null>>;

/**
 * Auto-detect which column is which from the header row, in Arabic or English.
 * Exact matches on the normalised header only — a "contains" guess would map
 * «الرصيد بالدولار» onto «الرصيد» and silently import dollars as the wrong
 * field. Each column is claimed at most once, fields in declaration order.
 * The merchant confirms (and can change) this mapping before anything else.
 */
export function detectColumns(entity: ImportEntity, headerRow: readonly unknown[]): Mapping {
  const out: Mapping = {};
  const claimed = new Set<number>();
  const keys = headerRow.map(headerKey);
  for (const f of FIELDS[entity]) {
    const names = spellings(f);
    const idx = keys.findIndex((k, i) => !claimed.has(i) && k !== "" && names.has(k));
    out[f.key] = idx >= 0 ? idx : null;
    if (idx >= 0) claimed.add(idx);
  }
  return out;
}

/**
 * True when a row is itself a header row: at least two filled cells and every
 * filled cell a known spelling. The templates carry an Arabic header row AND
 * an English one; this is what lets the second be skipped instead of being
 * imported as a product called "Name".
 */
export function isHeaderLike(entity: ImportEntity, row: readonly unknown[]): boolean {
  const all = new Set<string>();
  for (const f of FIELDS[entity]) for (const s of spellings(f)) all.add(s);
  const filled = row.map(headerKey).filter(Boolean);
  return filled.length >= 2 && filled.every((k) => all.has(k));
}

/** What the mapping still lacks before a preview can be built. */
export function missingRequired(entity: ImportEntity, mapping: Mapping): FieldKey[] {
  const missing: FieldKey[] = FIELDS[entity]
    .filter((f) => f.required && (mapping[f.key] ?? null) === null)
    .map((f) => f.key);
  // A ledger file must say how much, in at least one of the three ways.
  if (
    entity === "ledger" &&
    (mapping.balance ?? null) === null &&
    (mapping.balance_usd ?? null) === null &&
    (mapping.balance_lbp ?? null) === null
  ) {
    missing.push("balance");
  }
  return missing;
}

/** A mapping that sends two fields to the same column is a mistake. */
export function duplicateColumns(mapping: Mapping): FieldKey[] {
  const seen = new Map<number, FieldKey>();
  const dup: FieldKey[] = [];
  for (const [k, v] of Object.entries(mapping) as [FieldKey, number | null | undefined][]) {
    if (v === null || v === undefined) continue;
    if (seen.has(v)) dup.push(k);
    else seen.set(v, k);
  }
  return dup;
}

/** Row cells → { field: trimmed text } through the confirmed mapping. */
export function applyMapping(
  mapping: Mapping,
  row: readonly unknown[],
): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  for (const [k, idx] of Object.entries(mapping) as [FieldKey, number | null | undefined][]) {
    if (idx === null || idx === undefined) continue;
    const text = String(row[idx] ?? "").trim();
    if (text) out[k] = text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF, a UTF-8 BOM
 * (Excel's "CSV UTF-8" writes one). The delimiter is whichever of , ; or tab
 * appears most in the first line outside quotes — Excel set to Arabic or
 * French regional settings writes semicolons.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const delim = best && best[1] > 0 ? best[0] : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** True when a row has nothing in it — Excel leaves these below the data. */
export function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((c) => String(c ?? "").trim() === "");
}

// ---------------------------------------------------------------------------
// Cells: money, currency, date
// ---------------------------------------------------------------------------

// JavaScript's \b only knows ASCII word characters, so the Arabic spellings are
// listed whole rather than bounded.
const USD_MARK = /(\$|usd|us\s*dollars?|dollars?|دولارات|دولار)/i;
const LBP_MARK = /(lbp|l\.\s*l\.?|\bll\b|ل\.\s*ل\.?|ل\s+ل|ليرات|ليرة|ليره|lira)/i;
const USD_MARKS = new RegExp(USD_MARK.source, "gi");
const LBP_MARKS = new RegExp(LBP_MARK.source, "gi");

/** "USD" / "LBP" from a currency cell or a marker inside an amount cell. */
export function parseCurrency(text: string | null | undefined): LedgerCurrency | null {
  const s = normalizeDigits(String(text ?? "")).trim();
  if (!s) return null;
  const usd = USD_MARK.test(s);
  const lbp = LBP_MARK.test(s);
  if (usd === lbp) return null; // neither, or both: not ours to guess
  return usd ? "USD" : "LBP";
}

/**
 * An amount as a merchant types it into a spreadsheet: "1,500,000", "$120.5",
 * "(40)", "-40", "٤٠٠٠٠٠ ل.ل.", "12,50". Signed — a negative opening balance
 * means the shop owes the customer. null when it is not a number.
 *
 * Thousands vs decimals: "1,500,000" and "1,500" are thousands (groups of
 * three after the first comma); "12,50" is a decimal comma. With both "," and
 * "." present, "," is the thousands separator. Everything ends in
 * ledger.parseAmountInput, so the same 2-decimal and size limits apply as on
 * the ledger's own entry form.
 */
export function parseSignedAmount(text: string | null | undefined): number | null {
  // Currency words go first: «ل.ل.» is made of dots, and left in it would read
  // as a decimal point.
  let s = normalizeDigits(String(text ?? ""))
    .replace(LBP_MARKS, "")
    .replace(USD_MARKS, "")
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/[\s ]/g, "")
    .trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip currency words and symbols; keep digits, separators and a sign.
  s = s.replace(/[^0-9.,\-]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.includes("-")) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, ""); // 1.500.000
  else if (s.includes(",")) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  // Round to cents first so "12.345" is 12.35 rather than a refusal.
  const abs = parseAmountInput((Math.round(n * 100) / 100).toFixed(2));
  if (abs === null) return null;
  return negative ? -abs : abs;
}

/** yyyy-mm-dd from a Date exceljs produced. Excel stores a date with no zone,
 *  and exceljs hands it over as that wall-clock date at 00:00 UTC — so the UTC
 *  parts ARE the date the merchant typed. */
export function excelDateToIso(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2100) return null;
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A date cell: 2026-09-01, 1/9/2026 or 01-09-2026 (day first — how dates are
 * written in Lebanon), or an Excel serial number. null when unreadable.
 */
export function parseDateCell(text: string | null | undefined): string | null {
  const s = normalizeDigits(String(text ?? "")).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return validYmd(+m[3], +m[2], +m[1]);
  // Excel serial day (1900 date system): 45900 ≈ 2025-09-01.
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      return excelDateToIso(new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export type RowIssue =
  // products (product-import.ts codes)
  | "errName"
  | "errPrice"
  | "errDiscount"
  | "errCost"
  | "errStock"
  // customers / ledger
  | "errPhone"
  | "errBalance"
  | "errCurrency"
  | "errDate"
  | "errDateFuture"
  | "errNothing"
  | "errNeedName"
  // duplicates
  | "dupInFile"
  | "nameAmbiguous"
  | "nameNeedsCode";

export type RowWarning = "warnPhoneForeign" | "warnNoSku" | "matchedByName";

/** Customers need a name; a phone is optional, but a phone too short to be one
 *  is a typo worth fixing now (it would never match or dial). A foreign number
 *  is kept — a warning, never a block (see phoneIssue). */
export function validateCustomerRow(row: Partial<Record<FieldKey, string>>): {
  issue: RowIssue | null;
  warning: RowWarning | null;
} {
  if (!(row.name ?? "").trim()) return { issue: "errName", warning: null };
  const phone = (row.phone ?? "").trim();
  if (phone) {
    const p = phoneIssue(normalizeDigits(phone));
    if (p === "tooShort") return { issue: "errPhone", warning: null };
    if (p === "notDialable") return { issue: null, warning: "warnPhoneForeign" };
  }
  return { issue: null, warning: null };
}

export type OpeningEntry = {
  currency: LedgerCurrency;
  kind: Extract<LedgerKind, "charge" | "payment">;
  /** Always positive, as record_customer_transaction requires. */
  amount: number;
};

/**
 * THE conversion rule. A signed balance per currency becomes at most ONE
 * ledger line per currency:
 *   positive → "charge"  (the customer owes the shop — «أعطيت»)
 *   negative → "payment" of the absolute value (the shop owes the customer: a
 *              credit, recorded the way the ledger records money received)
 *   zero     → nothing
 * USD and LBP are never added, netted or converted — the ledger's one rule.
 */
export function openingEntries(
  balances: Partial<Record<LedgerCurrency, number>>,
): OpeningEntry[] {
  const out: OpeningEntry[] = [];
  for (const currency of ["USD", "LBP"] as const) {
    const v = balances[currency];
    if (v === undefined || v === 0 || !Number.isFinite(v)) continue;
    out.push({ currency, kind: v > 0 ? "charge" : "payment", amount: Math.abs(v) });
  }
  return out;
}

export type LedgerRowValue = {
  balances: Partial<Record<LedgerCurrency, number>>;
  /** yyyy-mm-dd; the import day when the file has no date. */
  date: string;
};

/**
 * A ledger row → its balances per currency, or the reason it cannot import.
 *   * a Balance column needs a currency: the Currency column, or a marker in
 *     the amount ("$120", "400,000 ل.ل."). Never assumed.
 *   * Balance (USD) / Balance (LBP) columns carry their own currency.
 *   * two values for the same currency in one row is ambiguous → refused.
 *   * the date, when given, must be readable and not in the future (Beirut).
 */
export function validateLedgerRow(
  row: Partial<Record<FieldKey, string>>,
  todayIso: string,
): { issue: RowIssue | null; warning: RowWarning | null; value: LedgerRowValue | null } {
  const fail = (issue: RowIssue) => ({ issue, warning: null, value: null });
  const name = (row.name ?? "").trim();
  const phone = (row.phone ?? "").trim();
  if (!name && !phone) return fail("errName");
  let warning: RowWarning | null = null;
  if (phone) {
    const p = phoneIssue(normalizeDigits(phone));
    if (p === "tooShort") return fail("errPhone");
    if (p === "notDialable") warning = "warnPhoneForeign";
  }

  const balances: Partial<Record<LedgerCurrency, number>> = {};
  const put = (c: LedgerCurrency, v: number): boolean => {
    if (balances[c] !== undefined) return false;
    balances[c] = v;
    return true;
  };

  const generic = (row.balance ?? "").trim();
  if (generic) {
    const amount = parseSignedAmount(generic);
    if (amount === null) return fail("errBalance");
    const fromColumn = parseCurrency(row.currency);
    const fromAmount = parseCurrency(generic);
    // "$120" under a Currency cell that says LBP: which one is the typo is not
    // ours to decide.
    if (fromColumn && fromAmount && fromColumn !== fromAmount) return fail("errCurrency");
    const currency = fromColumn ?? fromAmount;
    if (!currency) return fail("errCurrency");
    put(currency, amount);
  } else if ((row.currency ?? "").trim() && !parseCurrency(row.currency)) {
    return fail("errCurrency");
  }
  for (const [key, currency] of [
    ["balance_usd", "USD"],
    ["balance_lbp", "LBP"],
  ] as const) {
    const t = (row[key] ?? "").trim();
    if (!t) continue;
    const amount = parseSignedAmount(t);
    if (amount === null) return fail("errBalance");
    if (!put(currency, amount)) return fail("errCurrency");
  }
  if (Object.keys(balances).length === 0) return fail("errBalance");

  let date = todayIso;
  const rawDate = (row.date ?? "").trim();
  if (rawDate) {
    const d = parseDateCell(rawDate);
    if (!d) return fail("errDate");
    if (d > todayIso) return fail("errDateFuture");
    date = d;
  }
  if (openingEntries(balances).length === 0) {
    return { issue: "errNothing", warning, value: { balances, date } };
  }
  return { issue: null, warning, value: { balances, date } };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/** Names compared the way the database compares them: lower(btrim(name)). */
export function nameKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** A phone reduced for matching; Arabic-Indic digits count as digits. */
export function importPhoneKey(raw: string | null | undefined): string | null {
  return phoneKey(normalizeDigits(String(raw ?? "")));
}

// ---- products --------------------------------------------------------------

export type ExistingProduct = { id: string; sku: string | null; name: string };

export type ProductAction =
  | { kind: "create" }
  | { kind: "updateSku"; productId: string }
  | { kind: "updateName"; productId: string; injectSku: string | null };

export type PlannedRow<A> = {
  /** Line number as Excel shows it. */
  line: number;
  fields: Partial<Record<FieldKey, string>>;
  issue: RowIssue | null;
  warning: RowWarning | null;
  action: A | null;
};

/**
 * What each product row will do. Mirrors import_products() as 0311 defines it:
 *   * a row with a code (sku) updates the product with that code, case-
 *     insensitively, or creates it;
 *   * a row WITHOUT a code falls back to the EXACT name (trimmed, case-
 *     insensitive) — and only when exactly one product has that name. Two
 *     products sharing it is ambiguous and the row is refused, not guessed.
 *   * the same code, or the same code-less name, twice in one file is refused
 *     on the later line: which of the two should win is the merchant's call.
 *
 * `nameMatchActive` is false until 0311 is applied (the database then has no
 * name fallback). A code-less row whose name belongs to a product WITH a code
 * still updates — the code is filled in for the database. One whose name
 * belongs to a product WITHOUT a code is refused rather than duplicated.
 */
export function planProducts(
  rows: readonly Partial<Record<FieldKey, string>>[],
  existing: readonly ExistingProduct[],
  opts: { nameMatchActive: boolean; firstLine: number },
): PlannedRow<ProductAction>[] {
  const bySku = new Map<string, ExistingProduct>();
  const byName = new Map<string, ExistingProduct[]>();
  for (const p of existing) {
    const s = nameKey(p.sku);
    if (s) bySku.set(s, p);
    const n = nameKey(p.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), p]);
  }
  const seenSku = new Set<string>();
  const seenName = new Set<string>();

  return rows.map((fields, i) => {
    const line = opts.firstLine + i;
    const base = { line, fields, warning: null as RowWarning | null };
    const err = validateRow(fields as RawRow);
    if (err) return { ...base, issue: err, action: null };

    const sku = nameKey(fields.sku);
    const name = nameKey(fields.name);
    if (sku) {
      if (seenSku.has(sku)) return { ...base, issue: "dupInFile" as const, action: null };
      seenSku.add(sku);
      const hit = bySku.get(sku);
      return {
        ...base,
        issue: null,
        action: hit ? { kind: "updateSku" as const, productId: hit.id } : { kind: "create" as const },
      };
    }

    if (seenName.has(name)) return { ...base, issue: "dupInFile" as const, action: null };
    seenName.add(name);
    const hits = byName.get(name) ?? [];
    if (hits.length === 0) {
      return { ...base, issue: null, warning: "warnNoSku" as const, action: { kind: "create" as const } };
    }
    if (hits.length > 1) return { ...base, issue: "nameAmbiguous" as const, action: null };
    const hit = hits[0];
    if (!opts.nameMatchActive && !hit.sku) {
      return { ...base, issue: "nameNeedsCode" as const, action: null };
    }
    return {
      ...base,
      issue: null,
      warning: "matchedByName" as const,
      action: { kind: "updateName" as const, productId: hit.id, injectSku: hit.sku ?? null },
    };
  });
}

/** The rows import_products() receives: validated ones, with a matched
 *  product's code filled in where the merchant's row had none. */
export function productRpcRows(planned: readonly PlannedRow<ProductAction>[]): RawRow[] {
  return planned
    .filter((p) => p.issue === null && p.action)
    .map((p) => {
      const row: RawRow = {};
      for (const c of IMPORT_COLUMNS) {
        const v = p.fields[c.key];
        if (v) row[c.key] = v;
      }
      if (p.action?.kind === "updateName" && p.action.injectSku && !row.sku) {
        row.sku = p.action.injectSku;
      }
      return row;
    });
}

// ---- customers -------------------------------------------------------------

export type ExistingCustomer = { id: string; name: string; phone: string | null };

export type CustomerAction =
  | { kind: "create"; phone: string | null }
  | { kind: "skip"; customerId: string; reason: "phone" | "name" };

/**
 * Customers are matched by NORMALISED phone (03 123 456, +961 3 123456 and
 * 0096131234 56 are one person — the same key the WhatsApp actions use). A
 * row with no phone is matched by exact name instead. An existing customer is
 * never overwritten: the row is skipped and reported. Twice in one file → the
 * later line is refused.
 */
export function planCustomers(
  rows: readonly Partial<Record<FieldKey, string>>[],
  existing: readonly ExistingCustomer[],
  opts: { firstLine: number },
): PlannedRow<CustomerAction>[] {
  const byPhone = new Map<string, ExistingCustomer>();
  const byName = new Map<string, ExistingCustomer>();
  for (const c of existing) {
    const k = importPhoneKey(c.phone);
    if (k && !byPhone.has(k)) byPhone.set(k, c);
    const n = nameKey(c.name);
    if (n && !byName.has(n)) byName.set(n, c);
  }
  const seenPhone = new Set<string>();
  const seenName = new Set<string>();

  return rows.map((fields, i) => {
    const line = opts.firstLine + i;
    const { issue, warning } = validateCustomerRow(fields);
    if (issue) return { line, fields, issue, warning, action: null };
    const phone = (fields.phone ?? "").trim() || null;
    const key = importPhoneKey(phone);
    const name = nameKey(fields.name);
    if (key) {
      if (seenPhone.has(key)) return { line, fields, issue: "dupInFile" as const, warning, action: null };
      seenPhone.add(key);
      const hit = byPhone.get(key);
      if (hit) return { line, fields, issue: null, warning, action: { kind: "skip" as const, customerId: hit.id, reason: "phone" as const } };
    } else {
      if (seenName.has(name)) return { line, fields, issue: "dupInFile" as const, warning, action: null };
      seenName.add(name);
      const hit = byName.get(name);
      if (hit) return { line, fields, issue: null, warning, action: { kind: "skip" as const, customerId: hit.id, reason: "name" as const } };
    }
    return { line, fields, issue: null, warning, action: { kind: "create" as const, phone } };
  });
}

// ---- ledger opening balances ------------------------------------------------

export type LedgerCustomerRef =
  | { kind: "existing"; customerId: string }
  /** Created by this import; `key` groups rows of the same new customer. */
  | { kind: "new"; key: string; name: string; phone: string | null };

export type LedgerAction = {
  customer: LedgerCustomerRef;
  /** Lines to write (at most one per currency). */
  entries: OpeningEntry[];
  /** Currencies skipped because the customer already has an opening balance
   *  in that currency — a second upload of the same file changes nothing. */
  alreadyOpened: LedgerCurrency[];
  date: string;
};

/**
 * Opening balances attach to an existing customer by normalised phone (by
 * exact name when the row has no phone and exactly one customer has it), or
 * create the customer. Each currency becomes one line labelled
 * «رصيد افتتاحي» (openingEntries). A customer that already HAS an opening
 * line in a currency is skipped for that currency, which makes the import
 * safe to run twice and safe to resume after a dropped connection. The same
 * customer and currency twice in one file is refused on the later line.
 */
export function planLedger(
  rows: readonly Partial<Record<FieldKey, string>>[],
  existing: readonly ExistingCustomer[],
  existingOpenings: ReadonlySet<string>,
  opts: { firstLine: number; todayIso: string },
): PlannedRow<LedgerAction>[] {
  const byPhone = new Map<string, ExistingCustomer>();
  const byName = new Map<string, ExistingCustomer[]>();
  for (const c of existing) {
    const k = importPhoneKey(c.phone);
    if (k && !byPhone.has(k)) byPhone.set(k, c);
    const n = nameKey(c.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), c]);
  }
  const seen = new Set<string>(); // customerRefKey:currency

  return rows.map((fields, i) => {
    const line = opts.firstLine + i;
    const v = validateLedgerRow(fields, opts.todayIso);
    if (v.issue || !v.value) return { line, fields, issue: v.issue, warning: v.warning, action: null };

    const phone = (fields.phone ?? "").trim() || null;
    const name = (fields.name ?? "").trim();
    const key = importPhoneKey(phone);
    let customer: LedgerCustomerRef | null = null;
    if (key) {
      const hit = byPhone.get(key);
      customer = hit
        ? { kind: "existing", customerId: hit.id }
        : { kind: "new", key: `p:${key}`, name, phone };
    } else {
      const hits = byName.get(nameKey(name)) ?? [];
      if (hits.length > 1) return { line, fields, issue: "nameAmbiguous" as const, warning: v.warning, action: null };
      customer = hits.length === 1
        ? { kind: "existing", customerId: hits[0].id }
        : { kind: "new", key: `n:${nameKey(name)}`, name, phone: null };
    }
    if (customer.kind === "new" && !customer.name) {
      return { line, fields, issue: "errNeedName" as const, warning: v.warning, action: null };
    }

    const refKey = customer.kind === "existing" ? customer.customerId : customer.key;
    const all = openingEntries(v.value.balances);
    for (const e of all) {
      if (seen.has(`${refKey}:${e.currency}`)) {
        return { line, fields, issue: "dupInFile" as const, warning: v.warning, action: null };
      }
    }
    for (const e of all) seen.add(`${refKey}:${e.currency}`);

    const alreadyOpened: LedgerCurrency[] = [];
    const entries = all.filter((e) => {
      if (customer?.kind === "existing" && existingOpenings.has(`${customer.customerId}:${e.currency}`)) {
        alreadyOpened.push(e.currency);
        return false;
      }
      return true;
    });
    return {
      line,
      fields,
      issue: null,
      warning: v.warning,
      action: { customer, entries, alreadyOpened, date: v.value.date },
    };
  });
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export type PlanSummary = {
  total: number;
  ok: number;
  problems: number;
  create: number;
  update: number;
  skip: number;
  matchedByName: number;
};

export function summarize(
  entity: ImportEntity,
  planned: readonly PlannedRow<ProductAction | CustomerAction | LedgerAction>[],
): PlanSummary {
  const s: PlanSummary = { total: planned.length, ok: 0, problems: 0, create: 0, update: 0, skip: 0, matchedByName: 0 };
  for (const p of planned) {
    if (p.issue || !p.action) {
      // A zero balance is not a mistake to fix — nothing to write.
      if (p.issue === "errNothing") s.skip++;
      else s.problems++;
      continue;
    }
    s.ok++;
    if (entity === "products") {
      const a = p.action as ProductAction;
      if (a.kind === "create") s.create++;
      else s.update++;
      if (a.kind === "updateName") s.matchedByName++;
    } else if (entity === "customers") {
      const a = p.action as CustomerAction;
      if (a.kind === "create") s.create++;
      else s.skip++;
    } else {
      const a = p.action as LedgerAction;
      if (a.entries.length === 0) s.skip++;
      else s.create++;
    }
  }
  return s;
}

/** Distinct new customers a ledger import will create, in first-seen order. */
export function newLedgerCustomers(
  planned: readonly PlannedRow<LedgerAction>[],
): { key: string; name: string; phone: string | null }[] {
  const out = new Map<string, { key: string; name: string; phone: string | null }>();
  for (const p of planned) {
    const c = p.action?.customer;
    if (!p.issue && c?.kind === "new" && !out.has(c.key) && (p.action?.entries.length ?? 0) > 0) {
      out.set(c.key, { key: c.key, name: c.name, phone: c.phone });
    }
  }
  return [...out.values()];
}
