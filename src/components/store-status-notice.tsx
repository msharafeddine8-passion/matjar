import { MessageCircle, Ban, XCircle } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { supportWaLink } from "@/lib/support";

/**
 * What a merchant sees when their shop has been suspended or refused.
 *
 * Until 0282 the only signal was a grey pill reading "معطّل" on a card, plus a
 * push that said "تواصل معنا" and nothing more. Twenty stores are suspended in
 * production and five or six of them belong to distinct real people with no
 * other store — they had no way to learn why, and neither did the admin, because
 * no reason was ever written down.
 *
 * Three rules this block follows:
 *
 *  1. Non-punitive. It states what happened and what to do next. A merchant
 *     reading it has already lost their storefront; the copy does not also
 *     accuse them.
 *  2. A NULL reason is said out loud. There is no default sentence and no empty
 *     box — "no reason was recorded, ask us" is the truth for every store
 *     suspended before there was anywhere to record one, and it is the only
 *     honest thing to print.
 *  3. The way out is one tap. supportWaLink() is the real support line, and the
 *     message is prefilled with the store's name so the person answering knows
 *     which shop is being asked about without a round-trip.
 */
export function StoreStatusNotice({
  lang,
  dict,
  status,
  storeName,
  reason,
  changedAt,
  className = "",
}: {
  lang: Locale;
  dict: Dictionary;
  status: "suspended" | "rejected";
  storeName: string;
  /** NULL means no reason was recorded. Never pass "" to mean the same thing. */
  reason: string | null;
  changedAt: string | null;
  className?: string;
}) {
  const t = dict.storeStatus;
  const suspended = status === "suspended";
  const Icon = suspended ? Ban : XCircle;
  const waText = (suspended ? t.waSuspended : t.waRejected).replace(
    "{store}",
    storeName,
  );

  return (
    <div
      className={`rounded-2xl border border-danger/30 bg-danger-soft/40 p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold">
            {suspended ? t.suspendedTitle : t.rejectedTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {suspended ? t.suspendedBody : t.rejectedBody}
          </p>

          <div className="mt-3 rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-bold text-muted-foreground">
              {t.reasonLabel}
            </p>
            {reason ? (
              <p className="mt-1 whitespace-pre-line text-sm font-semibold">
                {reason}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t.noReason}</p>
            )}
            {changedAt && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t.since}{" "}
                {new Date(changedAt).toLocaleDateString(
                  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                  { timeZone: "Asia/Beirut", year: "numeric", month: "short", day: "numeric" },
                )}
              </p>
            )}
          </div>

          <a
            href={supportWaLink(waText)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <MessageCircle className="h-4 w-4" />
            {t.contact}
          </a>
        </div>
      </div>
    </div>
  );
}
