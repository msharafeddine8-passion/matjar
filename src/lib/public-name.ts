// The name a person shows in PUBLIC — on a review, a product question — is
// their own name or nothing. Several forms filled it with
// `full_name ?? user.email`, so anyone without a name on their profile would
// have published their email address under their review. Nothing had leaked
// yet (0 of the stored names contain "@", checked 2026-09-29); this keeps it so.
//
// An empty name is fine: the review card renders «زبون» for it.

/** A name safe to publish: trimmed, capped, and never an email address. */
export function safePublicName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n || n.includes("@")) return "";
  return n.slice(0, 80);
}
