"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, Store, Shield, ExternalLink, User } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutButton } from "@/components/logout-button";

export function DashboardMobileMenu({
  lang,
  dict,
  isAdmin,
  name,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "dashboard">;
  isAdmin: boolean;
  name?: string;
}) {
  const [open, setOpen] = useState(false);

  const items = [
    { href: `/${lang}/merchant`, label: dict.dashboard.stores, icon: Store },
    ...(isAdmin
      ? [{ href: `/${lang}/admin`, label: dict.dashboard.admin, icon: Shield }]
      : []),
    { href: `/${lang}`, label: dict.dashboard.visitSite, icon: ExternalLink },
  ];

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <>
          {/* Hangs off the dashboard header, so it needs the same derived
              offset the header itself uses: the h-16 row (--m-header-h) plus
              env(safe-area-inset-top). At a flat `top-16` the panel and its
              scrim started under the notch and covered the header. (MP-032) */}
          <div
            className="fixed inset-0 top-[calc(var(--m-header-h)+env(safe-area-inset-top))] z-40 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <nav className="fixed inset-x-0 top-[calc(var(--m-header-h)+env(safe-area-inset-top))] z-40 max-h-[calc(100dvh-var(--m-header-h)-env(safe-area-inset-top))] overflow-y-auto border-b border-border bg-background p-3 shadow-lg">
            {name && (
              <div className="mb-1 flex items-center gap-2 px-3 py-2 text-sm font-semibold text-muted-foreground">
                <User className="h-4 w-4 text-primary" />
                {name}
              </div>
            )}
            <div className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* Controls that live in the bar on wider screens move here on a
                phone, so the header row never overflows. */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-3">
              <LanguageSwitcher currentLocale={lang} />
              <ThemeToggle />
            </div>
            <div className="mt-1">
              <LogoutButton label={dict.auth.logout} />
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
