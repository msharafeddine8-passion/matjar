import Link from "next/link";
import { dictSlice } from "@/lib/dict-slice";
import Image from "next/image";
import { User } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";
import { MobileMenu } from "@/components/mobile-menu";
import { NavDropdown } from "@/components/nav-dropdown";
import { NavLink } from "@/components/nav-link";
import { HeaderBells } from "@/components/header-bells";
import { HeaderSearch } from "@/components/header-search";
import { MobileSearch } from "@/components/mobile-search";
import type { NavSections } from "@/lib/data/section-supply";

export function SiteHeader({
  lang,
  dict,
  user,
  userId = null,
  unread = 0,
  unreadMessages = 0,
  dashboardHref = null,
  lbpRate = 0,
  sections,
}: {
  lang: Locale;
  dict: Dictionary;
  user: { name: string } | null;
  userId?: string | null;
  unread?: number;
  unreadMessages?: number;
  dashboardHref?: string | null;
  lbpRate?: number;
  /** Which verticals have three real results behind them — see
   *  lib/data/section-supply.ts. Unlisted sections keep their routes; they
   *  simply stop being advertised from the top of every page. */
  sections: NavSections;
}) {
  // The dropdown is built from what survives the gate, and disappears entirely
  // rather than opening onto one item — a menu with a single entry is a link
  // wearing a chevron.
  const workItems = [
    { href: `/${lang}/jobs`, label: dict.jobs.title, on: sections.jobs },
    {
      href: `/${lang}/freelance`,
      label: dict.freelance.title,
      on: sections.freelance,
    },
    // Beside freelance on purpose, and deliberately not the same thing: that
    // one is remote and digital, this one comes to your house.
    { href: `/${lang}/crafts`, label: dict.crafts.title, on: sections.crafts },
    {
      href: `/${lang}/wholesale`,
      label: dict.wholesale.title,
      on: sections.wholesale,
    },
    {
      href: `/${lang}/delivery`,
      label: dict.delivery.title,
      on: sections.delivery,
    },
  ]
    .filter((i) => i.on)
    .map(({ href, label }) => ({ href, label }));

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-md print:hidden">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link
            href={`/${lang}`}
            aria-label={dict.common.brand}
            /* The mark stays 36px; the tap area is extended to 44 with a
               transparent pseudo-element — the same trick ui/button uses for
               its sm size, so the header does not have to get taller. */
            className="relative flex items-center before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']"
          >
            <Image
              src="/logo.png"
              alt={dict.common.brand}
              width={450}
              height={182}
              priority
              unoptimized
              className="h-9 w-auto max-w-none object-contain"
            />
          </Link>
          {/* One breakpoint for the whole header. This nav used to appear at
              `md`, while the mobile search row below is `lg:hidden`, the ☰
              menu was `md:hidden`, and the rate pill and merchant CTA both
              wait for `lg`. Between 768 and 1024 that produced the worst of
              both: the ☰ gone, the full nav crammed into a row that measured
              1011px of content inside 768px, and the phone search bar still
              stacked underneath it. The tablet now gets the mobile treatment,
              which is complete, until there is genuinely room for the desktop
              one. */}
          <nav className="hidden items-center gap-1 lg:flex">
            <NavLink
              href={`/${lang}/explore`}
              className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm xl:px-3 font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground aria-[current=page]:bg-surface-muted aria-[current=page]:text-foreground"
            >
              {dict.common.explore}
            </NavLink>
            {sections.market && (
              <NavLink
                href={`/${lang}/market`}
                className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm xl:px-3 font-bold text-primary transition-colors hover:bg-surface-muted aria-[current=page]:bg-primary-soft"
              >
                {dict.market.nav}
              </NavLink>
            )}
            <NavDropdown
              label={dict.common.deals}
              items={[
                { href: `/${lang}/offers`, label: dict.offers.title },
                { href: `/${lang}/flash`, label: dict.flash.title, accent: true },
                { href: `/${lang}/best-sellers`, label: dict.bestSellers.title },
              ]}
            />
            {workItems.length > 1 && (
              <NavDropdown label={dict.common.workServices} items={workItems} />
            )}
            {workItems.length === 1 && (
              <NavLink
                href={workItems[0].href}
                className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm xl:px-3 font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground aria-[current=page]:bg-surface-muted aria-[current=page]:text-foreground"
              >
                {workItems[0].label}
              </NavLink>
            )}
            <NavLink
              href={`/${lang}/hub`}
              className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm xl:px-3 font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground aria-[current=page]:bg-surface-muted aria-[current=page]:text-foreground"
            >
              {dict.common.hub}
            </NavLink>
            <NavLink
              href={`/${lang}/merchants`}
              className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm xl:px-3 font-bold text-primary transition-colors hover:bg-surface-muted aria-[current=page]:bg-primary-soft"
            >
              {dict.common.forMerchants}
            </NavLink>
            {/* The map link left this row on purpose. The row was 94px over its
                container at every desktop width, something had to go, and the map
                is the least-earned tenant: 5 of 13 stores have a pin, and the
                footer keeps the link. It returns to the header when the map has
                a marketplace behind it. */}
          </nav>
        </div>
        {/* This row used to need 1182px inside 1088px of container — measured in
            a live browser as 6px of horizontal page scroll at 1280, with the CTA
            at left:-6 in RTL. min-w-0 on this group changed nothing (tried,
            measured, reverted): the row was simply over-tenanted. Dropping the
            map link (see the nav above) is what paid the debt. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          {/* Bells stay visible for signed-in users even on a phone. */}
          {user && (
            <HeaderBells
              lang={lang}
              dict={dictSlice(dict, ["common"])}
              userId={userId}
              unreadNotifications={unread}
              unreadMessages={unreadMessages}
            />
          )}
          {/* Full controls on desktop; below `lg` these live in the ☰ menu so
              the bar can never overflow. */}
          <div className="hidden items-center gap-2 lg:flex lg:gap-3">
            {/* Daily habit hook: Lebanese users check the USD rate constantly. */}
            {lbpRate > 0 && (
              <span
                title={dict.common.rateTitle}
                className="hidden whitespace-nowrap rounded-full bg-surface-muted px-3 py-1.5 text-xs font-bold text-muted-foreground xl:block"
              >
                $1 = {lbpRate.toLocaleString("en-US")}{" "}
                {lang === "ar" ? "ل.ل." : "LBP"}
              </span>
            )}
            <ThemeToggle />
            {/* A language toggle in the top bar is a website control — an app
                asks once, in Settings, and remembers. Hidden in the shell and
                offered on /account instead (`data-app-only` block there);
                signed-out app users still reach one on /login, whose layout
                carries its own. The theme toggle stays: switching to dark is
                something a phone user does at night, not once at signup. */}
            <span data-app-hide="lang" className="contents">
              <LanguageSwitcher currentLocale={lang} />
            </span>
            {user ? (
              <>
                {dashboardHref && (
                  <Link
                    href={dashboardHref}
                    className="rounded-lg px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-surface-muted"
                  >
                    {dict.dashboard.panel}
                  </Link>
                )}
                <Link
                  href={`/${lang}/account`}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
                >
                  <User className="h-4 w-4 text-primary" />
                  {user.name}
                </Link>
                <LogoutButton label={dict.auth.logout} />
              </>
            ) : (
              <Link
                href={`/${lang}/login`}
                className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
              >
                {dict.common.login}
              </Link>
            )}
          </div>
          {/* Open-store is the primary guest CTA from `lg` up, where the row
              has the width for it. On a phone it was one of only six visible
              controls, and the one asking somebody who came to buy something
              to become a merchant instead — §8 puts secondary controls in the
              menu. It is not lost there: the ☰ menu carries `للتجّار` in bold,
              the footer carries both `للتجّار` and `افتح متجرك`, and the foot
              of Home is a merchant door of its own. It stops competing above
              the fold, which is all that changed.
              `xl`, not `lg`: at 1024 the logo, nav and controls already need
              1075px of a 1024px row, and this button together with the rate
              pill is 215 of them. Both now wait for 1280. Nothing is lost in
              between — `للتجّار` is a link in the nav row a few pixels away,
              and the footer carries both it and `افتح متجرك`. */}
          {/* `data-app-hide`: in the shell this is the app's own top bar, and a
              customer who opened a shopping app is not there to be recruited as
              a merchant. The door is not bricked up — /account carries an
              app-only merchant block, and /merchant/new still answers. */}
          {!user && (
            <Link
              href={`/${lang}/merchant/new`}
              data-app-hide="merchant-cta"
              className="relative hidden rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] hover:bg-primary-hover xl:inline-block xl:px-4"
            >
              {dict.common.openStore}
            </Link>
          )}
          <MobileMenu
            lang={lang}
            labels={{
              shop: dict.mobileNav.shop,
              explore: dict.common.explore,
              market: dict.market.nav,
              offers: dict.offers.title,
              flash: dict.flash.title,
              bestSellers: dict.bestSellers.title,
              workServices: dict.common.workServices,
              jobs: dict.jobs.title,
              freelance: dict.freelance.title,
              crafts: dict.crafts.title,
              wholesale: dict.wholesale.title,
              delivery: dict.delivery.title,
              more: dict.mobileNav.more,
              forMerchants: dict.common.forMerchants,
              hub: dict.common.hub,
              map: dict.map.title,
              pricing: dict.pricing.title,
              dashboard: dict.dashboard.panel,
              login: dict.common.login,
              menu: dict.common.menu,
              logout: dict.auth.logout,
            }}
            sections={sections}
            user={user}
            dashboardHref={dashboardHref}
            lbpRate={lbpRate}
          />
        </div>
      </Container>

      {/* Phones get search as its own screen; desktop keeps the sticky field,
          which works fine at that width. Both routes end at /search. */}
      <Container className="pb-2.5 lg:hidden">
        <MobileSearch
          lang={lang}
          labels={{
            open: dict.search.openSearch,
            placeholder: dict.hero.searchPlaceholder,
            recent: dict.search.recent,
            clear: dict.search.clear,
            back: dict.common.back,
          }}
        />
      </Container>

      <HeaderSearch lang={lang} dict={dictSlice(dict, ["hero"])} />
    </header>
  );
}
