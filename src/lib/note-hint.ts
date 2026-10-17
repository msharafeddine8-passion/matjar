// What to suggest a customer might write in the note field on a product.
//
// The hint was a single string written for restaurants — "e.g. no onions, extra
// spicy". On a cotton T-shirt that is not a small mismatch: it tells the shopper
// the platform was built for someone else, on the one screen where they are
// deciding whether to trust it with an order.
//
// Only the sectors that sell something a note can meaningfully change get their
// own. The rest fall back to a neutral prompt rather than an invented one —
// a wrong example is worse than a plain one.

import { isCategoryKey, type CategoryKey } from "@/lib/catalog";

export type NoteHintKey =
  | "default"
  | "food"
  | "retail"
  | "pharmacy"
  | "farm"
  | "petCare"
  | "automotive"
  | "beauty";

const BY_SECTOR: Partial<Record<CategoryKey, NoteHintKey>> = {
  food: "food",
  retail: "retail",
  pharmacy: "pharmacy",
  farm: "farm",
  petCare: "petCare",
  automotive: "automotive",
  beauty: "beauty",
};

/** Unknown or note-less sectors get the neutral prompt.
 *
 *  Checked with `isCategoryKey`, not narrowed with `toCategoryKey`: the fallback
 *  that belongs here is the neutral prompt, not retail's. Sending an
 *  unrecognised sector through `toCategoryKey` would hand a shopper retail's
 *  hint — an invented example, which is the exact failure this table exists to
 *  avoid. Same result as the old assertion, minus the assertion. */
export function noteHintKey(
  category?: string | null,
  /** The offering's CTA. «أضف إلى الطلب» means a dish on a menu, whatever
   *  sector row the store sits under, so it gets the kitchen example. */
  cta?: string | null,
): NoteHintKey {
  if (cta === "addToOrder") return "food";
  if (!isCategoryKey(category)) return "default";
  return BY_SECTOR[category] ?? "default";
}
