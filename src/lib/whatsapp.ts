import { waNumber, waUrl } from "@/lib/phone";

// WhatsApp is the dominant ordering channel in Lebanon. These helpers build a
// click-to-chat link with a pre-filled message — no backend, no API.

/** Build a wa.me link to a phone number with a pre-filled message.
 *
 *  Compatibility wrapper over lib/phone's builder — there is ONE wa.me
 *  implementation (phone.ts `waUrl`), and new code should import `waLink` from
 *  "@/lib/phone". This one survives for its existing callers because its
 *  contract differs in one deliberate way: it never returns null. An
 *  undialable number falls back to its bare digits, and "" opens WhatsApp's
 *  own chat picker (order-dispatch uses that to let the merchant choose).
 *
 *  Normalisation lives in lib/phone so this and every other WhatsApp button on
 *  the platform agree. Stripping non-digits alone was not enough: a merchant
 *  who stored 03709064 got wa.me/03709064, which WhatsApp cannot resolve. The
 *  old test only covered "+961 70 123 456" — already international — which is
 *  exactly why nobody noticed. */
export function waLink(phone: string, text: string): string {
  const n = waNumber(phone) ?? phone.replace(/[^0-9]/g, "");
  return waUrl(n, text);
}

export type WaLine = { name: string; qty: number; lineTotal: string };

/** Compose an order message: greeting + store, line items, total, optional address. */
export function buildOrderMessage(opts: {
  greeting: string;
  storeName: string;
  lines: WaLine[];
  totalLabel: string;
  total: string;
  address?: string | null;
}): string {
  const parts = [`${opts.greeting} ${opts.storeName}`, ""];
  for (const l of opts.lines) {
    parts.push(`• ${l.name} ×${l.qty} — ${l.lineTotal}`);
  }
  parts.push("", `${opts.totalLabel}: ${opts.total}`);
  if (opts.address) parts.push(opts.address);
  return parts.join("\n");
}
