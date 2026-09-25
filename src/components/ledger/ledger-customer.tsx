"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  ExternalLink,
  Link2,
  Minus,
  Paperclip,
  Plus,
  RefreshCw,
  Ban,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { waLink } from "@/lib/phone";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  balancesByCurrency,
  buildReminderMessage,
  formatLedgerAmount,
  nonZeroBalances,
  statementUrl,
  withRunningBalance,
  type LedgerEntry,
} from "@/lib/ledger";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { LedgerEntryForm, type EntryKind } from "./ledger-entry-form";

type T = Dictionary["ledger"];

const noopSubscribe = () => () => {};

/** Sends a tab opened during the tap to its real address, or navigates this
 *  one when a popup blocker refused the tab. */
function openIn(win: Window | null, href: string) {
  if (win) win.location.replace(href);
  else window.location.assign(href);
}

export function LedgerCustomer({
  storeId,
  storeName,
  lang,
  t,
  customer,
  entries,
  token: initialToken,
  today,
}: {
  storeId: string;
  storeName: string;
  lang: Locale;
  t: T;
  customer: { id: string; name: string; phone: string | null };
  entries: LedgerEntry[];
  token: { id: string; token: string } | null;
  today: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [sheet, setSheet] = useState<EntryKind | null>(null);
  const [lastKind, setLastKind] = useState<EntryKind>("charge");
  const [token, setToken] = useState(initialToken);
  const [busyLink, setBusyLink] = useState(false);
  // A server refresh can bring a different live token (revoked or created in
  // another tab); adopt it. Compared by value, not identity — every refresh
  // hands down a new object.
  const [seenToken, setSeenToken] = useState(initialToken?.token ?? null);
  if ((initialToken?.token ?? null) !== seenToken) {
    setSeenToken(initialToken?.token ?? null);
    setToken(initialToken);
  }
  // The address the customer will open is wherever this app is being served
  // from; "" during server render, the real origin once hydrated.
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );

  const balances = useMemo(() => balancesByCurrency(entries), [entries]);
  const shown = nonZeroBalances(balances);
  const owes = shown.some((b) => b.balance > 0);
  const rows = useMemo(() => withRunningBalance(entries).reverse(), [entries]);
  const link = token && origin ? statementUrl(origin, lang, token.token) : null;
  const canWhatsApp = waLink(customer.phone) !== null;

  function open(kind: EntryKind) {
    setLastKind(kind);
    setSheet(kind);
  }

  async function ensureToken(): Promise<{ id: string; token: string } | null> {
    if (token) return token;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_ledger_statement_token", {
      p_customer_id: customer.id,
    });
    const row = data as { id: string; token: string } | null;
    if (error || !row?.token) {
      notifyError(t.statementFailed);
      return null;
    }
    setToken({ id: row.id, token: row.token });
    return { id: row.id, token: row.token };
  }

  async function remind() {
    if (!canWhatsApp) {
      notifyError(t.remindNoPhone);
      return;
    }
    // Opened synchronously, inside the tap, so a popup blocker lets it through;
    // the address is filled in once the statement link exists.
    const win = window.open("", "_blank");
    setBusyLink(true);
    const tok = await ensureToken();
    setBusyLink(false);
    if (!tok) {
      win?.close();
      return;
    }
    const message = buildReminderMessage({
      template: { body: t.reminderTemplate, and: t.and },
      customerName: customer.name,
      storeName,
      balances,
      link: statementUrl(window.location.origin, lang, tok.token),
      lang,
    });
    const href = waLink(customer.phone, message);
    if (!href) {
      win?.close();
      return;
    }
    openIn(win, href);
  }

  async function createLink() {
    setBusyLink(true);
    await ensureToken();
    setBusyLink(false);
  }

  async function revokeLink(): Promise<boolean> {
    if (!token) return true;
    const supabase = createClient();
    const { error } = await supabase.rpc("revoke_ledger_statement_token", {
      p_id: token.id,
    });
    if (error) {
      notifyError(t.statementFailed);
      return false;
    }
    setToken(null);
    return true;
  }

  async function onRevoke() {
    const ok = await confirm({
      message: t.statementRevokeConfirm,
      confirmLabel: t.statementRevoke,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (!ok) return;
    setBusyLink(true);
    if (await revokeLink()) notifySuccess(t.statementRevoked);
    setBusyLink(false);
  }

  async function onRegenerate() {
    const ok = await confirm({
      message: t.statementRegenerateConfirm,
      confirmLabel: t.statementRegenerate,
      cancelLabel: t.cancel,
    });
    if (!ok) return;
    setBusyLink(true);
    if (await revokeLink()) {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_ledger_statement_token", {
        p_customer_id: customer.id,
      });
      const row = data as { id: string; token: string } | null;
      if (error || !row?.token) notifyError(t.statementFailed);
      else setToken({ id: row.id, token: row.token });
    }
    setBusyLink(false);
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notifySuccess(t.statementCopied);
    } catch {
      window.prompt(t.statementCopy, link);
    }
  }

  async function viewPhoto(path: string) {
    // The bucket is private: a one-minute signed URL, asked for on the tap.
    const supabase = createClient();
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage
      .from("ledger-attachments")
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      win?.close();
      notifyError(t.photoFailed);
      return;
    }
    openIn(win, data.signedUrl);
  }

  async function removeEntry(e: LedgerEntry) {
    const ok = await confirm({
      title: t.deleteConfirmTitle,
      message: t.deleteConfirm,
      confirmLabel: t.delete,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from("customer_transactions").delete().eq("id", e.id);
    if (error) {
      notifyError(t.saveFailed);
      return;
    }
    if (e.attachment_path) {
      await supabase.storage.from("ledger-attachments").remove([e.attachment_path]);
    }
    notifySuccess(t.deleted);
    router.refresh();
  }

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    [lang],
  );
  const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

  return (
    <div>
      {/* Who, and what they owe — per currency, never added together. */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5">
        <h1 className="text-2xl font-extrabold tracking-tight">{customer.name}</h1>
        {customer.phone && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            <bdi dir="ltr">{customer.phone}</bdi>
          </p>
        )}
        <div className="mt-4">
          <p className="text-xs font-bold text-muted-foreground">{t.balance}</p>
          {shown.length === 0 ? (
            <p className="mt-1 text-2xl font-extrabold text-success">{t.settled}</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {shown.map((b) => (
                <li key={b.currency} className="flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-extrabold tabular-nums ${
                      b.balance > 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    <bdi dir="ltr">{formatLedgerAmount(b.balance, b.currency, lang)}</bdi>
                  </span>
                  <span className="text-xs font-bold text-muted-foreground">
                    {b.balance > 0 ? t.owes : t.credit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* The two big buttons — the whole screen exists for these. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => open("charge")}
          className="flex h-20 flex-col items-center justify-center gap-0.5 rounded-2xl bg-danger-strong text-danger-strong-foreground shadow-sm transition-transform active:scale-[0.97]"
        >
          <span className="flex items-center gap-1.5 text-xl font-extrabold">
            <Plus className="h-5 w-5" aria-hidden />
            {t.gave}
          </span>
          <span className="text-xs font-semibold opacity-90">{t.gaveHint}</span>
        </button>
        <button
          type="button"
          onClick={() => open("payment")}
          className="flex h-20 flex-col items-center justify-center gap-0.5 rounded-2xl bg-success-strong text-success-strong-foreground shadow-sm transition-transform active:scale-[0.97]"
        >
          <span className="flex items-center gap-1.5 text-xl font-extrabold">
            <Minus className="h-5 w-5" aria-hidden />
            {t.received}
          </span>
          <span className="text-xs font-semibold opacity-90">{t.receivedHint}</span>
        </button>
      </div>

      {sheet !== null && (
      <LedgerEntryForm
        open
        initialKind={sheet ?? lastKind}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null);
          router.refresh();
        }}
        t={t}
        storeId={storeId}
        customerId={customer.id}
        today={today}
      />
      )}

      {/* Reminder */}
      <div className="mt-4">
        <Button
          variant="whatsapp"
          full
          size="lg"
          loading={busyLink}
          disabled={!canWhatsApp || !owes}
          onClick={remind}
        >
          {t.remind}
        </Button>
        {!canWhatsApp ? (
          <p className="mt-1.5 text-center text-xs text-muted-foreground">{t.remindNoPhone}</p>
        ) : !owes ? (
          <p className="mt-1.5 text-center text-xs text-muted-foreground">{t.remindNothing}</p>
        ) : null}
      </div>

      {/* Statement link */}
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-xs">
        <h2 className="flex items-center gap-2 text-base font-extrabold">
          <Link2 className="h-4 w-4 text-primary" aria-hidden />
          {t.statementTitle}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t.statementHint}</p>
        {token && link ? (
          <>
            <p className="mt-3 truncate rounded-lg bg-surface-muted px-3 py-2 text-xs">
              <bdi dir="ltr">{link}</bdi>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" leftIcon={<Copy className="h-4 w-4" />} onClick={copyLink}>
                {t.statementCopy}
              </Button>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold shadow-xs hover:border-primary/40"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                {t.statementOpen}
              </a>
              <Button size="sm" variant="ghost" disabled={busyLink} leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRegenerate}>
                {t.statementRegenerate}
              </Button>
              <Button size="sm" variant="ghost" disabled={busyLink} leftIcon={<Ban className="h-4 w-4" />} onClick={onRevoke}>
                {t.statementRevoke}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t.statementNone}</p>
            <Button size="sm" variant="outline" loading={busyLink} onClick={createLink}>
              {t.statementCreate}
            </Button>
          </div>
        )}
      </section>

      {/* Entries, newest first, each with the running balance of its currency. */}
      <section className="mt-6">
        <h2 className="text-base font-extrabold">{t.entries}</h2>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t.noEntries}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {rows.map((e) => {
              const isPayment = e.kind === "payment";
              return (
                <li key={e.id} className="flex items-start gap-3 p-3.5">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      isPayment ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                    }`}
                    aria-hidden
                  >
                    {isPayment ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{t.kinds[e.kind]}</span>
                      <span
                        className={`text-base font-extrabold tabular-nums ${
                          isPayment ? "text-success" : "text-danger"
                        }`}
                      >
                        <bdi dir="ltr">
                          {isPayment ? "−" : "+"}
                          {formatLedgerAmount(e.amount, e.currency, lang)}
                        </bdi>
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{fmtDate(e.happened_on)}</span>
                      <span>
                        {t.after.replace(
                          "{amount}",
                          (e.running < 0 ? "−" : "") + formatLedgerAmount(e.running, e.currency, lang),
                        )}
                      </span>
                    </div>
                    {e.label && <p className="mt-1 text-sm break-words">{e.label}</p>}
                    <div className="mt-1.5 flex items-center gap-1">
                      {e.attachment_path && (
                        <button
                          type="button"
                          onClick={() => viewPhoto(e.attachment_path as string)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-primary hover:bg-primary-soft"
                        >
                          <Paperclip className="h-3.5 w-3.5" aria-hidden />
                          {t.photoView}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeEntry(e)}
                        aria-label={t.delete}
                        className="ms-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
