// Beirut calendar-day boundaries for date-only inputs that are stored as
// instants (a coupon's "valid until" date). Pure — client and server safe.
import { beirutOffsetMinutes, beirutYmd } from "./quick-panel";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fmtOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/**
 * The last second of Beirut's day `ymd`, as an ISO string carrying Beirut's
 * own offset for that date ("2026-10-20T23:59:59+03:00", "…+02:00" in winter).
 *
 * A bare "YYYY-MM-DD" sent to a timestamptz column is read as 00:00 UTC — 2 or
 * 3 a.m. in Beirut — so a coupon "valid until the 20th" died in the first hours
 * of the 20th. The offset is the one in force at 23:59:59 that day (taken twice:
 * the first guess uses the offset at UTC 23:59:59, which differs on the night
 * the clocks move). Null when the input is not a calendar date.
 */
export function beirutEndOfDayIso(ymd: string): string | null {
  const m = YMD_RE.exec(ymd);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  if (Number.isNaN(naive)) return null;
  const first = beirutOffsetMinutes(new Date(naive));
  const off = beirutOffsetMinutes(new Date(naive - first * 60_000));
  return `${ymd}T23:59:59${fmtOffset(off)}`;
}

/** The Beirut calendar date of a stored instant, for a date input. */
export function isoToBeirutYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : beirutYmd(t);
}
