import Link from "next/link";
import { Store, Smartphone, MessageCircle } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { LanguageSwitcher } from "@/components/language-switcher";
import type { NavSections } from "@/lib/data/section-supply";
import { SUPPORT_WHATSAPP, supportWaLink } from "@/lib/support";
import { featureCopy, featureStatus } from "@/lib/feature-availability";

export function SiteFooter({
  lang,
  dict,
  sections,
}: {
  lang: Locale;
  dict: Dictionary;
  /** Which verticals have enough behind them to be worth a link — see
   *  lib/data/section-supply.ts. The routes all still exist and answer. */
  sections: NavSections;
}) {
  const L = dict.footer.links;
  // The two app-store badges stand for ONE feature — `nativeApp` in the
  // availability registry — and the word on them is the registry's, not this
  // file's. The day the app is submitted the registry flips and the badge
  // vanishes here without anyone remembering the footer had its own "Soon".
  // (The section links below are gated on SUPPLY, not on feature status: a
  // vertical with no rows is hidden, never labelled — see section-supply.ts.)
  const app = featureStatus("nativeApp");
  const appBadge = app.status === "available" ? null : featureCopy(app.status, dict);

  // `on` is written per link rather than filtered after the fact so that the
  // gate is visible at the point where the link is declared — the failure mode
  // this fixes is exactly a section quietly outliving its supply.
  const columns = [
    {
      title: dict.mobileNav.shop,
      links: [
        { label: L.stores, href: `/${lang}/explore` },
        { label: L.categories, href: `/${lang}/categories` },
        { label: dict.market.nav, href: `/${lang}/market`, on: sections.market },
        { label: L.offers, href: `/${lang}/offers` },
        { label: dict.flash.title, href: `/${lang}/flash` },
        { label: dict.bestSellers.title, href: `/${lang}/best-sellers` },
      ],
    },
    {
      title: dict.common.workServices,
      links: [
        { label: dict.jobs.title, href: `/${lang}/jobs`, on: sections.jobs },
        {
          label: dict.freelance.title,
          href: `/${lang}/freelance`,
          on: sections.freelance,
        },
        {
          label: dict.crafts.title,
          href: `/${lang}/crafts`,
          on: sections.crafts,
        },
        {
          label: dict.wholesale.title,
          href: `/${lang}/wholesale`,
          on: sections.wholesale,
        },
        {
          label: dict.delivery.title,
          href: `/${lang}/delivery`,
          on: sections.delivery,
        },
        // The map is a view of the stores that already exist, not a vertical
        // with its own supply, so it is not gated on one.
        { label: dict.map.title, href: `/${lang}/map` },
      ],
    },
    {
      title: dict.footer.merchantsTitle,
      links: [
        { label: dict.common.forMerchants, href: `/${lang}/merchants` },
        { label: L.openStore, href: `/${lang}/merchant/new` },
        // Ungated on purpose, and it is the one link here that MUST be.
        //
        // Every other vertical link on this page is gated on supply — see
        // section-supply.ts — so a customer is never sent to an empty browse
        // page. For crafts that gate closed a loop: craft_providers is 0, so
        // /crafts vanished from the header, the mobile menu and this footer,
        // which meant the page where a tradesman signs up could not be reached
        // from anywhere on the site. No craftsmen, therefore no link;
        // no link, therefore no craftsmen.
        //
        // The customer-facing browse link stays gated. This is the supply side,
        // it lives in the merchants column where the other recruitment doors
        // are, and it is always open.
        { label: dict.crafts.joinCta, href: `/${lang}/crafts/join` },
        { label: dict.common.hub, href: `/${lang}/hub` },
        { label: L.pricing, href: `/${lang}/pricing` },
        { label: L.merchantLogin, href: `/${lang}/login` },
      ],
    },
    {
      title: dict.footer.companyTitle,
      links: [
        { label: L.about, href: `/${lang}/about` },
        { label: dict.trustPage.metaTitle, href: `/${lang}/trust` },
        { label: L.help, href: `/${lang}/help` },
        { label: L.contact, href: `/${lang}/contact` },
        { label: L.privacy, href: `/${lang}/privacy` },
      ],
    },
  ];

  return (
    // `data-app-hide`: gone inside the native shell, untouched in every
    // browser. This footer is 21 internal links and the site's only visible
    // support number — load-bearing for SEO and for a first-time visitor —
    // and it is also 1115px of sitemap under a phone screen that already has
    // a tab bar. Apps do not put a sitemap at the bottom of every screen;
    // websites do, which is exactly what it was making this one feel like.
    // The rule that hides it is inlined into <head> (src/lib/app-mode.ts) so
    // it applies in the first style resolution — this never paints in the app
    // and is never removed after the fact.
    <footer
      data-app-hide="footer"
      className="border-t border-border bg-surface print:hidden"
    >
      <Container className="py-10 sm:py-14">
        {/* One column on phones, five from `md`. The app block is a separate
            cell so the single-column stack can end with it — see below. It is
            pinned back to column 1 / row 2 at `md`, and the row gap there is
            the 24px it used to get from its own `mt-6`, so the desktop footer
            is byte-for-byte where it was. `1fr` on row 2 absorbs any extra
            height the row-spanning link columns need, keeping row 1 — and so
            the app block's top edge — exactly under the tagline. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr] md:grid-rows-[auto_1fr] md:gap-10 md:gap-y-6">
          {/* The brand block spans both mobile columns; the four link columns
              pair up beneath it. One column on a phone put 21 links at 44px
              into a single stack and made this footer 1639px tall — 52% of the
              whole home page. Two columns halves that without hiding a single
              link behind a tap, which is what an accordion would have cost.
              The labels are short enough for a half-width column at 320px. */}
          <div className="col-span-2 md:col-span-1">
            {/* Measured at 40px in a live browser: the only interactive target on
                the home page that misses the 44px the rest of the codebase holds
                to, and the only one with no hit-area pseudo behind it. */}
            <Link href={`/${lang}`} className="flex min-h-11 items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-hover text-primary-foreground shadow-md">
                <Store className="h-5 w-5" />
              </span>
              <span className="text-xl font-extrabold tracking-tight">
                {dict.common.brand}
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {dict.footer.tagline}
            </p>
            {/* The footer is the only contact affordance on every page, and until
                now it offered a link to a page that offers a link. WhatsApp is how
                a Lebanese shop is actually reached, so the number is here in full
                rather than one hop away — and shown, not hidden behind a label,
                because a visible number is what makes a small platform look real
                enough to trust with an order. dir="ltr" + tabular-nums so the
                digits do not reorder inside the Arabic column. */}
            <a
              href={supportWaLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-bold transition-colors hover:border-whatsapp hover:text-whatsapp"
            >
              <MessageCircle className="h-4 w-4 text-whatsapp" />
              <span>{dict.common.supportWhatsappShort}</span>
              <span dir="ltr" className="tabular-nums text-muted-foreground">
                {SUPPORT_WHATSAPP.replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3")}
              </span>
            </a>
          </div>

          {columns
            .map((col) => ({
              ...col,
              links: col.links.filter((l) => !("on" in l) || l.on),
            }))
            // A heading with nothing under it is its own kind of dead end.
            .filter((col) => col.links.length > 0)
            .map((col) => (
              <div key={col.title} className="md:row-span-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  {col.title}
                </h3>
                {/* Links carry vertical padding so the touch target clears 44px
                    (WCAG 2.5.5) — measured at 20px before. The negative inline
                    margin keeps the text where it was, so only the hit area
                    grows. */}
                <ul className="mt-3 space-y-0.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="-mx-2 inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground transition-colors hover:text-primary"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

          {/* Two "Soon" badges for apps nobody can install yet were the first
              thing under the brand on a phone — above every link the footer
              actually exists to serve. Last child, so the mobile stack reaches
              them only after the navigation. */}
          <div className="col-span-2 md:col-span-1 md:col-start-1 md:row-start-2 md:self-start">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {dict.footer.appTitle}
            </p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {[
                { top: dict.footer.downloadOn, name: dict.footer.appStore },
                { top: dict.footer.getItOn, name: dict.footer.googlePlay },
              ].map((b) => (
                <span
                  key={b.name}
                  className="relative flex items-center gap-2.5 rounded-xl border border-border bg-surface-muted/60 px-3.5 py-2"
                >
                  <Smartphone className="h-5 w-5 text-muted-foreground" />
                  <span className="leading-tight">
                    {/* 12px is the floor for Arabic: below it the harakat and
                        the dots that separate ب ت ث stop resolving on a phone. */}
                    <span className="block text-xs text-muted-foreground">
                      {b.top}
                    </span>
                    <span className="block text-[13px] font-extrabold">
                      {b.name}
                    </span>
                  </span>
                  {appBadge && (
                    <span className="absolute -end-1.5 -top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-extrabold text-primary-foreground">
                      {appBadge}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            © 2026 {dict.common.brand}. {dict.footer.rights}
          </p>
          <LanguageSwitcher currentLocale={lang} />
        </div>
      </Container>
    </footer>
  );
}
