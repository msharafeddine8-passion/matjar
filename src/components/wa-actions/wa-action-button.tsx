"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DEFAULT_WA_TEMPLATES,
  absoluteLink,
  waActionHref,
  type WaItem,
  type WaLocale,
  type WaTargetType,
  type WaTemplateKey,
  type WaValues,
} from "@/lib/wa-templates";
import {
  formatSince,
  logWaAction,
  setWaLocale,
  touchNow,
  useMinuteNow,
  useOrigin,
  useWaLocale,
  type AgoLabels,
} from "./wa-client";

export type WaButtonLabels = {
  noPhone: string;
  lastSent: string;
  ago: AgoLabels;
  truncated: string;
};

/**
 * One WhatsApp action: a real link to wa.me with the message filled in.
 *
 * It is an <a href>, not a button that calls window.open, so there is nothing
 * for a popup blocker to stop and the phone hands it straight to WhatsApp. The
 * tap is logged on the way out (fire and forget) and the button then reads
 * «آخر إرسال: هلّق».
 *
 * Disabled — never a dead link — when the number cannot be dialled or the
 * caller says the action does not apply (with the reason shown underneath).
 */
export function WaActionButton({
  uiLang,
  storeId,
  templateKey,
  targetType,
  targetId,
  phone,
  label,
  bodies,
  values,
  linkPath,
  items,
  lastSentAt,
  labels,
  disabledReason,
  variant = "secondary",
  full = false,
}: {
  uiLang: string;
  storeId: string;
  templateKey: WaTemplateKey;
  targetType: WaTargetType;
  targetId: string;
  phone: string | null;
  label: string;
  /** The body per message language — the merchant's override or the default. */
  bodies: Record<WaLocale, string>;
  /** Values per message language (status words, currency labels differ). */
  values: Record<WaLocale, WaValues>;
  /** Path of the page the message links to; made absolute in the browser.
   *  null → no page exists, and the {link} line is dropped. */
  linkPath?: Record<WaLocale, string | null> | null;
  items?: readonly WaItem[];
  lastSentAt: string | null;
  labels: WaButtonLabels;
  disabledReason?: string | null;
  variant?: "whatsapp" | "secondary";
  full?: boolean;
}) {
  const locale = useWaLocale(uiLang);
  const origin = useOrigin();
  const now = useMinuteNow();
  const [sentAt, setSentAt] = useState<string | null>(lastSentAt);
  // A server refresh can bring a newer log time (another staff member tapped).
  const [seen, setSeen] = useState(lastSentAt);
  if (lastSentAt !== seen) {
    setSeen(lastSentAt);
    if (lastSentAt && (!sentAt || lastSentAt > sentAt)) setSentAt(lastSentAt);
  }

  const link = origin ? absoluteLink(origin, linkPath?.[locale] ?? null) : null;
  const built = disabledReason
    ? null
    : waActionHref(phone, {
        body: bodies[locale],
        fallbackBody: DEFAULT_WA_TEMPLATES[templateKey][locale],
        values: { ...values[locale], link },
        items,
        locale,
      });

  const reason = disabledReason ?? (built ? null : labels.noPhone);
  const since = sentAt ? formatSince(sentAt, now, labels.ago, uiLang) : null;
  const cls = `${buttonVariants({ variant, size: "md", full })} min-h-11`;

  return (
    <div className={full ? "w-full" : "min-w-0"}>
      {built ? (
        <a
          href={built.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
          onClick={() => {
            logWaAction({ storeId, key: templateKey, targetType, targetId });
            const at = new Date().toISOString();
            setSentAt(at);
            touchNow();
          }}
        >
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </a>
      ) : (
        <button type="button" disabled className={cls}>
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </button>
      )}
      {reason ? (
        <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
      ) : since ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {labels.lastSent.split("{when}").join(since)}
        </p>
      ) : null}
      {built?.truncated && (
        <p className="mt-1 text-xs text-warning">{labels.truncated}</p>
      )}
    </div>
  );
}

/** Switches the language every WhatsApp message goes out in. */
export function WaLocaleToggle({
  uiLang,
  labels,
}: {
  uiLang: string;
  labels: { messageLang: string; langAr: string; langEn: string };
}) {
  const locale = useWaLocale(uiLang);
  const opt = (l: WaLocale, text: string) => (
    <button
      type="button"
      onClick={() => setWaLocale(l)}
      aria-pressed={locale === l}
      className={`min-h-9 rounded-lg px-2.5 text-xs font-bold transition-colors ${
        locale === l
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
      lang={l}
    >
      {text}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span>{labels.messageLang}</span>
      <span className="inline-flex rounded-xl border border-border bg-surface p-0.5">
        {opt("ar", labels.langAr)}
        {opt("en", labels.langEn)}
      </span>
    </div>
  );
}
