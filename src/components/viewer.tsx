"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { NavSections } from "@/lib/data/section-supply";
import { createClient } from "@/lib/supabase/client";
import {
  ANONYMOUS,
  dashboardHrefFor,
  followStateFrom,
  hasAuthCookie,
  parseMe,
  withFollow,
  type FollowState,
  type MeResponse,
} from "@/lib/viewer";
import { HeaderBells } from "@/components/header-bells";
import { LogoutButton } from "@/components/logout-button";
import { MobileMenu, type MobileMenuLabels } from "@/components/mobile-menu";
import { BottomNav } from "@/components/bottom-nav";
import { FollowsContext, type FollowsApi } from "@/components/follows-context";

// ===== The viewer island =====
//
// The (site) layout renders anonymous chrome so its pages can be static. This
// is the one client island that turns it into the signed-in chrome: it asks
// /api/me once after hydration — and only when a Supabase session cookie is
// present, so an anonymous visitor costs nothing — and every user-dependent
// slot (bells, account link, dashboard link, merchant CTA, phone menu, tab bar
// badge, suspended screen) reads the answer from context.
//
// States:
//   pending — server render and first client render (identical, so hydration
//             matches). Slots render BOTH variants, tagged data-anon-only /
//             data-auth-only; an inline pre-paint script (AUTH_HINT_SCRIPT)
//             marks <html data-auth> when a session cookie exists and inline
//             CSS shows the right one. A signed-in visitor sees a neutral
//             placeholder, never a misleading "log in".
//   anon    — no cookie, or /api/me said so, or anything failed.
//   user    — /api/me answered for a signed-in viewer.

type ViewerState =
  | { status: "pending" }
  | { status: "anon" }
  | { status: "user"; me: Extract<MeResponse, { signedIn: true }> };

const ViewerContext = createContext<ViewerState>({ status: "pending" });

export function useViewer(): ViewerState {
  return useContext(ViewerContext);
}

/** Re-ask at most this often on navigation / tab focus. The bells keep their
 *  own 20s poll and realtime channel; this only freshens the tab-bar badge. */
const REFRESH_MS = 30_000;

function markHtml(signedIn: boolean) {
  try {
    const d = document.documentElement;
    if (signedIn) d.setAttribute("data-auth", "1");
    else d.removeAttribute("data-auth");
  } catch {
    // never let chrome bookkeeping break a page
  }
}

/** One /api/me round trip; never throws, anything odd is anonymous. With no
 *  session cookie there is nobody to look up and no request is made. */
async function fetchMe(): Promise<MeResponse> {
  if (!hasAuthCookie(document.cookie)) return ANONYMOUS;
  // The head script already did this on a hard load; a client-side entry
  // into this layout (e.g. back from /login) did not run it.
  markHtml(true);
  try {
    const res = await fetch("/api/me", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return res.ok ? parseMe(await res.json()) : ANONYMOUS;
  } catch {
    return ANONYMOUS;
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState>({ status: "pending" });
  const [follows, setFollows] = useState<FollowState | null>(null);
  const lastFetch = useRef(0);
  const inFlight = useRef(false);
  const pathname = usePathname();

  const apply = useCallback((me: MeResponse) => {
    markHtml(me.signedIn);
    setState(me.signedIn ? { status: "user", me } : { status: "anon" });
    // Keep this tab's own toggles across refreshes (followStateFrom carries
    // them over); drop everything on sign-out.
    setFollows((prev) =>
      me.signedIn ? followStateFrom(me.followedStoreIds, prev) : null,
    );
  }, []);

  const setFollow = useCallback((storeId: string, on: boolean) => {
    // Before /api/me answers there is no list yet; record the toggle anyway
    // so the answer, possibly read before the write, cannot undo it.
    setFollows((prev) => withFollow(prev ?? followStateFrom([]), storeId, on));
  }, []);
  const followsApi = useMemo<FollowsApi>(
    () => ({ state: follows, set: setFollow }),
    [follows, setFollow],
  );

  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastFetch.current = Date.now();
    void fetchMe()
      .then(apply)
      .finally(() => {
        inFlight.current = false;
      });
  }, [apply]);

  // First answer, right after hydration.
  useEffect(() => {
    load();
  }, [load]);

  // Freshen on client navigation and when the tab comes back — throttled, and
  // only for a viewer who might be signed in.
  const signedInish = state.status === "user";
  useEffect(() => {
    if (!signedInish) return;
    if (Date.now() - lastFetch.current > REFRESH_MS) load();
  }, [pathname, signedInish, load]);
  useEffect(() => {
    if (!signedInish) return;
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastFetch.current > REFRESH_MS
      )
        load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [signedInish, load]);

  // Sign-out from the header (LogoutButton) happens inside this layout, so the
  // island must hear it; router.refresh() alone would leave the name showing.
  useEffect(() => {
    if (state.status !== "user") return;
    let sub: { unsubscribe: () => void } | null = null;
    try {
      const { data } = createClient().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") apply(ANONYMOUS);
        else if (event === "USER_UPDATED") load();
      });
      sub = data.subscription;
    } catch {
      // no realtime auth events: the next navigation still re-asks
    }
    return () => sub?.unsubscribe();
  }, [state.status, apply, load]);

  return (
    <ViewerContext.Provider value={state}>
      <FollowsContext.Provider value={followsApi}>
        {children}
      </FollowsContext.Provider>
    </ViewerContext.Provider>
  );
}

