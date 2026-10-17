"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { QUICK_ACTION_BASE, QUICK_ACTION_LABEL } from "@/components/quick-action";

export function MessageStoreButton({
  storeId,
  lang,
  dict,
  compact = false,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "messages">;
  /** Phone presentation: icon only, one 44px target, label back from lg up. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login`);
      return;
    }
    const { data, error } = await supabase.rpc("start_store_conversation", {
      p_store_id: storeId,
    });
    setBusy(false);
    if (!error && data) router.push(`/${lang}/messages/${data}`);
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label={compact ? dict.messages.messageStore : undefined}
      className={`flex items-center gap-1.5 rounded-xl border border-border text-sm font-semibold transition-colors hover:border-primary hover:text-primary disabled:opacity-60 ${
        compact ? QUICK_ACTION_BASE : "px-4 py-2"
      }`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageSquare className="h-4 w-4" />
      )}
      <span className={compact ? QUICK_ACTION_LABEL : undefined}>
        {dict.messages.messageStore}
      </span>
    </button>
  );
}
