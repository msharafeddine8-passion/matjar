"use client";

// استيراد من إكسل — template → upload → match columns → review → import.
//
// WHERE THE FILE IS PARSED: in the browser, on purpose.
//   * A server action would have to receive the whole file (Vercel caps a
//     request body at 4.5 MB, and every upload would be a billed function
//     invocation for work the phone can do for free), then send the parsed
//     rows back for review anyway — the merchant has to SEE them before
//     anything is written. Parsing locally sends nothing until "Import".
//   * exceljs (already a dependency) is loaded only when a file is chosen,
//     so the dashboard never pays for it.
//   * The file never leaves the device: a customer list is personal data.
// Limits keep that honest on a mid-range phone: 5 MB, 2,000 rows. Converting
// rows yields to the browser every 250 rows so the page keeps scrolling and
// the counter keeps moving; exceljs's own unzip is asynchronous.
//
// WHAT IS WRITTEN, AND HOW (rules in src/lib/import-mapping.ts, tested):
//   products  → one call to import_products(): all-or-nothing in the database.
//   customers → store_customers inserts, 500 per statement, under the caller's
//               RLS (staff need `customers`).
//   ledger    → new customers first, then one record_customer_transaction()
//               per customer per currency, labelled «رصيد افتتاحي», four at a
//               time. Not one transaction — but a re-run skips every customer
//               that already has an opening line in that currency, so a
//               dropped connection is resumed by uploading the same file again.
// Nothing is written until the merchant presses Import on the review step.

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Download, FileSpreadsheet, Lock, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { revalidateProduct, revalidateStore } from "@/lib/cache-actions";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/i18n/get-dictionary";
import {
  FIELDS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  OPENING_LABEL,
  PREVIEW_ROWS,
  applyMapping,
  detectColumns,
  duplicateColumns,
  excelDateToIso,
  importPhoneKey,
  isBlankRow,
  isHeaderLike,
  isImportEntity,
  missingRequired,
  nameKey,
  newLedgerCustomers,
  parseCsv,
  planCustomers,
  planLedger,
  planProducts,
  productRpcRows,
  summarize,
  type CustomerAction,
  type ExistingCustomer,
  type ExistingProduct,
  type FieldKey,
  type ImportEntity,
  type LedgerAction,
  type Mapping,
  type PlannedRow,
  type ProductAction,
  type RowIssue,
} from "@/lib/import-mapping";
import { formatLedgerAmount } from "@/lib/ledger";

type T = Dictionary["importer"];

type Loaded = {
  file: string;
  header: string[];
  rows: string[][];
  /** The spreadsheet line number of each row, as Excel shows it. */
  lines: number[];
};

type Stage = "pick" | "map" | "preview" | "running" | "done";

type Done =
  | { kind: "products"; created: number; updated: number; byName: number }
  | { kind: "customers"; created: number; skipped: number; failures: Failure[]; partial: boolean }
  | { kind: "ledger"; lines: number; customers: number; failures: Failure[]; partial: boolean };

type Failure = { line: number; message: string };

type AnyPlanned = PlannedRow<ProductAction | CustomerAction | LedgerAction>;

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s);

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

/** A, B, … Z, AA — the letters Excel shows above a column. */
function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Example rows for the template's SECOND sheet, which is never imported: an
// example left in the sheet a merchant fills would otherwise land in their shop.
const EXAMPLES: Record<ImportEntity, string[][]> = {
  products: [
    ["TS-001", "تي شيرت قطن", "12.5", "40", "9.99", "6", "ملابس", "", "", "", "Cotton T-shirt", ""],
    ["MG-002", "مغ سيراميك", "6", "15", "", "", "مطبخ", "", "", "", "Ceramic mug", ""],
  ],
  customers: [
    ["رنا الحاج", "03 123 456", ""],
    ["Sami Khoury", "+961 71 000 000", "VIP"],
  ],
  ledger: [
    ["رنا الحاج", "03 123 456", "150", "USD", "", "", "15/01/2026"],
    ["Sami Khoury", "71 000 000", "", "", "-20", "2,500,000", ""],
  ],
};

