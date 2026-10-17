import { Check, Clock, X } from "lucide-react";
import { ORDER_FLOW } from "@/lib/order-progress";

export type OrderEvent = { to_status: string; created_at: string };

// Visual order journey (0173): the canonical steps with real timestamps from
// order_status_events. Pure presentational — usable from server pages and the
// client guest tracker alike.
//
// The two flows used to be declared here. They moved to lib/order-progress.ts
// when the orders LIST grew a compact version of this same track, because two
// declarations of the order journey are two things that can disagree about it.
// This file still owns the timestamps and the presentation; it no longer owns
// the sequence.

export function OrderTimeline({
  events,
  status,
  fulfillment,
  labels,
  lang,
}: {
  events: OrderEvent[];
  status: string;
  fulfillment: string;
  labels: Record<string, string>;
  lang: string;
}) {
  const terminated = status === "cancelled" || status === "rejected";
  const flow: readonly string[] =
    fulfillment === "delivery" ? ORDER_FLOW.delivery : ORDER_FLOW.pickup;
  const eventAt = new Map<string, string>();
  for (const e of events) if (!eventAt.has(e.to_status)) eventAt.set(e.to_status, e.created_at);
  const reachedIdx = flow.indexOf(status);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
      timeZone: "Asia/Beirut",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // On cancellation, show only the steps that actually happened + a red end.
  const steps = terminated
    ? flow.filter((s) => eventAt.has(s))
    : flow;

  return (
    <ol className="relative ms-3 space-y-0">
      {steps.map((s, i) => {
        const at = eventAt.get(s);
        const done = terminated ? true : at != null || (reachedIdx >= 0 && i < reachedIdx);
        const current = !terminated && s === status;
        const last = i === steps.length - 1 && !terminated;
        return (
          <li key={s} className="relative flex gap-3 pb-6 last:pb-0">
            {/* rail */}
            {!(last && !terminated) || terminated ? (
              <span
                className={`absolute start-[11px] top-6 h-full w-0.5 ${
                  done && !current ? "bg-primary" : "bg-border"
                }`}
                aria-hidden
              />
            ) : null}
            <span
              className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {current ? (
                <Clock className="h-3.5 w-3.5" />
              ) : done ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className="min-w-0 pt-0.5">
              <span
                className={`block text-sm font-bold ${
                  current
                    ? "text-primary"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {labels[s] ?? s}
              </span>
              {at && (
                <span className="block text-xs text-muted-foreground" dir="ltr">
                  {fmt(at)}
                </span>
              )}
            </span>
          </li>
        );
      })}
      {terminated && (
        <li className="relative flex gap-3">
          <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-danger bg-danger text-white">
            <X className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 pt-0.5">
            <span className="block text-sm font-bold text-danger">
              {labels[status] ?? status}
            </span>
            {eventAt.get(status) && (
              <span className="block text-xs text-muted-foreground" dir="ltr">
                {fmt(eventAt.get(status)!)}
              </span>
            )}
          </span>
        </li>
      )}
    </ol>
  );
}
