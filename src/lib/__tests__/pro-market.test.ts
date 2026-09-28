import { describe, it, expect } from "vitest";
import {
  beirutToday,
  craftIntentFromProblem,
  formatDay,
  isJobOpen,
  visibleJobFilters,
} from "@/lib/pro-market";
import { TRADE_SLUGS } from "@/lib/search-intent";

describe("craftIntentFromProblem — «شو خربان؟» read with the site-search lexicon", () => {
  it("resolves a dialect trade word and a place in one sentence", () => {
    expect(craftIntentFromProblem("بدي كهربجي طرابلس")).toEqual({
      trade: "electrician",
      area: "tripoli",
    });
  });

  it("resolves a SYMPTOM, not only a profession", () => {
    expect(craftIntentFromProblem("المكيف ما عم يبرد").trade).toBe("ac-service");
    expect(craftIntentFromProblem("الغسالة عم تسرّب").trade).toBe("washer-repair");
  });

  it("guesses nothing from words it does not know", () => {
    expect(craftIntentFromProblem("etumax")).toEqual({ trade: null, area: null });
    expect(craftIntentFromProblem("")).toEqual({ trade: null, area: null });
    expect(craftIntentFromProblem("a")).toEqual({ trade: null, area: null });
  });

  it("never returns a sector that is not a craft trade", () => {
    // «مطعم» is a food SECTOR in the lexicon — not one of the 47 trades.
    expect(craftIntentFromProblem("مطعم بطرابلس").trade).toBeNull();
  });

  it("only ever returns a real trade slug", () => {
    for (const q of ["سنكري", "دهان", "طرمبة", "انفرتر", "نقل عفش", "رش حشرات"]) {
      const t = craftIntentFromProblem(q).trade;
      expect(t).not.toBeNull();
      expect(TRADE_SLUGS.has(t as string)).toBe(true);
    }
  });
});

describe("jobs — Beirut dates and liveness", () => {
  it("uses the Beirut calendar day, not UTC", () => {
    // 22:30 UTC on 1 Oct is 01:30 on 2 Oct in Beirut (UTC+3 in October).
    expect(beirutToday(Date.parse("2026-10-01T22:30:00Z"))).toBe("2026-10-02");
    expect(beirutToday(Date.parse("2026-10-01T12:00:00Z"))).toBe("2026-10-01");
  });

  it("keeps a posting open through its own deadline day", () => {
    expect(isJobOpen({ status: "active", apply_deadline: "2026-10-01" }, "2026-10-01")).toBe(true);
    expect(isJobOpen({ status: "active", apply_deadline: "2026-09-30" }, "2026-10-01")).toBe(false);
    expect(isJobOpen({ status: "active", apply_deadline: null }, "2026-10-01")).toBe(true);
    expect(isJobOpen({ status: "closed", apply_deadline: null }, "2026-10-01")).toBe(false);
  });

  it("prints Western digits and Levantine month names in Arabic", () => {
    const s = formatDay("2026-07-27T14:53:02Z", "ar");
    expect(s).toMatch(/27/);
    expect(s).not.toMatch(/[٠-٩]/);
    expect(s).toContain("تموز");
    expect(formatDay("2026-07-27", "en")).toBe("27 Jul");
    expect(formatDay("not a date", "ar")).toBe("");
  });

  it("never rolls a bare date onto a neighbouring day", () => {
    expect(formatDay("2026-01-01", "en")).toBe("1 Jan");
    expect(formatDay("2026-12-31", "en")).toBe("31 Dec");
  });
});

describe("visibleJobFilters — a control must be able to split the list", () => {
  it("draws nothing over an empty board", () => {
    expect(visibleJobFilters([])).toEqual({ types: [], regions: [] });
  });

  it("draws nothing for a value every posting shares (production today: 2 × full_time)", () => {
    const live = [
      { job_type: "full_time", region: "north" },
      { job_type: "full_time", region: "beirut" },
    ];
    expect(visibleJobFilters(live)).toEqual({ types: [], regions: ["north", "beirut"] });
  });

  it("offers only values that have a posting behind them", () => {
    const f = visibleJobFilters([
      { job_type: "full_time", region: null },
      { job_type: "remote", region: null },
      { job_type: "remote", region: null },
    ]);
    expect(f.types).toEqual(["full_time", "remote"]);
    expect(f.types).not.toContain("internship");
    expect(f.regions).toEqual([]);
  });
});

describe("craftIntentFromProblem — prepositions a sentence carries", () => {
  it("reads «بالميناء» and «بطرابلس» as places", () => {
    expect(craftIntentFromProblem("البراد ما عم يبرد بالميناء")).toEqual({
      trade: "fridge-repair",
      area: "mina",
    });
    expect(craftIntentFromProblem("بدي سنكري بطرابلس")).toEqual({
      trade: "plumber",
      area: "tripoli",
    });
  });

  it("does not let the split damage a word that merely starts with the letter", () => {
    expect(craftIntentFromProblem("البراد خربان").trade).toBe("fridge-repair");
    expect(craftIntentFromProblem("بدي بنشري").trade).toBe("tyres");
  });
});
