"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { supportWaLink } from "@/lib/support";
import {
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
  Lock,
  MessageCircle,
  Store,
  X,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { CategoryKey } from "@/lib/catalog";
import type { StorePlan } from "@/lib/plan-tiers";
import {
  OS_MODULE_META,
  sectorTeamMeta,
  type OsModuleKey,
} from "@/lib/sectors";
import {
  MerchantBottomNav,
  type MerchantNavItem,
} from "@/components/merchant/merchant-bottom-nav";

// ===== Matjar Business OS — persistent sidebar =====
// The Shopify-grade shell around every store page. Desktop (lg+): a sticky rail
// on the inline-start side. Below lg: the merchant mode bar (rendered by the
// store layout above this) plus a thumb-reachable bottom nav, with this
// component's drawer behind its "المزيد" slot as the long tail. The nav model
// arrives fully resolved (labels + hrefs) from the server layout; icons are
// looked up client-side by module key since component refs don't serialize
// across the RSC boundary.

export type SidebarItem = {
  key: string;
  label: string;
  href: string;
  /** Pro module on a free store — shows a lock (pages still re-gate). */
  locked?: boolean;
  /** Match this href exactly (the OS home must not stay lit on subpages). */
  exact?: boolean;
};

export type SidebarNav = {
  home: SidebarItem;
  groups: { key: string; label: string; items: SidebarItem[] }[];
  /** Modules this plan will not open, collected out of the groups above. */
  advanced: { label: string; hint: string; items: SidebarItem[] };
  pinned: SidebarItem[];
  backLabel: string;
  supportLabel: string;
  viewStoreLabel: string;
  proBadge: string;
  basicBadge: string;
  businessBadge: string;
  freeBadge: string;
  trialBadge: string;
};

function ItemIcon({
  itemKey,
  category,
  className,
}: {
  itemKey: string;
  /** The store's sector — only the roster module's glyph depends on it. */
  category: CategoryKey;
  className?: string;
}) {
  const Icon =
    itemKey === "home"
      ? LayoutDashboard
      : // The roster module's key is `doctors` everywhere (table, route, RPCs);
        // only a clinic's roster is doctors. The sector says which glyph.
        itemKey === "doctors"
        ? sectorTeamMeta(category).Icon
        : (OS_MODULE_META[itemKey as OsModuleKey]?.Icon ?? LayoutDashboard);
  return <Icon className={className} aria-hidden />;
}

function NavRow({
  item,
  category,
  active,
  onNavigate,
}: {
  item: SidebarItem;
  category: CategoryKey;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors active:scale-[0.98] ${
        active
          ? "bg-primary-soft font-bold text-primary"
          : "font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary"
        />
      )}
      <ItemIcon
        itemKey={item.key}
        category={category}
        className="h-4 w-4 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.locked && (
        <Lock className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      )}
    </Link>
  );
}

