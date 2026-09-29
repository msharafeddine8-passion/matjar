"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

// «راسل البائع» on a private seller's Sunday Market listing (0317). A person's
// listing has no store, so no WhatsApp or phone button — and their number is
// neither public nor verified. start_listing_conversation resolves the seller
// on the server and opens (or reuses) an in-app conversation; the thread page
// then pre-fills a first line naming the listing (?about=).

export function MessageSellerButton({
  listingId,
  lang,
  dict,
}: {
  listingId: string;
  lang: Locale;
  dict: Pick<Dictionary, "messages">;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const t = dict.messages;

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login?next=/${lang}/market/${listingId}`);
      return;
    }
    const { data, error } = await supabase.rpc("start_listing_conversation", {
      p_listing_id: listingId,
    });
    setBusy(false);
    if (error || !data) {
      notifyError(t.messageSellerError);
      return;
    }
    router.push(`/${lang}/messages/${data}?about=${listingId}`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
        {t.messageSeller}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{t.messageSellerNote}</p>
    </div>
  );
}
