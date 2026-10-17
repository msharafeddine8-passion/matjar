import { describe, expect, it } from "vitest";
import { statusErrorKind, statusNeedsConfirm } from "@/lib/booking-status";

describe("statusNeedsConfirm", () => {
  it("asks before the closing statuses only", () => {
    for (const s of ["rejected", "declined", "cancelled", "no_show"]) {
      expect(statusNeedsConfirm(s)).toBe(true);
    }
    for (const s of ["pending", "accepted", "scheduled", "completed", "confirmed", "checked_in"]) {
      expect(statusNeedsConfirm(s)).toBe(false);
    }
  });
});

describe("statusErrorKind", () => {
  it("maps class_full, exclusion and unique violations", () => {
    expect(statusErrorKind({ code: "P0001", message: "class_full" })).toBe("classFull");
    expect(statusErrorKind({ code: "23P01", message: "conflicting key value" })).toBe("conflict");
    expect(statusErrorKind({ code: "23505", message: "duplicate key" })).toBe("conflict");
  });
  it("falls back to generic", () => {
    expect(statusErrorKind({ code: "42501", message: "permission denied" })).toBe("generic");
    expect(statusErrorKind(null)).toBe("generic");
  });
});