export function MerchantSidebar({
  lang,
  storeId,
  storeName,
  logoUrl,
  plan,
  trialDaysLeft = 0,
  slug,
  category,
  nav,
  tabs,
}: {
  lang: Locale;
  storeId: string;
  storeName: string;
  logoUrl: string | null;
  /** The tier the store pays for (not the trial-raised effective plan). */
  plan: StorePlan;
  /** > 0 only while a trial is what unlocks Pro (the layout decides). */
  trialDaysLeft?: number;
  slug: string | null;
  /** The store's sector, so the roster module can carry its own glyph. */
  category: CategoryKey;
  nav: SidebarNav;
  /** Phone bottom nav, resolved from the sector in the layout. Empty = none. */
  tabs?: MerchantNavItem[];
}) {
  // During an active trial Pro is unlocked, but say so explicitly so the
  // merchant knows it's temporary and counting down.
  const onTrial = trialDaysLeft > 0;
  const paid = plan !== "free";
  const planBadge = onTrial
    ? nav.trialBadge
    : plan === "business"
      ? nav.businessBadge
      : plan === "pro"
        ? nav.proBadge
        : plan === "basic"
          ? nav.basicBadge
          : nav.freeBadge;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Navigating closes the drawer. Adjusted during render rather than in an
  // effect: an effect would paint the new route with the drawer still over it
  // for a frame before closing it.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const viewHref = `/${lang}/${slug ?? `store/${storeId}`}`;

  // Longest-prefix active matching; the home item opts into exact-only so it
  // doesn't stay lit for every subpage under the store base path.
  const activeHref = useMemo(() => {
    const all = [
      nav.home,
      ...nav.groups.flatMap((g) => g.items),
      ...nav.advanced.items,
      ...nav.pinned,
    ];
    let best: SidebarItem | null = null;
    for (const item of all) {
      const match = item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.href.length)) best = item;
    }
    return best?.href ?? null;
  }, [pathname, nav]);

  // Drawer lifecycle: close on Escape, focus the close button when opening
  // (basic trap), lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const identity = (
    <div className="flex items-center gap-3 border-b border-border px-4 py-4">
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-lg border border-border bg-surface object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-extrabold text-primary">
          {storeName.trim().charAt(0)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{storeName}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
              onTrial
                ? "bg-warning-soft text-warning"
                : paid
                  ? "bg-accent-soft text-accent-foreground"
                  : "bg-surface-muted text-muted-foreground"
            }`}
          >
            {planBadge}
          </span>
          <Link
            href={viewHref}
            target="_blank"
            aria-label={nav.viewStoreLabel}
            title={nav.viewStoreLabel}
            className="text-muted-foreground transition-colors hover:text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );

  // Section header chrome, shared by a collapsible group and the advanced
  // block. h-9 is 36px; the transparent before: band adds 4px above and below
  // for a 44px touch target. Reading the summary's own box would report 36 and
  // be wrong — the target lives on ::before.
  const summaryCls =
    "relative flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:text-foreground";

  // ISS-029. The advanced-tools collapse shortened the drawer for a FREE store
  // (most of its modules are locked, so most of its rows moved behind one
  // summary) and did nothing at all for a paying one — a Business store has
  // nothing locked, so `nav.advanced` is empty and every module still renders
  // flat. That store has the longest drawer in the product and got none of the
  // relief. So on the phone the groups collapse too: the group holding the
  // current page is open, the first group (daily work) is open, the rest rest.
  // Every group label stays visible with its count, so nothing is more than one
  // tap away and nothing is hidden — the merchant still sees that "المال" has
  // four things in it. The desktop rail is NOT collapsed: it has the full column
  // height to spend and scanning beats tapping when the whole list fits.
  const renderGroup = (
    group: SidebarNav["groups"][number],
    index: number,
    collapsible: boolean,
  ) => {
    const rows = (
      <div className="mt-1.5 space-y-0.5">
        {group.items.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            category={category}
            active={activeHref === item.href}
            onNavigate={() => setOpen(false)}
          />
        ))}
      </div>
    );

    if (!collapsible) {
      return (
        <div key={group.key} className="mt-6">
          <div className="ps-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </div>
          {rows}
        </div>
      );
    }

    return (
      <details
        key={group.key}
        className="group mt-6"
        open={
          index === 0 ||
          group.items.some((i) => i.href === activeHref) ||
          undefined
        }
      >
        <summary className={summaryCls}>
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          <span className="shrink-0 tabular-nums">{group.items.length}</span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>
        {rows}
      </details>
    );
  };

  const renderNav = (collapsibleGroups: boolean) => (
    <>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavRow
          item={nav.home}
          category={category}
          active={activeHref === nav.home.href}
          onNavigate={() => setOpen(false)}
        />
        {nav.groups.map((group, i) =>
          renderGroup(group, i, collapsibleGroups),
        )}

        {/* Everything this plan does not open, in one place instead of thirteen
            padlocks salted through the groups above. Kept as a real <details>
            so it needs no state, no effect and no JS to work — and it opens
            itself when the merchant is standing on one of these pages, so the
            rail never loses track of where they are. */}
        {nav.advanced.items.length > 0 && (
          <details
            className="group mt-6"
            open={
              nav.advanced.items.some((i) => i.href === activeHref) || undefined
            }
          >
            <summary className={summaryCls}>
              <Lock className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {nav.advanced.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {nav.advanced.items.length}
              </span>
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium leading-snug text-muted-foreground/70">
              {nav.advanced.hint}
            </p>
            <div className="mt-1 space-y-0.5">
              {nav.advanced.items.map((item) => (
                <NavRow
                  key={item.key}
                  item={item}
                  category={category}
                  active={activeHref === item.href}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          </details>
        )}
      </nav>
      <div className="space-y-0.5 border-t border-border px-3 py-3">
        {nav.pinned.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            category={category}
            active={activeHref === item.href}
            onNavigate={() => setOpen(false)}
          />
        ))}
        <Link
          href={`/${lang}/merchant`}
          onClick={() => setOpen(false)}
          className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground active:scale-[0.98]"
        >
          <Store className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{nav.backLabel}</span>
        </Link>
        {/* The merchant dashboard had no route to a human anywhere in it. A
            merchant whose orders stopped arriving, or who cannot find where a
            setting moved, was expected to navigate out to the customer site and
            hunt for a contact page. These are the people paying for the
            platform; the way to reach somebody belongs where they already are.
            The shop's name rides along in the prefill, because the first thing
            support would otherwise have to ask is "which store?". */}
        <a
          href={supportWaLink(
            `${storeName} — ${nav.supportLabel}`,
          )}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-whatsapp active:scale-[0.98]"
        >
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {nav.supportLabel}
          </span>
        </a>
      </div>
    </>
  );

  return (
    <>
      {/* Both rails stick *below* the dashboard header, whose real height is the
          h-16 row PLUS env(safe-area-inset-top) — the header pads for the notch
          above its row (see (dashboard)/layout.tsx). `top-16` was a hardcoded
          64px that ignored the inset, so on a notched phone the strip sat ~47px
          (iPhone 14/15) too high and tucked under the header. The offset is now
          derived: --m-header-h is the row (4rem, the token that already names
          h-16), and the inset is added on top. Off a notch the inset is 0 and
          this resolves to the old 64px exactly. (MP-033)

          ISS-028 moved this rail to md (768px). The mobile-shell redesign moves
          it back to lg (1024px) so that ONE breakpoint decides which of the two
          shells a merchant gets: below lg the navy mode bar, the thumb nav and
          the drawer; from lg the rail. Two thresholds meant a 900px tablet
          could show the rail while the shell above it still spoke phone.
          Stated plainly because it is a real trade-off and ISS-028 argued the
          other way: a portrait iPad (810–834px) goes back to the phone shell
          and gives up its persistent rail. Nothing at or above lg — every
          desktop, every landscape iPad — changes at all.

          Both rails stick *below* the dashboard header, whose real height is
          the h-16 row PLUS env(safe-area-inset-top): the header pads for the
          notch above its row (see (dashboard)/layout.tsx). A hardcoded `top-16`
          ignored the inset and sat ~47px too high on a notched phone; the
          offset is derived instead, and off a notch resolves to 64px exactly.
          (MP-033) */}
      <aside className="sticky top-[calc(var(--m-header-h)+env(safe-area-inset-top))] hidden h-[calc(100dvh-var(--m-header-h)-env(safe-area-inset-top))] w-60 shrink-0 flex-col border-e border-border bg-surface lg:flex print:hidden">
        {identity}
        {renderNav(false)}
      </aside>

      {/* No phone top bar here any more: the store's name, its open/closed
          state and the link to the public page moved into the merchant mode
          bar, which the store layout renders above this. Two stacked strips
          both saying the shop's name was 100px of a phone screen spent twice on
          the same fact. */}

      {/* Phone primary navigation. The drawer below is no longer how a
          merchant reaches their orders — it is where the long tail lives. */}
      {tabs && tabs.length > 0 && (
        <MerchantBottomNav
          items={tabs}
          category={category}
          onMore={() => setOpen(true)}
          navLabel={nav.backLabel}
        />
      )}

      {/* Phone drawer — always mounted so it can slide, inert when closed.
          overflow-hidden clips the off-canvas panel (translated a full width
          past the inline-start edge when closed) so it never adds horizontal
          page scroll — which on mobile would blow up the layout viewport and
          shrink the whole dashboard. Below lg only: from lg up the rail above
          is the navigation and this never renders. */}
      <div
        className={`fixed inset-0 z-50 overflow-hidden lg:hidden ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={storeName}
          className={`absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
            open
              ? "translate-x-0"
              : "ltr:-translate-x-full rtl:translate-x-full"
          }`}
        >
          <div className="relative">
            {identity}
            <button
              ref={closeRef}
              type="button"
              aria-label="close"
              onClick={() => setOpen(false)}
              className="absolute end-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {renderNav(true)}
        </div>
      </div>
    </>
  );
}
