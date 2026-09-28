import type { SupabaseClient } from "@supabase/supabase-js";

// The merchant's internal note on an order (P2-PRIV-04).
//
// It used to live in orders.store_note, and orders_select lets the ordering
// customer read their own order row — every column of it, because column
// privileges are per role and merchant and customer are both `authenticated`.
// The UI never showed the note to the customer; the API handed it over.
//
// Migration 0314 moves it to public.order_staff_notes, readable and writable
// only under staff_can(store_id, 'orders') (the owner always passes). The old
// column stays, always NULL: a BEFORE trigger on orders turns any write to it
// into a write to the new table and blanks the column, so a browser still
// running the previous build keeps working and the customer only ever reads
// NULL there.
//
// BEFORE 0314 the table does not exist: reads fall back to orders.store_note
// (which the orders page still selects), writes fall back to updating it.

export const STAFF_NOTE_MAX = 2000;

/** Trimmed note, or null for "no note". Pure. */
export function cleanStaffNote(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v === "" ? null : v.slice(0, STAFF_NOTE_MAX);
}

/**
 * The note to show for one order: the staff-notes table wins, the legacy
 * column is the fallback (pre-0314, or an order nobody has re-saved). Pure.
 */
export function pickStaffNote(
  fromTable: ReadonlyMap<string, string>,
  orderId: string,
  legacy: string | null | undefined,
): string | null {
  return fromTable.get(orderId) ?? cleanStaffNote(legacy);
}

/** order_id → note for one store. Empty map when the table is not there yet. */
export async function loadStaffNotes(
  supabase: SupabaseClient,
  storeId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from("order_staff_notes")
      .select("order_id, note")
      .eq("store_id", storeId)
      .limit(5000);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as { order_id: string; note: string | null }[]) {
      const note = cleanStaffNote(row.note);
      if (note) out.set(row.order_id, note);
    }
  } catch {
    // no table yet, or unreachable: the legacy column still renders
  }
  return out;
}

/**
 * Save (or clear, with an empty string) the note. Tries the staff-only table
 * first; if that table does not exist yet (before 0314) it writes the legacy
 * column exactly as the previous build did. Returns whether it worked.
 */
export async function saveStaffNote(
  supabase: SupabaseClient,
  args: { orderId: string; storeId: string; note: string },
): Promise<boolean> {
  const note = cleanStaffNote(args.note);
  const table = note
    ? await supabase
        .from("order_staff_notes")
        .upsert(
          { order_id: args.orderId, store_id: args.storeId, note },
          { onConflict: "order_id" },
        )
    : await supabase.from("order_staff_notes").delete().eq("order_id", args.orderId);
  if (!table.error) return true;
  if (!isMissingTable(table.error)) return false;
  const legacy = await supabase
    .from("orders")
    .update({ store_note: note })
    .eq("id", args.orderId);
  return !legacy.error;
}

/** PostgREST "relation not in the schema cache" (PGRST205) or Postgres 42P01. */
export function isMissingTable(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
