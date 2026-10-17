// store_audience_counts(p_store_id) (0334) — the campaign audience sizes,
// counted by the database. The page used to count `follows` itself, but RLS
// only lets a user read their OWN follow row, so every merchant saw 0
// followers. The RPC returns null when the caller lacks the orders permission.

export const AUDIENCE_KEYS = [
  "followers",
  "customers",
  "all",
  "repeat",
  "vip",
  "inactive",
] as const;
export type AudienceKey = (typeof AUDIENCE_KEYS)[number];
export type AudienceCounts = Record<AudienceKey, number>;

/** The RPC's jsonb as counts, or null when it is missing/unusable (the caller
 *  then falls back to its previous behaviour). Missing keys count as 0;
 *  negative or non-numeric values make the whole answer unusable. */
export function parseAudienceCounts(raw: unknown): AudienceCounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!AUDIENCE_KEYS.some((k) => k in o)) return null;
  const out = {} as AudienceCounts;
  for (const k of AUDIENCE_KEYS) {
    const v = o[k] == null ? 0 : Number(o[k]);
    if (!Number.isFinite(v) || v < 0) return null;
    out[k] = Math.floor(v);
  }
  return out;
}
