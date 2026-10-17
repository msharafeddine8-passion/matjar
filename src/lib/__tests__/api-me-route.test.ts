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
