import { MessageCircle, Navigation, Phone } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { directionsHref } from "@/lib/listing";
import { waLink } from "@/lib/phone";

/**
 * How a display-only store is reached: WhatsApp, phone, directions — each only
 * when the store has the fact behind it. Used on its product pages and above its
 * catalogue, in the place an order control would otherwise be.
 */
export function StoreContactActions({
  whatsapp,
  phone,
  lat,
  lng,
  waText,
  dict,
}: {
  whatsapp: string | null | undefined;
  phone: string | null | undefined;
  lat?: number | null;
  lng?: number | null;
  /** Prefilled WhatsApp message («مرحبا، بخصوص…»). */
  waText?: string;
  dict: Pick<Dictionary, "store">;
}) {
  const wa = waLink(whatsapp, waText);
  const directions = directionsHref(lat, lng);
  if (!wa && !phone && !directions) return null;
  const secondary =
    "flex min-h-11 flex-1 basis-32 items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary";
  return (
    <div className="flex flex-wrap gap-2">
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-whatsapp px-6 py-3 font-bold text-whatsapp-foreground transition-colors hover:bg-whatsapp-hover"
        >
          <MessageCircle aria-hidden className="h-4.5 w-4.5" />
          {dict.store.whatsapp}
        </a>
      )}
      {phone && (
        <a href={`tel:${phone}`} className={secondary}>
          <Phone aria-hidden className="h-4 w-4" />
          {dict.store.call}
        </a>
      )}
      {directions && (
        <a href={directions} target="_blank" rel="noopener noreferrer" className={secondary}>
          <Navigation aria-hidden className="h-4 w-4" />
          {dict.store.directions}
        </a>
      )}
    </div>
  );
}
