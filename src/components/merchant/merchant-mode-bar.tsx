import Link from "next/link";
import { ExternalLink } from "lucide-react";

// ===== Merchant mode bar =====
//
// The same human is a customer and a merchant in this app, on the same phone,
// under the same login. The customer marketplace and the merchant dashboard
// share the header shell, and on a phone — where there is no 240px rail on the
// side saying "you are running a shop" — the only thing that distinguished the
// two was which page happened to be loaded. A merchant standing behind a
// counter has to be able to tell at a glance, and so does a customer who tapped
// something wrong.
//
// So below `lg` every dashboard screen opens with this: a dark navy band that
// belongs to no other surface in the product, a «وضع التاجر» chip, the shop's
// own name, and the shop's open/closed state.
//
// ── The open/closed control is READ-ONLY, deliberately ────────────────────
//
// There is no manual open/closed switch in this database. `stores` has no
// `is_open`, no `paused`, no `accepting_orders` column — the open/closed state
// the whole platform renders (store header, /explore cards, the for-you strip)
// is DERIVED from `stores.hours` by isOpenNow(). "Closing the shop" therefore
// means editing the weekly hours grid, which lives in the store-settings form
// this component does not own and must not reach into.
//
// A switch here would have to either (a) write a column that does not exist,
// or (b) rewrite the merchant's real opening hours from a one-tap control —
// destroying the grid they configured, in order to fake a feature. Both are
// worse than saying the truth. So the state renders as the real derived status,
// it says out loud where that status comes from, and tapping it goes to the
// place that actually decides it.
//
// If a manual switch is wanted, it is a migration (`stores.is_open boolean`)
// plus a change to isOpenNow's callers — a feature, not a control.

export type StoreOpenState = boolean | null;

export function MerchantModeBar({
  storeName,
  /** True/false from the hours grid; null when no hours are configured. */
  open,
  chipLabel,
  openLabel,
  closedLabel,
  unknownLabel,
  hoursNote,
  hoursUnsetNote,
  /** Where the hours grid actually lives (the store edit screen). */
  hoursHref,
  viewHref,
  viewLabel,
}: {
  storeName: string;
  open: StoreOpenState;
  chipLabel: string;
  openLabel: string;
  closedLabel: string;
  unknownLabel: string;
  hoursNote: string;
  hoursUnsetNote: string;
  /** Null for staff: the edit screen is owner-only, so the chip is plain text. */
  hoursHref: string | null;
  viewHref: string;
  viewLabel: string;
}) {
  const statusLabel =
    open === null ? unknownLabel : open ? openLabel : closedLabel;
  const dot =
    open === null ? "bg-warning" : open ? "bg-success" : "bg-danger";

  return (
    <>
      {/*
        The navy is a fixed brand colour, not a semantic token, and this repo
        styles exclusively through tokens — there is no `dark:` variant
        configured anywhere in it (zero occurrences across src/), so `dark:`
        classes would silently do nothing. globals.css belongs to another agent,
        so the dark-theme value cannot be added as a token there either.

        React 19 hoists and de-duplicates a <style> carrying `href` +
        `precedence`, so this ships once however many times the bar renders. The
        two dark selectors mirror globals.css exactly: the media query is
        guarded with :not([data-theme="light"]) so a user who forced light on a
        dark OS keeps the light navy, and [data-theme="dark"] wins for the
        toggle. Off both, the value is the light one.
      */}
      <style href="merchant-mode-bar" precedence="default">
        {`.m-mode-bar{--m-mode-bg:#0e2a5c;--m-mode-chip:rgba(255,255,255,.16);}` +
          `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .m-mode-bar{--m-mode-bg:#0a1c3d;--m-mode-chip:rgba(255,255,255,.13);}}` +
          `:root[data-theme="dark"] .m-mode-bar{--m-mode-bg:#0a1c3d;--m-mode-chip:rgba(255,255,255,.13);}`}
      </style>
      {/* Sticks directly under the dashboard header, whose real height is the
          h-16 row (--m-header-h) PLUS env(safe-area-inset-top) — the header
          pads for the notch above its row. Same derived offset the sidebar
          rail uses; a flat top-16 sits ~47px too high on a notched phone. */}
      <div
        className="m-mode-bar sticky top-[calc(var(--m-header-h)+env(safe-area-inset-top))] z-30 lg:hidden print:hidden"
        style={{ backgroundColor: "var(--m-mode-bg)" }}
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <span
            className="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold leading-none text-white"
            style={{ backgroundColor: "var(--m-mode-chip)" }}
          >
            {chipLabel}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold leading-tight text-white">
              {storeName}
            </div>
            {/* Says where the status comes from, in plain words, always — this
                is the "and say so" half of a read-only control.

                Deliberately NOT its own link. Measured at 320–768 it came out
                as a 79×21 hit area — a 13px line of text inside a 56px bar,
                with the store name directly above it and the status pill
                beside it. There is no way to grow it to 44px that does not
                steal taps from one of those two. The pill next to it already
                goes to the same place with a 44px target, so the caption is
                the label and the pill is the control. */}
            <span className="block truncate text-[10px] font-medium leading-tight text-white/70">
              {open === null ? hoursUnsetNote : hoursNote}
            </span>
          </div>
          {/* h-8 (32px) + the transparent -inset-y-1.5 band (2×6) = a 44px hit
              area without changing the bar's height. */}
          {hoursHref ? (
            <Link
              href={hoursHref}
              aria-label={`${statusLabel} — ${open === null ? hoursUnsetNote : hoursNote}`}
              className="relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold text-white before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
              style={{ backgroundColor: "var(--m-mode-chip)" }}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
              {statusLabel}
            </Link>
          ) : (
            // Staff can't open the owner-only edit screen; a link there would
            // just bounce them home, so the status is shown, not offered.
            <span
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold text-white"
              style={{ backgroundColor: "var(--m-mode-chip)" }}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
              {statusLabel}
            </span>
          )}
          {/* 32×32 visible; the transparent -inset-1.5 band (2×6 on both axes)
              makes the hit area 44×44 without widening the bar. Measured: the
              -inset-y-only version this started as came out 32px WIDE. */}
          <Link
            href={viewHref}
            target="_blank"
            aria-label={viewLabel}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/75 before:absolute before:-inset-1.5 before:content-[''] hover:text-white"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </>
  );
}
