import type { SupabaseClient } from "@supabase/supabase-js";

// The private columns of public.stores, read the one way that works both
// before and after migration 0314.
//
// 0314 revokes SELECT on these columns from every client role (see
// STORE_PRIVATE_COLUMNS in src/lib/store-columns.ts) and adds
// public.store_private_fields(uuid[]), a SECURITY DEFINER getter that returns a
// row only for a store the caller owns, works at, or administers:
//
//   legal_name, tax_no, legal_address, commercial_reg_no, invoice_prefix
//                      → owner, any staff member (they print invoices), and
//                        admin_can('stores')
//   status_reason      → owner and admin_can('stores')
//   status_changed_by  → admin_can('stores') only (which admin acted)
//
// BEFORE 0314 the function does not exist and the columns are still readable,
// so this falls back to a plain select of them. After it, the plain select
// would be refused (42501) — but by then the RPC answers. Either failure mode
// degrades to "no private fields", never to a crash: the pages render without
// the legal block rather than redirecting away.

export type StorePrivateFields = {
  legal_name: string | null;
  tax_no: string | null;
  legal_address: string | null;
  commercial_reg_no: string | null;
  invoice_prefix: string | null;
  status_reason: string | null;
  status_changed_by: string | null;
};

export const EMPTY_PRIVATE_FIELDS: StorePrivateFields = {
  legal_name: null,
  tax_no: null,
  legal_address: null,
  commercial_reg_no: null,
  invoice_prefix: null,
  status_reason: null,
  status_changed_by: null,
};

const FIELD_NAMES = Object.keys(EMPTY_PRIVATE_FIELDS) as (keyof StorePrivateFields)[];

/** The pre-0314 fallback projection. Kept in step with the getter's columns. */
export const PRIVATE_FALLBACK_SELECT = ["id", ...FIELD_NAMES].join(", ");

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Rows from either source → id-keyed map. Pure; unknown shapes are dropped. */
export function toPrivateFieldsMap(rows: unknown): Map<string, StorePrivateFields> {
  const out = new Map<string, StorePrivateFields>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    const fields = { ...EMPTY_PRIVATE_FIELDS };
    for (const k of FIELD_NAMES) fields[k] = textOrNull(r[k]);
    out.set(r.id, fields);
  }
  return out;
}

/** Ids per round trip. The RPC takes them in a POST body, but the pre-0314
 *  fallback puts them in an `.in()` filter, which travels in the URL. */
const CHUNK = 150;

/** Private fields for the given stores, under the caller's own session. */
export async function fetchStorePrivateFields(
  supabase: SupabaseClient,
  storeIds: readonly string[],
): Promise<Map<string, StorePrivateFields>> {
  const ids = [...new Set(storeIds.filter(Boolean))];
  const out = new Map<string, StorePrivateFields>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await fetchChunk(supabase, ids.slice(i, i + CHUNK));
    for (const [k, v] of part) out.set(k, v);
  }
  return out;
}

async function fetchChunk(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, StorePrivateFields>> {
  try {
    const { data, error } = await supabase.rpc("store_private_fields", {
      p_store_ids: ids,
    });
    if (!error) return toPrivateFieldsMap(data);
    // Before 0314: no such function, but the columns are still granted.
    const fallback = await supabase
      .from("stores")
      .select(PRIVATE_FALLBACK_SELECT)
      .in("id", ids);
    return fallback.error ? new Map() : toPrivateFieldsMap(fallback.data);
  } catch {
    return new Map();
  }
}

/** One store's private fields, or all-null. */
export async function fetchOneStorePrivateFields(
  supabase: SupabaseClient,
  storeId: string,
): Promise<StorePrivateFields> {
  const map = await fetchStorePrivateFields(supabase, [storeId]);
  return map.get(storeId) ?? { ...EMPTY_PRIVATE_FIELDS };
}
