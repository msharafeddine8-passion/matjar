import { describe, expect, it } from "vitest";
import {
  addDays,
  beirutDay,
  beirutWallToIso,
  formatDuration,
  groupByDay,
  hoursDecimal,
  isoToBeirutWall,
  monthRange,
  toCsv,
  totalsByEmployee,
  weekRange,
  type TimesheetRow,
} from "@/lib/attendance";

// The correction form is the only place in the app where a human types a time
// that becomes a timestamp in payroll. An hour of drift here is an hour of
// wages, so the DST boundary is tested on both sides rather than assumed.
describe("beirut wall time", () => {
  it("reads a typed time as Beirut, not as the browser's zone", () => {
    // August: Lebanon is on EEST, +3.
    expect(beirutWallToIso("2026-08-13T09:00")).toBe("2026-08-13T06:00:00.000Z");
    // January: EET, +2. Same input, different instant.
    expect(beirutWallToIso("2026-01-15T09:00")).toBe("2026-01-15T07:00:00.000Z");
  });

  it("refuses anything that is not a full local datetime", () => {
    expect(beirutWallToIso("")).toBeNull();
    expect(beirutWallToIso("2026-08-13")).toBeNull();
  });

  it("round-trips an instant back into the form field", () => {
    expect(isoToBeirutWall("2026-08-13T06:00:00.000Z")).toBe("2026-08-13T09:00");
    expect(isoToBeirutWall("2026-01-15T07:00:00.000Z")).toBe("2026-01-15T09:00");
  });

  it("puts a late-evening UTC instant on the NEXT Beirut day", () => {
    // 22:30Z in August is 01:30 tomorrow in Beirut — the case that makes a
    // naive slice(0,10) file a shift under the wrong day.
    expect(beirutDay(Date.parse("2026-08-13T22:30:00Z"))).toBe("2026-08-14");
  });
});

describe("ranges", () => {
  it("starts the week on Monday, as date_trunc does", () => {
    // 2026-08-13 is a Thursday.
    expect(weekRange(Date.parse("2026-08-13T09:00:00Z"))).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
    // A Monday is its own week start, not the end of the previous one.
    expect(weekRange(Date.parse("2026-08-10T09:00:00Z")).from).toBe("2026-08-10");
    // A Sunday belongs to the week that began six days earlier.
    expect(weekRange(Date.parse("2026-08-16T09:00:00Z")).from).toBe("2026-08-10");
  });

  it("ends the month on its real last day", () => {
    expect(monthRange(Date.parse("2026-02-05T09:00:00Z")).to).toBe("2026-02-28");
    expect(monthRange(Date.parse("2026-08-05T09:00:00Z"))).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("crosses month and year boundaries when shifting days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("durations", () => {
  const en = (m: number) => formatDuration(m, "en", "h", "m");

  it("reads a round number as a round number", () => {
    expect(en(60)).toBe("1 h");
    expect(en(90)).toBe("1 h 30 m");
    expect(en(45)).toBe("45 m");
    expect(en(0)).toBe("0 m");
  });

  it("takes its digits from the locale and its letters from the caller", () => {
    // Merchant screens read Western digits (ar-LB-u-nu-latn); the unit
    // letters still come from the caller.
    expect(formatDuration(450, "ar", "س", "د")).toBe("7 س 30 د");
  });

  it("never reports negative time", () => {
    expect(en(-30)).toBe("0 m");
    expect(hoursDecimal(-30)).toBe("0.00");
    expect(hoursDecimal(450)).toBe("7.50");
  });
});

describe("csv", () => {
  it("quotes the separators instead of splitting the row on them", () => {
    const out = toCsv([
      ["name", "note"],
      ['سامر, "أبو علي"', "line1\nline2"],
    ]);
    expect(out).toBe(
      '\uFEFFname,note\r\n"سامر, ""أبو علي""","line1\nline2"',
    );
  });

  it("leads with a BOM so Excel does not mangle the Arabic names", () => {
    expect(toCsv([["اسم"]]).startsWith("\uFEFF")).toBe(true);
  });

  it("writes an empty cell for a shift nobody closed", () => {
    expect(toCsv([["a", null, undefined, 0]])).toBe("\uFEFFa,,,0");
  });
});

function row(over: Partial<TimesheetRow>): TimesheetRow {
  return {
    id: "r1",
    employee_id: "e1",
    employee_name: "سامر",
    work_date: "2026-08-13",
    checked_in_at: "2026-08-13T05:00:00Z",
    checked_out_at: "2026-08-13T13:00:00Z",
    net_minutes: 480,
    break_minutes: 0,
    late_minutes: null,
    source: "device",
    in_meters: 12,
    out_meters: 15,
    auto_closed: false,
    edited: false,
    edit_reason: null,
    ...over,
  };
}

describe("totals", () => {
  it("counts days a person was present, not rows they punched", () => {
    const totals = totalsByEmployee([
      row({ id: "a", net_minutes: 240 }),
      // Same person, same day, second punch — one day, not two.
      row({ id: "b", net_minutes: 180 }),
      row({ id: "c", work_date: "2026-08-14", net_minutes: 300 }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].minutes).toBe(720);
    expect(totals[0].days).toBe(2);
  });

  it("carries how much of the total rests on a guess", () => {
    const totals = totalsByEmployee([
      row({ id: "a", auto_closed: true, late_minutes: 15 }),
      row({ id: "b", employee_id: "e2", employee_name: "ريما", net_minutes: 60 }),
    ]);
    // Sorted by hours, so the person with the most is read first.
    expect(totals.map((t) => t.employee_name)).toEqual(["سامر", "ريما"]);
    expect(totals[0].estimatedRows).toBe(1);
    expect(totals[0].lateMinutes).toBe(15);
    // Null late is "no expected hours", and must not read as zero-late.
    expect(totals[1].lateMinutes).toBe(0);
  });
});

describe("grouping", () => {
  it("puts the newest day first, and the newest punch first inside it", () => {
    const groups = groupByDay([
      row({ id: "a", work_date: "2026-08-12", checked_in_at: "2026-08-12T05:00:00Z" }),
      row({ id: "b", work_date: "2026-08-13", checked_in_at: "2026-08-13T05:00:00Z" }),
      row({ id: "c", work_date: "2026-08-13", checked_in_at: "2026-08-13T11:00:00Z" }),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-08-13", "2026-08-12"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["c", "b"]);
    expect(groups[0].minutes).toBe(960);
  });
});
