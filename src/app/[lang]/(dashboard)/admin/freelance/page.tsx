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
import { FreelancerVerifyList } from "@/components/freelancer-verify-list";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminFreelancePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("freelance", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("gigs")
    .select(
      "id, title, freelancer_id, freelancer_name, category, price, region, image_url, status, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    freelancer_id: string | null;
    freelancer_name: string | null;
    category: string | null;
    price: number | null;
    region: string | null;
    image_url: string | null;
    status: string;
    created_at: string;
  }[];

  // Both translated on the public gig page; the moderation queue was joining
  // the raw columns, so an Arabic reviewer read "voice · bekaa".
  const regionName = (key: string | null) =>
    key ? (regions.find((x) => x.key === key)?.name[lang] ?? key) : null;

  const items: ModerationItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.freelancer_name,
    meta:
      [
        labelFor(dict, "freelanceCategory", r.category),
        regionName(r.region),
        r.price != null ? `$${r.price}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    image: r.image_url,
    status: r.status,
    createdAt: r.created_at,
  }));

  // Verification is per PERSON, not per gig — one freelancer with three
  // listings is verified once. profiles is readable here because the section is
  // already behind requireAdminSection and profiles_select admits super admins.
  const byFreelancer = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "active" || !r.freelancer_id) continue;
    byFreelancer.set(r.freelancer_id, (byFreelancer.get(r.freelancer_id) ?? 0) + 1);
  }
  const ids = [...byFreelancer.keys()];
  const { data: profs } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, freelancer_verified")
        .in("id", ids)
    : { data: [] };
  const people = ((profs ?? []) as {
    id: string;
    full_name: string | null;
    freelancer_verified: boolean | null;
  }[])
    .map((p) => ({
      id: p.id,
      name: p.full_name?.trim() || "—",
      gigCount: byFreelancer.get(p.id) ?? 0,
      verified: Boolean(p.freelancer_verified),
    }))
    // Unverified first: this list exists to work through, not to admire.
    .sort((a, b) => Number(a.verified) - Number(b.verified));

  return (
    <div className="space-y-6">
      <FreelancerVerifyList people={people} dict={dictSlice(dict, ["auth", "freelance"])} />
      <AdminModerationClient
        lang={lang}
        dict={dictSlice(dict, ["admin", "common"])}
        table="gigs"
        title={dict.admin.freelance.title}
        subtitle={dict.admin.freelance.subtitle}
        viewBase="freelance"
        items={items}
      />
    </div>
  );
}
