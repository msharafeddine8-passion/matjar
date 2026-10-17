"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Check, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { supportWaLink } from "@/lib/support";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

const REASONS = ["violating", "duplicate", "misleading", "images", "fraud"] as const;

export function ListingReport({
  listingId,
  lang,
  dict,
}: {
  listingId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "market" | "reportContent">;
}) {
  const router = useRouter();
  const t = dict.market;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function report(reason: string) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      router.push(`/${lang}/login`);
      return;
    }
    const { error: e } = await supabase
      .from("listing_reports")
      .insert({ listing_id: listingId, reporter_id: user.id, reason });
    setBusy(false);
    // 23505 = duplicate → the user already reported this listing; treat as done.
    if (e && e.code !== "23505") {
      setError(dict.auth.errorGeneric);
      return;
    }
    setOpen(false);
    setSent(true);
  }

  if (sent) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
        <Check className="h-4 w-4" />
        {t.reportSent}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-danger"
      >
        <Flag className="h-4 w-4" />
        {t.report}
      </button>
      {open && (
        <div className="absolute end-0 z-20 mt-2 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-bold text-muted-foreground">
            {t.reportTitle}
          </p>
          {REASONS.map((r) => (
            <button
              key={r}
              disabled={busy}
              onClick={() => report(r)}
              className="block w-full rounded-lg px-2 py-1.5 text-start text-sm transition-colors hover:bg-surface-muted disabled:opacity-60"
            >
              {t.reasons[r]}
            </button>
          ))}
          {error && (
            <p className="px-2 py-1 text-xs font-medium text-danger">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Everything else on the platform ──────────────────────────────────────────
//
// MJ-026. The button above has only ever covered the Sunday Market, because
// `listing_reports` only has a listing_id. A fake store, a stolen product photo
// or a price that changes at the door had nowhere to go at all — the only
// recourse on a marketplace of strangers was to tell nobody.
//
// `content_reports` (migration 0216) already models the general case: an
// entity_type/entity_id pair over store, product, gig, job, listing, review and
// profile, with a dedupe index so the same person reporting the same thing twice
// is one report. Nothing new is needed in the database; what was missing was a
// control. This is that control, kept in the same file as its Sunday-Market
// ancestor so the two cannot drift into offering different reasons for the same
// complaint, and kept SEPARATE from it so the market's admin queue — which reads
// listing_reports — is not quietly emptied by a component swap.
//
// Two paths out on purpose. The report is the record; WhatsApp is the person.
// A complaint channel that first demands an account is not a public complaint
// channel, and someone who has just lost money to a fake store is not going to
// register to say so.

/** entity_type values migration 0216 accepts. Narrowed to what the customer
 *  site actually renders a control for. */
export type ReportableEntity = "store" | "product";

const CONTENT_REASONS = [
  "fake",
  "misleading",
  "images",
  "prohibited",
  "fraud",
  "other",
] as const;

export function ContentReport({
  entityType,
  entityId,
  lang,
  dict,
}: {
  entityType: ReportableEntity;
  entityId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "market" | "reportContent">;
}) {
  const router = useRouter();
  const t = dict.reportContent;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The page the complaint is about, so the support chat opens already knowing
  // what it is about. Read at click time rather than from props: this component
  // is mounted on two route shapes and the browser already holds the answer.
  const waHref = () =>
    supportWaLink(
      t.waPrefill.replace(
        "{url}",
        typeof window === "undefined" ? "" : window.location.href,
      ),
    );

  async function report(reason: string) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      router.push(`/${lang}/login`);
      return;
    }
    const { error: e } = await supabase.from("content_reports").insert({
      entity_type: entityType,
      entity_id: entityId,
      reporter_id: user.id,
      reason,
    });
    setBusy(false);
    // 23505 = the dedupe index — they already reported this. Their report is on
    // file, which is exactly what they were trying to achieve, so say so.
    if (e && e.code !== "23505") {
      setError(dict.auth.errorGeneric);
      return;
    }
    setOpen(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-border bg-surface-muted/40 p-3">
        <p className="flex items-center gap-1.5 text-sm font-bold text-success">
          <Check className="h-4 w-4 shrink-0" />
          {t.sentTitle}
        </p>
        {/* What actually happens next, without a turnaround we cannot keep. */}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t.sentBody}
        </p>
        <a
          href={waHref()}
          target="_blank"
          rel="noopener noreferrer"
          className="relative mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-whatsapp before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']"
        >
          <MessageCircle className="h-4 w-4" />
          {t.urgent}
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-danger before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']"
      >
        <Flag className="h-4 w-4" />
        {t.button}
      </button>
      {open && (
        <div className="absolute start-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-bold text-muted-foreground">
            {t.title}
          </p>
          {CONTENT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => report(r)}
              className="block w-full rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-surface-muted disabled:opacity-60"
            >
              {t.reasons[r]}
            </button>
          ))}
          {error && (
            <p className="px-2 py-1 text-xs font-medium text-danger">{error}</p>
          )}
          <a
            href={waHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block rounded-lg border-t border-border px-2 pt-2 pb-1.5 text-xs font-bold text-whatsapp"
          >
            <MessageCircle className="me-1 inline h-3.5 w-3.5" />
            {t.urgent}
          </a>
        </div>
      )}
    </div>
  );
}
