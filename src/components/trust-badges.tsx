import Link from "next/link";
import { Crown, FileCheck2, Landmark, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Badge } from "@/components/ui/badge";
import {
  paidAnchor,
  trustAnchor,
  type TrustKind,
  type TrustSignal,
} from "@/lib/trust";

// The one way a trust signal is drawn for a customer.
//
// One icon per kind, one colour for every kind (the success tone), and every
// badge names WHAT was checked and links to the paragraph on /trust that says
// how. A link rather than a popover: it works on the first paint, on a phone,
// with no JS and no client boundary, and the destination is a page the
// customer can read at leisure.
//
// The paid marker is drawn by `PaidPlanBadge` — Crown, accent tone, and a
// title that says "paid plan" — so that it can never be read as a review.
// Nothing in this file lets a plan produce a trust badge; see lib/trust.ts.

export type TrustDict = Pick<Dictionary, "trust">;

const ICONS: Record<TrustKind, LucideIcon> = {
  registration: Landmark,
  documents: FileCheck2,
  identity: UserCheck,
};

const TONE = "bg-success-soft text-success";

export function TrustBadges({
  signals,
  dict,
  lang,
  variant = "link",
  className = "",
}: {
  signals: readonly TrustSignal[];
  dict: TrustDict;
  lang: Locale;
  /**
   * `link` — a pill per signal that links to its /trust section (default).
   * `mark` — icon only, no link, for a card that is itself one anchor (an
   * <a> inside an <a> is invalid HTML and untappable). Still carries the
   * full aria-label, so a screen reader hears what was checked.
   */
  variant?: "link" | "mark";
  className?: string;
}) {
  if (!signals.length) return null;
  const t = dict.trust.kinds;
  return (
    <span
      role="group"
      aria-label={dict.trust.groupLabel}
      className={`inline-flex flex-wrap items-center gap-1 ${className}`}
    >
      {signals.map((s) => {
        const Icon = ICONS[s.kind];
        const k = t[s.kind];
        if (variant === "mark") {
          return (
            <span
              key={s.kind}
              role="img"
              title={k.aria}
              aria-label={k.aria}
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${TONE}`}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
            </span>
          );
        }
        return (
          <Link
            key={s.kind}
            href={trustAnchor(lang, s.kind)}
            title={k.aria}
            aria-label={k.aria}
            // z-10 lifts the pill above a card's full-surface overlay link.
            className={`relative z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold underline-offset-2 hover:underline ${TONE}`}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {k.label}
          </Link>
        );
      })}
    </span>
  );
}

/**
 * The paid-plan marker. Crown + accent tone — the visual language the app
 * uses for "featured" and "flash", never for "checked" — with a title that
 * says so. Links to the /trust paragraph that spells out what Pro is not.
 */
export function PaidPlanBadge({
  dict,
  lang,
  variant = "link",
}: {
  dict: TrustDict;
  lang: Locale;
  variant?: "link" | "mark";
}) {
  const p = dict.trust.paid;
  const body = (
    <Badge variant="accent" size="sm" title={p.title}>
      <Crown className="h-3 w-3" aria-hidden="true" />
      {p.label}
    </Badge>
  );
  if (variant === "mark")
    return (
      <span role="img" aria-label={`${p.label} — ${p.title}`}>
        {body}
      </span>
    );
  return (
    <Link
      href={paidAnchor(lang)}
      aria-label={`${p.label} — ${p.title}`}
      className="relative z-10 inline-flex"
    >
      {body}
    </Link>
  );
}
