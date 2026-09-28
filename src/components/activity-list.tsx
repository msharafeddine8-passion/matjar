"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Package,
  CalendarCheck,
  BedDouble,
  CarFront,
  Ticket,
  FileText,
  Wrench,
  MessageSquare,
  Briefcase,
  Tag,
  RotateCcw,
  CalendarPlus,
  UserRoundCheck,
} from "lucide-react";
import { ChevronNext } from "@/components/ui/directional-icon";
import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/i18n/config";
import {
  ACTIVITY_KINDS,
  againAction,
  againCandidates,
  formatDayRange,
  formatInstant,
  primaryAction,
  type ActionKey,
  type ActivityItem,
  type ActivityKind,
} from "@/lib/activity";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { ACTIVITY_DOMAINS, statusTone } from "@/lib/status-labels";
import {
  ReorderSheet,
  type ActivityCopy,
} from "@/components/activity/reorder-sheet";

const ICONS: Record<ActivityKind, LucideIcon> = {
  order: Package,
  booking: CalendarCheck,
  stay: BedDouble,
  rental: CarFront,
  ticket: Ticket,
  service: FileText,
  craft: Wrench,
  lead: MessageSquare,
  job: Briefcase,
  listing: Tag,
};

const AGAIN_ICONS: Partial<Record<ActionKey, LucideIcon>> = {
  reorder: RotateCcw,
  rebook: CalendarPlus,
  requestAgain: FileText,
  hireAgain: UserRoundCheck,
};

type ReorderTarget = { orderId: string; storeId: string; storeName: string };

