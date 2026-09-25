"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Search, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { phoneIssue } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ChevronNext } from "@/components/ui/directional-icon";
import {
  LEDGER_CURRENCIES,
  OVERDUE_FILTERS,
  buildExportRows,
  daysBetween,
  formatLedgerAmount,
  isOverdue,
  matchesSearch,
  sortByOutstanding,
  summarizeBalanceRows,
  toCsv,
  type ExportEntry,
  type LedgerBalanceRow,
  type LedgerCurrency,
  type OverdueFilter,
} from "@/lib/ledger";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { LedgerSheet } from "./ledger-sheet";

type T = Dictionary["ledger"];
type BookCustomer = { id: string; name: string; phone: string | null };

export function LedgerHome({
  storeId,
  lang,
  t,
  rows,
  loadFailed,
  customers,
  rate,
  today,
}: {
  storeId: string;
  lang: Locale;
  t: T;
  rows: LedgerBalanceRow[];
  loadFailed: boolean;
  customers: BookCustomer[];
  rate: number;
  today: string;
}) {
  const router = useRouter();
  const base = `/${lang}/merchant/${storeId}/ledger`;
  const [query, setQuery] = useState("");
  const [overdue, setOverdue] = useState<OverdueFilter | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);

  const summaries = useMemo(
    () => sortByOutstanding(summarizeBalanceRows(rows), rate),
    [rows, rate],
  );

  const visible = summaries.filter(
    (s) =>
      matchesSearch(s, query) &&
      (overdue == null || isOverdue(s.oldestUnpaidOn, overdue, today)),
  );

  // What the shop is owed, per currency. Only positive balances count: a
  // customer in credit does not reduce what another one owes.
  const totals = useMemo(() => {
    const cents: Record<LedgerCurrency, number> = { USD: 0, LBP: 0 };
    let owing = 0;
    for (const s of summaries) {
      let any = false;
      for (const c of LEDGER_CURRENCIES) {
        if (s.balances[c] > 0) {
          cents[c] += Math.round(s.balances[c] * 100);
          any = true;
        }
      }
      if (any) owing++;
    }
    return { USD: cents.USD / 100, LBP: cents.LBP / 100, owing };
  }, [summaries]);

  async function fetchAllEntries(): Promise<ExportEntry[] | null> {
    const supabase = createClient();
    const out: ExportEntry[] = [];
    // PostgREST returns at most 1000 rows per request; page until done so a
    // busy shop's export is complete rather than silently truncated.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("customer_transactions")
        .select("id, kind, amount, currency, label, happened_on, created_at, store_customers(name, phone)")
        .eq("store_id", storeId)
        .order("happened_on", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) return null;
      for (const r of (data ?? []) as unknown as (ExportEntry & {
        store_customers: { name: string; phone: string | null } | null;
      })[]) {
        out.push({
          ...r,
          amount: Number(r.amount),
          customer_name: r.store_customers?.name ?? "",
          customer_phone: r.store_customers?.phone ?? null,
        });
      }
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportAs(kind: "xlsx" | "csv") {
    setExporting(kind);
    try {
      const entries = await fetchAllEntries();
      if (!entries) {
        notifyError(t.exportFailed);
        return;
      }
      if (entries.length === 0) {
        notifyError(t.exportEmpty);
        return;
      }
      const table = buildExportRows(entries, { headers: t.headers, kinds: t.kinds });
      const stamp = today;
      if (kind === "csv") {
        download(new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" }), `ledger-${stamp}.csv`);
        return;
      }
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(t.sheetName.slice(0, 31), {
        views: [{ rightToLeft: lang === "ar", state: "frozen", ySplit: 1 }],
      });
      for (const row of table) ws.addRow(row);
      ws.getRow(1).font = { bold: true };
      ws.columns = [14, 24, 16, 14, 10, 14, 16, 36].map((width) => ({ width }));
      // Per-currency totals under the data, as formulas the merchant can
      // audit — never a single mixed total.
      const last = table.length;
      ws.addRow([]);
      for (const c of LEDGER_CURRENCIES) {
        ws.addRow([
          t.balance,
          "",
          "",
          "",
          c,
          "",
          { formula: `SUMIF(E2:E${last},"${c}",G2:G${last})` },
          "",
        ]);
      }
      const buf = await wb.xlsx.writeBuffer();
      download(
        new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `ledger-${stamp}.xlsx`,
      );
    } catch {
      notifyError(t.exportFailed);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      {loadFailed && (
        <p role="alert" className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          {t.statementFailed}
        </p>
      )}

      {/* Owed to the shop, per currency. */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5">
        <p className="text-xs font-bold text-muted-foreground">{t.owedToYou}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          {LEDGER_CURRENCIES.map((c) => (
            <span key={c} className="text-2xl font-extrabold tabular-nums">
              <bdi dir="ltr">{formatLedgerAmount(totals[c], c, lang)}</bdi>
            </span>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.customersCount.replace("{n}", String(totals.owing))}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          className="flex-1"
          size="lg"
          leftIcon={<UserPlus className="h-5 w-5" />}
          onClick={() => setAdding((v) => !v)}
        >
          {t.addCustomer}
        </Button>
      </div>

      <AddCustomer
        open={adding}
        onClose={() => setAdding(false)}
        t={t}
        storeId={storeId}
        customers={customers}
        onPicked={(id) => {
          setAdding(false);
          router.push(`${base}/${id}`);
        }}
      />

      {/* Search + overdue filter */}
      <div className="mt-5">
        <label htmlFor="ledger-search" className="sr-only">
          {t.searchLabel}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="ledger-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="ps-9"
          />
        </div>
        <div role="group" aria-label={t.filterLabel} className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {[null, ...OVERDUE_FILTERS].map((d) => {
            const active = overdue === d;
            return (
              <button
                key={d ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setOverdue(d)}
                className={`h-9 shrink-0 rounded-full border px-3.5 text-sm font-bold transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-foreground hover:border-primary/40"
                }`}
              >
                {d == null ? t.filterAll : t.filterOverdue.replace("{days}", String(d))}
              </button>
            );
          })}
        </div>
      </div>

      {/* The list */}
      {summaries.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t.empty}
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t.emptyFiltered}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {visible.map((s) => {
            const owed = LEDGER_CURRENCIES.filter((c) => s.balances[c] !== 0);
            const lateDays = s.oldestUnpaidOn ? daysBetween(s.oldestUnpaidOn, today) : 0;
            return (
              <li key={s.id}>
                <Link
                  href={`${base}/${s.id}`}
                  className="flex items-center gap-3 p-3.5 transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {lateDays > 7
                        ? t.overdueDays.replace("{days}", String(lateDays))
                        : s.lastActivity
                          ? t.lastActivity.replace("{date}", s.lastActivity)
                          : ""}
                    </p>
                  </div>
                  <div className="text-end">
                    {owed.length === 0 ? (
                      <span className="text-sm font-bold text-success">{t.settled}</span>
                    ) : (
                      owed.map((c) => (
                        <p
                          key={c}
                          className={`text-sm font-extrabold tabular-nums ${
                            s.balances[c] > 0 ? "text-danger" : "text-success"
                          }`}
                        >
                          <bdi dir="ltr">
                            {s.balances[c] < 0 ? "−" : ""}
                            {formatLedgerAmount(s.balances[c], c, lang)}
                          </bdi>
                        </p>
                      ))
                    )}
                  </div>
                  <ChevronNext className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rate > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t.rateNote.replace("{rate}", Math.round(rate).toLocaleString("en-US"))}
        </p>
      )}

      {/* Export */}
      <section className="mt-6 flex flex-wrap items-center gap-2">
        <span className="me-auto text-sm font-bold">{t.exportTitle}</span>
        <Button
          size="sm"
          variant="secondary"
          loading={exporting === "xlsx"}
          disabled={exporting !== null}
          leftIcon={<FileSpreadsheet className="h-4 w-4" />}
          onClick={() => exportAs("xlsx")}
        >
          {t.exportExcel}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={exporting === "csv"}
          disabled={exporting !== null}
          leftIcon={<Download className="h-4 w-4" />}
          onClick={() => exportAs("csv")}
        >
          {t.exportCsv}
        </Button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add a customer to the book: pick one the shop already has, or type a name
// and a number. Either way the next screen is that customer's page, with the
// «أعطيت» button one tap away.
// ---------------------------------------------------------------------------
function AddCustomer({
  open,
  onClose,
  t,
  storeId,
  customers,
  onPicked,
}: {
  open: boolean;
  onClose: () => void;
  t: T;
  storeId: string;
  customers: BookCustomer[];
  onPicked: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = name.trim() || phone.trim();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => matchesSearch(c, name.trim()) && matchesSearch(c, phone.trim()))
      .slice(0, 8);
  }, [customers, name, phone]);

  async function create() {
    const n = name.trim();
    if (!n) {
      setError(t.nameRequired);
      return;
    }
    const p = phone.trim();
    if (p && phoneIssue(p) === "tooShort") {
      setError(t.phoneInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insErr } = await supabase
      .from("store_customers")
      .insert({ store_id: storeId, name: n, phone: p || null })
      .select("id")
      .single();
    if (insErr) {
      // store_customers is unique on (store_id, phone): that number is already
      // one of this shop's customers, so open theirs instead of failing.
      if (insErr.code === "23505" && p) {
        const { data: existing } = await supabase
          .from("store_customers")
          .select("id")
          .eq("store_id", storeId)
          .eq("phone", p)
          .maybeSingle();
        setBusy(false);
        if (existing) {
          notifySuccess(t.phoneExists);
          onPicked((existing as { id: string }).id);
          return;
        }
      }
      setBusy(false);
      notifyError(t.saveFailed);
      return;
    }
    setBusy(false);
    setName("");
    setPhone("");
    onPicked((data as { id: string }).id);
  }

  return (
    <LedgerSheet
      open={open}
      onClose={onClose}
      title={t.addCustomerTitle}
      closeLabel={t.close}
      footer={
        <Button full size="lg" loading={busy} onClick={create}>
          {t.save}
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label={t.name} htmlFor="ledger-new-name" error={error ?? undefined}>
          <Input
            id="ledger-new-name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t.phone} htmlFor="ledger-new-phone" hint={t.phoneHint}>
          <Input
            id="ledger-new-phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>

      {customers.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-muted-foreground">{t.pickExisting}</p>
          {matches.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t.noMatches}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onPicked(c.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-surface-muted"
                  >
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    {c.phone && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <bdi dir="ltr">{c.phone}</bdi>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </LedgerSheet>
  );
}
