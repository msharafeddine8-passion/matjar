"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

export function ListingFavoriteButton({
  listingId,
  favorited,
  savesCount,
  lang,
  dict,
}: {
  listingId: string;
  favorited: boolean;
  savesCount: number;
  lang: Locale;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [on, setOn] = useState(favorited);
  const [count, setCount] = useState(savesCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
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
    const next = !on;
    setOn(next);
    setCount((c) => c + (next ? 1 : -1));
    const { error } = next
      ? await supabase
          .from("listing_favorites")
          .insert({ user_id: user.id, listing_id: listingId })
      : await supabase
          .from("listing_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("listing_id", listingId);
    if (error) {
      setOn(!next);
      setCount((c) => c + (next ? -1 : 1));
    } else if (next) {
      track("favorite_added", { offeringId: listingId, offeringType: "listing", sourceSurface: "market" });
    }
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        on ? "border-primary bg-primary-soft text-primary" : "border-border hover:border-primary hover:text-primary"
      }`}
    >
      <Heart className={`h-4 w-4 ${on ? "fill-primary" : ""}`} />
      {count} {dict.market.saves}
    </button>
  );
}
