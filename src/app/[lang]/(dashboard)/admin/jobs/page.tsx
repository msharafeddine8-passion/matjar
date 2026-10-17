import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { labelFor } from "@/lib/status-labels";
import { regions } from "@/lib/catalog";
import {
  AdminModerationClient,
  type ModerationItem,
} from "@/components/admin-moderation-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminJobsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("jobs", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("job_postings")
    .select(
      "id, title, company_name, region, job_type, status, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    company_name: string | null;
    region: string | null;
    job_type: string | null;
    status: string;
    created_at: string;
  }[];

  // The public job board translates both of these (site/jobs/page.tsx); the
  // moderation queue used to join the raw column values, so a reviewer working
  // in Arabic read "full_time · mountLebanon" under an Arabic job title.
  const regionName = (key: string | null) =>
    key ? (regions.find((x) => x.key === key)?.name[lang] ?? key) : null;

  const items: ModerationItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.company_name,
    meta:
      [labelFor(dict, "jobType", r.job_type), regionName(r.region)]
        .filter(Boolean)
        .join(" · ") || null,
    image: null,
    status: r.status,
    createdAt: r.created_at,
  }));

  return (
    <AdminModerationClient
      lang={lang}
      dict={dictSlice(dict, ["admin", "common"])}
      table="job_postings"
      title={dict.admin.jobs.title}
      subtitle={dict.admin.jobs.subtitle}
      viewBase="jobs"
      items={items}
    />
  );
}
