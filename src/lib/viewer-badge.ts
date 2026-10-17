import { needsCustomer } from "@/lib/activity";
import { beirutDay } from "@/lib/attendance";

// The badge arithmetic behind /api/me, kept apart from lib/viewer.ts so the
// client island (which imports viewer.ts) does not pull lib/activity.ts into
// every page bundle.

/** Rows the badge count reads — the minimum columns `needsCustomer` uses. */
export type ActionableRows = {
  /** Completed orders (status filtered in SQL, kept here for safety). */
  orders?: { status: string; store_id: string | null; updated_at?: string | null }[] | null;
  bookings?: { status: string; requested_date: string | null }[] | null;
  stays?: { status: string; check_in: string | null; check_out: string | null }[] | null;
  rentals?: { status: string; pickup_date: string | null; return_date: string | null }[] | null;
  crafts?:
    | {
        status: string;
        craft_reviews?: { id: string }[] | { id: string } | null;
      }[]
    | null;
  /** Head counts: for these kinds the status alone decides. */
  quotedServices?: number | null;
  rejectedListings?: number | null;
  reviewedStoreIds?: readonly string[] | null;
};

function reviewedCraft(v: { id: string }[] | { id: string } | null | undefined) {
  if (!v) return false;
  return Array.isArray(v) ? v.length > 0 : Boolean(v.id);
}

/**
 * The طلباتي badge: how many things are the customer's move. Same rule as the
 * activity screen (lib/activity.ts `needsCustomer`), fed by a handful of
 * status-filtered, column-minimal reads instead of the full eleven-table list.
 */
export function countActionable(rows: ActionableRows, nowMs: number): number {
  const today = beirutDay(nowMs);
  const reviewed = new Set(rows.reviewedStoreIds ?? []);
  let n = 0;
  for (const o of rows.orders ?? []) {
    if (
      needsCustomer("order", o.status, {
        today,
        reviewed: o.store_id ? reviewed.has(o.store_id) : false,
        finishedAt: o.updated_at ?? null,
        nowMs,
      })
    )
      n++;
  }
  for (const b of rows.bookings ?? []) {
    if (needsCustomer("booking", b.status, { today, startsOn: b.requested_date }))
      n++;
  }
  for (const s of rows.stays ?? []) {
    if (
      needsCustomer("stay", s.status, {
        today,
        startsOn: s.check_in,
        endsOn: s.check_out,
      })
    )
      n++;
  }
  for (const r of rows.rentals ?? []) {
    if (
      needsCustomer("rental", r.status, {
        today,
        startsOn: r.pickup_date,
        endsOn: r.return_date,
      })
    )
      n++;
  }
  for (const c of rows.crafts ?? []) {
    if (
      needsCustomer("craft", c.status, {
        today,
        reviewed: reviewedCraft(c.craft_reviews),
      })
    )
      n++;
  }
  n += Math.max(0, rows.quotedServices ?? 0);
  n += Math.max(0, rows.rejectedListings ?? 0);
  return n;
}
