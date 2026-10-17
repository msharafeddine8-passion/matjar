// One customer, however their number was typed.
//
// store_customer_order_totals groups a guest on the raw `orders.phone` text, and
// the bookings fold on this page keyed the same way — so «03 123456»,
// «03123456» and «+961 3 123456» were three customers with three order counts,
// none of them the real one. Here every row gets a canonical phone (the same
// normalisation the WhatsApp buttons use, else digits only) and rows that share
// either an account id or a canonical phone fold into one.

import { waNumber } from "@/lib/phone";

export type CrmRow = {
  name: string | null;
  phone: string | null;
  count: number;
  total: number;
  customerId: string | null;
  lastOrder: string | null;
};

/** The key two spellings of one Lebanese number share. null = no number. */
export function normalizePhoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const wa = waNumber(raw);
  if (wa) return wa;
  const digits = raw.replace(/\D/g, "");
  return digits.length ? digits : null;
}

/**
 * Folds rows into one per person. Two rows are the same person when they share
 * an account id or a canonical phone; counts and spend add up, the newest
 * activity wins, and the first name / phone / account seen is kept.
 * Rows with neither an account nor a phone are all the anonymous walk-in and
 * fold into one row, as the RPC already does.
 */
export function mergeCrmRows(rows: readonly CrmRow[]): CrmRow[] {
  const out: CrmRow[] = [];
  const byKey = new Map<string, CrmRow>();
  for (const r of rows) {
    const keys: string[] = [];
    if (r.customerId) keys.push(`u:${r.customerId}`);
    const p = normalizePhoneKey(r.phone);
    if (p) keys.push(`p:${p}`);
    if (keys.length === 0) keys.push("anon");

    const hit = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!hit) {
      const fresh: CrmRow = { ...r };
      out.push(fresh);
      for (const k of keys) byKey.set(k, fresh);
      continue;
    }
    hit.count += r.count;
    hit.total = Math.round((hit.total + r.total) * 100) / 100;
    if (!hit.name && r.name) hit.name = r.name;
    if (!hit.phone && r.phone) hit.phone = r.phone;
    if (!hit.customerId && r.customerId) hit.customerId = r.customerId;
    if (r.lastOrder && (!hit.lastOrder || r.lastOrder > hit.lastOrder)) {
      hit.lastOrder = r.lastOrder;
    }
    for (const k of keys) if (!byKey.has(k)) byKey.set(k, hit);
  }
  return out;
}
