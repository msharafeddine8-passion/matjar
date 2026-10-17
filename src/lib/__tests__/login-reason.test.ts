import { describe, expect, it } from "vitest";
import { loginReason } from "../login-reason";

describe("loginReason", () => {
  it("trusts an explicit reason", () => {
    expect(loginReason("message", "/ar/market/1")).toBe("message");
  });
  it("infers from next", () => {
    expect(loginReason(null, "/ar/favorites")).toBe("favorites");
    expect(loginReason(null, "/en/activity")).toBe("activity");
    expect(loginReason(null, "/ar/bookings/abc")).toBe("activity");
    expect(loginReason(null, "/ar/crafts/join")).toBe("crafts");
  });
  it("says nothing it cannot know", () => {
    expect(loginReason(null, null)).toBeNull();
    expect(loginReason("bogus", "/ar/market/1")).toBeNull();
    expect(loginReason(null, "https://evil.example/favorites")).toBeNull();
    expect(loginReason(null, "/ar/favoritesX")).toBeNull();
  });
});
