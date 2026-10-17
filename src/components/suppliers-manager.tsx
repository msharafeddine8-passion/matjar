"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  MessageCircle,
  PackagePlus,
  BanknoteArrowDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { waLink } from "@/lib/phone";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatUsd } from "@/lib/currency";

export type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
};

export type SupplierTx = {
  id: string;
  supplier_id: string;
  kind: "purchase" | "payment";
  label: string | null;
  amount: number;
  happened_on: string;
};

function fmt(n: number) {
  return formatUsd(n, { cents: true });
}

function waHref(phone: string) {
  return waLink(phone) ?? `tel:${phone}`;
}

// Suppliers module of the Business OS: who supplies you, and the running
// balance you owe them. Purchases raise the debt, payments settle it — the
// hand-written supplier notebook, digitized.
export function SuppliersManager({
  storeId,
  lang,
  dict,
  suppliers,
  transactions,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "common" | "merchant" | "os">;
  suppliers: SupplierRow[];
  transactions: SupplierTx[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.suppliers;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  // Per-supplier inline transaction draft.
  const [tx, setTx] = useState<{
    supplier: string;
    kind: "purchase" | "payment";
    amount: string;
    label: string;
  } | null>(null);

  const balance = (supplierId: string) =>
    transactions
      .filter((x) => x.supplier_id === supplierId)
      .reduce(
        (s, x) => s + (x.kind === "purchase" ? Number(x.amount) : -Number(x.amount)),
        0,
      );

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await createClient().from("store_suppliers").insert({
      store_id: storeId,
      name: name.trim(),
      phone: phone.trim() || null,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    setName("");
    setPhone("");
    router.refresh();
  }

  async function addTx(e: React.FormEvent) {
    e.preventDefault();
    if (!tx) return;
    const amount = Number(tx.amount);
    if (!amount || amount <= 0) return;
    setBusy(true);
    const { error } = await createClient().from("supplier_transactions").insert({
      store_id: storeId,
      supplier_id: tx.supplier,
      kind: tx.kind,
      amount,
      label: tx.label.trim() || null,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    setTx(null);
    router.refresh();
  }

  async function removeSupplier(id: string) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    const { error } = await createClient()
      .from("store_suppliers")
      .delete()
      .eq("id", id);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(
      lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
      { month: "short", day: "numeric", timeZone: "UTC" },
    );

  const txBtn = (kind: "purchase" | "payment", supplierId: string) => (
    <button
      type="button"
      onClick={() =>
        setTx(
          tx?.supplier === supplierId && tx.kind === kind
            ? null
            : { supplier: supplierId, kind, amount: "", label: "" },
        )
      }
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
        tx?.supplier === supplierId && tx.kind === kind
          ? "border-primary bg-primary-soft text-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
      title={kind === "purchase" ? t.purchaseHint : t.paymentHint}
    >
      {kind === "purchase" ? (
        <PackagePlus className="h-3.5 w-3.5" />
      ) : (
        <BanknoteArrowDown className="h-3.5 w-3.5" />
      )}
      {kind === "purchase" ? t.purchase : t.payment}
    </button>
  );

  return (
    <div>
      <form
        onSubmit={addSupplier}
        className="flex flex-wrap items-stretch gap-2 rounded-2xl border border-border bg-surface p-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.name}
          className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t.phone}
          dir="ltr"
          className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {t.add}
        </button>
      </form>

      {suppliers.length ? (
        <div className="mt-4 space-y-2">
          {suppliers.map((s) => {
            const bal = balance(s.id);
            const txs = transactions.filter((x) => x.supplier_id === s.id);
            return (
              <details
                key={s.id}
                className="rounded-2xl border border-border bg-surface"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
                    {s.name.trim().charAt(0) || "؟"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{s.name}</span>
                    {s.phone && (
                      <span dir="ltr" className="block text-sm text-muted-foreground">
                        {s.phone}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-sm font-extrabold tabular-nums ${
                      bal > 0
                        ? "bg-warning-soft text-warning"
                        : "bg-success-soft text-success"
                    }`}
                  >
                    {bal > 0 ? `${t.owed} ${fmt(bal)}` : t.settled}
                  </span>
                  {s.phone && (
                    <a
                      href={waHref(s.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="WhatsApp"
                      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-whatsapp text-whatsapp-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-whatsapp-hover"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  )}
                </summary>

                <div className="border-t border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {txBtn("purchase", s.id)}
                    {txBtn("payment", s.id)}
                    <button
                      type="button"
                      onClick={() => removeSupplier(s.id)}
                      className="ms-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {dict.merchant.products.delete}
                    </button>
                  </div>

                  {tx?.supplier === s.id && (
                    <form
                      onSubmit={addTx}
                      className="mt-3 flex flex-wrap items-stretch gap-2 rounded-xl bg-surface-muted p-2.5"
                    >
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={tx.amount}
                        onChange={(e) => setTx({ ...tx, amount: e.target.value })}
                        placeholder={t.amount}
                        className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <input
                        value={tx.label}
                        onChange={(e) => setTx({ ...tx, label: e.target.value })}
                        placeholder={t.label}
                        className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1"
                      />
                      <button
                        type="submit"
                        disabled={busy || !Number(tx.amount)}
                        className="relative inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-bold whitespace-nowrap text-primary-foreground shadow-sm transition-[transform,box-shadow,background-color] duration-150 select-none hover:bg-primary-hover hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55"
                      >
                        {t.add}
                      </button>
                    </form>
                  )}

                  {txs.length ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-border">
                      {txs.map((x, i) => (
                        <div
                          key={x.id}
                          className={`flex items-center gap-3 p-2.5 text-sm ${i > 0 ? "border-t border-border" : ""}`}
                        >
                          <span
                            className={`w-20 shrink-0 text-center font-extrabold tabular-nums ${
                              x.kind === "purchase"
                                ? "text-warning"
                                : "text-success"
                            }`}
                            dir="ltr"
                          >
                            {x.kind === "purchase" ? "+" : "-"}
                            {fmt(Number(x.amount))}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {x.label ??
                              (x.kind === "purchase" ? t.purchase : t.payment)}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {fmtDate(x.happened_on)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t.emptyTx}
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
          {t.empty}
        </div>
      )}
    </div>
  );
}
