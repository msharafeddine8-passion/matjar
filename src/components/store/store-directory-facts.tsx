import { Globe, Link2, MapPin, MessageCircle, Phone, Stethoscope, Tag } from "lucide-react";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";
import type { StoreView } from "@/lib/data/store-view";
import { waLink } from "@/lib/phone";

/** An imported link may carry no scheme, and must never carry a dangerous one. */
function externalHref(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return `https://${v}`;
}

/** The address bar's version of a link: no scheme, no www, no trailing slash. */
function shortHost(href: string): string {
  return href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/**
 * Everything a public source stated about this business, and nothing else. A row
 * exists only when its value does. There is deliberately no description line, no
 * rating and no hours guess: an unclaimed page says what is known and stops.
 */
export function StoreDirectoryFacts({
  store,
  lang,
  dict,
}: {
  store: StoreView;
  lang: Locale;
  dict: Pick<Dictionary, "directory" | "catalog">;
}) {
  const t = dict.directory;
  const regionName = regions.find((r) => r.key === store.region)?.name[lang];
  const place = [store.area, regionName].filter(Boolean).join("، ");
  const whatsapp = waLink(store.whatsapp);
  const website = externalHref(store.website);
  const instagram = externalHref(store.instagram);
  const facebook = externalHref(store.facebook);

  const rows: { key: string; icon: ReactNode; label: string; value: ReactNode }[] = [];
  const row = (key: string, icon: ReactNode, label: string, value: ReactNode) =>
    rows.push({ key, icon, label, value });
  const linkClass =
    "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline lg:min-h-0";
  const iconClass = "h-4 w-4";

  row("sector", <Tag aria-hidden className={iconClass} />, t.rowSector, dict.catalog[store.category].name);
  if (place) row("place", <MapPin aria-hidden className={iconClass} />, t.rowPlace, place);
  if (store.address)
    row("address", <MapPin aria-hidden className={iconClass} />, t.rowAddress, <span dir="auto">{store.address}</span>);
  if (store.phone)
    row(
      "phone",
      <Phone aria-hidden className={iconClass} />,
      t.rowPhone,
      <a href={`tel:${store.phone}`} className={linkClass}>
        <bdi dir="ltr" className="tabular-nums">{store.phone}</bdi>
      </a>,
    );
  if (store.whatsapp && whatsapp)
    row(
      "whatsapp",
      <MessageCircle aria-hidden className={iconClass} />,
      t.rowWhatsapp,
      <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <bdi dir="ltr" className="tabular-nums">{store.whatsapp}</bdi>
      </a>,
    );
  if (website)
    row(
      "website",
      <Globe aria-hidden className={iconClass} />,
      t.rowWebsite,
      <a href={website} target="_blank" rel="noopener noreferrer nofollow" className={`${linkClass} break-all`}>
        <bdi dir="ltr">{shortHost(website)}</bdi>
      </a>,
    );
  if (instagram)
    row(
      "instagram",
      <Link2 aria-hidden className={iconClass} />,
      t.rowInstagram,
      <a href={instagram} target="_blank" rel="noopener noreferrer nofollow" className={`${linkClass} break-all`}>
        <bdi dir="ltr">{shortHost(instagram)}</bdi>
      </a>,
    );
  if (facebook)
    row(
      "facebook",
      <Link2 aria-hidden className={iconClass} />,
      t.rowFacebook,
      <a href={facebook} target="_blank" rel="noopener noreferrer nofollow" className={`${linkClass} break-all`}>
        <bdi dir="ltr">{shortHost(facebook)}</bdi>
      </a>,
    );
  if (store.specialties)
    row(
      "specialties",
      <Stethoscope aria-hidden className={iconClass} />,
      t.rowSpecialties,
      <span dir="auto">{store.specialties}</span>,
    );

  return (
    <section aria-labelledby="directory-facts" className="mt-4 rounded-2xl border border-border bg-surface p-5">
      <h2 id="directory-facts" className="font-bold">
        {t.knownTitle}
      </h2>
      <dl className="mt-3 divide-y divide-border text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="mt-0.5 shrink-0 text-muted-foreground">{r.icon}</span>
            <dt className="w-20 shrink-0 text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 flex-1 font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
