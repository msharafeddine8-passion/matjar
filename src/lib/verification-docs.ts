import type { SupabaseClient } from "@supabase/supabase-js";

// Verification document scans (P1-PRIV-02).
//
// A Lebanese commercial registration — the paper most merchants photograph for
// this — carries the owner's full name, ID number and home address. Until 0314
// the scan went to the PUBLIC store-assets bucket, so anyone holding the URL
// could open it. From 0314 it goes to the PRIVATE `verification-docs` bucket
// and store_verification_docs.doc_url holds the object PATH, not a URL:
//
//   <store_id>/<random>.<ext>
//
// The first segment is what the bucket policy keys on: the store's owner and
// staff and admins holding the 'verifications' section may read, only the
// owner may write. A reader turns the path into a short-lived signed URL on
// the server, under their own session, at render time.
//
// Rows written before 0314 may still hold a full https:// public URL. They are
// read as they are (0 such rows existed when 0314 was written; the constraint
// that forbids new ones is NOT VALID so it leaves any old one alone).

export const VERIFICATION_DOCS_BUCKET = "verification-docs";

/** Seconds a signed link stays valid: long enough to open the page and click,
 *  short enough that a forwarded link is dead by the time it is forwarded. */
export const VERIFICATION_DOC_LINK_SECONDS = 600;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DocRef =
  | { kind: "private"; path: string }
  | { kind: "legacy-url"; url: string };

/** Object path for a new upload. The ext is sanitised to what the bucket takes. */
export function verificationDocPath(storeId: string, id: string, ext: string): string {
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(clean) ? clean : "jpg";
  return `${storeId}/${id}.${safeExt}`;
}

/**
 * What a stored doc_url value is. Mirrors the 0314 CHECK constraint: a private
 * path is `<uuid>/<name>` with no scheme and no "..". Anything else that is not
 * an http(s) URL is refused (null) rather than guessed at.
 */
export function classifyDocRef(value: string | null | undefined): DocRef | null {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return { kind: "legacy-url", url: v };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.includes("..") || v.startsWith("/")) {
    return null;
  }
  const [first, ...rest] = v.split("/");
  if (!UUID_RE.test(first) || rest.length === 0 || rest.some((s) => s === "")) {
    return null;
  }
  return { kind: "private", path: v };
}

/** True when the path belongs to this store (the first segment is its id). */
export function docPathBelongsTo(path: string, storeId: string): boolean {
  const ref = classifyDocRef(path);
  return ref?.kind === "private" && ref.path.split("/")[0].toLowerCase() === storeId.toLowerCase();
}

/**
 * doc_url values → a URL the viewer can open. Legacy public URLs pass through;
 * private paths are signed in ONE call under the caller's session (the bucket
 * policy decides). A value that cannot be signed is simply absent from the
 * map — the screen then shows "no document" instead of a broken link.
 * Keyed by the TRIMMED stored value; look up with docUrlFor().
 */
export async function resolveDocUrls(
  supabase: SupabaseClient,
  values: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const paths: string[] = [];
  for (const value of values) {
    const ref = classifyDocRef(value);
    if (!ref) continue;
    if (ref.kind === "legacy-url") out.set(ref.url, ref.url);
    else paths.push(ref.path);
  }
  const unique = [...new Set(paths)];
  if (unique.length === 0) return out;
  try {
    const { data, error } = await supabase.storage
      .from(VERIFICATION_DOCS_BUCKET)
      .createSignedUrls(unique, VERIFICATION_DOC_LINK_SECONDS);
    if (error || !data) return out;
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
    }
  } catch {
    // Bucket missing (before 0314) or storage unreachable: no links, no crash.
  }
  return out;
}

/** The openable URL for one stored doc_url, from a resolveDocUrls() map. */
export function docUrlFor(
  urls: ReadonlyMap<string, string>,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return urls.get(value.trim()) ?? null;
}
