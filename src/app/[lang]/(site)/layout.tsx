import { dictSlice } from "@/lib/dict-slice";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getUsdLbpRate } from "@/lib/data/settings";
import { getNavSections } from "@/lib/data/section-supply";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import {
  SuspendedGate,
  ViewerBottomNav,
  ViewerProvider,
} from "@/components/viewer";
import { LogoutButton } from "@/components/logout-button";

// Shared chrome (header + footer) for all public marketing/browse pages.
//
// COOKIE-FREE ON PURPOSE. This layout wraps ~70 routes; when it called
// cookies() (via the Supabase server client) every one of them — /about and
// /pricing included — became dynamic, `private, no-store`, and ran ~15
// Supabase reads per click to draw header badges. It now reads only cached,
// public data (exchange rate, nav sections), so a page that does not itself
// read cookies or searchParams can be statically rendered / ISR. Who is
// looking is answered client-side by the viewer island from /api/me.
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Which verticals are worth linking to at all (MP-026). Same cached, public,
  // cross-request read as the exchange rate beside it — the header, the phone
  // menu and the footer all ask the same question and must not answer it
  // differently on one page.
  const [lbpRate, sections] = await Promise.all([
    getUsdLbpRate(),
    getNavSections(),
  ]);

  return (
    <ViewerProvider>
      <SuspendedGate
        screen={
          <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-2xl font-extrabold">
              {dict.admin.suspendedTitle}
            </h1>
            <p className="max-w-sm text-muted-foreground">
              {dict.admin.suspendedBody}
            </p>
            <LogoutButton label={dict.auth.logout} />
          </div>
        }
      >
        {/* First focusable element on every route: lets a keyboard user jump the
            whole header instead of tabbing it on all 137 pages (WCAG 2.4.1).
            Hidden until focused; positioned with logical `start-*` so it appears
            on the correct side in RTL and LTR alike. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-primary-foreground focus:shadow-lg"
        >
          {dict.common.skipToContent}
        </a>
        <SiteHeader
          lang={lang}
          dict={dict}
          lbpRate={lbpRate}
          sections={sections}
        />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter lang={lang} dict={dict} sections={sections} />
        {/* Spacer so page content can scroll clear of the fixed mobile tab bar. */}
        <div
          aria-hidden
          className="h-[calc(var(--m-tabbar-h)+env(safe-area-inset-bottom))] lg:hidden"
        />
        <ViewerBottomNav lang={lang} dict={dictSlice(dict, ["tabbar"])} />
      </SuspendedGate>
    </ViewerProvider>
  );
}
