"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function JobApplyForm({
  jobId,
  lang,
  dict,
  applied,
}: {
  jobId: string;
  lang: Locale;
  /** Only the two namespaces the form reads: this is a client component, and
   *  the whole dictionary would ride along in every job page's payload. */
  dict: Pick<Dictionary, "jobs" | "auth">;
  applied: boolean;
}) {
  const router = useRouter();
  const t = dict.jobs;
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(applied);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login`);
      return;
    }
    const { error: insErr } = await supabase.from("job_applications").insert({
      job_id: jobId,
      applicant_id: user.id,
      cover_note: String(form.get("cover_note")) || null,
      phone: String(form.get("phone")) || null,
      cv_url: String(form.get("cv_url")) || null,
    });
    setLoading(false);
    if (insErr) {
      // 42501 = the row policy refused it. From 0314 that happens when the
      // posting closed, was removed, or passed its deadline (Beirut date) while
      // this page was open — say that, rather than "something went wrong".
      setError(insErr.code === "42501" ? t.deadlinePassed : dict.auth.errorGeneric);
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success-soft p-5 font-bold text-success">
        <Check className="h-5 w-5" />
        {t.applied}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl border border-border bg-surface p-5"
    >
      <h2 className="font-bold">{t.applyTitle}</h2>
      <Input name="phone" type="tel" inputMode="tel" placeholder={t.applyPhone} />
      <Input name="cv_url" type="url" placeholder={t.applyCv} dir="ltr" />
      <Textarea name="cover_note" rows={3} placeholder={t.applyNote} />
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={loading}>{t.apply}</Button>
    </form>
  );
}
