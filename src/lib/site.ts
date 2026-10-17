// Canonical public base URL, used for SEO (sitemap, robots, Open Graph). Override
// with NEXT_PUBLIC_SITE_URL once the custom domain (matjarlb.com) is connected.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://matjarlb.com";

// ── Share images ────────────────────────────────────────────────────────────
//
// Next merges metadata SHALLOWLY: a page that sets its own `openGraph` (or
// `twitter`) replaces the layout's object whole, images included. Pages that
// set a title/description for sharing were therefore shipping no og:image at
// all, and a WhatsApp forward of them rendered as a bare link. Every page that
// sets `openGraph` takes its images from here.

/** The platform's own share card (src/app/opengraph-image.png, 1200×630,
 *  kept well under WhatsApp's ~300 KB preview limit). */
export const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "متجر · Matjar",
} as const;

const STORAGE_OBJECT = "/storage/v1/object/public/";
const STORAGE_RENDER = "/storage/v1/render/image/public/";

/** A merchant upload, resized by Supabase's own image renderer (the same
 *  object→render swap lib/image-loader.ts makes for <Image>), so a share
 *  preview fetches a ≤1200×630 rendition instead of a multi-hundred-KB
 *  original. Anything that is not a Supabase public object is returned as-is. */
export function shareImageUrl(src: string): string {
  if (!src.includes(STORAGE_OBJECT)) return src;
  const base = src.replace(STORAGE_OBJECT, STORAGE_RENDER);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}width=1200&height=630&resize=contain&quality=75`;
}

/** `openGraph.images` and `twitter.images` for one page: its own picture when
 *  it has one, the platform card otherwise — never nothing. */
export function shareImages(src?: string | null, alt?: string) {
  const own = src?.trim();
  if (!own) {
    return {
      openGraph: [DEFAULT_OG_IMAGE],
      twitter: [DEFAULT_OG_IMAGE.url],
    };
  }
  const url = shareImageUrl(own);
  return {
    openGraph: [{ url, ...(alt ? { alt } : {}) }],
    twitter: [url],
  };
}

// Per-page canonical + hreflang alternates for a bilingual page. `path` is the
// locale-less path (e.g. "/store/123", or "" for the home page). Values are
// relative — Next resolves them against metadataBase.
export function localeAlternates(lang: string, path: string) {
  const p = path === "/" ? "" : path;
  return {
    canonical: `/${lang}${p}`,
    languages: {
      ar: `/ar${p}`,
      en: `/en${p}`,
      "x-default": `/ar${p}`,
    },
  };
}
