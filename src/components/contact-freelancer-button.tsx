"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { buttonVariants } from "@/components/ui/button";

export function ContactFreelancerButton({
  freelancerId,
  lang,
  dict,
  label,
  variant,
  className = "",
}: {
  freelancerId: string;
  lang: Locale;
  dict: Dictionary;
  /** Overrides the default "تواصل مع المستقل" — e.g. «راسل» beside «اطلب عرض». */
  label?: string;
  /** Set when the button is the SECONDARY action next to a primary one; omitted,
   *  it keeps its original solid look for the pages that use it alone. */
  variant?: "primary" | "secondary";
  className?: string;
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
    if (user.id === freelancerId) {
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.rpc("start_conversation", {
      p_other_user: freelancerId,
    });
    setBusy(false);
    if (!error && data) router.push(`/${lang}/messages/${data}`);
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={
        variant
          ? `${buttonVariants({ variant })} ${className}`
          : `flex items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60 ${className}`
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageSquare className="h-4 w-4" />
      )}
      {label ?? dict.freelance.contact}
    </button>
  );
}
