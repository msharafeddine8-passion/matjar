"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  CalendarClock,
  MapPin,
  Phone,
  Send,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import {
  INTAKE_KEYS,
  resolveIntake,
  type IntakeConfig,
  type IntakeKey,
} from "@/lib/request-intake";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type ServiceRequestRow = {
  id: string;
  status:
    | "pending"
    | "quoted"
    | "countered"
    | "accepted"
    | "in_progress"
    | "completed"
    | "declined"
    | "cancelled";
  description: string;
  address: string | null;
  phone: string | null;
  customer_name: string | null;
  quote_amount: number | null;
  quote_note: string | null;
  counter_amount: number | null;
  counter_note: string | null;
  created_at: string;
  // 0297. Optional intake — older rows carry none of it, so every one of
  // these is read defensively rather than assumed present.
  photos?: string[] | null;
  urgency?: string | null;
  budget_range?: string | null;
  timeline?: string | null;
};

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

const STATUS_TONE: Record<ServiceRequestRow["status"], string> = {
  pending: "bg-warning-soft text-warning",
  quoted: "bg-info-soft text-info",
  countered: "bg-warning-soft text-warning",
  accepted: "bg-success-soft text-success",
  in_progress: "bg-primary-soft text-primary",
  completed: "bg-success-soft text-success",
  declined: "bg-danger-soft text-danger",
  cancelled: "bg-surface-muted text-muted-foreground",
};

