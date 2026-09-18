import type { Metadata, Viewport } from "next";
import { Tajawal, Alexandria } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { notFound } from "next/navigation";
import "../globals.css";
import { isLocale, locales, localeDirection } from "@/i18n/config";
import { SITE_URL } from "@/lib/site";
import { NativeBridge } from "@/components/native-bridge";
import {
  APP_MODE_BOOT_SCRIPT,
  APP_MODE_CRITICAL_CSS,
} from "@/lib/app-mode";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { SwRegister } from "@/components/sw-register";

// Tajawal — a modern, premium typeface that covers Arabic and Latin.
const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-tajawal",
});

// Alexandria — the display face. Geometric and confident in both Arabic and
// Latin; used for headings only (body stays Tajawal) to give the brand a
// recognizable typographic voice.
const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-alexandria",
});

const SITE_DESCRIPTION =
  "منصّة التجارة المحلية في لبنان — كل متجر، منتج، وخدمة بمكان واحد. Local commerce platform for Lebanon.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "متجر | Matjar",
    template: "%s · متجر",
  },
  description: SITE_DESCRIPTION,
  applicationName: "متجر · Matjar",
  openGraph: {
    type: "website",
    siteName: "متجر · Matjar",
    title: "متجر | Matjar",
    description: SITE_DESCRIPTION,
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "متجر | Matjar",
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image.png"],
  },
  manifest: "/manifest.webmanifest",
  // iOS reads none of the manifest for an installed home-screen app — it wants
  // its own meta tags, and without them the notch strip fell back to the
  // browser default instead of the brand. (MP-036)
  //
  // `statusBarStyle: "default"`, not "black-translucent": translucent draws the
  // status-bar glyphs in white over the page, and this app's light surface is
  // #fbfbf9 — the same colour the light `themeColor` below declares — so white
  // on it is unreadable. "default" gives an opaque bar iOS tints from the page,
  // which stays consistent with that themeColor and stays legible either side.
  //
  // `title` is the home-screen label. Arabic short name, matching `short_name`
  // in manifest.ts — the Latin half of "متجر · Matjar" gets truncated away
  // under an icon anyway.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "متجر",
  },
  verification: {
    google: "fRJTZiuJNv-lbiuGfanG8FAZFTV85klXdnQLiw1bXmM",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
  viewportFit: "cover",
};

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <html
      lang={lang}
      dir={localeDirection[lang]}
      className={`${tajawal.variable} ${alexandria.variable} h-full`}
    >
      <head>
        {/* Apply the saved light/dark choice before paint (no theme flash). With
            no saved choice the CSS follows the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('matjar-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
        {/* Same trick, same reason, for the native shell: mark <html> before the
            body is parsed, so the app never paints the website chrome and then
            takes it away. The <style> beside it carries the rules that removal
            depends on — inline, in this response, because they must not be
            droppable by the asset pipeline. See src/lib/app-mode.ts. */}
        <script dangerouslySetInnerHTML={{ __html: APP_MODE_BOOT_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: APP_MODE_CRITICAL_CSS }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
        {/* Google Tag Manager was here, and it has never once run.
            `script-src` in next.config.mjs allows 'self' and va.vercel-scripts.com;
            googletagmanager.com is not on it, so the browser refused the request
            on every page view since the tag was added — silently, because a CSP
            refusal is not a JavaScript error. Confirmed against the live
            response headers, not inferred.
            Removed rather than left in place: a tag that looks like analytics and
            collects nothing is worse than no tag, because it invites decisions to
            be made on numbers that were never recorded. Vercel Analytics is
            already loaded below and does work.
            To bring GA back, the honest path is to add https://www.googletagmanager.com
            to script-src in next.config.mjs and re-add this block — accepting that
            GTM exists to inject arbitrary third-party script, which is exactly
            what that CSP line is holding shut. First-party events
            (store_visits, search_logs) answer the merchant-funnel questions
            without that trade. */}
        <ConfirmProvider>{children}</ConfirmProvider>
        <SwRegister />
        <NativeBridge />
        <Analytics />
      </body>
    </html>
  );
}
