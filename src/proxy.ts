import { NextResponse, type NextRequest } from "next/server";
import { locales, defaultLocale } from "@/i18n/config";
import { updateSession } from "@/lib/supabase/proxy-session";

// Next.js 16 renamed `middleware` to `proxy` (nodejs runtime only).
// Ensures every request carries a locale prefix (/ar, /en) and keeps the
// Supabase session fresh. Lebanon-first: default to Arabic, switch via toggle.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const pathnameHasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (!pathnameHasLocale) {
    request.nextUrl.pathname = `/${defaultLocale}${pathname}`;
    return NextResponse.redirect(request.nextUrl);
  }

  return updateSession(request);
}

export const config = {
  // Run on everything except Next internals, API routes, short-link
  // redirects (/s/...), `.well-known` verification files, and static files.
  //
  // `.well-known` is listed explicitly even though `.*\..*` already excludes it
  // (the directory name itself contains a dot). Android's App Links verifier
  // fetches `/.well-known/assetlinks.json` and treats *any* redirect as a
  // failure — so if this locale redirect ever caught the path it would send a
  // 307 to `/ar/.well-known/assetlinks.json` and silently break deep links for
  // every installed app. Naming it here means a future edit to the dot rule
  // cannot re-break it by accident.
  //
  // `feeds/` is named for the same reason: /feeds/<slug>/google.xml is fetched
  // by Google Merchant Center and Meta's catalog fetcher, both of which treat a
  // redirect to /ar/feeds/... as a failed fetch. The `.xml` already exempts it
  // through the dot rule; naming it keeps that true if the rule ever changes.
  matcher: ["/((?!_next|api|s/|feeds/|\\.well-known|.*\\..*).*)"],
};
