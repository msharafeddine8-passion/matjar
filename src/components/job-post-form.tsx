"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";
import { JOB_TYPES } from "@/lib/jobs";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function JobPostForm({
  lang,
  dict,
  defaultCompany,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "jobs">;
  defaultCompany: string;
}) {
  const router = useRouter();
  const t = dict.jobs;
  const [loading, setLoading] = useState(false);
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
    const { data, error: insErr } = await supabase
      .from("job_postings")
      .insert({
        poster_id: user.id,
        title: String(form.get("title")),
        company_name: String(form.get("company_name")),
        description: String(form.get("description")),
        region: String(form.get("region")) || null,
        job_type: String(form.get("job_type")) || null,
        salary_note: String(form.get("salary_note")) || null,
        how_to_apply: String(form.get("how_to_apply")) || null,
        // Structured so a posting can't advertise "apply by email" with no
        // address (the DB also enforces the format).
        apply_email: String(form.get("apply_email") ?? "").trim() || null,
        apply_deadline: String(form.get("apply_deadline") ?? "") || null,
        experience_level: String(form.get("experience_level") ?? "") || null,
      })
      .select("id")
      .single();
    if (insErr || !data) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    router.push(`/${lang}/jobs/${data.id}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <Field label={t.jobTitle} htmlFor="title" required>
        <Input id="title" name="title" type="text" required placeholder={t.jobTitlePlaceholder} />
      </Field>
      <Field label={t.company} htmlFor="company_name" required>
        <Input id="company_name" name="company_name" type="text" required defaultValue={defaultCompany} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.region} htmlFor="region">
          <Select id="region" name="region" defaultValue="">
            <option value="">{t.selectRegion}</option>
            {regions.map((r) => (
              <option key={r.key} value={r.key}>{r.name[lang]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t.type} htmlFor="job_type">
          <Select id="job_type" name="job_type" defaultValue="">
            <option value="">{t.selectType}</option>
            {JOB_TYPES.map((ty) => (
              <option key={ty} value={ty}>{t.types[ty]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t.salary} htmlFor="salary_note">
        <Input id="salary_note" name="salary_note" type="text" placeholder={t.salaryPlaceholder} />
      </Field>
      <Field label={t.description} htmlFor="description" required>
        <Textarea id="description" name="description" rows={5} required placeholder={t.descriptionPlaceholder} />
      </Field>
      <Field label={t.applyEmail} htmlFor="apply_email" hint={t.applyEmailHint}>
        <Input
          id="apply_email"
          name="apply_email"
          type="email"
          dir="ltr"
          placeholder="jobs@company.com"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.experienceLevel} htmlFor="experience_level">
          <Select id="experience_level" name="experience_level" defaultValue="">
            <option value="">{t.selectExperience}</option>
            <option value="entry">{t.expEntry}</option>
            <option value="mid">{t.expMid}</option>
            <option value="senior">{t.expSenior}</option>
          </Select>
        </Field>
        <Field label={t.applyDeadline} htmlFor="apply_deadline">
          <Input id="apply_deadline" name="apply_deadline" type="date" />
        </Field>
      </div>
      <Field label={t.howToApply} htmlFor="how_to_apply" hint={t.howToApplyOtherHint}>
        <Input id="how_to_apply" name="how_to_apply" type="text" placeholder={t.howToApplyPlaceholder} />
      </Field>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={loading}>{t.publish}</Button>
    </form>
  );
}
