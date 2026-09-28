"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

export function WishlistButton({
  productId,
  wishlisted,
  lang,
  dict,
}: {
  productId: string;
  wishlisted: boolean;
  lang: Locale;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [on, setOn] = useState(wishlisted);
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
    const { error } = next
      ? await supabase
          .from("wishlist")
          .insert({ user_id: user.id, product_id: productId })
      : await supabase
          .from("wishlist")
          .delete()
          .eq("user_id", user.id)
          .eq("product_id", productId);
    if (error) {
      setOn(!next);
      setBusy(false);
      return;
    }
    if (next) track("favorite_added", { offeringId: productId, offeringType: "product", sourceSurface: "product" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`flex w-full items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
        on
          ? "border-primary bg-primary-soft text-primary"
          : "border-border hover:border-primary hover:text-primary"
      }`}
    >
      <Heart className={`h-4 w-4 ${on ? "fill-primary" : ""}`} />
      {on ? dict.product.wishlisted : dict.product.wishlist}
    </button>
  );
}
