// What went wrong when a merchant pressed «إنشاء المتجر», as a dictionary key.
//
// The form used to print `${createFailed} (${error.message})`, which put raw
// English Postgres text — "new row violates row-level security policy for
// table \"stores\"" — inside an Arabic screen, in front of the one person least
// able to act on it. Each failure the insert can actually produce is named
// here; anything else becomes the generic message and the raw error goes to
// the console only (see store-form.tsx).
//
// A 23505 can come from the name OR the slug unique index, so the slug
// constraint is matched by name first.
export type StoreCreateErrorKey =
  | "customLinkTaken"
  | "customLinkReserved"
  | "customLinkInvalid"
  | "storeNameTaken"
  | "createNotAllowed"
  | "createInvalid"
  | "createNetwork"
  | "createFailed";

export function storeCreateErrorKey(
  error: { code?: string | null; message?: string | null } | null | undefined,
): StoreCreateErrorKey {
  const msg = error?.message ?? "";
  const code = error?.code ?? "";
  if (msg.includes("stores_slug_unique")) return "customLinkTaken";
  if (msg.includes("slug_reserved")) return "customLinkReserved";
  if (msg.includes("slug_invalid")) return "customLinkInvalid";
  if (code === "23505") return "storeNameTaken";
  // RLS refusal, or an expired JWT the client could not refresh.
  if (code === "42501" || code === "PGRST301" || /JWT/i.test(msg))
    return "createNotAllowed";
  // check / not-null / value-too-long / bad enum or uuid text.
  if (["23514", "23502", "22001", "22P02"].includes(code)) return "createInvalid";
  // supabase-js surfaces a dropped connection as a fetch TypeError message.
  if (/failed to fetch|network|load failed/i.test(msg)) return "createNetwork";
  return "createFailed";
}
