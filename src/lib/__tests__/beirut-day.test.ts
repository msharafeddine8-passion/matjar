import { describe, expect, it } from "vitest";
import { beirutEndOfDayIso, isoToBeirutYmd } from "@/lib/beirut-day";

describe("beirutEndOfDayIso", () => {
  it("summer dates end at 23:59:59 +03:00", () => {
    expect(beirutEndOfDayIso("2026-07-15")).toBe("2026-07-15T23:59:59+03:00");
  });

  it("winter dates end at 23:59:59 +02:00", () => {
    expect(beirutEndOfDayIso("2026-12-31")).toBe("2026-12-31T23:59:59+02:00");
    expect(beirutEndOfDayIso("2027-01-10")).toBe("2027-01-10T23:59:59+02:00");
  });

  it("the instant is really the last second of that Beirut day", () => {
    const iso = beirutEndOfDayIso("2026-10-20")!;
    const t = new Date(iso).getTime();
    expect(isoToBeirutYmd(new Date(t).toISOString())).toBe("2026-10-20");
    expect(isoToBeirutYmd(new Date(t + 1000).toISOString())).toBe("2026-10-21");
  });

  it("holds on both DST-change dates of 2026", () => {
    for (const d of ["2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25"]) {
      const t = new Date(beirutEndOfDayIso(d)!).getTime();
      expect(isoToBeirutYmd(new Date(t).toISOString())).toBe(d);
      expect(isoToBeirutYmd(new Date(t + 1000).toISOString())).not.toBe(d);
    }
  });

  it("rejects non-dates", () => {
    expect(beirutEndOfDayIso("")).toBeNull();
    expect(beirutEndOfDayIso("20/10/2026")).toBeNull();
  });
});

describe("isoToBeirutYmd", () => {
  it("reads a stored instant as its Beirut date", () => {
    // 22:30 UTC on the 20th is already the 21st in Beirut (+03:00).
    expect(isoToBeirutYmd("2026-07-20T22:30:00Z")).toBe("2026-07-21");
    expect(isoToBeirutYmd(null)).toBe("");
  });
});
