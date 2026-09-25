"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatUsd } from "@/lib/currency";
import { phoneKey } from "@/lib/wa-templates";
import { waUrl } from "@/lib/phone";
import { loyaltyCardPath, memberWaNumber, type LoyaltyKind } from "@/lib/loyalty";
import {
  formatGiftAmount,
  giftErrorKey,
  isValidGiftCode,
  normalizeGiftCode,
  type GiftCurrency,
} from "@/lib/gift-cards";

// The two optional POS fields — the customer's phone for the loyalty card and
// a gift-card code — and what happens after the sale is recorded. Kept out of
// pos-terminal.tsx so the till's own money path changes by a few lines.
//
// Order matters and is deliberate: pos_record_sale records the sale FIRST
// (unchanged); only then are the extras applied to that sale id, each by its
// own 0310 RPC under the cashier's permission. A failed extra never undoes
// the sale — the cashier is told plainly what to collect instead.

export type PosExtrasConfig = {
  /** The store's active program kind, or null when there is none. */
  loyalty: LoyaltyKind | null;
  /** The store has at least one spendable gift card. */
  giftCards: boolean;
  lang: string;
  storeName: string;
  siteUrl: string;
};

export type PosExtrasValue = { phone: string; giftCode: string };

export type PosExtrasLine = { ok: boolean; text: string; waHref?: string };

const field =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function PosExtrasFields({
  config,
  value,
  onChange,
  dict,
  storeId,
}: {
  config: PosExtrasConfig;
  value: PosExtrasValue;
  onChange: (v: PosExtrasValue) => void;
  dict: Dictionary;
  storeId: string;
}) {
  const t = dict.loyaltyCards.pos;
  const [giftMsg, setGiftMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!config.loyalty && !config.giftCards) return null;

  async function checkGift() {
    if (!isValidGiftCode(value.giftCode)) {
      setGiftMsg({ ok: false, text: dict.loyaltyCards.checkout.invalidFormat });
      return;
    }
    const { data, error } = await createClient().rpc("gift_card_check", {
      p_store_id: storeId,
      p_code: normalizeGiftCode(value.giftCode),
    });
    const r = data as { ok: boolean; reason?: string; currency?: GiftCurrency; balance?: number } | null;
    if (error || !r || !r.ok) {
      setGiftMsg({ ok: false, text: dict.loyaltyCards.gift.errors[giftErrorKey(error?.message ?? r?.reason ?? null)] });
      return;
    }
    setGiftMsg({
      ok: true,
      text: t.giftValid.replace("{balance}", formatGiftAmount(Number(r.balance), r.currency ?? "USD", config.lang)),
    });
  }

  return (
    <>
      {config.loyalty && (
        <label className="block text-sm">
          <span className="font-semibold text-muted-foreground">{t.loyaltyPhone}</span>
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            placeholder="03 123 456"
            className={field}
          />
        </label>
      )}
      {config.giftCards && (
        <div className="block text-sm">
          <label className="font-semibold text-muted-foreground" htmlFor="pos-gift-code">
            {t.giftCode}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="pos-gift-code"
              dir="ltr"
              autoComplete="off"
              value={value.giftCode}
              onChange={(e) => {
                setGiftMsg(null);
                onChange({ ...value, giftCode: e.target.value });
              }}
              placeholder="XXXX-XXXX-XXXX"
              className={`${field} mt-0 uppercase`}
            />
            <button
              type="button"
              onClick={checkGift}
              disabled={!value.giftCode.trim()}
              className="shrink-0 rounded-lg border border-border px-3 text-xs font-bold hover:border-primary/40 disabled:opacity-60"
            >
              {t.check}
            </button>
          </div>
          {giftMsg && (
            <p className={`mt-1 text-xs font-semibold ${giftMsg.ok ? "text-success" : "text-danger"}`}>{giftMsg.text}</p>
          )}
        </div>
      )}
    </>
  );
}

/** Apply the extras to a sale that has just been recorded. Never throws. */
export async function applyPosExtras({
  saleId,
  value,
  config,
  dict,
}: {
  saleId: string;
  value: PosExtrasValue;
  config: PosExtrasConfig;
  dict: Dictionary;
}): Promise<PosExtrasLine[]> {
  const t = dict.loyaltyCards.pos;
  const out: PosExtrasLine[] = [];
  const supabase = createClient();

  if (config.giftCards && value.giftCode.trim()) {
    try {
      const { data, error } = await supabase.rpc("redeem_gift_card_pos", {
        p_sale_id: saleId,
        p_code: normalizeGiftCode(value.giftCode),
      });
      if (error || !data) {
        out.push({
          ok: false,
          text: t.giftFailed.replace("{reason}", dict.loyaltyCards.gift.errors[giftErrorKey(error?.message)]),
        });
      } else {
        const r = data as { applied_usd: number | string; due_usd: number | string };
        out.push({
          ok: true,
          text: t.giftApplied
            .replace("{amount}", formatUsd(Number(r.applied_usd), { cents: true }))
            .replace("{due}", formatUsd(Number(r.due_usd), { cents: true })),
        });
      }
    } catch {
      out.push({ ok: false, text: t.giftFailed.replace("{reason}", dict.loyaltyCards.gift.errors.generic) });
    }
  }

  const key = phoneKey(value.phone);
  if (config.loyalty && key) {
    try {
      const { data, error } = await supabase.rpc("loyalty_credit_pos_sale", {
        p_sale_id: saleId,
        p_phone: value.phone,
        p_name: null,
      });
      if (error) {
        const m = error.message.toLowerCase();
        const reason = m.includes("bad_phone")
          ? dict.loyaltyCards.members.badPhone
          : m.includes("not allowed")
            ? dict.loyaltyCards.common.notAllowed
            : dict.loyaltyCards.common.error;
        out.push({ ok: false, text: t.loyaltyFailed.replace("{reason}", reason) });
      } else if (!data) {
        out.push({ ok: true, text: t.loyaltyNothing });
      } else {
        const r = data as { kind: LoyaltyKind; delta: number; balance: number; token: string };
        const unit = r.kind === "stamps" ? dict.loyaltyCards.common.stamps : dict.loyaltyCards.common.points;
        const wa = memberWaNumber(key);
        const link = `${config.siteUrl}${loyaltyCardPath(config.lang, r.token)}`;
        out.push({
          ok: true,
          text: t.loyaltyAdded
            .replace("{n}", String(r.delta))
            .replace("{unit}", unit)
            .replace("{balance}", String(r.balance)),
          waHref: wa
            ? waUrl(
                wa,
                dict.loyaltyCards.members.waMessageNoName
                  .replace("{store}", config.storeName)
                  .replace("{link}", link),
              )
            : undefined,
        });
      }
    } catch {
      out.push({ ok: false, text: t.loyaltyFailed.replace("{reason}", dict.loyaltyCards.common.error) });
    }
  }
  return out;
}

export function PosExtrasResult({ lines, dict }: { lines: PosExtrasLine[]; dict: Dictionary }) {
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {lines.map((l, i) => (
        <li
          key={i}
          className={`rounded-xl p-2.5 text-sm font-semibold ${l.ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
        >
          {l.text}
          {l.waHref && (
            <a
              href={l.waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="ms-2 inline-flex items-center gap-1 underline"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {dict.loyaltyCards.pos.sendCard}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
