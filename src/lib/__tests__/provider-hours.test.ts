import { describe, expect, it } from "vitest";
import { checkWeek, type DraftWeek } from "@/lib/provider-hours";

const off = { on: false, from: "09:00", to: "18:00" };
function week(over: DraftWeek = {}): DraftWeek {
  const w: DraftWeek = {};
  for (let d = 0; d <= 6; d++) w[d] = over[d] ?? { ...off };
  return w;
}

describe("checkWeek", () => {
  it("returns the ticked windows in weekday order", () => {
    const r = checkWeek(
      week({
        5: { on: true, from: "10:00", to: "14:00" },
        1: { on: true, from: "09:00", to: "17:30" },
      }),
    );
    expect(r).toEqual({
      ok: true,
      empty: false,
      rows: [
        { weekday: 1, start_time: "09:00", end_time: "17:30" },
        { weekday: 5, start_time: "10:00", end_time: "14:00" },
      ],
    });
  });

  it("names the first day whose start is not before its end", () => {
    expect(
      checkWeek(
        week({
          2: { on: true, from: "09:00", to: "12:00" },
          4: { on: true, from: "18:00", to: "09:00" },
        }),
      ),
    ).toEqual({ ok: false, badDay: 4 });
    expect(checkWeek(week({ 0: { on: true, from: "10:00", to: "10:00" } }))).toEqual({
      ok: false,
      badDay: 0,
    });
  });

  it("rejects a ticked day with a missing time", () => {
    expect(checkWeek(week({ 3: { on: true, from: "", to: "12:00" } }))).toEqual({
      ok: false,
      badDay: 3,
    });
  });

  it("ignores bad times on unticked days and flags an empty week", () => {
    expect(checkWeek(week({ 6: { on: false, from: "20:00", to: "08:00" } }))).toEqual({
      ok: true,
      rows: [],
      empty: true,
    });
  });
});
