"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { QUICK_ACTION_BASE, QUICK_ACTION_LABEL } from "@/components/quick-action";

export function FollowButton({
  storeId,
  following,
  lang,
  dict,
  compact = false,
}: {
  storeId: string;
  following: boolean;
  lang: Locale;
  dict: Dictionary;
  /** Phone presentation: icon only, one 44px target, label back from lg up.
   *  Opt-in — a caller that does not ask for it renders exactly as before. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(following);
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
      ? await supabase.from("follows").insert({ user_id: user.id, store_id: storeId })
      : await supabase
          .from("follows")
          .delete()
          .eq("user_id", user.id)
          .eq("store_id", storeId);
    if (error) {
      setOn(!next);
      setBusy(false);
      return;
    }
    if (next) track("favorite_added", { storeId, offeringType: "store", sourceSurface: "store" });
    setBusy(false);
    router.refresh();
  }

  const label = on ? dict.store.following : dict.store.follow;
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={compact ? label : undefined}
      className={`flex items-center gap-1.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 ${
        compact ? QUICK_ACTION_BASE : "px-4 py-2"
      } ${
        on
          ? "bg-primary-soft text-primary"
          : "border border-border hover:border-primary hover:text-primary"
      }`}
    >
      {on ? <Check className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
      <span className={compact ? QUICK_ACTION_LABEL : undefined}>{label}</span>
    </button>
  );
}
