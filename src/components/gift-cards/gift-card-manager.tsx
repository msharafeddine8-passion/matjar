"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, Copy, Gift, MessageCircle, Printer, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { waUrl } from "@/lib/phone";
import { refreshGiftCardCheckout } from "@/app/[lang]/(dashboard)/merchant/[storeId]/gift-cards/actions";
import {
  formatGiftAmount,
  formatGiftCode,
  giftAmountIssue,
  giftCardPath,
  giftCardReport,
  giftCardStatus,
  giftErrorKey,
  type GiftCardRow,
  type GiftCurrency,
} from "@/lib/gift-cards";

// The owner's gift-card screen: issue, list, void, and the liability report.
// Issuing and voiding are 0310 RPCs (issue_gift_card re-checks owner + plan);
// the code is minted by the database, never here.

const field =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function GiftCardManager({
  storeId,
  storeName,
  lang,
  dict,
  cards,
  canIssue,
  lbpRate,
  siteUrl,
  today,
  setupPending,
}: {
  storeId: string;
  storeName: string;
  lang: string;
  dict: Dictionary;
  cards: GiftCardRow[];
  canIssue: boolean;
  lbpRate: number;
  siteUrl: string;
  /** Beirut calendar day, computed on the server so both renders agree. */
  today: string;
  setupPending: boolean;
}) {
  const t = dict.loyaltyCards.gift;
  const report = giftCardReport(cards, today);
  return (
    <div className="space-y-8">
      {setupPending && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          {dict.loyaltyCards.common.setupPending}
        </p>
      )}
      {canIssue ? (
        <IssueForm storeId={storeId} storeName={storeName} lang={lang} dict={dict} lbpRate={lbpRate} siteUrl={siteUrl} today={today} />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">{t.lockedList}</p>
      )}

      {report.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-extrabold">{t.report}</h2>
            <p className="text-xs text-muted-foreground">{t.reportNote}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {report.map((r) => (
              <div key={r.currency} className="rounded-2xl border border-border bg-surface p-4 text-sm">
                <p className="flex items-center justify-between font-bold">
                  <span>{r.currency === "USD" ? t.usd : t.lbp}</span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {t.reportCount.replace("{n}", String(r.issuedCount))}
                  </span>
                </p>
                <dl className="mt-2 space-y-1">
                  {(
                    [
                      [t.reportIssued, r.issued],
                      [t.reportRedeemed, r.redeemed],
                      [t.reportOutstanding, r.outstanding],
                      [t.reportExpired, r.expired],
                      [t.reportVoided, r.voided],
                    ] as const
                  ).map(([label, value], i) => (
                    <div key={i} className={`flex justify-between gap-2 ${i === 2 ? "font-extrabold text-primary" : ""}`}>
                      <dt>{label}</dt>
                      <dd className="tabular-nums">
                        <bdi dir="ltr">{formatGiftAmount(value, r.currency, lang)}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
                {r.currency === "LBP" && lbpRate > 0 && r.outstanding > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.approx.replace("{value}", formatGiftAmount(Math.round((r.outstanding / lbpRate) * 100) / 100, "USD", lang))}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">{t.list}</h2>
        {cards.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {cards.map((c) => (
              <CardRow key={c.id} card={c} storeId={storeId} storeName={storeName} lang={lang} dict={dict} siteUrl={siteUrl} today={today} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function IssueForm({
  storeId,
  storeName,
  lang,
  dict,
  lbpRate,
  siteUrl,
  today,
}: {
  storeId: string;
  storeName: string;
  lang: string;
  dict: Dictionary;
  lbpRate: number;
  siteUrl: string;
  today: string;
}) {
  const t = dict.loyaltyCards.gift;
  const router = useRouter();
  const [currency, setCurrency] = useState<GiftCurrency>("USD");
  const [amount, setAmount] = useState("");
  const [expires, setExpires] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ id: string; code: string; token: string; amount: number; currency: GiftCurrency } | null>(null);

  const n = Number(amount);
  const amountIssue = amount ? giftAmountIssue(n, currency) : null;
  const approx =
    lbpRate > 0 && n > 0 && !amountIssue
      ? currency === "USD"
        ? formatGiftAmount(Math.round(n * lbpRate), "LBP", lang)
        : formatGiftAmount(Math.round((n / lbpRate) * 100) / 100, "USD", lang)
      : null;

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    const problem = giftAmountIssue(n, currency);
    if (problem) {
      notifyError(t.amountIssues[problem]);
      return;
    }
    if (expires && expires < today) {
      notifyError(t.badExpiry);
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().rpc("issue_gift_card", {
      p_store_id: storeId,
      p_currency: currency,
      p_amount: n,
      p_expires_on: expires || null,
      p_recipient_name: recipient.trim() || null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error || !data) {
      const msg = error?.message ?? "";
      notifyError(msg.includes("bad_expiry") ? t.badExpiry : t.errors[giftErrorKey(msg)]);
      return;
    }
    const d = data as { id: string; code: string; token: string };
    setIssued({ ...d, amount: n, currency });
    setAmount("");
    setRecipient("");
    setNote("");
    setExpires("");
    await refreshGiftCardCheckout(storeId);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      {issued && (
        <IssuedCard
          storeId={storeId}
          storeName={storeName}
          lang={lang}
          dict={dict}
          siteUrl={siteUrl}
          card={issued}
          onClose={() => setIssued(null)}
        />
      )}
      <form onSubmit={issue} className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-extrabold">{t.issueTitle}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="text-sm">
            <legend className="font-semibold">{t.currency}</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["USD", "LBP"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                  className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                    currency === c ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {c === "USD" ? t.usd : t.lbp}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="font-semibold">{t.amount}</span>
            <input
              type="number"
              inputMode="decimal"
              dir="ltr"
              min="0"
              step={currency === "USD" ? "0.01" : "1000"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={field}
              required
            />
            {amountIssue ? (
              <span className="mt-1 block text-xs font-semibold text-danger">{t.amountIssues[amountIssue]}</span>
            ) : approx ? (
              <span className="mt-1 block text-xs text-muted-foreground">{t.approx.replace("{value}", approx)}</span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="font-semibold">{t.expires}</span>
            <input type="date" min={today} value={expires} onChange={(e) => setExpires(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            <span className="font-semibold">{t.recipient}</span>
            <input value={recipient} maxLength={80} onChange={(e) => setRecipient(e.target.value)} className={field} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-semibold">{t.note}</span>
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={field} />
          </label>
        </div>
        <p className="rounded-xl bg-surface-muted/60 px-4 py-3 text-xs text-muted-foreground">{t.currencyRule}</p>
        <button
          type="submit"
          disabled={busy || !!amountIssue || !amount}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        >
          <Gift className="h-4 w-4" />
          {busy ? t.issuing : t.issue}
        </button>
      </form>
    </section>
  );
}

function IssuedCard({
  storeId,
  storeName,
  lang,
  dict,
  siteUrl,
  card,
  onClose,
}: {
  storeId: string;
  storeName: string;
  lang: string;
  dict: Dictionary;
  siteUrl: string;
  card: { id: string; code: string; token: string; amount: number; currency: GiftCurrency };
  onClose: () => void;
}) {
  const t = dict.loyaltyCards.gift;
  const link = `${siteUrl}${giftCardPath(lang, card.token)}`;
  const message = t.waMessage
    .replace("{store}", storeName)
    .replace("{amount}", formatGiftAmount(card.amount, card.currency, lang))
    .replace("{code}", formatGiftCode(card.code))
    .replace("{link}", link);
  return (
    <div className="rounded-2xl border border-success/30 bg-success-soft p-5">
      <p className="flex items-center gap-2 font-extrabold text-success">
        <Check className="h-5 w-5" />
        {t.issuedTitle}
      </p>
      <p dir="ltr" className="mt-3 select-all text-center font-mono text-2xl font-extrabold tracking-widest">
        {formatGiftCode(card.code)}
      </p>
      <p className="mt-2 text-center text-sm font-bold">
        <bdi dir="ltr">{formatGiftAmount(card.amount, card.currency, lang)}</bdi>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t.issuedHint}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/${lang}/merchant/${storeId}/gift-cards/${card.id}/print`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
        >
          <Printer className="h-3.5 w-3.5" />
          {dict.loyaltyCards.common.print}
        </Link>
        <a
          href={waUrl("", message)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold"
        >
          <MessageCircle className="h-3.5 w-3.5 text-success" />
          {t.sendWa}
        </a>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground">
          {dict.loyaltyCards.common.cancel}
        </button>
      </div>
    </div>
  );
}

function CardRow({
  card,
  storeId,
  storeName,
  lang,
  dict,
  siteUrl,
  today,
}: {
  card: GiftCardRow;
  storeId: string;
  storeName: string;
  lang: string;
  dict: Dictionary;
  siteUrl: string;
  today: string;
}) {
  const t = dict.loyaltyCards.gift;
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = giftCardStatus(card, today);
  const link = `${siteUrl}${giftCardPath(lang, card.token)}`;
  const money = (v: number | string) => formatGiftAmount(Number(v), card.currency, lang);
  const message = t.waMessage
    .replace("{store}", storeName)
    .replace("{amount}", money(card.balance))
    .replace("{code}", formatGiftCode(card.code))
    .replace("{link}", link);
  const expiry = card.expires_on
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${card.expires_on}T00:00:00Z`))
    : null;

  async function voidCard() {
    const ok = await confirm({
      message: t.confirmVoid,
      confirmLabel: t.void,
      cancelLabel: dict.loyaltyCards.common.cancel,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await createClient().rpc("void_gift_card", { p_id: card.id });
    setBusy(false);
    if (error) {
      notifyError(t.errors[giftErrorKey(error.message)]);
      return;
    }
    notifySuccess(t.voided);
    await refreshGiftCardCheckout(storeId);
    router.refresh();
  }

  // A balance link that went to the wrong person, or was posted somewhere: a
  // fresh token (0316) makes the old /gift/<token> 404. The CODE is untouched —
  // it is the spending credential, and a leaked code is what "void" is for.
  async function rotateLink() {
    const ok = await confirm({
      message: t.confirmRotate,
      confirmLabel: t.rotateLink,
      cancelLabel: dict.loyaltyCards.common.cancel,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await createClient().rpc("rotate_gift_card_link", { p_id: card.id });
    setBusy(false);
    if (error) {
      notifyError(t.errors[giftErrorKey(error.message)]);
      return;
    }
    notifySuccess(t.rotated);
    router.refresh();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  const badge: Record<typeof status, string> = {
    active: "bg-success-soft text-success",
    spent: "bg-surface-muted text-muted-foreground",
    expired: "bg-warning-soft text-warning",
    void: "bg-danger-soft text-danger",
  };

  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p dir="ltr" className="font-mono text-sm font-extrabold tracking-wider">
            {formatGiftCode(card.code)}
          </p>
          <p className="text-xs text-muted-foreground">
            {card.recipient_name ? t.to.replace("{name}", card.recipient_name) : null}
            {card.recipient_name && expiry ? " · " : null}
            {expiry ? t.expiresOn.replace("{date}", expiry) : null}
          </p>
        </div>
        <div className="text-end">
          <p className="text-sm font-extrabold tabular-nums">
            {t.balanceOf
              .replace("{balance}", money(card.balance))
              .replace("{initial}", money(card.initial_amount))}
          </p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${badge[status]}`}>
            {t.status[status]}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/${lang}/merchant/${storeId}/gift-cards/${card.id}/print`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
        >
          <Printer className="h-3.5 w-3.5" />
          {dict.loyaltyCards.common.print}
        </Link>
        {status === "active" && (
          <a
            href={waUrl("", message)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
          >
            <MessageCircle className="h-3.5 w-3.5 text-success" />
            {t.sendWa}
          </a>
        )}
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? dict.loyaltyCards.common.copied : dict.loyaltyCards.common.copy}
        </button>
        <button
          type="button"
          onClick={rotateLink}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40 disabled:opacity-60"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t.rotateLink}
        </button>
        {card.status === "active" && (
          <button
            type="button"
            onClick={voidCard}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-danger hover:border-danger/40 disabled:opacity-60"
          >
            <Ban className="h-3.5 w-3.5" />
            {t.void}
          </button>
        )}
      </div>
    </li>
  );
}
