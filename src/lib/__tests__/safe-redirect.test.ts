import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

const ORIGIN = "https://matjarlb.com";
const FALLBACK = "/ar";
const check = (next: string | null) => safeRedirectPath(next, ORIGIN, FALLBACK);

describe("safeRedirectPath", () => {
  it("keeps a normal same-site path with its query string", () => {
    expect(check("/ar/merchant?tab=orders&x=1")).toBe("/ar/merchant?tab=orders&x=1");
    expect(check("/ar/merchant")).toBe("/ar/merchant");
  });

  it("refuses the tab trick, decoded (as searchParams.get hands it over)", () => {
    // new URL("/\t/evil.com", base) strips the tab and lands on evil.com.
    expect(new URL("/\t/evil.com", ORIGIN).host).toBe("evil.com");
    expect(check("/\t/evil.com")).toBe(FALLBACK);
  });

  it("does not let the still-encoded form leave the site either", () => {
    // Left encoded it is a literal path segment on our own origin.
    const out = check("/%09/evil.com");
    expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
  });

  it("refuses the same value when it arrives through a real query string", () => {
    const next = new URL(`${ORIGIN}/ar/callback?next=/%09/evil.com`).searchParams.get("next");
    expect(check(next)).toBe(FALLBACK);
  });

  it("refuses protocol-relative URLs", () => {
    expect(check("//evil.com")).toBe(FALLBACK);
    expect(check("//evil.com/ar")).toBe(FALLBACK);
  });

  it("refuses backslash forms the parser would turn into slashes", () => {
    expect(check("/\\evil.com")).toBe(FALLBACK);
    expect(check("\\\\evil.com")).toBe(FALLBACK);
  });

  it("refuses absolute URLs, including to other schemes", () => {
    expect(check("https://evil.com")).toBe(FALLBACK);
    expect(check("https://matjarlb.com.evil.com/ar")).toBe(FALLBACK);
    expect(check("javascript:alert(1)")).toBe(FALLBACK);
  });

  it("refuses other control characters", () => {
    expect(check("/ar\n/merchant")).toBe(FALLBACK);
    expect(check("/\r//evil.com")).toBe(FALLBACK);
  });

  it("falls back when there is nothing to follow", () => {
    expect(check(null)).toBe(FALLBACK);
    expect(check("")).toBe(FALLBACK);
    expect(check("ar/merchant")).toBe(FALLBACK);
  });
});
