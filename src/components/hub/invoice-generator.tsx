"use client";

import { useState, useSyncExternalStore } from "react";
import { Plus, Printer, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { trackToolUse } from "@/lib/track-tool";

const field =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

type Item = { name: string; qty: string; price: string };

function money(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Today, in the browser's own timezone, as the <input type="date"> wants it.
// Read through useSyncExternalStore rather than set in an effect: the server has
// no local date, so "" is its snapshot and the real one arrives at hydration —
// which is exactly the mismatch the effect was working around. The date never
// changes mid-session, so there is nothing to subscribe to.
const subscribeToNothing = () => () => {};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Invoice generator: a form drives a live A4-style preview; printing uses the
// browser (window.print) so Arabic RTL renders perfectly with no PDF library
// and no font-embedding headache. A scoped @media print rule isolates the sheet.
export function InvoiceGenerator({ dict }: { dict: Pick<Dictionary, "hub"> }) {
  const t = dict.hub.tools.invoice;
  const [seller, setSeller] = useState("");
  const [sellerInfo, setSellerInfo] = useState("");
  const [buyer, setBuyer] = useState("");
  const [buyerInfo, setBuyerInfo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("001");
  const [currency, setCurrency] = useState("$");
  const [vatPct, setVatPct] = useState("11");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([{ name: "", qty: "1", price: "" }]);

  // Defaults to today; once the merchant picks a date, their choice wins.
  const today = useSyncExternalStore(subscribeToNothing, localToday, () => "");
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const date = pickedDate ?? today;

  const rows = items.map((it) => ({
    ...it,
    line: (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0),
  }));
  const subtotal = rows.reduce((s, r) => s + r.line, 0);
  const vat = subtotal * ((parseFloat(vatPct) || 0) / 100);
  const total = subtotal + vat;

  function setItem(i: number, patch: Partial<Item>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((arr) => [...arr, { name: "", qty: "1", price: "" }]);
  }
  function removeItem(i: number) {
    setItems((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }
  function print() {
    trackToolUse("invoice");
    window.print();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* print isolation */}
      <style>{`@media print{body{background:#fff!important}body *{visibility:hidden!important}.invoice-sheet,.invoice-sheet *{visibility:visible!important}.invoice-sheet{position:absolute;inset-inline-start:0;top:0;width:100%;border:none!important;box-shadow:none!important;border-radius:0!important}.no-print{display:none!important}}`}</style>

      {/* ===== FORM (hidden when printing) ===== */}
      <div className="no-print grid content-start gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.invoiceNo}</span><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={field} /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.date}</span><input type="date" value={date} onChange={(e) => setPickedDate(e.target.value)} className={field} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.seller}</span><input value={seller} onChange={(e) => setSeller(e.target.value)} className={field} /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.buyer}</span><input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={field} /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.sellerInfo}</span><input value={sellerInfo} onChange={(e) => setSellerInfo(e.target.value)} className={field} /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.buyerInfo}</span><input value={buyerInfo} onChange={(e) => setBuyerInfo(e.target.value)} className={field} /></label>
        </div>

        <div>
          <span className="text-sm font-semibold">{t.items}</span>
          <div className="mt-2 grid gap-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder={t.itemName} className={`${field} flex-1`} />
                <input value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} placeholder={t.itemQty} inputMode="numeric" className={`${field} w-16`} />
                <input value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} placeholder={t.itemPrice} inputMode="decimal" className={`${field} w-24`} />
                <button type="button" onClick={() => removeItem(i)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger" aria-label={t.itemName}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addItem} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
            <Plus className="h-4 w-4" /> {t.addItem}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.vatPct}</span><input value={vatPct} onChange={(e) => setVatPct(e.target.value)} inputMode="decimal" className={field} /></label>
          <label className="grid gap-1"><span className="text-sm font-semibold">{t.currency}</span><input value={currency} onChange={(e) => setCurrency(e.target.value)} className={field} /></label>
        </div>
        <label className="grid gap-1"><span className="text-sm font-semibold">{t.notes}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.notesPlaceholder} rows={2} className={field} /></label>

        <Button onClick={print} leftIcon={<Printer className="h-4 w-4" />}>{t.print}</Button>
      </div>

      {/* ===== LIVE PREVIEW / PRINT SHEET ===== */}
      <div>
        <p className="no-print mb-2 text-sm font-semibold text-muted-foreground">{t.preview}</p>
        <div className="invoice-sheet rounded-2xl border border-border bg-white p-7 text-[13px] text-slate-800 shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-4">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">{seller || t.seller}</h2>
              {sellerInfo && <p className="mt-1 whitespace-pre-line text-slate-500">{sellerInfo}</p>}
            </div>
            <div className="text-end">
              <p className="text-xl font-extrabold uppercase tracking-wide text-slate-900">{t.invoiceWord}</p>
              <p className="mt-1 text-slate-500">#{invoiceNo}</p>
              <p className="text-slate-500" dir="ltr">{date}</p>
            </div>
          </div>

          {(buyer || buyerInfo) && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase text-slate-400">{t.buyer}</p>
              <p className="font-bold text-slate-900">{buyer}</p>
              {buyerInfo && <p className="whitespace-pre-line text-slate-500">{buyerInfo}</p>}
            </div>
          )}

          <table className="mt-5 w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-slate-300 text-xs uppercase text-slate-500">
                <th className="py-2 text-start font-semibold">{t.itemName}</th>
                <th className="py-2 text-center font-semibold">{t.itemQty}</th>
                <th className="py-2 text-end font-semibold">{t.itemPrice}</th>
                <th className="py-2 text-end font-semibold">{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.name || r.line > 0).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 text-start">{r.name || "—"}</td>
                  <td className="py-2 text-center tabular-nums">{r.qty}</td>
                  <td className="py-2 text-end tabular-nums">{money(parseFloat(r.price) || 0)}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">{money(r.line)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-[220px] space-y-1.5">
              <div className="flex justify-between text-slate-500"><span>{t.subtotal}</span><span className="tabular-nums">{money(subtotal)} {currency}</span></div>
              <div className="flex justify-between text-slate-500"><span>{t.vat} ({vatPct || 0}%)</span><span className="tabular-nums">{money(vat)} {currency}</span></div>
              <div className="flex justify-between border-t-2 border-slate-800 pt-1.5 text-base font-extrabold text-slate-900"><span>{t.total}</span><span className="tabular-nums">{money(total)} {currency}</span></div>
            </div>
          </div>

          {notes && <p className="mt-5 border-t border-slate-100 pt-3 text-slate-500">{notes}</p>}
        </div>
      </div>
    </div>
  );
}
