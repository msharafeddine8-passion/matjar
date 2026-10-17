// The arithmetic behind the attendance screen, kept out of the component.
//
// Not for tidiness: a wall-clock time typed by an owner in Beirut is not the
// wall clock of the browser that types it, and a correction saved an hour out
// is an hour of wages wrong in a payroll run nobody will re-check. That
// conversion — and the CSV quoting, and the week boundaries — is exactly the
// kind of thing that deserves a test, and this repo's vitest runs in node with
// no DOM. So it lives here, pure, and the component only renders it.

const TZ = "Asia/Beirut";

/** Rows as `attendance_timesheet` returns them (0267). */
export type TimesheetRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  checked_in_at: string;
  checked_out_at: string | null;
  net_minutes: number;
  break_minutes: number;
  /** Null — not zero — when the shop set no hours to be late against. */
  late_minutes: number | null;
  source: string;
  in_meters: number | null;
  out_meters: number | null;
  /** Nobody clocked out; the end time is the guard's guess, not a fact. */
  auto_closed: boolean;
  edited: boolean;
  edit_reason: string | null;
};

const BEIRUT_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function parts(ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of BEIRUT_PARTS.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Beirut's offset from UTC at an instant, in milliseconds. */
function offsetMs(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - (ms - (ms % 1000));
}

/** The Beirut calendar date (YYYY-MM-DD) an instant falls on. */
export function beirutDay(ms: number): string {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** A calendar date shifted by whole days, staying a calendar date. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday-first week containing the instant, as Beirut dates. Monday because
 *  that is what `date_trunc('week')` means to Postgres, and the two must agree
 *  or "this week" says something different on either side of the wire. */
export function weekRange(ms: number): { from: string; to: string } {
  const day = beirutDay(ms);
  const [y, m, d] = day.split("-").map(Number);
  // getUTCDay is 0 = Sunday; shift so Monday is 0.
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const from = addDays(day, -back);
  return { from, to: addDays(from, 6) };
}

/** Calendar month containing the instant, as Beirut dates. */
export function monthRange(ms: number): { from: string; to: string } {
  const [y, m] = beirutDay(ms).split("-").map(Number);
  return {
    from: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`,
    to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
}

/**
 * "YYYY-MM-DDTHH:mm" typed into a datetime-local, read as BEIRUT wall time,
 * returned as an instant. Null when the string is not a full local datetime.
 *
 * The browser would read that same string in its own zone, which is wrong for
 * an owner travelling, wrong for a phone whose zone is stuck on UTC, and wrong
 * in a way that silently moves someone's hours.
 */
export function beirutWallToIso(wall: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Two passes. The offset that applies is the one in force at the ANSWER, and
  // a single pass lands an hour out on the two nights a year the clocks move.
  const first = naive - offsetMs(naive);
  return new Date(naive - offsetMs(first)).toISOString();
}

/** An instant as "YYYY-MM-DDTHH:mm" Beirut wall time, for datetime-local. */
export function isoToBeirutWall(iso: string): string {
  const p = parts(new Date(iso).getTime());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * "7 س 30 د" / "7 h 30 m". Digits follow the locale, the unit letters come from
 * the dictionary — never spelled out here, or the screen ships Arabic strings
 * hidden inside a helper where no translator will find them.
 */
export function formatDuration(
  minutes: number,
  lang: string,
  hoursUnit: string,
  minsUnit: string,
): string {
  const total = Math.max(0, Math.round(minutes));
  // The numbering system is named rather than inferred. Node and the browser do
  // not agree on what a plain "ar" means — this machine's ICU answers 7 where a
  // phone answers ٧ — and a component that renders on both would hydrate with a
  // mismatch. Naming it makes the two sides identical by construction — and
  // it is Latin, like every other number a merchant reads here.
  const n = new Intl.NumberFormat(lang === "ar" ? "ar-LB-u-nu-latn" : lang);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${n.format(m)} ${minsUnit}`;
  // "7 h" beats "7 h 0 m": a round number should read as one.
  if (m === 0) return `${n.format(h)} ${hoursUnit}`;
  return `${n.format(h)} ${hoursUnit} ${n.format(m)} ${minsUnit}`;
}

/** Minutes as plain decimal hours — for the CSV, where a spreadsheet has to be
 *  able to add the column up. */
export function hoursDecimal(minutes: number): string {
  return (Math.max(0, minutes) / 60).toFixed(2);
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * RFC-4180 rows, with a BOM in front.
 *
 * The BOM is not decoration: Excel opens a .csv as the system codepage unless
 * the file says otherwise, and without it every Arabic name in the sheet
 * arrives as mojibake — which reads as "the export is broken", not "my
 * spreadsheet guessed".
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export type EmployeeTotal = {
  employee_id: string;
  employee_name: string;
  minutes: number;
  /** Distinct days present, which is what a daily-paid worker is paid on. */
  days: number;
  lateMinutes: number;
  /** How many of these hours rest on a guessed clock-out. */
  estimatedRows: number;
};

/** Hours per person over the range, plus the grand total the owner came for. */
export function totalsByEmployee(rows: TimesheetRow[]): EmployeeTotal[] {
  const byId = new Map<string, EmployeeTotal & { dayset: Set<string> }>();
  for (const r of rows) {
    let t = byId.get(r.employee_id);
    if (!t) {
      t = {
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        minutes: 0,
        days: 0,
        lateMinutes: 0,
        estimatedRows: 0,
        dayset: new Set<string>(),
      };
      byId.set(r.employee_id, t);
    }
    t.minutes += r.net_minutes ?? 0;
    t.lateMinutes += r.late_minutes ?? 0;
    if (r.auto_closed) t.estimatedRows += 1;
    t.dayset.add(r.work_date);
  }
  return [...byId.values()]
    .map(({ dayset, ...t }) => ({ ...t, days: dayset.size }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** Rows bucketed by work day, newest day first, newest punch first inside. */
export function groupByDay(
  rows: TimesheetRow[],
): { day: string; rows: TimesheetRow[]; minutes: number }[] {
  const byDay = new Map<string, TimesheetRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.work_date);
    if (list) list.push(r);
    else byDay.set(r.work_date, [r]);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({
      day,
      rows: [...list].sort((a, b) =>
        a.checked_in_at < b.checked_in_at ? 1 : -1,
      ),
      minutes: list.reduce((s, r) => s + (r.net_minutes ?? 0), 0),
    }));
}
