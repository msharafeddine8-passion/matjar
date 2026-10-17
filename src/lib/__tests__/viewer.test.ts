import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANONYMOUS,
  AUTH_HINT_SCRIPT,
  dashboardHrefFor,
  displayNameOf,
  FOLLOWED_STORE_IDS_CAP,
  followStateFrom,
  hasAuthCookie,
  parseMe,
  resolveFavorited,
  withFollow,
} from "@/lib/viewer";
import { countActionable } from "@/lib/viewer-badge";
import { loadMe } from "@/lib/data/viewer";

// 2026-10-17 12:00 Beirut (UTC+3) — "today" is 2026-10-17.
const NOW = Date.UTC(2026, 9, 17, 9, 0, 0);
const DAY = 86_400_000;

describe("hasAuthCookie", () => {
  it("spots the @supabase/ssr session cookie, chunked or not", () => {
    expect(hasAuthCookie("sb-wesihatopiznatsyfxer-auth-token=base64-abc")).toBe(true);
    expect(hasAuthCookie("a=1; sb-ref-auth-token.0=x; sb-ref-auth-token.1=y")).toBe(true);
  });
  it("ignores other cookies, empty input and look-alikes", () => {
    expect(hasAuthCookie("")).toBe(false);
    expect(hasAuthCookie(null)).toBe(false);
    expect(hasAuthCookie("matjar-theme=dark; _va=1")).toBe(false);
    expect(hasAuthCookie("sb-ref-auth-token-code-verifier=z")).toBe(false);
    expect(hasAuthCookie("xsb-ref-auth-token=1")).toBe(false);
  });
  it("the inline head script uses the same rule", () => {
    // Evaluate the script against a fake document.
    const run = (cookie: string) => {
      const attrs: Record<string, string> = {};
      const document = {
        cookie,
        documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
      };
      new Function("document", AUTH_HINT_SCRIPT)(document);
      return attrs["data-auth"] === "1";
    };
    for (const c of [
      "sb-ref-auth-token=1",
      "a=1; sb-ref-auth-token.0=x",
      "matjar-theme=dark",
      "sb-ref-auth-token-code-verifier=z",
      "",
    ]) {
      expect(run(c)).toBe(hasAuthCookie(c));
    }
  });
});

describe("dashboardHrefFor / displayNameOf", () => {
  it("maps roles to the panel they own", () => {
    expect(dashboardHrefFor("super_admin", "ar")).toBe("/ar/admin");
    expect(dashboardHrefFor("merchant", "en")).toBe("/en/merchant");
    expect(dashboardHrefFor("customer", "ar")).toBeNull();
    expect(dashboardHrefFor(null, "ar")).toBeNull();
  });
  it("prefers the full name, then the email", () => {
    expect(displayNameOf({ email: "a@b.c", user_metadata: { full_name: "سارة" } })).toBe("سارة");
    expect(displayNameOf({ email: "a@b.c", user_metadata: { full_name: "  " } })).toBe("a@b.c");
    expect(displayNameOf({ email: null, user_metadata: null })).toBe("");
  });
});

describe("parseMe", () => {
  it("anything malformed is anonymous", () => {
    expect(parseMe(null)).toEqual(ANONYMOUS);
    expect(parseMe("x")).toEqual(ANONYMOUS);
    expect(parseMe({ signedIn: true })).toEqual(ANONYMOUS);
    expect(parseMe({ signedIn: false, id: "u" })).toEqual(ANONYMOUS);
  });
  it("clamps counts and normalises the role", () => {
    expect(
      parseMe({
        signedIn: true,
        id: "u1",
        name: "N",
        role: "hacker",
        suspended: "yes",
        unreadNotifications: -3,
        unreadMessages: 2.7,
        activityCount: "5",
      }),
    ).toEqual({
      signedIn: true,
      id: "u1",
      name: "N",
      role: null,
      suspended: false,
      unreadNotifications: 0,
      unreadMessages: 2,
      activityCount: 0,
      followedStoreIds: [],
    });
  });
});

