import { NextResponse } from "next/server";
import { isLocale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Where an email link becomes a session.
//
// Password reset was landing people straight on /reset-password, which rendered
// the form and called updateUser — with no session, because nothing had turned
// the link into one. supabase-js refuses that client-side without even calling
// the API, so the person saw a generic error, then "wrong password" at login,
// and their password had never changed. The auth logs show it exactly: /recover
// then /verify then five failed /token, and no /user request anywhere between.
//
// Two link shapes arrive here and both have to work.
//
// `token_hash` + `type` is the one to prefer, and the one the email template
// should send. It carries everything needed, so it works in whatever browser the
// person happens to open their mail in.
//
// `code` is PKCE, which Supabase's default template produces. It only works in
// the browser that ASKED for the reset, because the matching verifier was stored
// there. Someone who requests a reset in Chrome and taps the link inside the
// Gmail app is in a different browser and will fail — which is why the template
// change matters and this branch is a fallback, not the plan.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "ar";
  const url = new URL(request.url);

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // Only same-origin paths, so a crafted link cannot bounce a freshly
  // authenticated visitor off to somebody else's site. A prefix check here was
  // bypassable (`next=/%09/evil.com`); see lib/safe-redirect.ts.
  const dest = safeRedirectPath(next, url.origin, `/${locale}`);

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "recovery" | "email" | "signup" | "invite" | "email_change",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(dest, request.url));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, request.url));
  }

  // Say which door failed. "Something went wrong" on a login screen is how
  // somebody ends up typing a password they already changed.
  return NextResponse.redirect(
    new URL(`/${locale}/forgot-password?error=link`, request.url),
  );
}
