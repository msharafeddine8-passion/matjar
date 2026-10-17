"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";
const labelClass = "text-sm font-semibold";

export function ProfileForm({
  dict,
  initial,
}: {
  dict: Pick<Dictionary, "account" | "auth">;
  initial: { full_name: string; phone: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);
    const form = new FormData(e.currentTarget);
    const fullName = String(form.get("full_name"));
    const phone = String(form.get("phone")) || null;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone })
      .eq("id", user.id);
    if (updateError) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    await supabase.auth.updateUser({ data: { full_name: fullName } });
    setLoading(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <div>
        <label className={labelClass} htmlFor="full_name">
          {dict.account.fullName}
        </label>
        <input id="full_name" name="full_name" type="text" required defaultValue={initial.full_name} className={fieldClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="phone">
          {dict.account.phone}
        </label>
        <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={initial.phone} placeholder="+961 …" className={fieldClass} />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? dict.account.saving : dict.account.save}
        </button>
        {saved && (
          <span className="text-sm font-semibold text-primary">
            {dict.account.saved}
          </span>
        )}
        {error && (
          <span className="text-sm font-semibold text-danger">{error}</span>
        )}
      </div>
    </form>
  );
}