/** Replaces the whole page with the suspended-account screen once /api/me
 *  says so. RLS (user_is_active) is what actually blocks a suspended account;
 *  this is the explanation. */
export function SuspendedGate({
  screen,
  children,
}: {
  screen: ReactNode;
  children: ReactNode;
}) {
  const v = useViewer();
  if (v.status === "user" && v.me.suspended) return <>{screen}</>;
  return <>{children}</>;
}

/** Rendered only for visitors who are not signed in (e.g. the open-store CTA). */
export function GuestOnly({ children }: { children: ReactNode }) {
  const v = useViewer();
  if (v.status === "user") return null;
  if (v.status === "anon") return <>{children}</>;
  return (
    <span data-anon-only="" className="contents">
      {children}
    </span>
  );
}

const SKELETON =
  "inline-block animate-pulse rounded-lg bg-surface-muted motion-reduce:animate-none";

/** Messages + notifications bells, live, for a signed-in viewer. */
export function ViewerBells({
  lang,
  dict,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "common">;
}) {
  const v = useViewer();
  if (v.status === "user") {
    return (
      <HeaderBells
        key={v.me.id}
        lang={lang}
        dict={dict}
        userId={v.me.id}
        unreadNotifications={v.me.unreadNotifications}
        unreadMessages={v.me.unreadMessages}
      />
    );
  }
  if (v.status === "anon") return null;
  // Reserve the two 36px slots so the row does not jump when they arrive.
  return (
    <span data-auth-only="" aria-hidden className="flex items-center gap-1 sm:gap-3">
      <span className={`${SKELETON} h-9 w-9`} />
      <span className={`${SKELETON} h-9 w-9`} />
    </span>
  );
}

/** Desktop account cluster: dashboard + name + logout, or the login link. */
export function ViewerAccount({
  lang,
  labels,
}: {
  lang: Locale;
  labels: { dashboard: string; login: string; logout: string };
}) {
  const v = useViewer();
  const login = (
    <Link
      href={`/${lang}/login`}
      className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
    >
      {labels.login}
    </Link>
  );
  if (v.status === "anon") return login;
  if (v.status === "pending") {
    return (
      <>
        <span data-anon-only="" className="contents">
          {login}
        </span>
        <span
          data-auth-only=""
          aria-hidden
          className={`${SKELETON} h-9 w-28`}
        />
      </>
    );
  }
  const dashboardHref = dashboardHrefFor(v.me.role, lang);
  return (
    <>
      {dashboardHref && (
        <Link
          href={dashboardHref}
          className="rounded-lg px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-surface-muted"
        >
          {labels.dashboard}
        </Link>
      )}
      <Link
        href={`/${lang}/account`}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
      >
        <User className="h-4 w-4 text-primary" />
        {v.me.name}
      </Link>
      <LogoutButton label={labels.logout} />
    </>
  );
}

/** The ☰ menu with the viewer's account entries filled in. */
export function ViewerMobileMenu(props: {
  lang: Locale;
  labels: MobileMenuLabels;
  sections: NavSections;
  lbpRate?: number;
}) {
  const v = useViewer();
  const user = v.status === "user" ? { name: v.me.name } : null;
  const dashboardHref =
    v.status === "user" ? dashboardHrefFor(v.me.role, props.lang) : null;
  return <MobileMenu {...props} user={user} dashboardHref={dashboardHref} />;
}

/** The phone tab bar with the طلباتي badge filled in. */
export function ViewerBottomNav({
  lang,
  dict,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "tabbar">;
}) {
  const v = useViewer();
  return (
    <BottomNav
      lang={lang}
      dict={dict}
      signedIn={v.status === "user"}
      activityCount={v.status === "user" ? v.me.activityCount : 0}
    />
  );
}