// A tab can be opened from a link as …/import#ledger. Read through an
// external store so the server render (no hash) and the first client render
// agree, and only then does the hash take effect.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
function readHash(): string | null {
  const h = window.location.hash.replace(/^#/, "");
  return h || null;
}

/** Cell → text. Numbers stay raw (1500000, not "1,500,000"), dates become
 *  yyyy-mm-dd, formulas and rich text use what Excel displays. */
function cellString(cell: { value: unknown; text?: string }): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return excelDateToIso(v) ?? "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  try {
    return String(cell.text ?? "");
  } catch {
    return "";
  }
}

export function ImportWizard({
  storeId,
  lang,
  entities,
  initial,
  productsLocked,
  planLimit,
  nameMatchActive,
  existingProducts,
  existingCustomers,
  existingOpenings,
  todayIso,
  t,
}: {
  storeId: string;
  lang: string;
  entities: ImportEntity[];
  initial: ImportEntity;
  productsLocked: boolean;
  /** null = unlimited. */
  planLimit: number | null;
  nameMatchActive: boolean;
  existingProducts: ExistingProduct[];
  existingCustomers: ExistingCustomer[];
  existingOpenings: string[];
  todayIso: string;
  t: T;
}) {
  const router = useRouter();
  const hash = useSyncExternalStore(subscribeHash, readHash, () => null);
  const [chosen, setChosen] = useState<ImportEntity | null>(null);
  const entity: ImportEntity =
    chosen ?? (isImportEntity(hash) && entities.includes(hash) ? hash : initial);

  const [stage, setStage] = useState<Stage>("pick");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [reading, setReading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverRows, setServerRows] = useState<Failure[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const openingSet = useMemo(() => new Set(existingOpenings), [existingOpenings]);
  const fields = FIELDS[entity];
  const fieldLabel = (k: FieldKey) => (t.fields as Record<string, string>)[k] ?? k;
  const issueText = (i: RowIssue) => (t.issues as Record<string, string>)[i] ?? i;
  const locked = entity === "products" && productsLocked;

  function reset(next?: ImportEntity) {
    if (next) {
      setChosen(next);
      try {
        window.history.replaceState(null, "", `#${next}`);
      } catch {
        /* the tab still switches */
      }
    }
    setStage("pick");
    setLoaded(null);
    setMapping({});
    setError(null);
    setServerRows([]);
    setProgress(null);
    setDone(null);
  }

  // ── Template ─────────────────────────────────────────────────────────────
  async function downloadTemplate() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const rtl = lang === "ar";
    const sheet = wb.addWorksheet(t.tabs[entity].slice(0, 31), { views: [{ rightToLeft: rtl }] });
    sheet.addRow(fields.map((f) => f.ar));
    sheet.addRow(fields.map((f) => f.en));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(2).font = { bold: true, italic: true };
    sheet.columns = fields.map(() => ({ width: 20 }));

    const example = wb.addWorksheet(t.exampleSheet.slice(0, 31), { views: [{ rightToLeft: rtl }] });
    example.addRow([t.exampleNote]);
    example.getRow(1).font = { italic: true };
    example.addRow(fields.map((f) => (rtl ? f.ar : f.en)));
    example.getRow(2).font = { bold: true };
    for (const r of EXAMPLES[entity]) example.addRow(r);
    example.columns = fields.map(() => ({ width: 20 }));

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `matjar-${entity}-template.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Read ─────────────────────────────────────────────────────────────────
  async function readXlsx(file: File): Promise<string[][] | "tooMany"> {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];
    // Header + a second header row + the cap. Refusing early avoids
    // converting fifty thousand rows only to reject them.
    if (ws.actualRowCount > MAX_ROWS + 2) return "tooMany";
    const cols = Math.min(Math.max(ws.actualColumnCount, ws.columnCount), 60);
    const out: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) cells.push(cellString(row.getCell(c)).trim());
      out.push(cells);
      if (r % 250 === 0) {
        setReading(r);
        await tick();
      }
    }
    return out;
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again after a fix
    if (!file) return;
    setError(null);
    setServerRows([]);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xls")) return setError(t.errOldXls);
    const isCsv = lower.endsWith(".csv");
    if (!isCsv && !lower.endsWith(".xlsx")) return setError(t.errBadFile);
    if (file.size > MAX_FILE_BYTES) return setError(fill(t.errTooBig, { mb: MB }));

    setReading(0);
    let grid: string[][] | "tooMany";
    try {
      grid = isCsv ? parseCsv(await file.text()) : await readXlsx(file);
    } catch {
      setReading(null);
      return setError(t.errBadFile);
    }
    if (grid === "tooMany") {
      setReading(null);
      return setError(fill(t.errTooManyRows, { n: `>${MAX_ROWS}`, max: MAX_ROWS }));
    }

    // Header = the first non-blank row; a second header row (the bilingual
    // template's English line) is skipped; blank rows are dropped but every
    // row keeps the line number Excel shows.
    let h = 0;
    while (h < grid.length && isBlankRow(grid[h])) h++;
    if (h >= grid.length) {
      setReading(null);
      return setError(t.errEmpty);
    }
    const header = grid[h];
    let start = h + 1;
    if (start < grid.length && isHeaderLike(entity, grid[start])) start++;
    const rows: string[][] = [];
    const lines: number[] = [];
    for (let i = start; i < grid.length; i++) {
      if (isBlankRow(grid[i])) continue;
      rows.push(grid[i]);
      lines.push(i + 1);
    }
    setReading(null);
    if (rows.length === 0) return setError(t.errEmpty);
    if (rows.length > MAX_ROWS) {
      return setError(fill(t.errTooManyRows, { n: rows.length, max: MAX_ROWS }));
    }
    setLoaded({ file: file.name, header, rows, lines });
    setMapping(detectColumns(entity, header));
    setStage("map");
  }

  // ── Plan (pure; recomputed only when its inputs change) ───────────────────
  const planned: AnyPlanned[] = useMemo(() => {
    if (!loaded || (stage !== "preview" && stage !== "running")) return [];
    const rows = loaded.rows.map((r) => applyMapping(mapping, r));
    let out: AnyPlanned[];
    if (entity === "products") {
      out = planProducts(rows, existingProducts, { nameMatchActive, firstLine: 0 });
    } else if (entity === "customers") {
      out = planCustomers(rows, existingCustomers, { firstLine: 0 });
    } else {
      out = planLedger(rows, existingCustomers, openingSet, { firstLine: 0, todayIso });
    }
    return out.map((p, i) => ({ ...p, line: loaded.lines[i] }));
  }, [loaded, stage, mapping, entity, existingProducts, existingCustomers, openingSet, nameMatchActive, todayIso]);

  const summary = useMemo(() => summarize(entity, planned), [entity, planned]);
  const problems = planned.filter((p) => p.issue && p.issue !== "errNothing");
  const writable =
    entity === "products" ? summary.ok : summary.create; // rows that will write something

  // ── Import ───────────────────────────────────────────────────────────────
  async function runImport() {
    if (!loaded || writable === 0) return;
    setStage("running");
    setError(null);
    setServerRows([]);
    const supabase = createClient();

    if (entity === "products") {
      const rpcRows = productRpcRows(planned as PlannedRow<ProductAction>[]);
      const okLines = planned.filter((p) => !p.issue && p.action).map((p) => p.line);
      setProgress({ done: 0, total: rpcRows.length });
      const { data, error: err } = await supabase.rpc("import_products", {
        p_store_id: storeId,
        p_rows: rpcRows,
        p_filename: loaded.file,
      });
      setProgress(null);
      if (err) {
        setStage("preview");
        if (/pro plan/i.test(err.message)) return setError(t.productsLocked);
        if (err.code === "42501" || /not allowed/i.test(err.message)) return setError(t.noPermission);
        return setError(t.failed);
      }
      const res = data as {
        ok: boolean;
        code?: string;
        created?: number;
        updated?: number;
        matched_by_name?: number;
        existing?: number;
        adding?: number;
        limit?: number;
        errors?: { row: number; code: string }[];
      };
      if (!res?.ok) {
        setStage("preview");
        if (res?.code === "plan_limit") {
          return setError(fill(t.planLimit, { existing: res.existing ?? 0, adding: res.adding ?? 0, limit: res.limit ?? 0 }));
        }
        if (res?.code === "rows_invalid") {
          const code: Record<string, RowIssue> = {
            name_required: "errName",
            price_invalid: "errPrice",
            cost_invalid: "errCost",
            discount_invalid: "errDiscount",
            stock_invalid: "errStock",
            name_ambiguous: "nameAmbiguous",
          };
          setServerRows(
            (res.errors ?? []).map((e) => ({
              line: okLines[e.row - 1] ?? e.row,
              message: code[e.code] ? issueText(code[e.code]) : e.code,
            })),
          );
          return;
        }
        return setError(t.failed);
      }
      setDone({
        kind: "products",
        created: res.created ?? 0,
        updated: res.updated ?? 0,
        byName: res.matched_by_name ?? 0,
      });
      setStage("done");
      // Without this the storefront shows the old catalogue for minutes, right
      // after the moment the import was supposed to win the merchant over.
      await revalidateProduct();
      await revalidateStore(storeId);
      router.refresh();
      return;
    }

    if (entity === "customers") {
      const toCreate = (planned as PlannedRow<CustomerAction>[]).filter(
        (p) => !p.issue && p.action?.kind === "create",
      );
      const skipped = planned.filter((p) => !p.issue && (p.action as CustomerAction | null)?.kind === "skip").length;
      let created = 0;
      const failures: Failure[] = [];
      setProgress({ done: 0, total: toCreate.length });
      for (let i = 0; i < toCreate.length; i += 500) {
        const chunk = toCreate.slice(i, i + 500);
        const { error: err } = await supabase.from("store_customers").insert(
          chunk.map((p) => ({
            store_id: storeId,
            name: (p.fields.name ?? "").trim(),
            phone: p.action?.kind === "create" ? p.action.phone : null,
            notes: (p.fields.notes ?? "").trim() || null,
          })),
        );
        if (err) {
          for (const p of chunk) failures.push({ line: p.line, message: err.code === "42501" ? t.noPermission : t.failed });
          break;
        }
        created += chunk.length;
        setProgress({ done: created, total: toCreate.length });
      }
      setProgress(null);
      setDone({ kind: "customers", created, skipped, failures, partial: failures.length > 0 && created > 0 });
      setStage("done");
      router.refresh();
      return;
    }

    // ledger
    const ledgerPlan = planned as PlannedRow<LedgerAction>[];
    const fresh = newLedgerCustomers(ledgerPlan);
    const idByKey = new Map<string, string>();
    const failures: Failure[] = [];
    let customersCreated = 0;
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500);
      const { data, error: err } = await supabase
        .from("store_customers")
        .insert(chunk.map((c) => ({ store_id: storeId, name: c.name, phone: c.phone })))
        .select("id, name, phone");
      if (err) {
        const msg = err.code === "42501" ? t.noPermission : t.failed;
        setDone({ kind: "ledger", lines: 0, customers: customersCreated, failures: [{ line: 0, message: msg }], partial: customersCreated > 0 });
        setStage("done");
        router.refresh();
        return;
      }
      for (const r of (data ?? []) as { id: string; name: string; phone: string | null }[]) {
        const k = importPhoneKey(r.phone);
        idByKey.set(k ? `p:${k}` : `n:${nameKey(r.name)}`, r.id);
        customersCreated++;
      }
    }

    type Task = { line: number; customerId: string; kind: string; amount: number; currency: string; date: string };
    const tasks: Task[] = [];
    for (const p of ledgerPlan) {
      if (p.issue || !p.action) continue;
      const c = p.action.customer;
      const customerId = c.kind === "existing" ? c.customerId : idByKey.get(c.key);
      for (const e of p.action.entries) {
        if (!customerId) {
          failures.push({ line: p.line, message: t.failed });
          continue;
        }
        tasks.push({ line: p.line, customerId, kind: e.kind, amount: e.amount, currency: e.currency, date: p.action.date });
      }
    }

    let written = 0;
    let next = 0;
    setProgress({ done: 0, total: tasks.length });
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        const { error: err } = await supabase.rpc("record_customer_transaction", {
          p_customer_id: task.customerId,
          p_kind: task.kind,
          p_amount: task.amount,
          p_label: OPENING_LABEL,
          p_happened_on: task.date,
          p_currency: task.currency,
        });
        if (err) failures.push({ line: task.line, message: err.code === "42501" ? t.noPermission : err.message || t.failed });
        else written++;
        setProgress({ done: written + failures.length, total: tasks.length });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setProgress(null);
    failures.sort((a, b) => a.line - b.line);
    setDone({ kind: "ledger", lines: written, customers: customersCreated, failures, partial: failures.length > 0 && written > 0 });
    setStage("done");
    router.refresh();
  }

  // ── Rendering helpers ────────────────────────────────────────────────────
  const card = "rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5";
  const base = `/${lang}/merchant/${storeId}`;
  const L = lang === "en" ? "en" : "ar";

  function rowData(p: AnyPlanned): string {
    const f = p.fields;
    if (entity === "products") return [f.sku, f.name, f.price].filter(Boolean).join(" · ");
    if (entity === "customers") return [f.name, f.phone].filter(Boolean).join(" · ");
    const a = p.action as LedgerAction | null;
    const money = a
      ? a.entries.map((e) => `${e.kind === "payment" ? "−" : ""}${formatLedgerAmount(e.amount, e.currency, L)}`).join(" + ")
      : [f.balance, f.balance_usd, f.balance_lbp].filter(Boolean).join(" / ");
    return [f.name, f.phone, money].filter(Boolean).join(" · ");
  }

  function rowResult(p: AnyPlanned): { text: string; tone: "success" | "info" | "neutral" | "danger" | "warning" } {
    if (p.issue === "errNothing") return { text: t.status.nothing, tone: "neutral" };
    if (p.issue) return { text: issueText(p.issue), tone: "danger" };
    const warn = p.warning ? ` · ${(t.warnings as Record<string, string>)[p.warning] ?? ""}` : "";
    if (entity === "products") {
      const a = p.action as ProductAction;
      const text = a.kind === "create" ? t.status.create : a.kind === "updateSku" ? t.status.updateSku : t.status.updateName;
      return { text: text + (a.kind === "updateName" ? "" : warn), tone: a.kind === "create" ? "success" : "info" };
    }
    if (entity === "customers") {
      const a = p.action as CustomerAction;
      if (a.kind === "create") return { text: t.status.create + warn, tone: "success" };
      return { text: a.reason === "phone" ? t.status.skipPhone : t.status.skipName, tone: "neutral" };
    }
    const a = p.action as LedgerAction;
    if (a.entries.length === 0) {
      return { text: fill(t.status.ledgerAlready, { currencies: a.alreadyOpened.join(" / ") }), tone: "neutral" };
    }
    const head = a.customer.kind === "new" ? t.status.ledgerNew : t.status.ledgerExisting;
    const already = a.alreadyOpened.length ? ` · ${fill(t.status.ledgerAlready, { currencies: a.alreadyOpened.join(" / ") })}` : "";
    return { text: head + already + warn, tone: a.customer.kind === "new" ? "success" : "info" };
  }

  const missing = missingRequired(entity, mapping);
  const dups = duplicateColumns(mapping);
  const found = Object.values(mapping).filter((v) => v !== null && v !== undefined).length;

  // ── Done ─────────────────────────────────────────────────────────────────
  if (stage === "done" && done) {
    const failures = done.kind === "products" ? [] : done.failures;
    return (
      <div className="space-y-4">
        <Tabs entities={entities} entity={entity} t={t} onPick={reset} disabled={false} />
        <div className={card} role="status">
          <p className="flex items-start gap-2 font-bold text-primary">
            <Check className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>
              {done.kind === "products"
                ? fill(t.doneProducts, { created: done.created, updated: done.updated })
                : done.kind === "customers"
                  ? fill(t.doneCustomers, { created: done.created, skipped: done.skipped })
                  : fill(t.doneLedger, { lines: done.lines, customers: done.customers })}
            </span>
          </p>
          {done.kind === "products" && done.byName > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{fill(t.doneByName, { n: done.byName })}</p>
          )}
          {failures.length > 0 && (
            <div className="mt-3 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm">
              <p className="font-bold text-danger">{fill(t.doneFailed, { n: failures.length })}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {failures.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    {f.line > 0 && (
                      <>
                        {t.colLine} <bdi dir="ltr">{f.line}</bdi> —{" "}
                      </>
                    )}
                    {f.message}
                  </li>
                ))}
              </ul>
              {done.kind !== "products" && done.partial && <p className="mt-2 text-xs">{t.partialFailed}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={done.kind === "products" ? `${base}/items` : `${base}/ledger`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {done.kind === "products" ? t.openProducts : t.openLedger}
            </Link>
            <button type="button" onClick={() => reset()} className={buttonVariants({ variant: "secondary", size: "md" })}>
              {t.startOver}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs entities={entities} entity={entity} t={t} onPick={reset} disabled={stage === "running"} />
      <p className="text-sm text-muted-foreground">{t.tabHints[entity]}</p>

      {locked && (
        <div className={`${card} border-primary/30 bg-primary-soft/20`}>
          <p className="flex items-start gap-1.5 text-sm font-semibold">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            {t.productsLocked}
          </p>
          <Link href={`${base}/subscription`} className={`mt-3 ${buttonVariants({ variant: "primary", size: "sm" })}`}>
            {t.lockedCta}
          </Link>
        </div>
      )}

      {/* 1 — template */}
      <section className={card}>
        <h2 className="text-sm font-bold">{t.step1}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.step1Body}</p>
        <button
          type="button"
          onClick={downloadTemplate}
          className={`mt-3 ${buttonVariants({ variant: "secondary", size: "md" })}`}
        >
          <Download className="h-4 w-4" aria-hidden />
          {t.download}
        </button>
      </section>

      {/* 2 — upload */}
      <section className={card}>
        <h2 className="text-sm font-bold">{t.step2}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.step2Body}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {fill(t.limits, { rows: MAX_ROWS.toLocaleString("en-US"), mb: MB })}
        </p>
        <label
          className={`mt-3 cursor-pointer ${buttonVariants({ variant: "secondary", size: "md" })} ${
            reading !== null || stage === "running" ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <Upload className="h-4 w-4" aria-hidden />
          {reading !== null ? (reading > 0 ? fill(t.readingRows, { n: reading }) : t.reading) : t.choose}
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            disabled={reading !== null || stage === "running"}
            className="sr-only"
          />
        </label>
        {loaded && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <bdi>{fill(t.fileSummary, { file: loaded.file, n: loaded.rows.length })}</bdi>
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </section>

      {/* 3 — mapping */}
      {loaded && stage !== "pick" && (
        <section className={card}>
          <h2 className="text-sm font-bold">{t.step3}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {fill(t.step3Body, { found })}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const value = mapping[f.key];
              const hint = (t.fieldHints as Record<string, string>)[f.key];
              const required = f.required || (entity === "ledger" && f.key === "balance" && missing.includes("balance"));
              return (
                <label key={f.key} className="block text-sm">
                  <span className="flex items-center gap-1.5 font-semibold">
                    {fieldLabel(f.key)}
                    <span className="text-xs font-normal text-muted-foreground">
                      {required ? t.required : t.optional}
                    </span>
                  </span>
                  <select
                    value={value === null || value === undefined ? "" : String(value)}
                    disabled={stage === "running"}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      setMapping((m) => ({ ...m, [f.key]: v }));
                      if (stage === "preview") setStage("map");
                    }}
                    className="mt-1 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                  >
                    <option value="">{t.notInFile}</option>
                    {loaded.header.map((h, i) => (
                      <option key={i} value={i}>
                        {fill(t.column, { col: colLetter(i), name: h || "—" })}
                      </option>
                    ))}
                  </select>
                  {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
                </label>
              );
            })}
          </div>
          {missing.length > 0 && (
            <p className="mt-3 text-sm font-semibold text-warning">
              {fill(t.missing, { fields: missing.map(fieldLabel).join("، ") })}
            </p>
          )}
          {dups.length > 0 && (
            <p className="mt-2 text-sm font-semibold text-warning">
              {fill(t.dupColumns, { fields: dups.map(fieldLabel).join("، ") })}
            </p>
          )}
          {stage === "map" && (
            <button
              type="button"
              disabled={missing.length > 0 || dups.length > 0}
              onClick={() => setStage("preview")}
              className={`mt-4 ${buttonVariants({ variant: "primary", size: "md" })}`}
            >
              {t.toPreview}
            </button>
          )}
        </section>
      )}

      {/* 4 — review */}
      {loaded && (stage === "preview" || stage === "running") && (
        <section className={card}>
          <h2 className="text-sm font-bold">{t.step4}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="neutral">{fill(t.sumTotal, { n: summary.total })}</Badge>
            {summary.create > 0 && <Badge variant="success">{fill(t.sumCreate, { n: summary.create })}</Badge>}
            {summary.update > 0 && <Badge variant="info">{fill(t.sumUpdate, { n: summary.update })}</Badge>}
            {summary.skip > 0 && <Badge variant="neutral">{fill(t.sumSkip, { n: summary.skip })}</Badge>}
            {summary.problems > 0 && <Badge variant="danger">{fill(t.sumProblems, { n: summary.problems })}</Badge>}
          </div>

          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {entity === "products" && <li>• {nameMatchActive ? t.noteNameMatch : t.noteNameMatchOld}</li>}
            {entity === "customers" && <li>• {t.noteCustomers}</li>}
            {entity === "ledger" && (
              <>
                <li>• {t.noteLedger}</li>
                <li>• {t.noteLedgerRerun}</li>
              </>
            )}
          </ul>

          <h3 className="mt-4 text-xs font-bold text-muted-foreground">
            {fill(t.previewTitle, { n: Math.min(PREVIEW_ROWS, planned.length) })}
          </h3>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {planned.slice(0, PREVIEW_ROWS).map((p) => {
              const r = rowResult(p);
              return (
                <li key={p.line} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">
                    <bdi dir="ltr">{p.line}</bdi>
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    <bdi>{rowData(p) || "—"}</bdi>
                  </span>
                  <Badge variant={r.tone} className="self-start whitespace-normal sm:self-auto">
                    {r.text}
                  </Badge>
                </li>
              );
            })}
          </ul>

          {problems.length > 0 && (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft/30 p-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {t.problemsTitle}
              </p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {problems.slice(0, 50).map((p) => (
                  <li key={p.line}>
                    {t.colLine} <bdi dir="ltr">{p.line}</bdi> — {p.issue ? issueText(p.issue) : ""}
                  </li>
                ))}
                {problems.length > 50 && (
                  <li className="text-muted-foreground">{fill(t.moreProblems, { n: problems.length - 50 })}</li>
                )}
              </ul>
            </div>
          )}

          {entity === "products" && planLimit !== null && !locked &&
            existingProducts.length + summary.create > planLimit && (
              <p className="mt-4 rounded-xl border border-warning/30 bg-warning-soft/30 p-3 text-sm font-semibold text-warning">
                {fill(t.planLimit, { existing: existingProducts.length, adding: summary.create, limit: planLimit })}
              </p>
            )}

          {serverRows.length > 0 && (
            <div role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm">
              <p className="font-bold text-danger">{fill(t.serverRows, { n: serverRows.length })}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {serverRows.slice(0, 30).map((f, i) => (
                  <li key={i}>
                    {t.colLine} <bdi dir="ltr">{f.line}</bdi> — {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {locked ? (
              <Link href={`${base}/subscription`} className={buttonVariants({ variant: "primary", size: "md" })}>
                {t.lockedCta}
              </Link>
            ) : (
              <button
                type="button"
                onClick={runImport}
                disabled={stage === "running" || writable === 0}
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                {stage === "running"
                  ? fill(t.importing, { done: progress?.done ?? 0, total: progress?.total ?? writable })
                  : fill(t.confirm, { n: writable })}
              </button>
            )}
            <button
              type="button"
              disabled={stage === "running"}
              onClick={() => setStage("map")}
              className={buttonVariants({ variant: "secondary", size: "md" })}
            >
              {t.changeMapping}
            </button>
            <button
              type="button"
              disabled={stage === "running"}
              onClick={() => reset()}
              className={buttonVariants({ variant: "ghost", size: "md" })}
            >
              {t.startOver}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Tabs({
  entities,
  entity,
  t,
  onPick,
  disabled,
}: {
  entities: ImportEntity[];
  entity: ImportEntity;
  t: T;
  onPick: (e: ImportEntity) => void;
  disabled: boolean;
}) {
  if (entities.length < 2) return null;
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1">
      {entities.map((e) => (
        <button
          key={e}
          type="button"
          role="tab"
          aria-selected={e === entity}
          disabled={disabled}
          onClick={() => onPick(e)}
          className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-bold transition-colors disabled:opacity-60 ${
            e === entity ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.tabs[e]}
        </button>
      ))}
    </div>
  );
}