describe("countActionable", () => {
  it("counts exactly what needsCustomer counts", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const n = countActionable(
      {
        orders: [
          { status: "completed", store_id: "s1", updated_at: iso(NOW - 2 * DAY) }, // wants review
          { status: "completed", store_id: "s2", updated_at: iso(NOW - 2 * DAY) }, // reviewed
          { status: "completed", store_id: "s3", updated_at: iso(NOW - 40 * DAY) }, // window over
        ],
        bookings: [
          { status: "accepted", requested_date: "2026-10-20" }, // upcoming
          { status: "scheduled", requested_date: "2026-10-01" }, // past
          { status: "accepted", requested_date: null }, // undated counts
        ],
        stays: [
          { status: "confirmed", check_in: "2026-10-10", check_out: "2026-10-18" }, // ongoing
          { status: "confirmed", check_in: "2026-10-01", check_out: "2026-10-05" }, // over
        ],
        rentals: [{ status: "confirmed", pickup_date: "2026-11-01", return_date: null }],
        crafts: [
          { status: "completed", craft_reviews: [] }, // wants rating
          { status: "completed", craft_reviews: { id: "r" } }, // rated
        ],
        quotedServices: 2,
        rejectedListings: 1,
        reviewedStoreIds: ["s2"],
      },
      NOW,
    );
    // 1 order + 2 bookings + 1 stay + 1 rental + 1 craft + 2 + 1
    expect(n).toBe(9);
  });
  it("is zero for nothing", () => {
    expect(countActionable({}, NOW)).toBe(0);
  });
});

// --- loadMe with a fake client ----------------------------------------------

type Result = { data?: unknown; error?: unknown; count?: number | null };

function fakeClient(opts: {
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  tables?: Record<string, Result>;
  rpcs?: Record<string, Result>;
  authError?: boolean;
}) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const rpcCalls: string[] = [];
  const from = (table: string) => {
    const filters: unknown[][] = [];
    calls.push({ table, filters });
    const res = { data: null, error: null, count: null, ...opts.tables?.[table] };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) {
      builder[m] = (...args: unknown[]) => {
        filters.push([m, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(res);
    builder.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve(res).then(ok, bad);
    return builder;
  };
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user },
        error: opts.authError ? new Error("jwt") : null,
      })),
    },
    from,
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({ data: null, error: null, ...opts.rpcs?.[name] });
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

