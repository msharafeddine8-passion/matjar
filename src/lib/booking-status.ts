// Pure rules shared by the merchant booking / stay status controls.

/** Statuses that tell a customer "no" or close the booking for good. The
 *  select changed them on a single mis-tap; they now ask first. */
const CONFIRM_STATUSES = new Set(["rejected", "declined", "cancelled", "no_show"]);

export function statusNeedsConfirm(next: string): boolean {
  return CONFIRM_STATUSES.has(next);
}

export type StatusErrorKind = "classFull" | "conflict" | "generic";

/**
 * What a failed status change means, from the Postgres error.
 *  - `class_full` (0275 trigger): re-accepting into a class with no seats left.
 *  - 23P01 (exclusion constraint, 0174 range bookings) / 23505 (unique slot,
 *    0275): another booking already holds that time.
 */
export function statusErrorKind(
  err: { code?: string | null; message?: string | null } | null | undefined,
): StatusErrorKind {
  if (!err) return "generic";
  if ((err.message ?? "").toLowerCase().includes("class_full")) return "classFull";
  if (err.code === "23P01" || err.code === "23505") return "conflict";
  return "generic";
}
