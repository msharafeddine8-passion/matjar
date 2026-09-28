import {
  CalendarClock,
  ClipboardList,
  MapPin,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { CategoryKey } from "@/lib/catalog";
import { formatUsd } from "@/lib/currency";
import { sectorTeamMeta } from "@/lib/sectors";
import type { SummaryRow, SummaryRowKey } from "@/lib/profile-engine";
import { ChevronNext } from "@/components/ui/directional-icon";

// The at-a-glance block under a clinic's (or a trade's) name: WHO / WHAT / WHEN
// / WHERE / HOW MUCH / WHY TRUST, one line each, so a patient knows whether this
// is the right place before reading the page. Every row comes from
// resolveProfileSummary() and exists only when its fact does — the component
// adds wording and nothing else. Each row links to the section that says it in
// full, and only when that section is on the page.

const ICON: Record<Exclude<SummaryRowKey, "who">, LucideIcon> = {
  what: ClipboardList,
  when: CalendarClock,
  where: MapPin,
  howMuch: Wallet,
  whyTrust: ShieldCheck,
};

/** Left-to-right isolate: a price, a time span or a numeric range keeps its
 *  own order inside an Arabic sentence ("09:00–00:00" must not flip). */
const ltr = (x: string) => `\u2066${x}\u2069`;

function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

export function StoreProfileSummary({
  rows,
  category,
  dict,
}: {
  rows: SummaryRow[];
  category: CategoryKey;
  dict: Dictionary;
}) {
  if (rows.length === 0) return null;
  const t = dict.profile.summary;
  const team = sectorTeamMeta(category);

  const render = (row: SummaryRow): { main: string; sub: string | null } => {
    switch (row.key) {
      case "who": {
        const more = row.more > 0 ? ` · ${fill(t.more, { n: row.more })}` : "";
        return {
          main: fill(t.teamCount, {
            label: dict.os.team[team.labelKey],
            n: row.count,
          }),
          sub: row.specialties.length
            ? row.specialties.join(" · ") + more
            : null,
        };
      }
      case "what": {
        const more = row.more > 0 ? ` · ${fill(t.more, { n: row.more })}` : "";
        const dur =
          row.minMinutes != null && row.maxMinutes != null
            ? `${dict.store.visitLength}: ${fill(t.duration, {
                range:
                  row.minMinutes === row.maxMinutes
                    ? String(row.minMinutes)
                    : ltr(`${row.minMinutes}–${row.maxMinutes}`),
              })}`
            : null;
        return {
          main:
            row.count > 0
              ? fill(t.servicesCount, { n: row.count })
              : row.names.join(" · "),
          sub:
            [row.count > 0 ? row.names.join(" · ") + more : null, dur]
              .filter(Boolean)
              .join(" — ") || null,
        };
      }
      case "when":
        return {
          main: row.openNow ? dict.os.hours.openNow : dict.os.hours.closedNow,
          sub: row.today
            ? fill(t.today, { span: ltr(`${row.today.open}–${row.today.close}`) })
            : t.closedToday,
        };
      case "where":
        return {
          main: row.area ?? fill(t.branches, { n: row.branches }),
          sub: row.area && row.branches > 1 ? fill(t.branches, { n: row.branches }) : null,
        };
      case "howMuch": {
        const price =
          row.min != null && row.max != null
            ? row.min === row.max
              ? ltr(formatUsd(row.min))
              : fill(t.priceRange, {
                  min: ltr(formatUsd(row.min)),
                  max: ltr(formatUsd(row.max)),
                })
            : null;
        const ins = row.insurance ? fill(t.insurance, { text: row.insurance }) : null;
        return { main: price ?? (ins as string), sub: price ? ins : null };
      }
      case "whyTrust": {
        const parts: string[] = [
          ...row.signals.map((k) => dict.trust.kinds[k].label),
        ];
        if (row.verifications > 0 && !row.signals.includes("documents"))
          parts.push(fill(t.documents, { n: row.verifications }));
        if (row.rating != null)
          parts.push(
            fill(t.rating, { rating: row.rating.toFixed(1), n: row.reviewCount }),
          );
        if (row.fulfilled > 0)
          parts.push(dict.store.ordersFulfilled.replace("{n}", String(row.fulfilled)));
        return { main: parts[0] ?? "", sub: parts.slice(1).join(" · ") || null };
      }
    }
  };

  return (
    <section
      aria-labelledby="profile-summary-title"
      className="mt-4 rounded-2xl border border-border bg-surface p-4 sm:p-5"
    >
      <h2
        id="profile-summary-title"
        className="text-sm font-bold text-muted-foreground"
      >
        {t.title}
      </h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => {
          const Icon = row.key === "who" ? team.Icon : ICON[row.key];
          const { main, sub } = render(row);
          const body = (
            <>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-muted-foreground">
                  {t[row.key]}
                </span>
                <span className="mt-0.5 block">
                  <span dir="auto" className="block text-sm font-bold">
                    {main}
                  </span>
                  {sub && (
                    <span
                      dir="auto"
                      className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                    >
                      {sub}
                    </span>
                  )}
                </span>
              </span>
              {row.targetId && (
                <ChevronNext
                  className="mt-2 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
            </>
          );
          return (
            <li key={row.key}>
              {row.targetId ? (
                <a
                  href={`#${row.targetId}`}
                  aria-label={`${t[row.key]} ${main} — ${t.details}`}
                  className="flex min-h-11 items-start gap-3 py-2.5 transition-colors hover:text-primary"
                >
                  {body}
                </a>
              ) : (
                <div className="flex min-h-11 items-start gap-3 py-2.5">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
