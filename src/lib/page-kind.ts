// 0344. A store opened as ONE page: a digital menu, a landing page, or the page
// of a single book, product or course. The storefront then shows only the
// identity block (cover, logo, name, description), the items, and the ways to
// get in touch — no reviews, hours, map, branches, tabs or directory furniture.
export const PAGE_KINDS = ["menu", "landing", "book", "product", "course"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export function toPageKind(v: unknown): PageKind | null {
  return (PAGE_KINDS as readonly unknown[]).includes(v) ? (v as PageKind) : null;
}

/** Sections a single page keeps, in the sector's own order. */
export const SINGLE_PAGE_SECTIONS: ReadonlySet<string> = new Set([
  "header", "summary", "catalog", "courses", "leadForm", "serviceRequest",
]);

/** How the items are laid out: a menu reads as rows, a single item as a big card. */
export function pageKindLayout(kind: PageKind): "menu" | "showcase" | null {
  if (kind === "menu") return "menu";
  if (kind === "landing") return null;
  return "showcase";
}
