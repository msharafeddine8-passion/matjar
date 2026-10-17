import Link from "next/link";
import type { Dictionary } from "@/i18n/get-dictionary";
import { categoryStyles, type CategoryKey } from "@/lib/catalog";
import type { FacetOption } from "@/lib/discovery";
import { categoryIcons } from "@/components/category-icon";
import { CountText } from "@/components/ui/count-text";
import type { CountForms } from "@/lib/plural";

/**
 * Browse-by-sector, as a grid a thumb can hit.
 *
 * Two screens need the same block and neither should invent it: the search
 * screen, where somebody has opened search without knowing the word yet, and
 * /explore, where "discovery" has to mean something other than a wall of cards.
 *
 * Every tile carries a live count and no tile exists without one. `options`
 * comes from sectorOptions(), which has already dropped every sector with zero
 * stores, so this component cannot render a door into an empty room — the
 * failure that made the old nine-tile category grid read as broken. It states
 * the number rather than a mood: a buyer can see "1" and decide.
 */
export function SectorShortcuts({
  title,
  titleId,
  options,
  names,
  countLabel,
  href,
  className = "",
}: {
  title: string;
  /** Ties the heading to the section for AT; also the anchor a page can link. */
  titleId: string;
  options: FacetOption<CategoryKey>[];
  /** dict.catalog — the sector's name in the reader's language. */
  names: Dictionary["catalog"];
  /** The noun after the number (dict.discovery.storesCount). A bare "8" on a
   *  tile could be a rank, a price or a distance. Plural forms, because
   *  «3 محل» is wrong Arabic. */
  countLabel: CountForms;
  /** Where a tile goes. /explore narrows itself; search sends you to the
   *  sector's own page, because there is nothing on screen to narrow. */
  href: (key: CategoryKey) => string;
  className?: string;
}) {
  // One door is not a choice of doors. Below two this is a link pretending to
  // be a section, and the results underneath say the same thing better.
  if (options.length < 2) return null;

  return (
    <section aria-labelledby={titleId} className={className}>
      <h2 id={titleId} className="text-base font-extrabold">
        {title}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {options.map(({ key, count }) => {
          const Icon = categoryIcons[key];
          const style = categoryStyles[key];
          return (
            <li key={key}>
              <Link
                href={href(key)}
                className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-border bg-surface p-3 text-start transition-colors hover:border-primary/40"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.iconWrap}`}
                >
                  <Icon aria-hidden className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  {/* Wraps rather than truncates. "مطاعم ومأكولات" does not fit
                      one line in a half-width tile at 320px, and a sector cut
                      to "مطاعم ومأكو…" is a door with half its sign painted. */}
                  <span className="block text-sm font-bold leading-snug">
                    {names[key].name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <CountText
                      forms={countLabel}
                      n={count}
                      numberClassName="tabular-nums"
                    />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
