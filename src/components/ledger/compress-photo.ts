// Receipt photos go into a PRIVATE bucket and are only ever looked at to settle
// a dispute, so they need to be legible, not beautiful. A phone camera shot is
// 3–6 MB; this brings it to a JPEG of at most 1280px on the long side and,
// in practice, 150–400 KB — which matters on Lebanese mobile data and keeps the
// upload inside the 10-second budget for a ledger entry.

const MAX_SIDE = 1280;
const TARGET_BYTES = 450_000;

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}

/** Returns a JPEG blob, or null when the file cannot be decoded as an image. */
export async function compressPhoto(file: File): Promise<Blob | null> {
  if (!file.type.startsWith("image/")) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return null;
  }
  // White under any transparency: JPEG has no alpha, and black would hide ink.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let blob = await encode(canvas, 0.72);
  for (const q of [0.6, 0.5, 0.4]) {
    if (blob && blob.size <= TARGET_BYTES) break;
    const next = await encode(canvas, q);
    if (next) blob = next;
  }
  return blob;
}
