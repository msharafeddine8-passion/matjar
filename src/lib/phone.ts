// Turning a Lebanese phone number into something wa.me will actually open.
//
// Every WhatsApp link in the app was built as `wa.me/${phone.replace(/\D/g,"")}`,
// which for a number stored the way Lebanese merchants type it — 03709064,
// 81457806, 71757701 — produces wa.me/03709064. WhatsApp cannot resolve that:
// the link needs a full international number, and every one of those buttons
// has been opening a dead page.
//
// Rules, in the order they apply:
//   already international (starts 961, long enough)  → leave alone
//   local with a trunk zero  (03709064)              → 961 + 3709064
//   local without one        (81457806)              → 961 + 81457806
//
// Returns null when there is nothing dialable, so callers can hide the button
// rather than render a link to nowhere.
const LB = "961";

// A Lebanese national number is 7 or 8 digits once the trunk zero is gone: a
// mobile is a two-digit prefix (03, 70, 71, 76, 78, 79, 81) plus six, a landline
// a one-digit area code plus six.
const NATIONAL_MIN = 7;
const NATIONAL_MAX = 8;

export function waNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");

  // "00" is the international access prefix, dialled from a landline. Stored as
  // 0096171627323, the old code saw a leading zero, stripped exactly one, and
  // produced 961096171627323 — fifteen digits resolving nowhere.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Strip the country code only when what remains could be a national number.
  // The length test is doing real work, not defensive padding: Keserwan's area
  // code is 09, so 09612345 is a valid local number whose digits begin 961 the
  // moment the trunk zero comes off. Stripping on the prefix alone would leave
  // 2345.
  //   961 + 7       = 10     961 3434661
  //   961 + 8       = 11     961 71627323
  //   961 + 0 + 7/8 = 11/12  a trunk zero left in behind the country code
  if (
    digits.startsWith(LB) &&
    digits.length >= LB.length + NATIONAL_MIN &&
    digits.length <= LB.length + NATIONAL_MAX + 1
  ) {
    digits = digits.slice(LB.length);
  }

  // Now the trunk zero — which can also sit *after* a country code, when a
  // merchant types +961 03 434661. The old code only looked at the very front,
  // so that number went out as 96103434661 and WhatsApp could not resolve it.
  digits = digits.replace(/^0+/, "");

  // Outside the national range it is not a number that rings. Returning null
  // hides the button, which is the honest outcome: one live store is stored as
  // +961102164 — six national digits — and no amount of prefixing fixes that.
  if (digits.length < NATIONAL_MIN || digits.length > NATIONAL_MAX) return null;

  return LB + digits;
}

/**
 * THE wa.me URL builder. Every WhatsApp link in the app — this file's waLink,
 * the compatibility waLink in lib/whatsapp.ts and the action templates in
 * lib/wa-templates.ts — ends here, so there is one place that decides what a
 * click-to-chat link looks like. `digits` is already normalised (waNumber), or
 * "" for WhatsApp's own "choose a chat" picker.
 */
export function waUrl(digits: string, text?: string): string {
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Full wa.me URL, or null when the number cannot be dialled. */
export function waLink(
  raw: string | null | undefined,
  text?: string,
): string | null {
  const n = waNumber(raw);
  if (!n) return null;
  return waUrl(n, text);
}

/** What is wrong with a number a person just typed, or null when nothing is. */
export type PhoneIssue = "missing" | "tooShort" | "notDialable";

/**
 * Validation for the moment a phone number is *entered*, as opposed to
 * `waNumber`, which is about rendering a link from one already stored.
 *
 * Deliberately two levels rather than one, because the cost of a false
 * rejection here is a lost order:
 *
 *  - `tooShort` is not a phone number by any reading, and is worth blocking.
 *    Checkout's field was `required` with no format check at all, so a customer
 *    could type "123" and place a cash-on-delivery order the merchant can never
 *    deliver — a wasted trip for him and a sale that was never going to happen.
 *  - `notDialable` means it has enough digits to be a phone, but not one this
 *    app can turn into a wa.me link — a foreign number, most often. That is a
 *    warning, never a block. Somebody in the diaspora ordering for family in
 *    Lebanon is a real customer, and refusing their number because it is not
 *    +961 would be the app deciding it knows better than the person typing.
 */
export function phoneIssue(raw: string | null | undefined): PhoneIssue | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "missing";
  if (digits.length < 7) return "tooShort";
  if (!waNumber(raw)) return "notDialable";
  return null;
}
