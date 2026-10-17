"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Money } from "@/components/ui/money";
import {
  paymentMethodLabel,
  paymentNoteLabel,
} from "@/lib/order-payment-labels";

export type OrderPayment = {
  id: string;
  kind: "payment" | "refund";
  amount: number;
  method: string | null;
  note: string | null;
  created_at: string;
};

// Per-order money ledger: recorded payments and refunds, plus a form to add one.
// Writes go through the server RPC record_order_payment (re-validates authority
// and caps amounts) — the client only displays and requests.
export function OrderPayments({
  orderId,
  orderTotal,
  orderStatus,
  payments,
  dict,
}: {
  orderId: string;
  /** What the order is worth — the ceiling on a refund once it is completed. */
  orderTotal: number;
  orderStatus: string;
  payments: OrderPayment[];
  dict: Dictionary;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.payments;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"payment" | "refund">("payment");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const paid = payments
    .filter((p) => p.kind === "payment")
    .reduce((s, p) => s + Number(p.amount), 0);
  const refunded = payments
    .filter((p) => p.kind === "refund")
    .reduce((s, p) => s + Number(p.amount), 0);
  // A completed order was paid for even when nobody keyed the payment in —
  // cash arrives at the door, not in the app, and across the whole platform
  // exactly one payment row has ever been typed. Counting it as unpaid made
  // every refund fail (0247), which left cancelling the order as the only way
  // out, which is the thing 0246 just closed.
  const settled =
    orderStatus === "completed" ? Math.max(paid, orderTotal) : paid;
  const net = settled - refunded;
  const refundable = Math.max(0, settled - refunded);

  async function submit() {
    const amt = Number(amount);
    if (!amt || amt <= 0 || busy) return;
    if (
      kind === "refund" &&
      !(await confirm({
        message: t.confirmRefund,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const { error } = await createClient().rpc("record_order_payment", {
      p_order_id: orderId,
      p_kind: kind,
      p_amount: amt,
      p_method: method.trim() || null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      const m = error.message ?? "";
      notifyError(
        m.includes("exceeds_paid")
          ? t.exceedsPaid
          : m.includes("exceeds_total")
            ? t.exceedsTotal
            : dict.common.actionFailed,
      );
      return;
    }
    notifySuccess(t.save);
    setAmount("");
    setMethod("");
    setNote("");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
          <Wallet className="h-4 w-4" />
          {t.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
          {/* Sums of floats: 0.1 + 0.2 must not print as $0.30000000000000004. */}
          <span className="text-success">
            {t.paid}: <Money value={settled} cents />
          </span>
          {refunded > 0 && (
            <span className="text-danger">
              {t.refunded}: <Money value={refunded} cents />
            </span>
          )}
          <span>
            {t.net}: <Money value={net} cents />
          </span>
        </span>
      </div>

      {payments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {payments.map((p) => {
            // The gift-card writer (0310) stores a bilingual method and an
            // English note; show both in the merchant's language.
            const methodText = paymentMethodLabel(p.method, t);
            const noteText = paymentNoteLabel(p.note, t);
            return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
            >
              <span className="flex items-center gap-1.5">
                {p.kind === "refund" ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-danger" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 text-success" />
                )}
                <span className="font-semibold text-foreground">
                  {p.kind === "refund" ? t.refund : t.payment}
                </span>
                {methodText ? ` · ${methodText}` : ""}
                {noteText ? ` · ${noteText}` : ""}
              </span>
              <Money
                value={Number(p.amount)}
                cents
                prefix={p.kind === "refund" ? "−" : "+"}
                className={
                  p.kind === "refund"
                    ? "font-bold text-danger"
                    : "font-bold text-success"
                }
              />
            </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface-muted/50 p-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            {t.kind}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "payment" | "refund")}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="payment">{t.payment}</option>
              <option value="refund">{t.refund}</option>
            </select>
          </label>
          <label className="text-xs font-semibold">
            {t.amount}
            <input
              type="number"
              min="0"
              step="0.01"
              max={kind === "refund" ? refundable : orderTotal - paid}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="text-xs font-semibold">
            {t.method}
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder={t.methodHint}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="text-xs font-semibold">
            {t.note}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              onClick={submit}
              disabled={busy}
              className="relative inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-bold whitespace-nowrap text-primary-foreground shadow-sm transition-[transform,box-shadow,background-color] duration-150 select-none hover:bg-primary-hover hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55"
            >
              {t.save}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.record}
        </button>
      )}
    </div>
  );
}
