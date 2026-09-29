"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Star, X, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ImageUpload } from "@/components/image-upload";
import { safePublicName } from "@/lib/public-name";

export function ProductReviewForm({
  productId,
  dict,
  commentPlaceholder,
}: {
  productId: string;
  dict: Dictionary;
  /** Variant wording from the offering resolver (service / dish). */
  commentPlaceholder?: string;
}) {
  const router = useRouter();
  const t = dict.productReviews;
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [adderKey, setAdderKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating < 1) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/login`);
      return;
    }
    // Published under the review: the person's name or nothing, never their
    // email (the card shows «زبون» for an empty name).
    const name = safePublicName(user.user_metadata?.full_name as string | undefined);
    const { error: e } = await supabase.from("product_reviews").insert({
      product_id: productId,
      customer_id: user.id,
      rating,
      comment: comment.trim() || null,
      photos,
      customer_name: name,
    });
    setBusy(false);
    if (e) {
      setError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="mb-3 font-bold">{t.write}</h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n}`}
          >
            <Star
              className={`h-7 w-7 transition-colors ${
                n <= (hover || rating)
                  ? "fill-accent text-accent"
                  : "text-border"
              }`}
            />
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder={commentPlaceholder ?? t.commentPlaceholder}
        className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={url} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border">
            <Image src={url} alt="" fill className="object-cover" sizes="80px" />
            <button
              type="button"
              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
              className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {photos.length < 4 && (
          <div className="w-20">
            <ImageUpload
              key={adderKey}
              folder="reviews"
              value={null}
              label=""
              onChange={(url) => {
                if (url) {
                  setPhotos((p) => [...p, url]);
                  setAdderKey((k) => k + 1);
                }
              }}
            />
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || rating < 1}
        className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        <Send className="h-4 w-4" />
        {t.submit}
      </button>
    </div>
  );
}
