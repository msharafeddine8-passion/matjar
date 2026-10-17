"use client";

/**
 * next/image loader: Supabase resizes its own images; Vercel touches none.
 *
 * Why this exists, dated so the reason is checkable later. On 2026-09-01,
 * store pages on matjarlb.com were serving broken product photos — 7 of 18 on
 * the butcher's page, 3 of 4 on the one freelancer's profile — because every
 * fresh call to /_next/image came back:
 *
 *   HTTP 402 Payment Required
 *   X-Vercel-Error: OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED
 *
 * That is Vercel refusing to optimize an image for billing reasons — here, the
 * hard spend cap put on the account after an earlier crawler incident. Images
 * optimized before the cap were still served from Vercel's cache, which is why
 * the home page looked fine while a shop's newer photos did not, and why the
 * damage was growing rather than constant: every new upload and every new size
 * variant was a fresh 402.
 *
 * Supabase Storage has its own resizer on the same bucket, one path segment
 * away — /storage/v1/render/image/public/ instead of /storage/v1/object/public/
 * — and it answered 200 for the exact image Vercel refused, at 583 KB instead of
 * 1.67 MB. Browsers that send Accept: image/webp get WebP from it. So the
 * resize moves to the machine that already has the file, and the Vercel
 * optimizer is out of the request path entirely: no quota to exhaust, no cap
 * to hit, and one fewer hop for a customer on Lebanese mobile data.
 *
 * Anything that is not a Supabase public object — the logo, icons, anything
 * under /public — is returned untouched. With a custom loader Next does not
 * optimize those either; they are small static files and that is fine.
 *
 * The trade this makes, stated rather than hidden: the resizing work now counts
 * against the Supabase plan's image-transformation allowance instead of
 * Vercel's. Worth knowing when reading either bill.
 */

const OBJECT = "/storage/v1/object/public/";
const RENDER = "/storage/v1/render/image/public/";

export default function supabaseImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (!src.includes(OBJECT)) return src;
  // An upload that already carries a query string is not something this
  // codebase produces, but a second "?" would corrupt the URL, so join safely.
  const base = src.replace(OBJECT, RENDER);
  const sep = base.includes("?") ? "&" : "?";
  // resize=contain keeps the aspect ratio. With width alone Supabase keeps the
  // ORIGINAL height and crops the sides (a 1283x1506 cover asked at 640 came
  // back 640x1506), so every logo, cover and thumbnail showed a zoomed-in
  // centre strip. Share images (site.ts) already passed it.
  return `${base}${sep}width=${width}&resize=contain&quality=${quality ?? 75}`;
}
