"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatUsd } from "@/lib/currency";
import {
  formatGiftAmount,
  formatGiftCode,
  giftErrorKey,
  isValidGiftCode,
  normalizeGiftCode,
  type GiftCurrency,
} from "@/lib/gift-cards";

// The gift card at checkout, kept out of checkout-form.tsx so the money path
// there changes by a handful of lines.
//
// Two steps, deliberately:
//   1. before the order: `gift_card_check` shows the balance (nothing moves);
//   2. after the order exists: `redeem_gift_card_order` spends it against that
//      order under a row lock (0310). A card is TENDER — it becomes a payment
//      on the order, the order's total is never rewritten.
// If step 2 fails (the card was spent elsewhere a second ago, the order has no
// rate for an LBP card…) the order still stands and the customer is told the
// full amount is due on delivery — nothing is silently lost either way.

const fieldClass =
  "mt-0 min-h-11 flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm uppercase outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";

export function CheckoutGiftCard({
  dict,
  lang,
  storeId,
  code,
  onCode,
}: {
  dict: Dictionary;
  lang: string;
  storeId: string;
  /** The checked code (normalised), or null. */
  code: string | null;
  onCode: (code: string | null) => void;
}) {
  const t = dict.loyaltyCards.checkout;
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    if (!isValidGiftCode(input)) {
      setMsg({ ok: false, text: t.invalidFormat });
      onCode(null);
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().rpc("gift_card_check", {
      p_store_id: storeId,
      p_code: normalizeGiftCode(input),
    });
    setBusy(false);
    const r = data as { ok: boolean; reason?: string; currency?: GiftCurrency; balance?: number } | null;
    if (error || !r || !r.ok) {
      const key = giftErrorKey(error?.message ?? r?.reason ?? null);
      setMsg({ ok: false, text: dict.loyaltyCards.gift.errors[key] });
      onCode(null);
      return;
    }
    setMsg({
      ok: true,
      text: t.valid.replace("{balance}", formatGiftAmount(Number(r.balance), r.currency ?? "USD", lang)),
    });
    onCode(normalizeGiftCode(input));
  }

  return (
    <details className="group rounded-xl border border-border" open={!!code || undefined}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors group-open:text-foreground hover:text-foreground">
        {code ? `${formatGiftCode(code)} ✓` : t.have}
      </summary>
      <div className="px-4 pb-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            dir="ltr"
            autoComplete="off"
            aria-label={t.have}
            className={fieldClass}
          />
          {code ? (
            <button
              type="button"
              onClick={() => {
                onCode(null);
                setInput("");
                setMsg(null);
              }}
              className="shrink-0 rounded-xl border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:border-danger hover:text-danger"
            >
              {t.remove}
            </button>
          ) : (
            <button
              type="button"
              onClick={check}
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-xl border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {t.check}
            </button>
          )}
        </div>
        {msg && (
          <p className={`mt-1 text-sm font-medium ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
        )}
      </div>
    </details>
  );
}

/**
 * Spend the checked code on the order that was just placed. Never throws:
 * returns the sentence the confirmation screen shows, success or not.
 */
export async function redeemGiftCardForOrder({
  orderId,
  code,
  dict,
}: {
  orderId: string;
  code: string;
  dict: Dictionary;
}): Promise<string> {
  const t = dict.loyaltyCards.checkout;
  try {
    const { data, error } = await createClient().rpc("redeem_gift_card_order", {
      p_order_id: orderId,
      p_code: code,
    });
    if (error || !data) {
      return t.failed.replace("{reason}", dict.loyaltyCards.gift.errors[giftErrorKey(error?.message)]);
    }
    const r = data as { applied_usd: number | string; due_usd: number | string };
    const applied = formatUsd(Number(r.applied_usd), { cents: true });
    const due = Number(r.due_usd);
    return due > 0
      ? t.applied.replace("{amount}", applied).replace("{due}", formatUsd(due, { cents: true }))
      : t.appliedFull.replace("{amount}", applied);
  } catch {
    return t.failed.replace("{reason}", dict.loyaltyCards.gift.errors.generic);
  }
}
