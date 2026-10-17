import { beforeEach, describe, expect, it, vi } from "vitest";

// The route handler only wires the cookie-bound client to loadMe; what matters
// here is that it never caches and degrades to anonymous on ANY failure.
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const { GET } = await import("@/app/api/me/route");

beforeEach(() => {
  createClient.mockReset();
});

describe("GET /api/me", () => {
  it("answers anonymous, uncached, when there is no session", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it("answers anonymous instead of a 500 when the client throws", async () => {
    createClient.mockRejectedValue(new Error("cookies() outside a request"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it("returns the signed-in viewer's followed store ids, uncached", async () => {
    const tables: Record<string, unknown> = {
      profiles: { data: { role: "customer", is_active: true }, error: null },
      follows: { data: [{ store_id: "s2" }, { store_id: "s1" }], error: null },
    };
    const from = (table: string) => {
      const res = { data: null, error: null, count: null, ...(tables[table] as object) };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"])
        b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(res);
      b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve(res).then(ok, bad);
      return b;
    };
    createClient.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "u1", email: "c@x.lb" } }, error: null }),
      },
      from,
      rpc: async () => ({ data: null, error: null }),
    });
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toMatchObject({
      signedIn: true,
      id: "u1",
      followedStoreIds: ["s2", "s1"],
    });
  });

  it("answers anonymous when the auth call itself throws", async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: async () => {
          throw new Error("network");
        },
      },
    });
    expect(await (await GET()).json()).toEqual({ signedIn: false });
  });
});
