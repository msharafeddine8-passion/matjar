import { Info } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { isOpenStreetMapSource, safeSourceUrl } from "@/lib/listing";

const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

/**
 * The first thing an unclaimed page says, right under the name: where this came
 * from and how far to trust it. Calm on purpose. Nothing is wrong with the
 * business; the page is simply not its own yet, so it is drawn in neutral tones
 * and not as a warning.
 *
 * OpenStreetMap's licence asks for the credit by name, so that one source always
 * prints it and links it. Any other source prints a plain link when there is one.
 */
export function StoreDirectoryNotice({
  dataSource,
  sourceUrl,
  dict,
}: {
  dataSource: string | null | undefined;
  sourceUrl: string | null | undefined;
  dict: Pick<Dictionary, "directory">;
}) {
  const t = dict.directory;
  const href = safeSourceUrl(sourceUrl);
  const osm = isOpenStreetMapSource(dataSource, sourceUrl);
  return (
    <aside
      aria-label={t.noticeLabel}
      className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-surface-muted/60 px-4 py-3.5"
    >
      <Info aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 text-sm leading-relaxed">
        <p className="font-medium">{t.notice}</p>
        {osm ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t.sourceLabel}: <bdi>{t.sourceOsm}</bdi>
            {" · "}
            <a
              href={href ?? OSM_COPYRIGHT}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2 hover:text-primary"
            >
              <bdi dir="ltr">{t.osmCredit}</bdi>
            </a>
          </p>
        ) : href ? (
          <p className="mt-1 text-xs text-muted-foreground">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2 hover:text-primary"
            >
              {t.sourceLabel}
              {/* The site it came from: "web" tells a reader nothing. */}
              : <bdi>{new URL(href).hostname.replace(/^www\./, "")}</bdi>
            </a>
          </p>
        ) : null}
      </div>
    </aside>
  );
}
