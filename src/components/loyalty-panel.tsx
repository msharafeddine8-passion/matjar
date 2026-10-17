"use client";

import { useEffect, useState } from "react";
import { Gift, Sparkles, Copy, Check, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

const REFERRAL_BONUS = 200;

type LedgerRow = { delta: number; reason: string; created_at: string };

const TIERS = [
  { key: "tierBronze", min: 0 },
  { key: "tierSilver", min: 500 },
  { key: "tierGold", min: 2000 },
  { key: "tierPlatinum", min: 5000 },
] as const;

type Tier = (typeof TIERS)[number];

function tierFor(balance: number) {
  let current: Tier = TIERS[0];
  let next: Tier | null = null;
  for (let i = 0; i < TIERS.length; i++) {
    if (balance >= TIERS[i].min) {
      current = TIERS[i];
      next = TIERS[i + 1] ?? null;
    }
  }
  return { current, next };
}

export function LoyaltyPanel({
  lang,
  dict,
  balance,
  code,
  referralCount,
  history,
  siteUrl,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "loyalty">;
  balance: number;
  code: string;
  referralCount: number;
  history: LedgerRow[];
  siteUrl: string;
}) {
  const t = dict.loyalty;
  const [copied, setCopied] = useState(false);
  const [byStore, setByStore] = useState<
    { store_id: string; store_name: string; balance: number }[]
  >([]);
  const link = `${siteUrl}/${lang}/signup?ref=${code}`;

  // Points are earned + spent PER STORE — fetch the per-store breakdown so the
  // customer sees what's actually redeemable where (the big number above is the
  // lifetime total that drives their tier).
  useEffect(() => {
    createClient()
      .rpc("my_loyalty_by_store")
      .then(({ data }) => {
        setByStore(
          (data ?? []) as {
            store_id: string;
            store_name: string;
            balance: number;
          }[],
        );
      });
  }, []);

  // Attribute a referral captured at signup time (works even after email
  // confirmation, since this runs whenever the referred user opens /account).
  useEffect(() => {
    let ref: string | null = null;
    try {
      ref = localStorage.getItem("matjar-ref");
    } catch {
      ref = null;
    }
    if (!ref) return;
    const supabase = createClient();
    supabase
      .rpc("record_referral", { p_code: ref })
      .then(() => {
        try {
          localStorage.removeItem("matjar-ref");
        } catch {
          /* ignore */
        }
      });
  }, []);

  const { current, next } = tierFor(balance);
  const reasonLabel = (r: string) =>
    r === "order"
      ? t.reasonOrder
      : r === "referral_referrer"
        ? t.reasonReferralReferrer
        : r === "referral_referred"
          ? t.reasonReferralReferred
          : t.reasonRedeem;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-bold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.howItWorks}</p>
        </div>
      </div>

      {/* Points + tier */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-hover p-5 text-primary-foreground">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm opacity-80">{t.pointsBalance}</p>
            <p className="text-4xl font-extrabold tabular-nums">
              {balance.toLocaleString("en-US")}
            </p>
            <p className="text-sm opacity-80">{t.points}</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold">
            <Trophy className="h-4 w-4" />
            {t[current.key]}
          </div>
        </div>
        <p className="mt-3 text-sm opacity-90">
          {next
            ? t.toNextTier
                .replace("{n}", (next.min - balance).toLocaleString("en-US"))
                .replace("{tier}", t[next.key])
            : t.maxTier}
        </p>
      </div>

      {/* Points by store — what's actually redeemable, and where. */}
      {byStore.length > 0 && (
        <div className="rounded-2xl border border-border bg-background p-5">
          <h3 className="text-sm font-bold">{t.byStoreTitle}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.byStoreNote}</p>
          <ul className="mt-3 divide-y divide-border">
            {byStore.map((b) => (
              <li
                key={b.store_id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <a
                  href={`/${lang}/store/${b.store_id}`}
                  className="font-semibold hover:text-primary"
                >
                  {b.store_name}
                </a>
                <span className="font-bold tabular-nums text-primary">
                  {Number(b.balance).toLocaleString("en-US")} {t.points}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Referral */}
      <div className="rounded-2xl border border-border bg-background p-5">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <h3 className="font-bold">{t.referralTitle}</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.referralSubtitle.replace("{n}", String(REFERRAL_BONUS))}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-surface-muted px-3 py-2 text-sm font-bold tracking-wider">
            {code}
          </code>
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t.copied : t.copyLink}
          </button>
          {referralCount > 0 && (
            <span className="text-sm font-semibold text-muted-foreground">
              {referralCount} {t.referralsCount}
            </span>
          )}
        </div>
      </div>

      {/* History */}
      {history.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-bold">{t.history}</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {history.map((h, i) => (
              <li
                key={i}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-muted-foreground">
                  {reasonLabel(h.reason)}
                </span>
                <span
                  className={`font-bold tabular-nums ${h.delta >= 0 ? "text-primary" : "text-danger"}`}
                >
                  {h.delta >= 0 ? "+" : ""}
                  {h.delta}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      )}
    </div>
  );
}
