// Pure rules for a provider's weekly-hours editor (booking engine v2, 0174).

export type DraftDay = { on: boolean; from: string; to: string };
export type DraftWeek = Record<number, DraftDay>;

export type WeekRow = { weekday: number; start_time: string; end_time: string };

export type WeekCheck =
  /** Ready to save; `rows` are the windows to write (weekday ascending). */
  | { ok: true; rows: WeekRow[]; empty: boolean }
  /** A ticked day whose window is missing or not from < to. */
  | { ok: false; badDay: number };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate the draft before anything is written.
 *
 * The old save silently DROPPED a ticked day whose end was before its start —
 * the merchant thought Friday was saved and it was gone. A bad window now stops
 * the save and names the day. `empty` (no ticked day at all) is reported so the
 * caller can warn: the engine treats "no rules" as "no restriction", so
 * unticking everything does not close the provider, it opens them all week.
 */
export function checkWeek(draft: DraftWeek): WeekCheck {
  const rows: WeekRow[] = [];
  for (let d = 0; d <= 6; d++) {
    const v = draft[d];
    if (!v?.on) continue;
    if (!HHMM.test(v.from) || !HHMM.test(v.to) || v.from >= v.to) {
      return { ok: false, badDay: d };
    }
    rows.push({ weekday: d, start_time: v.from, end_time: v.to });
  }
  return { ok: true, rows, empty: rows.length === 0 };
}
