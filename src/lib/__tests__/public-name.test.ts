import { describe, expect, it } from "vitest";
import { safePublicName } from "@/lib/public-name";

describe("safePublicName", () => {
  it("keeps a real name, trimmed", () => {
    expect(safePublicName("  ريما حداد ")).toBe("ريما حداد");
  });

  it("never publishes an email address", () => {
    expect(safePublicName("someone@example.com")).toBe("");
    expect(safePublicName(" me@x.lb")).toBe("");
  });

  it("returns empty for nothing (the card then says «زبون»)", () => {
    expect(safePublicName(null)).toBe("");
    expect(safePublicName(undefined)).toBe("");
    expect(safePublicName("   ")).toBe("");
  });

  it("caps the length", () => {
    expect(safePublicName("x".repeat(200))).toHaveLength(80);
  });
});
