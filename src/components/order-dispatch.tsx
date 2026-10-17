"use client";

// Dispatch panel on a merchant's order. Everything here goes through the two
// RPCs in migration 0213 — never a direct table write — because the plan gate
// and the forward-only status machine live there, not in this file.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Truck, Copy, Check, Lock, MessageCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { waLink } from "@/lib/whatsapp";
import { waNumber } from "@/lib/phone";
import { formatUsd } from "@/lib/currency";
import { dispatchErrorKey } from "@/lib/dispatch-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Dictionary } from "@/i18n/get-dictionary";

export type DispatchCourier = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  price: number | null;
};

export type DeliveryRequest = {
  id: string;
  company_id: string;
  status: "requested" | "picked_up" | "in_transit" | "delivered" | "cancelled";
  fee: number;
  tracking_ref: string;
};

const FLOW = ["requested", "picked_up", "in_transit", "delivered"] as const;

export function OrderDispatch({
  orderId,
  lang,
  storeId,
  storeName,
  customerName,
  customerPhone = null,
  address,
  couriers,
  request,
  canDispatch,
  dict,
}: {
  orderId: string;
  lang: string;
  storeId: string;
  storeName: string;
  customerName: string | null;
  /** Where «ابعت للزبون» sends the tracking link. */
  customerPhone?: string | null;
  address: string | null;
  couriers: DispatchCourier[];
  request: DeliveryRequest | null;
  canDispatch: boolean;
  dict: Dictionary;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.merchant.dispatch;
  // The RPCs refuse in developer English; say it in the merchant's words.
  const errorText = (message: string | undefined) => {
    const key = dispatchErrorKey(message);
    return key ? t[key] : dict.auth.errorGeneric;
  };
  // Without a number the old link opened WhatsApp with no recipient, leaving
  // the merchant to hunt for the customer in their contacts.
  const customerWa = waNumber(customerPhone);
  const [companyId, setCompanyId] = useState(couriers[0]?.id ?? "");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const courier = request
    ? couriers.find((c) => c.id === request.company_id)
    : couriers.find((c) => c.id === companyId);

  const trackUrl =
    request && typeof window !== "undefined"
      ? `${window.location.origin}/${lang}/delivery/track/${request.tracking_ref}`
      : "";

  async function dispatch() {
    if (!companyId) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("request_delivery", {
      p_order_id: orderId,
      p_company_id: companyId,
      p_fee: fee.trim() === "" ? null : Number(fee),
      p_note: null,
    });
    setBusy(false);
    if (error) {
      notifyError(errorText(error.message));
      return;
    }
    router.refresh();
  }

  async function advance(status: string) {
    if (
      status === "cancelled" &&
      !(await confirm({
        message: t.cancelConfirm,
        confirmLabel: t.cancel,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_delivery_status", {
      p_request_id: request!.id,
      p_status: status,
    });
    setBusy(false);
    if (error) {
      notifyError(errorText(error.message));
      // A stale step (someone else advanced or cancelled it) — show the truth.
      if (dispatchErrorKey(error.message)) router.refresh();
      return;
    }
    router.refresh();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notifyError(dict.auth.errorGeneric);
    }
  }

  const shell =
    "space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-sm";
  const header = (
    <div className="flex items-center gap-2">
      <Truck className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-bold">{t.title}</h3>
    </div>
  );

  // Locked, not hidden — a feature the merchant never sees is a feature they
  // never upgrade for.
  if (!canDispatch) {
    return (
      <div className={shell}>
        {header}
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          {t.locked}
        </p>
        <Link
          href={`/${lang}/merchant/${storeId}/subscription`}
          className="inline-block rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          {t.lockedCta}
        </Link>
      </div>
    );
  }

  if (couriers.length === 0) {
    return (
      <div className={shell}>
        {header}
        <p className="text-sm text-muted-foreground">{t.none}</p>
      </div>
    );
  }

  // ── Live dispatch ────────────────────────────────────────────────────────
  if (request && request.status !== "cancelled") {
    const at = FLOW.indexOf(request.status as (typeof FLOW)[number]);
    const next = at >= 0 && at < FLOW.length - 1 ? FLOW[at + 1] : null;

    return (
      <div className={shell}>
        {header}

        <ol className="flex flex-wrap items-center gap-1.5">
          {FLOW.map((s, i) => (
            <li
              key={s}
              className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                i <= at
                  ? "bg-primary-soft/40 text-primary"
                  : "bg-muted/40 text-muted-foreground"
              }`}
            >
              {t.status[s]}
            </li>
          ))}
        </ol>

        <p className="text-sm">
          <span className="text-muted-foreground">{t.trackingRef}: </span>
          <span className="font-mono font-bold">{request.tracking_ref}</span>
          {courier ? (
            <span className="text-muted-foreground"> · {courier.name}</span>
          ) : null}
        </p>

        <div className="flex flex-wrap gap-2">
          {next && (
            <button
              type="button"
              onClick={() => advance(next)}
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {t.markAs} {t.status[next]}
            </button>
          )}

          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted/40"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t.copied : t.copyLink}
          </button>

          {customerWa ? (
            <a
              href={waLink(
                customerWa,
                t.waCustomer
                  .replace("{store}", storeName)
                  .replace("{link}", trackUrl),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {t.sendCustomer}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-semibold text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              {t.noCustomerPhone}
            </span>
          )}

          {courier?.whatsapp && (
            <a
              href={waLink(
                courier.whatsapp,
                t.waCourier
                  .replace("{store}", storeName)
                  .replace("{customer}", customerName ?? "—")
                  .replace("{address}", address ?? "—")
                  .replace("{fee}", formatUsd(Number(request.fee), { cents: true }))
                  .replace("{ref}", request.tracking_ref),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {t.messageCourier}
            </a>
          )}

          {request.status !== "delivered" && (
            <button
              type="button"
              onClick={() => advance("cancelled")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 px-3 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              {t.cancel}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── No live dispatch ─────────────────────────────────────────────────────
  return (
    <div className={shell}>
      {header}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            {t.choose}
          </span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.price != null
                  ? ` — ${formatUsd(Number(c.price), { cents: true })}`
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            {t.fee}
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder={courier?.price != null ? String(courier.price) : "0.00"}
            className="w-28 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>

        <button
          type="button"
          onClick={dispatch}
          disabled={busy || !companyId}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? t.sending : t.send}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{t.feeHint}</p>
    </div>
  );
}