// Provider-side controls for one service request: send a quote, then drive the
// job (decline / start / complete). All transitions go through the RPC.
export function ServiceRequestManager({
  request,
  lang,
  dict,
}: {
  request: ServiceRequestRow;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "os">;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.requests;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(action: string, extra?: { amount?: number; note?: string }) {
    if (busy) return;
    if (action === "decline" && !(await confirm({ message: t.confirmDecline, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient().rpc("manage_service_request", {
      p_id: request.id,
      p_action: action,
      p_amount: extra?.amount ?? null,
      p_note: extra?.note ?? null,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  async function sendQuote() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    await act("quote", { amount: amt, note: note.trim() || undefined });
  }

  // Value labels come from the customer-facing dictionary block, so the two
  // sides of the request can never drift into naming the same answer
  // differently. An unknown code (a value written before a rename) renders as
  // nothing rather than as a raw slug.
  const f = dict.os.requestForm;
  const urgencyLabel = request.urgency
    ? (f.urgencyOptions as Record<string, string>)[request.urgency]
    : null;
  const budgetLabel = request.budget_range
    ? (f.budgetOptions as Record<string, string>)[request.budget_range]
    : null;
  const timelineLabel = request.timeline
    ? (f.timelineOptions as Record<string, string>)[request.timeline]
    : null;
  const photos = Array.isArray(request.photos) ? request.photos : [];

  const created = new Date(request.created_at).toLocaleDateString(
    lang === "ar" ? "ar" : "en",
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted-foreground">
          {request.customer_name && (
            <span className="font-bold text-foreground">
              {request.customer_name}
            </span>
          )}
          <span className="ms-2 text-xs">{created}</span>
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_TONE[request.status]}`}
        >
          {t.status[request.status]}
        </span>
      </div>

      <p className="mt-3 border-t border-border pt-3 text-sm">
        {request.description}
      </p>

      {/* 0297 intake, shown above the contact line because it is what decides
          whether this job is worth the call, not how to place it. */}
      {(urgencyLabel || budgetLabel || timelineLabel) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {urgencyLabel && (
            <span
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                request.urgency === "emergency"
                  ? "bg-danger-soft text-danger"
                  : "bg-surface-muted text-muted-foreground"
              }`}
            >
              <AlarmClock className="h-3.5 w-3.5" />
              {t.urgencyLabel}: {urgencyLabel}
            </span>
          )}
          {budgetLabel && (
            <span className="flex items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              {t.budgetLabel}: <span dir="ltr">{budgetLabel}</span>
            </span>
          )}
          {timelineLabel && (
            <span className="flex items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {t.timelineLabel}: {timelineLabel}
            </span>
          )}
        </div>
      )}

      {photos.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-muted-foreground">
            {t.attachedPhotos}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {photos.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative h-20 w-20 overflow-hidden rounded-xl border border-border transition-colors hover:border-primary"
              >
                <Image src={url} alt="" fill className="object-cover" sizes="80px" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {request.phone && (
          <a
            href={`tel:${request.phone}`}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Phone className="h-3.5 w-3.5" />
            {request.phone}
          </a>
        )}
        {request.address && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {request.address}
          </span>
        )}
      </div>

      {(request.counter_amount != null || request.counter_note) && (
        <p className="mt-2 rounded-xl bg-warning-soft px-3 py-2 text-sm font-bold text-warning">
          {t.counterFrom}
          {request.counter_amount != null
            ? `: ${money(Number(request.counter_amount))}`
            : ""}
          {request.counter_note && (
            <span className="font-normal"> · {request.counter_note}</span>
          )}
        </p>
      )}
      {request.quote_amount != null && (
        <p className="mt-3 rounded-xl bg-info-soft px-3 py-2 text-sm">
          <span className="font-bold text-info">
            {t.quotedAt}: {money(Number(request.quote_amount))}
          </span>
          {request.quote_note && (
            <span className="text-muted-foreground"> · {request.quote_note}</span>
          )}
        </p>
      )}

      {/* Provider actions by state. */}
      {(request.status === "pending" || request.status === "countered") && (
        <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 sm:grid-cols-[1fr_2fr_auto]">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t.quoteAmount}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.quoteNote}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={sendQuote}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {t.sendQuote}
          </button>
        </div>
      )}

      {(request.status === "pending" ||
        request.status === "quoted" ||
        request.status === "accepted" ||
        request.status === "in_progress") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {request.status === "accepted" && (
            <button
              onClick={() => act("start")}
              disabled={busy}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {t.start}
            </button>
          )}
          {(request.status === "accepted" ||
            request.status === "in_progress") && (
            <button
              onClick={() => act("complete")}
              disabled={busy}
              className="rounded-lg bg-success-strong px-3 py-1.5 text-sm font-bold text-success-strong-foreground transition-colors hover:brightness-90 disabled:opacity-60"
            >
              {t.complete}
            </button>
          )}
          <button
            onClick={() => act("decline")}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
          >
            {t.decline}
          </button>
        </div>
      )}
    </div>
  );
}

// The off-switch. Every question the request form adds costs the merchant a
// few requests and improves the ones that arrive; which side of that trade
// they want is theirs to decide, not the platform's. Writes
// `stores.request_intake` (0297) — a partial object, so a key the merchant
// never touched keeps following the sector default instead of being frozen at
// today's value.
export function ServiceRequestIntakeSettings({
  storeId,
  category,
  initial,
  dict,
}: {
  storeId: string;
  /** business_types.slug — decides the defaults before any override. */
  category: string | null;
  /** stores.request_intake as stored: null, or a partial object. */
  initial: unknown;
  dict: Pick<Dictionary, "common" | "os">;
}) {
  const t = dict.os.requests;
  const [config, setConfig] = useState<IntakeConfig>(() =>
    resolveIntake(category, initial),
  );
  const [busy, setBusy] = useState(false);

  const labels: Record<IntakeKey, string> = {
    photos: t.intakePhotos,
    urgency: t.intakeUrgency,
    budget: t.intakeBudget,
    timeline: t.intakeTimeline,
  };

  async function toggle(key: IntakeKey) {
    if (busy) return;
    const next = { ...config, [key]: !config[key] };
    setConfig(next);
    setBusy(true);
    // The full resolved object is written, not a diff: the merchant has now
    // seen and implicitly confirmed all four, and a later change to the sector
    // default should not silently rearrange a form they signed off on.
    const { error } = await createClient()
      .from("stores")
      .update({ request_intake: next })
      .eq("id", storeId);
    setBusy(false);
    if (error) {
      setConfig(config);
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(t.intakeSaved);
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        {t.intakeTitle}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.intakeHint}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {INTAKE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="switch"
            aria-checked={config[key]}
            disabled={busy}
            onClick={() => toggle(key)}
            className={`min-h-11 rounded-xl border px-3.5 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
              config[key]
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted-foreground hover:border-primary/50"
            }`}
          >
            {labels[key]}
          </button>
        ))}
      </div>
    </section>
  );
}