describe("loadMe (/api/me body)", () => {
  it("is anonymous with no user, and reads nothing else", async () => {
    const { client, calls, rpcCalls } = fakeClient({ user: null });
    expect(await loadMe(client, NOW)).toEqual({ signedIn: false });
    expect(calls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("is anonymous when the auth call errors", async () => {
    const { client } = fakeClient({ user: { id: "u" }, authError: true });
    expect(await loadMe(client, NOW)).toEqual({ signedIn: false });
  });

  it("returns exactly the chrome's shape for a signed-in merchant", async () => {
    const { client, calls, rpcCalls } = fakeClient({
      user: { id: "u1", email: "m@x.lb", user_metadata: { full_name: "Mira" } },
      tables: {
        profiles: { data: { role: "merchant", is_active: true } },
        notifications: { count: 4 },
        orders: {
          data: [
            {
              status: "completed",
              store_id: "s1",
              updated_at: new Date(NOW - DAY).toISOString(),
            },
          ],
        },
        bookings: { data: [{ status: "accepted", requested_date: "2026-10-19" }] },
        service_requests: { count: 1 },
        listings: { count: 0 },
        follows: { data: [{ store_id: "s9" }, { store_id: "s1" }, { store_id: null }] },
      },
      rpcs: {
        unread_conversation_count: { data: 3 },
        my_reviewed_store_ids: { data: [] },
      },
    });
    const me = await loadMe(client, NOW);
    expect(me).toEqual({
      signedIn: true,
      id: "u1",
      name: "Mira",
      role: "merchant",
      suspended: false,
      unreadNotifications: 4,
      unreadMessages: 3,
      activityCount: 3, // order review + booking + quote
      followedStoreIds: ["s9", "s1"],
    });
    expect(Object.keys(me).sort()).toEqual(
      [
        "activityCount",
        "followedStoreIds",
        "id",
        "name",
        "role",
        "signedIn",
        "suspended",
        "unreadMessages",
        "unreadNotifications",
      ].sort(),
    );
    expect(rpcCalls).toContain("my_reviewed_store_ids");
    // Every own-rows read is scoped to the caller, never only to RLS.
    for (const c of calls) {
      const scoped = c.filters.some(
        (f) =>
          (f[0] === "eq" &&
            ["id", "user_id", "customer_id", "seller_id"].includes(f[1] as string) &&
            f[2] === "u1"),
      );
      expect(scoped, c.table).toBe(true);
    }
  });

  it("flags a suspended account and skips the review RPC with no orders", async () => {
    const { client, rpcCalls } = fakeClient({
      user: { id: "u2", email: "c@x.lb" },
      tables: { profiles: { data: { role: "customer", is_active: false } } },
    });
    const me = await loadMe(client, NOW);
    expect(me).toMatchObject({
      signedIn: true,
      suspended: true,
      role: "customer",
      name: "c@x.lb",
      activityCount: 0,
    });
    expect(rpcCalls).not.toContain("my_reviewed_store_ids");
  });

  it("a failed read zeroes its own number, never the whole answer", async () => {
    const { client } = fakeClient({
      user: { id: "u3" },
      tables: {
        profiles: { error: { message: "boom" } },
        notifications: { error: { message: "boom" }, count: 9 },
        service_requests: { count: 2 },
      },
      rpcs: { unread_conversation_count: { error: { message: "boom" }, data: 7 } },
    });
    expect(await loadMe(client, NOW)).toEqual({
      signedIn: true,
      id: "u3",
      name: "",
      role: null,
      suspended: false,
      unreadNotifications: 0,
      unreadMessages: 0,
      activityCount: 2,
      followedStoreIds: [],
    });
  });
});

// --- followedStoreIds: the hearts on static pages ---------------------------

describe("loadMe followedStoreIds", () => {
  it("reads the caller's follows, newest first, capped", async () => {
    const { client, calls } = fakeClient({
      user: { id: "u4" },
      tables: { follows: { data: [{ store_id: "a" }, { store_id: "b" }] } },
    });
    const me = await loadMe(client, NOW);
    expect(me).toMatchObject({ signedIn: true, followedStoreIds: ["a", "b"] });
    const f = calls.find((c) => c.table === "follows");
    expect(f?.filters).toContainEqual(["eq", "user_id", "u4"]);
    expect(f?.filters).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(f?.filters).toContainEqual(["limit", FOLLOWED_STORE_IDS_CAP]);
  });

  it("a failed follows read is an empty list, not an anonymous viewer", async () => {
    const { client } = fakeClient({
      user: { id: "u5" },
      tables: { follows: { error: { message: "boom" }, data: [{ store_id: "x" }] } },
    });
    expect(await loadMe(client, NOW)).toMatchObject({
      signedIn: true,
      id: "u5",
      followedStoreIds: [],
    });
  });
});

describe("parseMe followedStoreIds", () => {
  const base = { signedIn: true, id: "u1" };
  it("keeps only non-empty strings and caps the list", () => {
    const many = Array.from({ length: FOLLOWED_STORE_IDS_CAP + 5 }, (_, i) => `s${i}`);
    const me = parseMe({ ...base, followedStoreIds: ["a", 3, "", null, "b", ...many] });
    expect(me.signedIn && me.followedStoreIds.slice(0, 3)).toEqual(["a", "b", "s0"]);
    expect(me.signedIn && me.followedStoreIds.length).toBe(FOLLOWED_STORE_IDS_CAP);
  });
  it("is an empty list when missing or malformed", () => {
    expect(parseMe(base)).toMatchObject({ followedStoreIds: [] });
    expect(parseMe({ ...base, followedStoreIds: "a,b" })).toMatchObject({
      followedStoreIds: [],
    });
  });
});

describe("follow state (shared hearts)", () => {
  it("unknown viewer: the server's favorited decides", () => {
    expect(resolveFavorited(null, "s1", true)).toBe(true);
    expect(resolveFavorited(null, "s1", false)).toBe(false);
  });

  it("the follow list fills hearts a static page rendered empty", () => {
    const st = followStateFrom(["s1"]);
    expect(resolveFavorited(st, "s1", false)).toBe(true);
    expect(resolveFavorited(st, "s2", false)).toBe(false);
    // A dynamic page's server answer still counts (e.g. a follow past the cap).
    expect(resolveFavorited(st, "s3", true)).toBe(true);
  });

  it("a toggle updates every heart for that store, and only that store", () => {
    const st = followStateFrom(["s1"]);
    const off = withFollow(st, "s1", false);
    // Two cards for s1 on one page — both read the same state.
    expect(resolveFavorited(off, "s1", false)).toBe(false);
    expect(resolveFavorited(off, "s1", true)).toBe(false); // beats the server too
    const on = withFollow(off, "s2", true);
    expect(resolveFavorited(on, "s2", false)).toBe(true);
    expect(resolveFavorited(on, "s1", false)).toBe(false);
  });

  it("never mutates the previous state", () => {
    const st = followStateFrom(["s1"]);
    withFollow(st, "s1", false);
    expect(st.overrides.size).toBe(0);
    expect(resolveFavorited(st, "s1", false)).toBe(true);
  });

  it("a refreshed /api/me answer keeps this tab's toggles", () => {
    // Pressed before the answer that was read before the write landed.
    const toggled = withFollow(followStateFrom([]), "s7", true);
    const refreshed = followStateFrom(["s1"], toggled);
    expect(resolveFavorited(refreshed, "s7", false)).toBe(true);
    expect(resolveFavorited(refreshed, "s1", false)).toBe(true);
    const unfollowed = followStateFrom(["s1", "s7"], withFollow(refreshed, "s1", false));
    expect(resolveFavorited(unfollowed, "s1", false)).toBe(false);
  });
});
