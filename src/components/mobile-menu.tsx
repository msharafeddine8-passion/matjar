"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  Compass,
  ShoppingBag,
  Percent,
  Zap,
  TrendingUp,
  Briefcase,
  Sparkles,
  Boxes,
  Truck,
  Map as MapIcon,
  Store,
  Wrench,
  Hammer,
  Tag,
  LayoutDashboard,
  User,
  LogIn,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutButton } from "@/components/logout-button";
import { isActivePath } from "@/components/nav-link";
import type { NavSections } from "@/lib/data/section-supply";

type Item = {
  href: string;
  label: string;
  icon: typeof Compass;
  bold?: boolean;
  /** Omitted = always shown. `false` = nothing behind it yet (MP-026). */
  on?: boolean;
  /** Merchant-recruitment entries: present on the web, hidden inside the
   *  native shell, where they belong on /account rather than in the browse
   *  menu of a shopping app. See src/lib/app-mode.ts. */
  appHide?: boolean;
};

/** The words the menu prints, resolved on the server by site-header. */
export type MobileMenuLabels = Record<
  | "shop" | "explore" | "market" | "offers" | "flash" | "bestSellers"
  | "workServices" | "jobs" | "freelance" | "crafts" | "wholesale" | "delivery"
  | "more" | "forMerchants" | "hub" | "map" | "pricing" | "dashboard"
  | "login" | "menu" | "logout",
  string
>;

export function MobileMenu({
  lang,
  labels,
  sections,
  user,
  dashboardHref = null,
  lbpRate = 0,
}: {
  lang: Locale;
  /** Plain strings only: the menu is on every route, so it carries the
   *  ~20 words it prints rather than fifteen whole dictionary namespaces. */
  labels: MobileMenuLabels;
  /** Which verticals have three real results behind them — a plain object of
   *  booleans, so it crosses the server/client boundary as data. */
  sections: NavSections;
  user: { name: string } | null;
  dashboardHref?: string | null;
  lbpRate?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Modal drawer lifecycle (mirrors the merchant sidebar): while open, lock body
  // scroll, close on Escape, trap Tab within the panel, and move focus inside on
  // open. On close the effect cleanup returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Tab") {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open]);

  // Same gate as the desktop dropdown and the footer, from the same counts:
  // a section that cannot return three real results is not offered here either
  // (MP-026). Its route still answers — this menu just stops promising it.
  // A group left with no surviving items drops out rather than showing a
  // heading over empty space.
  const allGroups: { title: string; items: Item[] }[] = [
    {
      title: labels.shop,
      items: [
        { href: `/${lang}/explore`, label: labels.explore, icon: Compass },
        { href: `/${lang}/market`, label: labels.market, icon: ShoppingBag, bold: true, on: sections.market },
        { href: `/${lang}/offers`, label: labels.offers, icon: Percent },
        { href: `/${lang}/flash`, label: labels.flash, icon: Zap },
        { href: `/${lang}/best-sellers`, label: labels.bestSellers, icon: TrendingUp },
      ],
    },
    {
      title: labels.workServices,
      items: [
        { href: `/${lang}/jobs`, label: labels.jobs, icon: Briefcase, on: sections.jobs },
        { href: `/${lang}/freelance`, label: labels.freelance, icon: Sparkles, on: sections.freelance },
        { href: `/${lang}/crafts`, label: labels.crafts, icon: Hammer, on: sections.crafts },
        { href: `/${lang}/wholesale`, label: labels.wholesale, icon: Boxes, on: sections.wholesale },
        { href: `/${lang}/delivery`, label: labels.delivery, icon: Truck, on: sections.delivery },
      ],
    },
    {
      title: labels.more,
      items: [
        { href: `/${lang}/merchants`, label: labels.forMerchants, icon: Store, bold: true, appHide: true },
        { href: `/${lang}/hub`, label: labels.hub, icon: Wrench },
        { href: `/${lang}/map`, label: labels.map, icon: MapIcon },
        { href: `/${lang}/pricing`, label: labels.pricing, icon: Tag },
      ],
    },
  ];
  const groups = allGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.on !== false) }))
    .filter((g) => g.items.length > 0);

  const account: Item[] = user
    ? [
        ...(dashboardHref
          ? [{ href: dashboardHref, label: labels.dashboard, icon: LayoutDashboard, bold: true }]
          : []),
        { href: `/${lang}/account`, label: user.name, icon: User },
      ]
    : [{ href: `/${lang}/login`, label: labels.login, icon: LogIn }];

  // `lg:hidden`, not `md:hidden`: the desktop nav and controls only appear at
  // `lg`, so a tablet between 768 and 1024 was left with no menu at all and a
  // nav row it could not fit.
  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label={labels.menu}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted before:absolute before:-inset-1 before:content-['']"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <>
          {/* Same derived offset as the header it hangs off: site-header pads
              env(safe-area-inset-top) above its h-16 row, so a flat `top-16`
              here put the panel under the notch and over the header. (MP-032,
              same root cause on the customer side.) */}
          <div
            className="fixed inset-0 top-[calc(var(--m-header-h)+env(safe-area-inset-top))] z-40 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <nav
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={labels.menu}
            className="fixed inset-x-0 top-[calc(var(--m-header-h)+env(safe-area-inset-top))] z-40 max-h-[calc(100dvh-var(--m-header-h)-env(safe-area-inset-top))] overflow-y-auto border-b border-border bg-background p-3 shadow-lg"
          >
            {lbpRate > 0 && (
              <div className="mb-2 rounded-xl bg-surface-muted px-3 py-2 text-center text-sm font-bold text-muted-foreground">
                $1 = {lbpRate.toLocaleString("en-US")}{" "}
                {lang === "ar" ? "ل.ل." : "LBP"}
              </div>
            )}
            {groups.map((group, si) => (
              <div key={group.title} className={si > 0 ? "mt-3" : ""}>
                <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        data-app-hide={item.appHide ? "merchant-cta" : undefined}
                        aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors hover:bg-surface-muted aria-[current=page]:bg-surface-muted ${
                          item.bold ? "font-bold text-primary" : "font-medium text-foreground"
                        }`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="my-2 border-t border-border" />

            <div className="space-y-1">
              {account.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors hover:bg-surface-muted aria-[current=page]:bg-surface-muted ${
                      item.bold ? "font-bold text-primary" : "font-medium text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* Language + theme live in the bar on desktop; on a phone they
                move here so the header can't overflow.
                In the native shell the language half is hidden (it lives on
                /account there — see src/lib/app-mode.ts) and the row falls back
                to `justify-end`, which is where a lone theme toggle belongs
                rather than stranded at the start of an empty row. */}
            <div
              data-app-row="lang-theme"
              className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-3"
            >
              <span data-app-hide="lang" className="contents">
                <LanguageSwitcher currentLocale={lang} />
              </span>
              <ThemeToggle />
            </div>
            {user && (
              <div className="mt-1" onClick={() => setOpen(false)}>
                <LogoutButton label={labels.logout} />
              </div>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
