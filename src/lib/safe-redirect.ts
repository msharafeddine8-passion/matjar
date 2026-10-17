// Where an auth route may send someone after it has signed them in.
//
// Both auth routes take a `next` parameter from the link that brought the
// visitor there, and both used to vet it with string prefixes:
// `startsWith("/") && !startsWith("//")` in /auth/confirm, `startsWith("/")`
// alone in /callback. Prefixes are not how a browser reads a URL. `next=/%09/evil.com`
// arrives decoded as "/\t/evil.com", passes both checks, and the URL parser then
// strips the tab and resolves "//evil.com" — a protocol-relative URL to
// somebody else's site, handed a visitor who has just authenticated.
//
// So the question is asked the way the browser will answer it: resolve the
// value against our own origin and keep it only if it is still our origin.
// Control characters and backslashes are refused before that, because the URL
// parser silently drops or rewrites them (a backslash is a slash to it), and a
// value that only becomes safe after being rewritten was not a path to begin
// with.
//
// Returns pathname + search of the resolved URL, or `fallback`.
export function safeRedirectPath(
  next: string | null | undefined,
  origin: string,
  fallback: string,
): string {
  if (!next) return fallback;
  // C0 controls (tab, CR, LF …), DEL, and backslashes.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  // A same-site path is all this ever needs to accept. Absolute URLs and
  // protocol-relative ones are refused outright rather than parsed.
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;

  let base: URL;
  let resolved: URL;
  try {
    base = new URL(origin);
    resolved = new URL(next, base);
  } catch {
    return fallback;
  }
  if (resolved.origin !== base.origin) return fallback;
  return `${resolved.pathname}${resolved.search}`;
}
