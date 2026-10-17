import { NextResponse } from "next/server";
import { isLocale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

// OAuth (Google) callback: exchange the PKCE code for a session, then land the
// user in the app. The Supabase server client writes the session cookies onto
// the response during exchange.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "ar";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // Same-origin paths only — `startsWith("/")` let `//evil.com` and
  // `/%09/evil.com` through to another site (lib/safe-redirect.ts).
  const dest = safeRedirectPath(next, url.origin, `/${locale}`);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(dest, request.url));
    }
  }
  return NextResponse.redirect(new URL(`/${locale}/login?error=oauth`, request.url));
}
