"use client";

// Identity verification, admin side.
//
// This is the one trust signal that works with zero completed jobs, so with 3
// gigs and no history it is the most valuable thing on the freelancer card —
// and until this screen existed, freelancer_verified had no way of ever being
// set. The badge is a claim the platform makes, so only the platform can make
// it: set_freelancer_verified() rejects anyone who is not a super admin, and
// this component is a way to call it, not the thing that authorises it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import type { Dictionary } from "@/i18n/get-dictionary";

export type VerifiableFreelancer = {
  id: string;
  name: string;
  gigCount: number;
  verified: boolean;
};

export function FreelancerVerifyList({
  people,
  dict,
}: {
  people: VerifiableFreelancer[];
  dict: Pick<Dictionary, "auth" | "freelance">;
}) {
  const router = useRouter();
  const t = dict.freelance;
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(id: string, next: boolean) {
    setBusy(id);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_freelancer_verified", {
      p_user: id,
      p_verified: next,
    });
    setBusy(null);
    if (error) {
      notifyError(error.message || dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  if (!people.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <BadgeCheck className="h-4 w-4 text-primary" />
        {t.verified}
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {people.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <span className="truncate">{p.name}</span>
                {p.verified && (
                  <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {p.gigCount}
              </span>
            </span>
            <button
              type="button"
              onClick={() => toggle(p.id, !p.verified)}
              disabled={busy !== null}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-bold transition-colors disabled:opacity-60 ${
                p.verified
                  ? "border border-border hover:bg-muted/40"
                  : "bg-primary text-primary-foreground hover:bg-primary-hover"
              }`}
            >
              {busy === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {p.verified ? t.unverify : t.verify}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