// One screen for everything the customer started.
//
// Ten kinds share one list, and every row states its kind, speaks its own
// status vocabulary (words AND colour, lib/status-labels.ts) and names the one
// next step in that kind's terms (lib/activity.ts). Nothing on this screen is
// called an "order" unless it is one.
//
// The type filter is a segmented rail, not a dropdown: on a phone switching
// between "my orders" and "my appointments" is a thumb move. Filtering is
// client-side because the whole set is one page of rows. The rail sticks under
// the header below lg so the filter is reachable forty rows down.
export function ActivityList({
  items,
  labels,
  copy,
  statusLabels,
  leadKindLabels,
  closeLabel,
  lang,
}: {
  items: ActivityItem[];
  /** The original `activity` block (+ emptyHref). */
  labels: Record<string, string>;
  /** The `activityCenter` block. */
  copy: ActivityCopy;
  /** Each domain keeps its own wording. */
  statusLabels: Record<ActivityKind, Record<string, string>>;
  /** `lead_kind` → words, for the leads that arrived without a message. */
  leadKindLabels: Record<string, string>;
  closeLabel: string;
  lang: Locale;
}) {
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const [reorder, setReorder] = useState<ReorderTarget | null>(null);

  const counts: Record<string, number> = { all: items.length };
  for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;

  // Tab labels: the four original kinds keep their existing words.
  const tabLabel: Record<ActivityKind, string> = {
    order: labels.orders,
    booking: labels.bookings,
    stay: copy.tab_stay,
    rental: copy.tab_rental,
    ticket: copy.tab_ticket,
    service: copy.tab_service,
    craft: labels.crafts,
    lead: labels.leads,
    job: copy.tab_job,
    listing: copy.tab_listing,
  };
  const kindLabel: Record<ActivityKind, string> = {
    order: labels.kind_order,
    booking: labels.kind_booking,
    stay: copy.kind_stay,
    rental: copy.kind_rental,
    ticket: copy.kind_ticket,
    service: copy.kind_service,
    craft: labels.kind_craft,
    lead: labels.kind_lead,
    job: copy.kind_job,
    listing: copy.kind_listing,
  };
  const actionLabel = (k: ActionKey) => copy.actions[k];

  const tabs: (ActivityKind | "all")[] = ["all", ...ACTIVITY_KINDS];
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);
  const again = againCandidates(items, lang);

  function againButton(it: ActivityItem) {
    const a = againAction(it, lang);
    if (!a) return null;
    const Icon = AGAIN_ICONS[a.key] ?? RotateCcw;
    const cls =
      "inline-flex h-[var(--m-touch)] items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-bold transition-colors hover:border-primary hover:text-primary";
    if (a.key === "reorder") {
      return (
        <button
          type="button"
          className={cls}
          onClick={() =>
            setReorder({
              orderId: it.id,
              storeId: it.storeId!,
              storeName: it.storeName,
            })
          }
        >
          <Icon className="h-4 w-4" />
          {actionLabel(a.key)}
        </button>
      );
    }
    return (
      <Link href={a.href!} className={cls}>
        <Icon className="h-4 w-4" />
        {actionLabel(a.key)}
      </Link>
    );
  }

  return (
    <>
      {/* ===== Again: places the customer has already dealt with ===== */}
      {again.length > 0 && (
        <section className="mt-5" aria-labelledby="again-title">
          <h2 id="again-title" className="text-base font-extrabold">
            {copy.againTitle}
          </h2>
          <p className="text-xs text-muted-foreground">{copy.againHint}</p>
          <ul className="-mx-[var(--m-page-x)] mt-2 flex gap-2 overflow-x-auto px-[var(--m-page-x)] pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
            {again.map(({ item, action }) => {
              const Icon = AGAIN_ICONS[action.key] ?? RotateCcw;
              const inner = (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 text-start">
                    <span dir="auto" className="block max-w-[11rem] truncate text-sm font-bold">
                      {item.storeName || item.title}
                    </span>
                    <span className="block text-xs font-semibold text-primary">
                      {actionLabel(action.key)}
                    </span>
                  </span>
                </>
              );
              const cls =
                "flex min-h-[var(--m-touch)] shrink-0 items-center gap-2 rounded-2xl border border-border bg-surface p-2.5 pe-4 transition-colors active:bg-surface-muted";
              return (
                <li key={`${action.key}-${item.kind}-${item.id}`}>
                  {action.key === "reorder" ? (
                    <button
                      type="button"
                      className={cls}
                      onClick={() =>
                        setReorder({
                          orderId: item.id,
                          storeId: item.storeId!,
                          storeName: item.storeName,
                        })
                      }
                    >
                      {inner}
                    </button>
                  ) : (
                    <Link href={action.href!} className={cls}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Horizontal rail, never wrapped: the chips must stay one row at 360px. */}
      <div className="sticky top-[calc(var(--m-header-h)+env(safe-area-inset-top))] z-30 -mx-[var(--m-page-x)] mt-4 flex gap-2 overflow-x-auto bg-background/95 px-[var(--m-page-x)] py-2 backdrop-blur-md [scrollbar-width:none] lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none [&::-webkit-scrollbar]:hidden">
        {tabs.map((key) => {
          const on = kind === key;
          const n = counts[key] ?? 0;
          // A filter that leads to an empty screen is a dead end, so tabs with
          // nothing behind them are not offered at all.
          if (key !== "all" && n === 0) return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              aria-pressed={on}
              className={`flex h-[var(--m-touch)] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors ${
                on
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {key === "all" ? labels.all : tabLabel[key]}
              <span className="text-xs opacity-70 tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-bold">{labels.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {labels.emptyBody}
          </p>
          <Link
            href={labels.emptyHref}
            className="mt-4 inline-flex h-[var(--m-touch)] items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
          >
            {labels.emptyCta}
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((it) => {
            const Icon = ICONS[it.kind];
            const status = statusLabels[it.kind]?.[it.status] ?? it.status;
            // Half the leads carry no message; the kind then stands in for the
            // title, in words rather than as the raw enum.
            const title =
              it.title ||
              (it.leadKind ? (leadKindLabels[it.leadKind] ?? it.leadKind) : "");
            const when = formatDayRange(it.startsOn, it.endsOn, lang);
            const primary = primaryAction(it, lang);
            const hasAgain = againAction(it, lang) != null;
            return (
              <li
                key={`${it.kind}-${it.id}`}
                className="rounded-2xl border border-border bg-surface"
              >
                <Link
                  href={primary.href ?? it.href}
                  className="flex items-start gap-3 rounded-2xl p-4 transition-colors active:bg-surface-muted"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    {/* Type is always stated. */}
                    <span className="flex flex-wrap items-center gap-x-2 text-xs font-bold text-muted-foreground">
                      {kindLabel[it.kind]}
                      <span
                        dir="ltr"
                        className="font-normal tabular-nums"
                        suppressHydrationWarning
                      >
                        {formatInstant(it.createdAt, lang)}
                      </span>
                      {/* About the customer, not the transaction: `accent`,
                          never `warning`, which means "the other side has
                          not answered yet" here. */}
                      {it.needsCustomer && (
                        <Badge variant="accent">{labels.needsYou}</Badge>
                      )}
                    </span>

                    {/* dir=auto: merchant text may be Latin inside RTL. */}
                    <span dir="auto" className="mt-0.5 block truncate font-bold">
                      {it.storeName || title || kindLabel[it.kind]}
                    </span>
                    {it.storeName && title && (
                      <span
                        dir="auto"
                        className="block truncate text-sm text-muted-foreground"
                      >
                        {title}
                      </span>
                    )}
                    {/* The day it happens on — the row's own date column,
                        never a computed ETA. */}
                    {(when || it.quantity) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                        {when && <bdi>{when}</bdi>}
                        {it.kind === "ticket" && it.quantity ? (
                          <bdi>
                            {copy.ticketsCount.replace("{n}", String(it.quantity))}
                          </bdi>
                        ) : null}
                      </span>
                    )}

                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      {/* Colour by phase, words by domain. 12px floor for
                          Arabic dots on a phone, hence `md`. */}
                      <Badge
                        size="md"
                        variant={statusTone(ACTIVITY_DOMAINS[it.kind], it.status)}
                      >
                        {status}
                      </Badge>
                      {/* Money only where the row states an amount; a $0.00
                          would read as a price that was agreed. */}
                      {it.total != null && it.total > 0 && (
                        <Money value={it.total} className="text-sm font-bold" />
                      )}
                    </span>

                    {/* What this row is for. Never an ETA, never a count. */}
                    <span className="mt-2 block text-xs font-bold text-primary">
                      {actionLabel(primary.key)}
                    </span>
                  </span>

                  <ChevronNext className="mt-3 h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>

                {/* Outside the link: a button inside an <a> is invalid and
                    swallows the tap on some phones. */}
                {hasAgain && (
                  <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2.5">
                    {againButton(it)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {reorder && (
        <ReorderSheet
          open
          onClose={() => setReorder(null)}
          orderId={reorder.orderId}
          storeId={reorder.storeId}
          storeName={reorder.storeName}
          lang={lang}
          copy={copy}
          closeLabel={closeLabel}
        />
      )}
    </>
  );
}
