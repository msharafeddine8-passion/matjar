import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, LayoutDashboard } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";
import { DashboardMobileMenu } from "@/components/dashboard-mobile-menu";
import { HeaderBells } from "@/components/header-bells";
import { dictSlice } from "@/lib/dict-slice";

// Dedicated control-panel chrome for merchants and admins — distinct from the
// customer marketplace. Logged-in only.
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = (profile as { role?: string } | null)?.role === "super_admin";
  const isActive =
    (profile as { is_active?: boolean } | null)?.is_active !== false;

  if (!isActive) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-muted/30 p-6 text-center">
        <h1 className="text-2xl font-extrabold">{dict.admin.suspendedTitle}</h1>
        <p className="max-w-sm text-muted-foreground">
          {dict.admin.suspendedBody}
        </p>
        <LogoutButton label={dict.auth.logout} />
      </div>
    );
  }
  const name =
    ((profile as { full_name?: string } | null)?.full_name as string) ??
    user.email ??
    "";

  // Unread badges — a merchant working the dashboard must still see new
  // notifications (orders, bookings) and customer messages instantly.
  const [{ count: unread }, { data: msgCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false)
      .neq("type", "message"),
    supabase.rpc("unread_conversation_count"),
  ]);

  // Admins: how many stores are waiting for review, surfaced as a badge so a
  // pending store is never missed.
  let pendingStores = 0;
  if (isAdmin) {
    const { count } = await supabase
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null);
    pendingStores = count ?? 0;
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-surface-muted/30">
      {/* First focusable element: skip the dashboard chrome (WCAG 2.4.1).
          Logical `start-*` keeps it on the correct side in RTL and LTR. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-primary-foreground focus:shadow-lg"
      >
        {dict.common.skipToContent}
      </a>
      {/* `viewportFit: cover` is set globally, so on a notched phone the layout
          extends under the status bar. The customer header handles that with
          `pt-[env(safe-area-inset-top)]` (site-header.tsx); the dashboard header
          did not, and the merchant's logo/nav row sat behind the clock. The
          padding sits ABOVE the h-16 row, so the header's total height is
          `--m-header-h + env(safe-area-inset-top)` — which is exactly what the
          merchant sidebar sticks to. Off a notch the inset is 0 and nothing
          moves. (MP-032) */}
      <header className="sticky top-0 z-50 border-b border-border bg-background pt-[env(safe-area-inset-top)] print:hidden">
        <Container className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link href={`/${lang}/merchant`} className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <LayoutDashboard className="h-5 w-5" />
              </span>
              {/* Brand text is redundant next to the logo on a phone — hide it
                  so the header never outgrows a narrow viewport. */}
              <span className="hidden text-lg font-extrabold tracking-tight sm:inline">
                {dict.dashboard.panel}
              </span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              <Link
                href={`/${lang}/merchant`}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                {dict.dashboard.stores}
              </Link>
              {isAdmin && (
                <Link
                  href={`/${lang}/admin`}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  {dict.dashboard.admin}
                  {pendingStores > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-strong px-1.5 text-[11px] font-bold text-danger-strong-foreground">
                      {pendingStores > 9 ? "9+" : pendingStores}
                    </span>
                  )}
                </Link>
              )}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <HeaderBells
              lang={lang}
              dict={dictSlice(dict, ["common"])}
              userId={user.id}
              unreadNotifications={unread ?? 0}
              unreadMessages={(msgCount as number | null) ?? 0}
            />
            {/* Full controls on tablet/desktop; on a phone these live inside the
                menu below so the bar can't overflow. */}
            <div className="hidden items-center gap-2 md:flex lg:gap-3">
              <Link
                href={`/${lang}`}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-muted"
              >
                <ExternalLink className="h-4 w-4" />
                {dict.dashboard.visitSite}
              </Link>
              <ThemeToggle />
              <LanguageSwitcher currentLocale={lang} />
              <span className="text-sm font-semibold">{name}</span>
              <LogoutButton label={dict.auth.logout} />
            </div>
            <DashboardMobileMenu
              lang={lang}
              dict={dictSlice(dict, ["auth", "dashboard"])}
              isAdmin={isAdmin}
              name={name}
            />
          </div>
        </Container>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
