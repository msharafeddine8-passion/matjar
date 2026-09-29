// Sunday Market renew cooldown — the app's copy of the rule in migration 0317.
//
// Renewing a listing moves it to the top of "newest". guard_listing_write only
// accepts the new date when the listing is at least RENEW_COOLDOWN_DAYS old; a
// sooner attempt silently keeps the old date. The seller's screen uses this to
// disable the button and say when it opens, so the database rule never has to
// surprise anyone. Keep the two numbers equal (__tests__/market-renew.test.ts
// reads the migration and fails if they drift).

export const RENEW_COOLDOWN_DAYS = 7;

const DAY_MS = 86_400_000;

/** When this listing may be renewed again, or null if it may be now. */
export function renewOpensAt(createdAt: string | Date, now: Date = new Date()): Date | null {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(created.getTime())) return null;
  const opens = new Date(created.getTime() + RENEW_COOLDOWN_DAYS * DAY_MS);
  return opens.getTime() > now.getTime() ? opens : null;
}
