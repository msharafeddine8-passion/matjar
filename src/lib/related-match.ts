/**
 * "Is this other item plausibly the same kind of thing?" — for the
 * «منتجات مشابهة» rail on a product page.
 *
 * The rail used to match on the store's sector alone, and a sector is wide:
 * a butcher and a soap shop are both `retail`, so a butcher's sausages
 * recommended soap. There is no cross-store product taxonomy to lean on
 * (products carry a store-local `section_id` and nothing else), so the rule is
 * deliberately plain and deterministic:
 *
 *   1. the same section of the same store,
 *   2. then other items of the same store whose name shares a word with this one,
 *   3. then items of other stores in the same sector whose name shares a word.
 *
 * Anything that shares no word with the item is not "similar", whatever its
 * sector — an empty rail is better than a wrong one.
 *
 * Pure: no Supabase, no Next — so it is unit-tested directly.
 */

const STOPWORD_LIST = [
  // Arabic function words and very common filler in product names.
  "من",
  "مع",
  "على",
  "في",
  "عن",
  "الى",
  "او",
  "حبة",
  "كيلو",
  "غرام",
  "علبة",
  // English.
  "the",
  "and",
  "with",
  "for",
  "from",
  "pack",
  "size",
  "new",
];

/** Arabic-aware lower-casing: strip diacritics and tatweel, fold the alef,
 *  ta-marbuta and alef-maqsura variants that the same word is typed with. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

// Compared after normalisation, so the list is normalised the same way.
const STOPWORDS = new Set(STOPWORD_LIST.map(normalizeForMatch));

function stem(token: string): string {
  // «السجق» and «سجق» are the same word.
  if (token.startsWith("ال") && token.length >= 5) return token.slice(2);
  // "sausages" / "sausage".
  if (/^[a-z]+$/.test(token) && token.length > 3 && token.endsWith("s"))
    return token.slice(0, -1);
  return token;
}

/** The meaningful words of one or more names (e.g. the Arabic and English
 *  name of the same item). Words under 3 letters, pure numbers and stopwords
 *  carry no "kind of thing" signal and are dropped. */
export function nameTokens(
  ...names: (string | null | undefined)[]
): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    for (const raw of normalizeForMatch(name).split(/[^\p{L}\p{N}]+/u)) {
      if (raw.length < 3 || /^\p{N}+$/u.test(raw) || STOPWORDS.has(raw))
        continue;
      const t = stem(raw);
      if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t);
    }
  }
  return out;
}

/** Whether any of `names` shares a meaningful word with `tokens`. */
export function sharesNameToken(
  tokens: Set<string>,
  ...names: (string | null | undefined)[]
): boolean {
  if (tokens.size === 0) return false;
  for (const t of nameTokens(...names)) if (tokens.has(t)) return true;
  return false;
}

export type SimilarCandidate = {
  id: string;
  name: string;
  nameEn: string | null;
  storeId: string;
  sectionId: string | null;
};

/** Ranks and filters candidates by the three tiers above. Order within a
 *  tier is the order the candidates arrived in (the query's own order), so
 *  the result is deterministic for a given input. */
export function pickSimilar<T extends SimilarCandidate>(
  self: {
    id: string;
    storeId: string;
    sectionId: string | null;
    name: string;
    nameEn: string | null;
  },
  candidates: T[],
  limit: number,
): T[] {
  const tokens = nameTokens(self.name, self.nameEn);
  const sameSection: T[] = [];
  const sameStore: T[] = [];
  const otherStores: T[] = [];
  const seen = new Set<string>([self.id]);
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    const shares = sharesNameToken(tokens, c.name, c.nameEn);
    if (c.storeId === self.storeId) {
      if (self.sectionId && c.sectionId === self.sectionId) sameSection.push(c);
      else if (shares) sameStore.push(c);
      else continue;
    } else if (shares) {
      otherStores.push(c);
    } else continue;
    seen.add(c.id);
  }
  return [...sameSection, ...sameStore, ...otherStores].slice(0, limit);
}
