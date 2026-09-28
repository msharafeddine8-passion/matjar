"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import type { Locale } from "@/i18n/config";

export function FavoriteButton({
  storeId,
  favorited,
  lang,
  className = "",
}: {
  storeId: string;
  favorited: boolean;
  lang: Locale;
  className?: string;
}) {
  const router = useRouter();
  const [fav, setFav] = useState(favorited);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      router.push(`/${lang}/login`);
      return;
    }
    const next = !fav;
    setFav(next); // optimistic
    const { error } = next
      ? await supabase
          .from("follows")
          .insert({ store_id: storeId, user_id: user.id })
      : await supabase
          .from("follows")
          .delete()
          .eq("store_id", storeId)
          .eq("user_id", user.id);
    if (error) {
      setFav(!next); // revert on failure
      setBusy(false);
      return;
    }
    if (next) track("favorite_added", { storeId, offeringType: "store", sourceSurface: "card" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={
        fav
          ? lang === "ar"
            ? "إزالة من المفضّلة"
            : "Remove from favorites"
          : lang === "ar"
            ? "أضف للمفضّلة"
            : "Add to favorites"
      }
      aria-pressed={fav}
      // The visible circle stays 32px — it sits over a photo and a larger disc
      // would cover the product. The tap area is grown to 44 with a transparent
      // pseudo-element instead, which is how the rest of this codebase does it.
      //
      // Worth the comment because of how it was found: measured in the browser
      // pane, the home page reported zero undersized targets. The store rails
      // are Suspense boundaries whose completion scripts do not run there, so
      // the cards — and these eight buttons — were never in the DOM being
      // measured. Playwright, where the rails resolve, reports 32x32 eight
      // times over. A clean measurement of the wrong page reads exactly like a
      // clean page.
      className={`relative flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 backdrop-blur transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-surface ${className}`}
    >
      <Heart
        className={`h-4 w-4 ${fav ? "fill-danger text-danger" : "text-foreground/60"}`}
      />
    </button>
  );
}
