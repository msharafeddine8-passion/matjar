// Storefront SECTIONS — grouping helper shared by the cart storefront and the
// booking panel. A store groups its catalog into named sections so the page
// opens according to its type (food → menu, retail → collections, clinic →
// service groups…). Grouping is display-only: callers keep the full flat product
// array for cart/total logic and use this purely to partition for rendering.

export type SectionInfo = {
  id: string;
  name: string;
  nameEn: string | null;
  sortOrder: number;
};

export type SectionGroup<T> = {
  // null → the generic "Other" bucket for unsectioned products.
  section: SectionInfo | null;
  items: T[];
};

// Partition products into ordered groups. Sections render in sort_order; any
// product with no (or an unknown) section_id collects into a trailing null
// group. Empty sections are dropped. When the store has no sections the result
// is a single null group holding every product — callers render that as one
// flat list with no headers (no regression for stores that never opt in).
export function groupBySection<T extends { sectionId?: string | null }>(
  products: T[],
  sections: SectionInfo[],
): SectionGroup<T>[] {
  if (sections.length === 0) return [{ section: null, items: products }];

  const ordered = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const known = new Set(ordered.map((s) => s.id));
  const groups: SectionGroup<T>[] = [];

  for (const s of ordered) {
    const items = products.filter((p) => p.sectionId === s.id);
    if (items.length) groups.push({ section: s, items });
  }

  const other = products.filter(
    (p) => !p.sectionId || !known.has(p.sectionId),
  );
  if (other.length) groups.push({ section: null, items: other });

  return groups;
}

/**
 * A flat picker (the booking panel's service <select>) in the order the
 * catalogue shows: by section position — unsectioned items last, as in
 * groupBySection — then alphabetically by the name the customer reads. The
 * array the server hands over is in id order, which is no order at all.
 */
export function orderForPicker<T extends { sectionId?: string | null }>(
  items: T[],
  sections: SectionInfo[],
  nameOf: (item: T) => string,
  locale: string,
): T[] {
  const rank = new Map(sections.map((s) => [s.id, s.sortOrder]));
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const pos = (it: T) =>
    it.sectionId != null && rank.has(it.sectionId)
      ? (rank.get(it.sectionId) as number)
      : Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => {
    const pa = pos(a);
    const pb = pos(b);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return collator.compare(nameOf(a), nameOf(b));
  });
}
