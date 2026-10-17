"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, MailCheck, ShoppingBag, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Card } from "@/components/ui/card";
import { Field, Input, fieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { loginReason, type LoginReason } from "@/lib/login-reason";

/** Brand mark + title + subtitle centered atop each auth card. */
function AuthHeader({
  title,
  subtitle,
  brand,
}: {
  title: string;
  subtitle: string;
  brand: string;
}) {
  return (
    <div className="mb-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
        <Store className="h-6 w-6" />
      </span>
      <span className="sr-only">{brand}</span>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** Password input with a show/hide toggle. Kept as custom markup (the shared
 *  <Input> has no trailing-affordance slot); still built on `fieldClass`. */
function PasswordField({
  label,
  autoComplete,
  minLength,
  showLabel,
  hideLabel,
  hint,
}: {
  label: string;
  autoComplete: string;
  minLength?: number;
  showLabel: string;
  hideLabel: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor="password" hint={hint}>
      <div className="relative">
        <input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder="••••••••"
          className={`${fieldClass} pe-11`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? hideLabel : showLabel}
          // The input already reserves a 44px end gutter (pe-11); the button
          // now fills it exactly. It used to be pe-3.5 with no width of its
          // own, so it measured 34 wide against a full 44 of height — tall
          // enough to look correct and too narrow to hit with a thumb.
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </Field>
  );
}

/** Full-page confirmation card (email sent / password updated). */
function StatusCard({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card variant="elevated" className="p-8 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <MailCheck className="h-7 w-7" />
      </span>
      <h1 className="mt-4 text-xl font-extrabold">{title}</h1>
      {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
      {children}
    </Card>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

// "Continue with Google" via Supabase OAuth. Requires the Google provider to be
// enabled in the Supabase dashboard (with Google Cloud OAuth credentials) and
// the /{lang}/callback URL added to the allowed redirect URLs.
//
// Hidden unless NEXT_PUBLIC_GOOGLE_AUTH_ENABLED is "true", because none of that
// setup is visible from here and the failure is brutal: signInWithOAuth does not
// reject when the provider is off — it navigates the browser to Supabase, which
// answers with raw JSON on its own domain:
//
//   {"code":400,"error_code":"validation_failed",
//    "msg":"Unsupported provider: provider is not enabled"}
//
// A customer who taps it lands on a white page of JSON at a supabase.co address,
// with no way back and nothing suggesting the site still works. Better to offer
// only what is actually wired up. Flip the flag once Google is enabled.
const GOOGLE_ENABLED =
  process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

function GoogleButton({ lang, dict }: { lang: Locale; dict: Pick<Dictionary, "auth" | "common"> }) {
  if (!GOOGLE_ENABLED) return null;
  return <GoogleButtonInner lang={lang} dict={dict} />;
}

function GoogleButtonInner({ lang, dict }: { lang: Locale; dict: Pick<Dictionary, "auth" | "common"> }) {
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${lang}/callback` },
    });
    // On success the browser navigates to Google, so we only reset on error.
    if (error) setLoading(false);
  }
  return (
    <>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold text-muted-foreground">
          {dict.auth.orDivider}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold transition-colors hover:bg-surface-muted disabled:opacity-60"
      >
        <GoogleIcon />
        {dict.auth.continueWithGoogle}
      </button>
    </>
  );
}

/**
 * Where to go after signing in, when the visitor was already on their way
 * somewhere. Relative paths only: anything starting with a scheme or `//` is a
 * link to another site, and honouring it would turn the login page into an open
 * redirect anyone could point wherever they liked.
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function LoginForm({ lang, dict }: { lang: Locale; dict: Pick<Dictionary, "auth" | "common"> }) {
  const router = useRouter();
  // Why they are here («راسل البائع», favourites, …) — one honest line above
  // the form instead of only a generic welcome. Read after mount from the
  // live URL (not useSearchParams) so the form itself stays in the static
  // HTML instead of bailing out to client rendering.
  const [reason, setReason] = useState<LoginReason | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason(loginReason(q.get("reason"), q.get("next")));
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError(dict.auth.errorInvalid);
      setLoading(false);
      return;
    }
    // Route each role to its home surface.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // An explicit destination wins over the role default. Someone who clicked
    // "list your trade" and was asked to sign in first means to end up back
    // there — sending them to a dashboard instead loses the intent that brought
    // them, and they rarely find their way back to it.
    // Read at submit time from the live URL rather than through
    // useSearchParams: that hook opts the page out of static rendering unless
    // it sits behind a Suspense boundary, and this value is only ever needed
    // inside an event handler.
    const next = safeNext(
      new URLSearchParams(window.location.search).get("next"),
    );
    let dest = next ?? `/${lang}`;
    if (!next && user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role === "super_admin") dest = `/${lang}/admin`;
      else if (profile?.role === "merchant") dest = `/${lang}/merchant`;
    }
    router.push(dest);
    router.refresh();
  }

  return (
    <Card variant="elevated" className="p-6 sm:p-8">
      <AuthHeader
        title={dict.auth.loginTitle}
        subtitle={dict.auth.loginSubtitle}
        brand={dict.common.brand}
      />
      {reason && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm font-semibold text-info"
        >
          {dict.auth.loginReasons[reason]}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={dict.auth.email} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            placeholder="name@email.com"
          />
        </Field>
        <PasswordField
          label={dict.auth.password}
          autoComplete="current-password"
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />
        <div className="text-end">
          <Link
            href={`/${lang}/forgot-password`}
            // Standalone link on its own row, so it earns a real 44px target.
            // The "create one" link further down sits inside a sentence and
            // keeps its text height — growing it would break the line it is
            // part of, and inline links in prose are exempt for that reason.
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            {dict.auth.forgotLink}
          </Link>
        </div>
        {error && (
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" full loading={loading}>
          {dict.auth.loginButton}
        </Button>
      </form>
      <GoogleButton lang={lang} dict={dict} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {dict.auth.noAccount}{" "}
        <Link
          href={`/${lang}/signup`}
          className="font-bold text-primary hover:underline"
        >
          {dict.auth.createOne}
        </Link>
      </p>
    </Card>
  );
}

export function SignupForm({ lang, dict }: { lang: Locale; dict: Pick<Dictionary, "auth" | "common"> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [accountType, setAccountType] = useState<"customer" | "merchant">(
    "customer",
  );

  // Remember an inbound referral code so it survives email confirmation; it's
  // redeemed once the referred user is authenticated (see LoyaltyPanel).
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      try {
        localStorage.setItem("matjar-ref", ref);
      } catch {
        /* ignore */
      }
    }
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: String(form.get("email")),
      password: String(form.get("password")),
      options: {
        data: {
          full_name: String(form.get("full_name")),
          account_type: accountType,
        },
        emailRedirectTo: `${window.location.origin}/${lang}`,
      },
    });
    if (error) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    if (!data.session) {
      // Email confirmation is enabled — ask the user to confirm.
      setSent(true);
      setLoading(false);
      return;
    }
    // Logged in immediately — attribute the referral now if one was shared.
    const ref = searchParams.get("ref");
    if (ref) {
      await supabase.rpc("record_referral", { p_code: ref });
      try {
        localStorage.removeItem("matjar-ref");
      } catch {
        /* ignore */
      }
    }
    router.push(accountType === "merchant" ? `/${lang}/merchant` : `/${lang}`);
    router.refresh();
  }

  if (sent) {
    return (
      <StatusCard
        title={dict.auth.checkEmailTitle}
        message={dict.auth.checkEmail}
      />
    );
  }

  const typeBtn = (active: boolean) =>
    `flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
      active
        ? "border-primary bg-primary-soft text-primary"
        : "border-border text-muted-foreground hover:border-primary/40"
    }`;

  return (
    <Card variant="elevated" className="p-6 sm:p-8">
      <AuthHeader
        title={dict.auth.signupTitle}
        subtitle={dict.auth.signupSubtitle}
        brand={dict.common.brand}
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={dict.auth.accountType} group>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAccountType("customer")}
              className={typeBtn(accountType === "customer")}
            >
              <ShoppingBag className="h-4 w-4" />
              {dict.auth.asCustomer}
            </button>
            <button
              type="button"
              onClick={() => setAccountType("merchant")}
              className={typeBtn(accountType === "merchant")}
            >
              <Store className="h-4 w-4" />
              {dict.auth.asMerchant}
            </button>
          </div>
        </Field>
        <Field label={dict.auth.fullName} htmlFor="full_name">
          <Input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            placeholder={dict.auth.fullNamePlaceholder}
          />
        </Field>
        <Field label={dict.auth.email} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            placeholder="name@email.com"
          />
        </Field>
        <PasswordField
          label={dict.auth.password}
          autoComplete="new-password"
          minLength={8}
          hint={dict.auth.passwordHint}
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />
        {error && (
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" full loading={loading}>
          {dict.auth.signupButton}
        </Button>
      </form>
      <GoogleButton lang={lang} dict={dict} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {dict.auth.haveAccount}{" "}
        <Link
          href={`/${lang}/login`}
          className="font-bold text-primary hover:underline"
        >
          {dict.auth.loginLink}
        </Link>
      </p>
    </Card>
  );
}

export function ForgotPasswordForm({
  lang,
  dict,
  linkError = false,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "common">;
  /** Sent back here by /auth/confirm because the link was spent or opened in a
   *  different browser than the one that requested it. */
  linkError?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? dict.auth.resetLinkDead : null,
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email"));
    // Through /auth/confirm, never straight at the form. The link has to become
    // a session before anyone is asked to type a new password; landing on the
    // form directly is what left people changing nothing and then being told at
    // login that their password was wrong.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/${lang}/auth/confirm?next=/${lang}/reset-password`,
    });
    if (error) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <StatusCard
        title={dict.auth.checkEmailTitle}
        message={dict.auth.resetSent}
      />
    );
  }

  return (
    <Card variant="elevated" className="p-6 sm:p-8">
      <AuthHeader
        title={dict.auth.forgotTitle}
        subtitle={dict.auth.forgotSubtitle}
        brand={dict.common.brand}
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={dict.auth.email} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            placeholder="name@email.com"
          />
        </Field>
        {error && (
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" full loading={loading}>
          {dict.auth.sendReset}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link
          href={`/${lang}/login`}
          className="font-bold text-primary hover:underline"
        >
          {dict.auth.backToLogin}
        </Link>
      </p>
    </Card>
  );
}

export function ResetPasswordForm({
  lang,
  dict,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "common">;
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <Card variant="elevated" className="p-8 text-center">
        <h1 className="text-xl font-extrabold text-primary">
          {dict.auth.resetDone}
        </h1>
        <p className="mt-4">
          <Link
            href={`/${lang}/login`}
            className="font-bold text-primary hover:underline"
          >
            {dict.auth.backToLogin}
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card variant="elevated" className="p-6 sm:p-8">
      <AuthHeader
        title={dict.auth.resetTitle}
        subtitle={dict.auth.resetSubtitle}
        brand={dict.common.brand}
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <PasswordField
          label={dict.auth.newPassword}
          autoComplete="new-password"
          minLength={8}
          hint={dict.auth.passwordHint}
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />
        {error && (
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" full loading={loading}>
          {dict.auth.updatePassword}
        </Button>
      </form>
    </Card>
  );
}
