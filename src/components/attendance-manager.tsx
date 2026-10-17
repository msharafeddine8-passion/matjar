"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Coffee,
  Download,
  Pencil,
  Settings2,
  UserCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fieldClass } from "@/components/ui/field";
import type { Locale } from "@/i18n/config";
import {
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

/** A person whose expected hours the owner can set. */
export type ShiftEmployee = {
  id: string;
  name: string;
  /** "HH:MM:SS" from Postgres, or null for "no expected hours". */
  shift_start: string | null;
  shift_end: string | null;
  /** ISO days, 1 = Monday .. 7 = Sunday. Null = every day they show up. */
  work_days: number[] | null;
};

/** Someone who is on the clock right now, and whether they stepped out. */
export type OpenShift = {
  id: string;
  employee_id: string;
  employee_name: string;
  checked_in_at: string;
  break_since: string | null;
};

type L = Record<string, string>;

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DAY_KEYS = [
  "dayMon",
  "dayTue",
  "dayWed",
  "dayThu",
  "dayFri",
  "daySat",
  "daySun",
] as const;

// The ticking clock as an external store. The snapshot is cached in a module
// variable because useSyncExternalStore compares snapshots by identity and a
// getSnapshot that returns a fresh Date.now() every call never settles.
let clockSnapshot = 0;
function subscribeMinute(onChange: () => void) {
  clockSnapshot = Date.now();
  const id = setInterval(() => {
    clockSnapshot = Date.now();
    onChange();
  }, 30_000);
  return () => clearInterval(id);
}
const readClock = () => clockSnapshot;
/** Zero on the server: the page has no business guessing how long it will take
 *  to reach the phone, so it renders the start time and nothing else. */
const serverClock = () => 0;

/** The eight columns of the sheet, so every row and the header agree. Fixed
 *  fractions rather than `auto`, or each row would size its own columns and the
 *  desktop table would come out ragged. */
const GRID =
  "lg:grid-cols-[minmax(7rem,1.5fr)_repeat(5,minmax(3.5rem,0.8fr))_minmax(5rem,1fr)_auto]";

// The shop's hours: who is here now, who worked how long, and which of those
// numbers the machine guessed.
//
// A separate screen from HR on purpose. HR answers "who works here and what do
// I owe them"; this answers "was Tuesday really four hours", which is a
// different question asked at a different moment — usually the day before
// payroll, with a row that looks wrong.
export function AttendanceManager({
  storeId,
  lang,
  labels,
  initialRows,
  initialFrom,
  initialTo,
  openShifts,
  employees,
  graceMinutes,
  autoCloseHours,
}: {
  storeId: string;
  lang: Locale;
  labels: L;
  initialRows: TimesheetRow[];
  initialFrom: string;
  initialTo: string;
  /** Derived on the server from the open rows, so the board is right on paint
   *  rather than after a round-trip. */
  openShifts: OpenShift[];
  employees: ShiftEmployee[];
  graceMinutes: number;
  autoCloseHours: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();

  const [rows, setRows] = useState<TimesheetRow[]>(initialRows);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [loading, setLoading] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Correction draft, one row at a time: two open editors on the same sheet is
  // two ways to lose what you typed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editReason, setEditReason] = useState("");

  const [grace, setGrace] = useState(String(graceMinutes));
  const [autoClose, setAutoClose] = useState(String(autoCloseHours));
  const [shifts, setShifts] = useState<
    Record<string, { start: string; end: string; days: number[] | null }>
  >(() =>
    Object.fromEntries(
      employees.map((e) => [
        e.id,
        {
          start: e.shift_start?.slice(0, 5) ?? "",
          end: e.shift_end?.slice(0, 5) ?? "",
          days: e.work_days ?? null,
        },
      ]),
    ),
  );

  // "Since 09:12" is a fact; "3 h 40 m so far" is only true for a minute, so it
  // ticks. Subscribed to rather than set in an effect, because the wall clock
  // is an external system and React should be told that: the server snapshot is
  // 0, which renders no duration at all, and the number appears once the
  // browser owns the page. Reading Date.now() during render would instead
  // hydrate a different value than it painted.
  const now = useSyncExternalStore(subscribeMinute, readClock, serverClock);

  // Digits are pinned to a numbering system for the same reason: node and the
  // phone do not agree on what plain "ar" means.
  const numLocale = lang === "ar" ? "ar-LB-u-nu-latn" : lang;

  // Clock times stay Latin and 24-hour, matching the booking screens — a punch
  // is a reading off a machine, and "17:05" is unambiguous in both languages.
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Beirut",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [],
  );
  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(numLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    [numLocale],
  );

  const clock = (iso: string) => timeFmt.format(new Date(iso));
  const dur = (minutes: number) =>
    formatDuration(minutes, lang, labels.hoursShort, labels.minsShort);

  const sourceLabel = (source: string) =>
    source === "device"
      ? labels.srcDevice
      : source === "pin"
        ? labels.srcPin
        : labels.srcManager;

  const flagged = rows.filter((r) => r.auto_closed);
  // Correcting the last flagged row must not leave the owner staring at "no
  // attendance in this period" with a filter they have forgotten switching on.
  const shown = onlyFlagged && flagged.length > 0 ? flagged : rows;
  const groups = groupByDay(shown);
  const totals = totalsByEmployee(rows);
  const grandMinutes = totals.reduce((s, t) => s + t.minutes, 0);

  async function load(nextFrom: string, nextTo: string) {
    setLoading(true);
    const { data, error } = await createClient().rpc("attendance_timesheet", {
      p_store_id: storeId,
      p_from: nextFrom,
      p_to: nextTo,
    });
    setLoading(false);
    if (error) {
      notifyError(
        (error.message ?? "").includes("not_authorized")
          ? labels.errNotAuthorized
          : labels.error,
      );
      return;
    }
    setRows((data ?? []) as TimesheetRow[]);
    setEditingId(null);
  }

  function pickRange(next: { from: string; to: string }) {
    setFrom(next.from);
    setTo(next.to);
    void load(next.from, next.to);
  }

  function startEdit(row: TimesheetRow) {
    setEditingId(row.id);
    setEditIn(isoToBeirutWall(row.checked_in_at));
    setEditOut(row.checked_out_at ? isoToBeirutWall(row.checked_out_at) : "");
    // Never prefilled with the previous reason: a correction reuses the last
    // excuse only because nobody retyped it, and the log would say the same
    // thing about two different days.
    setEditReason("");
  }

  async function submitCorrection(row: TimesheetRow) {
    const reason = editReason.trim();
    if (!reason) {
      notifyError(labels.errReason);
      return;
    }
    const inIso = beirutWallToIso(editIn);
    const outIso = editOut.trim() ? beirutWallToIso(editOut) : null;
    if (!inIso || (editOut.trim() && !outIso)) {
      notifyError(labels.error);
      return;
    }
    // Checked here as well as in the function, because a round-trip to be told
    // something the form already knew is a round-trip wasted.
    if (outIso && Date.parse(outIso) <= Date.parse(inIso)) {
      notifyError(labels.errOutBeforeIn);
      return;
    }
    // Clearing the clock-out puts the person back on the clock, and the shift
    // starts counting against now() again. That is occasionally what you want
    // and never what you want by accident.
    if (!outIso && row.checked_out_at) {
      const ok = await confirm({
        message: labels.reopenConfirm.replace("{n}", row.employee_name),
        confirmLabel: labels.correctSave,
        cancelLabel: labels.correctCancel,
        danger: true,
      });
      if (!ok) return;
    }

    setBusy(row.id);
    const { error } = await createClient().rpc("correct_attendance", {
      p_id: row.id,
      p_in: inIso,
      p_out: outIso,
      p_reason: reason,
    });
    setBusy(null);
    if (error) {
      const m = error.message ?? "";
      notifyError(
        m.includes("reason_required")
          ? labels.errReason
          : m.includes("out_before_in")
            ? labels.errOutBeforeIn
            : m.includes("not_authorized")
              ? labels.errNotAuthorized
              : labels.error,
      );
      return;
    }
    notifySuccess(labels.correctDone);
    setEditingId(null);
    await load(from, to);
    // The live board is server-rendered, and a correction can take someone off
    // it or put them back on.
    router.refresh();
  }

  async function saveStoreSettings() {
    setBusy("store");
    const { error } = await createClient()
      .from("stores")
      .update({
        late_grace_minutes: Math.max(0, Math.min(120, Number(grace) || 0)),
        // Clamped to the check constraint rather than sent raw: a 23514 from
        // Postgres reaches the owner as "save failed" with nothing to act on.
        auto_close_hours: Math.max(4, Math.min(24, Number(autoClose) || 16)),
      })
      .eq("id", storeId);
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    notifySuccess(labels.settingsSaved);
    router.refresh();
  }

  async function saveShift(employeeId: string) {
    const s = shifts[employeeId];
    setBusy(employeeId);
    const { error } = await createClient()
      .from("store_employees")
      .update({
        shift_start: s.start || null,
        shift_end: s.end || null,
        // An empty selection means "every day", not "no day ever counts" —
        // the second would silently switch lateness off with the boxes on
        // screen still saying otherwise.
        work_days:
          s.days && s.days.length ? [...s.days].sort((a, b) => a - b) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId);
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    notifySuccess(labels.shiftSaved);
    router.refresh();
  }

  function toggleDay(employeeId: string, day: number) {
    setShifts((prev) => {
      const cur = prev[employeeId];
      const days = cur.days ?? [];
      const next = days.includes(day)
        ? days.filter((d) => d !== day)
        : [...days, day];
      return { ...prev, [employeeId]: { ...cur, days: next } };
    });
  }

  // Plain values, not the pretty ones: the owner opens this in a spreadsheet to
  // add the hours up, and "٧ س ٣٠ د" is not a number to anything.
  function exportCsv() {
    const head = [
      labels.colDay,
      labels.colName,
      labels.colIn,
      labels.colOut,
      labels.colHours,
      labels.colBreak,
      labels.colLate,
      labels.colSource,
      labels.csvFlags,
    ];
    const body = rows.map((r) => [
      r.work_date,
      r.employee_name,
      clock(r.checked_in_at),
      r.checked_out_at ? clock(r.checked_out_at) : "",
      hoursDecimal(r.net_minutes),
      r.break_minutes,
      r.late_minutes ?? "",
      sourceLabel(r.source),
      [
        r.auto_closed ? labels.estimate : "",
        r.edited ? `${labels.editedFlag}: ${r.edit_reason ?? ""}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
    const url = URL.createObjectURL(
      new Blob([toCsv([head, ...body])], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    // ASCII filename on purpose: an Arabic one survives the browser and then
    // arrives at a Windows share as percent-escapes.
    a.download = `attendance-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* ===== Who is on the clock right now ===== */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <UserCheck className="h-4 w-4 text-primary" />
          {labels.nowTitle}
        </h2>

        {openShifts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {labels.nowNobody}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {openShifts.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-border bg-surface-muted/40 p-3"
              >
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {s.employee_name}
                  {s.break_since ? (
                    <Badge variant="warning">
                      <Coffee className="h-3.5 w-3.5" />
                      {labels.onBreak}
                    </Badge>
                  ) : (
                    <Badge variant="success">{labels.stillIn}</Badge>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <WithTime template={labels.nowSince}>
                    <span dir="ltr" className="tabular-nums">
                      {clock(s.checked_in_at)}
                    </span>
                  </WithTime>
                  {now > 0 && (
                    <span className="ms-2">
                      ·{" "}
                      {labels.nowFor.replace(
                        "{d}",
                        dur((now - Date.parse(s.checked_in_at)) / 60000),
                      )}
                    </span>
                  )}
                </p>
                {s.break_since && (
                  <p className="mt-0.5 text-xs font-semibold text-warning">
                    <WithTime template={labels.nowBreak}>
                      <span dir="ltr" className="tabular-nums">
                        {clock(s.break_since)}
                      </span>
                    </WithTime>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== The sheet ===== */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{labels.sheetTitle}</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            <Download className="h-4 w-4" />
            {labels.exportCsv}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => pickRange(weekRange(Date.now()))}
          >
            {labels.rangeWeek}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => pickRange(monthRange(Date.now()))}
          >
            {labels.rangeMonth}
          </Button>
          <div className="min-w-0">
            <label
              className="text-xs font-semibold text-muted-foreground"
              htmlFor="att-from"
            >
              {labels.rangeFrom}
            </label>
            <input
              id="att-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${fieldClass} mt-1 max-w-44`}
              dir="ltr"
            />
          </div>
          <div className="min-w-0">
            <label
              className="text-xs font-semibold text-muted-foreground"
              htmlFor="att-to"
            >
              {labels.rangeTo}
            </label>
            <input
              id="att-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`${fieldClass} mt-1 max-w-44`}
              dir="ltr"
            />
          </div>
          <Button size="sm" onClick={() => load(from, to)} loading={loading}>
            {labels.rangeShow}
          </Button>
        </div>

        {/* The rows a human has to look at, said at the top rather than left to
            be spotted. An estimated clock-out is the one thing on this screen
            that is not a fact. */}
        {flagged.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="text-xs font-bold text-warning">
              {labels.reviewCount.replace("{n}", String(flagged.length))}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ms-auto"
              onClick={() => setOnlyFlagged((v) => !v)}
            >
              {onlyFlagged ? labels.reviewAll : labels.reviewOnly}
            </Button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {labels.sheetEmpty}
          </p>
        ) : (
          <>
            {/* Column names belong to the desktop table only; below lg every
                value carries its own label inside the card. */}
            <div
              className={`mt-4 hidden gap-3 border-b border-border pb-2 text-xs font-bold text-muted-foreground lg:grid ${GRID}`}
            >
              <span>{labels.colName}</span>
              <span>{labels.colIn}</span>
              <span>{labels.colOut}</span>
              <span>{labels.colWorked}</span>
              <span>{labels.colBreak}</span>
              <span>{labels.colLate}</span>
              <span>{labels.colSource}</span>
              <span />
            </div>

            {groups.map((group) => (
              <div key={group.day} className="mt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-1.5">
                  <h3 className="text-sm font-extrabold">
                    {dayFmt.format(new Date(`${group.day}T12:00:00Z`))}
                  </h3>
                  <span className="text-xs font-bold text-muted-foreground">
                    {dur(group.minutes)}
                  </span>
                </div>

                <ul className="space-y-2 lg:space-y-0">
                  {group.rows.map((r) => (
                    <li
                      key={r.id}
                      className={`grid gap-1.5 rounded-xl border p-3 text-xs lg:items-center lg:gap-3 lg:rounded-none lg:border-0 lg:border-b lg:p-0 lg:py-2.5 lg:text-sm ${GRID} ${
                        r.auto_closed
                          ? "border-warning/50 border-s-4 border-s-warning bg-warning-soft/50 ps-3 lg:border-b-warning/40 lg:border-s-4 lg:border-s-warning lg:bg-warning-soft/40 lg:ps-3"
                          : "border-border bg-surface-muted/30 lg:border-border/50 lg:bg-transparent"
                      }`}
                    >
                      <span className="font-bold">{r.employee_name}</span>

                      <Cell label={labels.colIn}>
                        <span dir="ltr" className="tabular-nums">
                          {clock(r.checked_in_at)}
                        </span>
                      </Cell>

                      <Cell label={labels.colOut}>
                        {r.checked_out_at ? (
                          <span
                            className={
                              r.auto_closed ? "font-bold text-warning" : ""
                            }
                          >
                            <span dir="ltr" className="tabular-nums">
                              {clock(r.checked_out_at)}
                            </span>
                            {/* Said on the number itself, not only in the note
                                below it: this is the one time on the row that
                                nobody actually punched. Default badge size, not
                                `sm` — that one is 11px, and 12px is the floor
                                for Arabic on a phone. */}
                            {r.auto_closed && (
                              <Badge variant="warning" className="ms-1.5">
                                {labels.estimate}
                              </Badge>
                            )}
                          </span>
                        ) : (
                          <Badge variant="success">{labels.stillIn}</Badge>
                        )}
                      </Cell>

                      <Cell label={labels.colWorked}>
                        <span className="font-bold tabular-nums">
                          {dur(r.net_minutes)}
                        </span>
                      </Cell>

                      <Cell label={labels.colBreak}>
                        <span className="tabular-nums text-muted-foreground">
                          {r.break_minutes > 0 ? dur(r.break_minutes) : "—"}
                        </span>
                      </Cell>

                      <Cell label={labels.colLate}>
                        {/* Null late is "this shop set no hours", and must not
                            wear a reassuring badge — nor an alarming one. */}
                        {r.late_minutes == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : r.late_minutes > 0 ? (
                          <Badge variant="danger">
                            {labels.lateBy.replace("{d}", dur(r.late_minutes))}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Cell>

                      <Cell label={labels.colSource}>
                        <span className="text-muted-foreground">
                          {sourceLabel(r.source)}
                        </span>
                      </Cell>

                      <Button
                        size="sm"
                        variant={r.auto_closed ? "primary" : "outline"}
                        className="w-full lg:w-auto"
                        onClick={() =>
                          editingId === r.id ? setEditingId(null) : startEdit(r)
                        }
                      >
                        <Pencil className="h-4 w-4" />
                        {labels.correct}
                      </Button>

                      {r.auto_closed && (
                        <p className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs font-bold text-warning lg:col-span-8">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {labels.estimateWhy}
                        </p>
                      )}

                      {r.edited && (
                        <p
                          className="text-xs text-muted-foreground lg:col-span-8"
                          title={r.edit_reason ?? undefined}
                        >
                          <Badge variant="info" className="me-1.5">
                            {labels.editedFlag}
                          </Badge>
                          {labels.editedWhy.replace("{r}", r.edit_reason ?? "")}
                        </p>
                      )}

                      {editingId === r.id && (
                        <div className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:col-span-8">
                          <div>
                            <label
                              className="text-xs font-semibold text-muted-foreground"
                              htmlFor={`in-${r.id}`}
                            >
                              {labels.correctIn}
                            </label>
                            <input
                              id={`in-${r.id}`}
                              type="datetime-local"
                              value={editIn}
                              onChange={(e) => setEditIn(e.target.value)}
                              className={`${fieldClass} mt-1`}
                              dir="ltr"
                            />
                          </div>
                          <div>
                            <label
                              className="text-xs font-semibold text-muted-foreground"
                              htmlFor={`out-${r.id}`}
                            >
                              {labels.correctOut}
                            </label>
                            <input
                              id={`out-${r.id}`}
                              type="datetime-local"
                              value={editOut}
                              onChange={(e) => setEditOut(e.target.value)}
                              className={`${fieldClass} mt-1`}
                              dir="ltr"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {labels.correctOutHint}
                            </p>
                          </div>
                          <div className="sm:col-span-2">
                            <label
                              className="text-xs font-semibold text-muted-foreground"
                              htmlFor={`why-${r.id}`}
                            >
                              {labels.correctReason}
                            </label>
                            <input
                              id={`why-${r.id}`}
                              value={editReason}
                              onChange={(e) => setEditReason(e.target.value)}
                              placeholder={labels.correctReasonPlaceholder}
                              className={`${fieldClass} mt-1`}
                              required
                            />
                          </div>
                          <div className="flex flex-wrap gap-2 sm:col-span-2">
                            <Button
                              size="sm"
                              loading={busy === r.id}
                              disabled={!editReason.trim()}
                              onClick={() => submitCorrection(r)}
                            >
                              {labels.correctSave}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              {labels.correctCancel}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      {/* ===== What the owner came for ===== */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-bold">{labels.totalsTitle}</h2>

        {totals.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {labels.sheetEmpty}
          </p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border">
              {totals.map((t) => (
                <li
                  key={t.employee_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="min-w-32 flex-1">
                    <span className="font-bold">{t.employee_name}</span>
                    <span className="ms-2 text-xs text-muted-foreground">
                      {labels.totalsDays.replace(
                        "{n}",
                        new Intl.NumberFormat(numLocale).format(t.days),
                      )}
                    </span>
                    {/* Said next to the number it inflates, not in a footnote:
                        these hours include a clock-out nobody made. */}
                    {t.estimatedRows > 0 && (
                      <span className="ms-2 text-xs font-bold text-warning">
                        {labels.totalsEstimated.replace(
                          "{n}",
                          new Intl.NumberFormat(numLocale).format(
                            t.estimatedRows,
                          ),
                        )}
                      </span>
                    )}
                  </span>
                  <span className="font-bold tabular-nums">
                    {dur(t.minutes)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-primary-soft px-3 py-2.5 text-sm font-extrabold text-primary">
              <span>{labels.totalsGrand}</span>
              <span className="tabular-nums">{dur(grandMinutes)}</span>
            </p>
          </>
        )}
      </section>

      {/* ===== Settings ===== */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{labels.settingsTitle}</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 className="h-4 w-4" />
            {labels.settingsToggle}
          </Button>
        </div>

        {showSettings && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  className="text-xs font-semibold text-muted-foreground"
                  htmlFor="att-grace"
                >
                  {labels.grace}
                </label>
                <input
                  id="att-grace"
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={grace}
                  onChange={(e) => setGrace(e.target.value)}
                  className={`${fieldClass} mt-1`}
                  dir="ltr"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {labels.graceHint}
                </p>
              </div>
              <div>
                <label
                  className="text-xs font-semibold text-muted-foreground"
                  htmlFor="att-autoclose"
                >
                  {labels.autoClose}
                </label>
                <input
                  id="att-autoclose"
                  type="number"
                  min="4"
                  max="24"
                  step="1"
                  value={autoClose}
                  onChange={(e) => setAutoClose(e.target.value)}
                  className={`${fieldClass} mt-1`}
                  dir="ltr"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {labels.autoCloseHint}
                </p>
              </div>
              <div className="sm:col-span-2">
                <Button onClick={saveStoreSettings} loading={busy === "store"}>
                  {labels.save}
                </Button>
              </div>
            </div>

            <h3 className="mt-6 font-bold">{labels.shiftsTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {labels.shiftsHint}
            </p>

            {employees.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {labels.noEmployees}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {employees.map((e) => {
                  const s = shifts[e.id];
                  return (
                    <li
                      key={e.id}
                      className="rounded-xl border border-border bg-surface-muted/30 p-3"
                    >
                      <p className="font-bold">{e.name}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <label
                            className="text-xs font-semibold text-muted-foreground"
                            htmlFor={`s-${e.id}`}
                          >
                            {labels.shiftStart}
                          </label>
                          <input
                            id={`s-${e.id}`}
                            type="time"
                            value={s.start}
                            onChange={(ev) =>
                              setShifts((p) => ({
                                ...p,
                                [e.id]: { ...s, start: ev.target.value },
                              }))
                            }
                            className={`${fieldClass} mt-1`}
                            dir="ltr"
                          />
                        </div>
                        <div>
                          <label
                            className="text-xs font-semibold text-muted-foreground"
                            htmlFor={`e-${e.id}`}
                          >
                            {labels.shiftEnd}
                          </label>
                          <input
                            id={`e-${e.id}`}
                            type="time"
                            value={s.end}
                            onChange={(ev) =>
                              setShifts((p) => ({
                                ...p,
                                [e.id]: { ...s, end: ev.target.value },
                              }))
                            }
                            className={`${fieldClass} mt-1`}
                            dir="ltr"
                          />
                        </div>
                      </div>

                      <p className="mt-2 text-xs font-semibold text-muted-foreground">
                        {labels.workDays}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          aria-pressed={s.days === null}
                          onClick={() =>
                            setShifts((p) => ({
                              ...p,
                              [e.id]: {
                                ...s,
                                days: s.days === null ? [] : null,
                              },
                            }))
                          }
                          className={`h-11 rounded-xl border px-3 text-xs font-bold transition-colors lg:h-9 ${
                            s.days === null
                              ? "border-primary bg-primary-soft text-primary"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {labels.everyDay}
                        </button>
                        {ISO_DAYS.map((d, i) => (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={s.days?.includes(d) ?? false}
                            disabled={s.days === null}
                            onClick={() => toggleDay(e.id, d)}
                            className={`h-11 min-w-11 rounded-xl border px-2.5 text-xs font-bold transition-colors disabled:opacity-40 lg:h-9 lg:min-w-9 ${
                              s.days?.includes(d)
                                ? "border-primary bg-primary-soft text-primary"
                                : "border-border text-muted-foreground"
                            }`}
                          >
                            {labels[DAY_KEYS[i]]}
                          </button>
                        ))}
                      </div>

                      <Button
                        size="sm"
                        className="mt-3"
                        loading={busy === e.id}
                        onClick={() => saveShift(e.id)}
                      >
                        {labels.save}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** A sentence with a {t} placeholder, with the time dropped in as its own
 *  LTR-isolated element. Concatenating it into the string instead would put a
 *  Latin "17:05" inside an Arabic run and let the bidi algorithm decide where
 *  it lands — which, next to a colon, is not where you left it. */
function WithTime({
  template,
  children,
}: {
  template: string;
  children: React.ReactNode;
}) {
  const [before, after = ""] = template.split("{t}");
  return (
    <>
      {before}
      {children}
      {after}
    </>
  );
}

/** One value in a row: a labelled line in the phone card, a bare cell in the
 *  desktop table. Written once rather than as two trees, so the two layouts
 *  cannot drift apart. */
function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center justify-between gap-2 lg:block">
      <span className="text-xs font-semibold text-muted-foreground lg:hidden">
        {label}
      </span>
      {children}
    </span>
  );
}
