/**
 * Why the visitor was sent to /login, so the page can say it in one line
 * instead of a generic "welcome back". Read from `?reason=` when the sender
 * set one (the market's «راسل البائع» does), otherwise inferred from `?next=`.
 * Unknown → null: no line at all rather than a guessed one.
 */
export type LoginReason = "message" | "favorites" | "activity" | "crafts";

export function loginReason(
  reason: string | null | undefined,
  next: string | null | undefined,
): LoginReason | null {
  if (reason === "message") return "message";
  if (!next || !next.startsWith("/")) return null;
  // Strip the locale prefix: /ar/favorites -> /favorites.
  const path = next.replace(/^\/(ar|en)(?=\/|$)/, "");
  if (/^\/messages(\/|$)/.test(path)) return "message";
  if (/^\/favorites(\/|$)/.test(path)) return "favorites";
  if (/^\/(activity|bookings|inquiries|orders)(\/|$)/.test(path)) return "activity";
  if (/^\/crafts(\/|$)/.test(path)) return "crafts";
  return null;
}
