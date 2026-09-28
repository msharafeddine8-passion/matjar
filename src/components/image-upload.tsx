"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { FileText, ImagePlus, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { hasNativeCamera, pickNativeImage } from "@/lib/native";
import type { Dictionary } from "@/i18n/get-dictionary";

// Target weight for any uploaded image — keeps pages fast on Lebanese mobile
// data. We compress DOWN to this rather than rejecting the user's photo (phone
// shots are routinely 3–6 MB; a hard limit would just block them).
const TARGET_BYTES = 1_000_000; // ~1 MB
// Guard against a genuinely huge file that could hang/crash the canvas step on a
// low-end phone. This is a "too big to process" wall, not the size budget.
const MAX_RAW_BYTES = 25_000_000; // 25 MB

function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

// Downscale + recompress an image before upload so every asset has a sane weight
// (phone photos are often 4000px / several MB). Caps the longest side to 1600px,
// then steps quality down until the result is under TARGET_BYTES. Keeps PNG for
// transparency (logos); everything else becomes JPEG.
async function downscaleImage(file: File, maxDim = 1600): Promise<File> {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/gif" ||
    file.type === "image/svg+xml"
  ) {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  // Already small and light — leave it alone.
  if (scale === 1 && file.size <= 600_000) {
    bitmap.close?.();
    return file;
  }
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // PNGs (toBlob ignores quality for PNG) can't be squeezed by quality — if a
  // PNG is still heavy, re-encode it as JPEG to hit the budget.
  const isPng = file.type === "image/png";
  let outType = isPng ? "image/png" : "image/jpeg";
  let blob = await encode(canvas, outType, 0.85);

  // Step quality down until under budget (JPEG only — PNG size won't move).
  if (blob && blob.size > TARGET_BYTES) {
    if (isPng) outType = "image/jpeg";
    for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
      const next = await encode(canvas, outType, q);
      if (next) blob = next;
      if (next && next.size <= TARGET_BYTES) break;
    }
  }

  if (!blob || blob.size >= file.size) return file; // no gain — keep original
  const base = file.name.replace(/\.[^.]+$/, "");
  const ext = outType === "image/png" ? "png" : "jpg";
  return new File([blob], `${base}.${ext}`, { type: outType });
}

export function ImageUpload({
  folder,
  value,
  onChange,
  label,
  hint,
  aspect,
  objectPosition,
  dict,
  privateBucket,
}: {
  folder: string;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  /**
   * Shown under the label, before anything is picked. Unless `privateBucket`
   * is set, every file this uploads goes to the `store-assets` bucket, which
   * is public — so where that is not
   * obvious from the field itself, say so here rather than letting someone
   * find out afterwards.
   */
  hint?: string;
  /**
   * Tailwind aspect class (e.g. "aspect-[3/1]") for the picker and the preview.
   * Pass it wherever the image is displayed at a fixed shape elsewhere, so what
   * the merchant frames here is what everyone else sees. Defaults to the
   * generic h-32 box for free-form images.
   */
  aspect?: string;
  /** CSS object-position for the preview, so it crops where the real one does. */
  objectPosition?: string;
  /** Optional — enables localized error text; falls back to Arabic if omitted. */
  dict?: Dictionary;
  /**
   * Upload to this PRIVATE bucket instead of the public store-assets one.
   * `value` / `onChange` then carry the object PATH (`<folder>/<random>.<ext>`),
   * never a URL — there is no public URL to give. The preview is drawn from the
   * picked file itself. Used for verification documents (0314, P1-PRIV-02).
   */
  privateBucket?: "verification-docs";
}) {
  const box = aspect ? `${aspect} w-full` : "h-32 w-full";
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local object URL of the last picked file (private mode only).
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const tooLargeMsg =
    dict?.upload?.tooLarge ?? "الصورة كبيرة جدًّا. جرّب صورة أصغر.";
  const failedMsg =
    dict?.upload?.failed ?? "تعذّر رفع الصورة. جرّب مرّة تانية.";

  async function uploadFile(rawFile: File) {
    setError(null);
    // Reject only genuinely huge files (can't be processed) — everything else is
    // compressed down, never rejected for weight.
    if (rawFile.size > MAX_RAW_BYTES) {
      setError(tooLargeMsg);
      return;
    }
    setUploading(true);
    const file = await downscaleImage(rawFile);
    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    if (privateBucket) {
      const { error: privErr } = await supabase.storage
        .from(privateBucket)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (privErr) {
        setError(failedMsg);
      } else {
        setPreview(URL.createObjectURL(file));
        onChange(path);
      }
      setUploading(false);
      return;
    }
    const { error: upErr } = await supabase.storage
      .from("store-assets")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    if (!upErr) {
      const { data } = supabase.storage
        .from("store-assets")
        .getPublicUrl(path);
      onChange(data.publicUrl);
    } else {
      setError(failedMsg);
    }
    setUploading(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  // On the native app, offer the native camera/gallery chooser; on the web,
  // fall back to the hidden file input.
  async function onPick() {
    if (await hasNativeCamera()) {
      try {
        const file = await pickNativeImage("prompt");
        await uploadFile(file);
      } catch {
        /* user cancelled the native picker */
      }
      return;
    }
    inputRef.current?.click();
  }

  return (
    <div>
      <span className="text-sm font-semibold">{label}</span>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
      <div className="mt-1.5">
        {value ? (
          <div className={`relative ${box} overflow-hidden rounded-xl border border-border`}>
            {privateBucket ? (
              // A private path is not a URL. Draw the picked file if we still
              // have it; otherwise a neutral document mark.
              preview ? (
                <Image
                  src={preview}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="400px"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-surface-muted text-muted-foreground">
                  <FileText className="h-8 w-8" />
                </span>
              )
            ) : (
              <Image
                src={value}
                alt=""
                fill
                className="object-cover"
                style={objectPosition ? { objectPosition } : undefined}
                sizes="400px"
              />
            )}
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="remove"
              // 28px of visible chrome so it does not swallow the photo, but a
              // 44px tap area: -inset-2 adds 8px on every side (28 + 16 = 44).
              className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onPick}
            disabled={uploading}
            className={`flex ${box} flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60`}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ImagePlus className="h-6 w-6" />
            )}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          className="hidden"
        />
        {error && (
          <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>
        )}
      </div>
    </div>
  );
}
