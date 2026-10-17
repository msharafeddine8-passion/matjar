import { notFound } from "next/navigation";
import { Settings } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { AdminSettingsForm } from "@/components/admin-settings-form";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("settings", lang);
  const dict = await getDictionary(lang);

  // Role is enforced by the admin layout.
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "usd_lbp_rate")
    .maybeSingle();
  const rate = (data as { value?: string } | null)?.value ?? "0";

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={Settings}
          title={dict.admin.platform.title}
          subtitle={dict.admin.platform.subtitle}
        />
        <div data-animate>
          <AdminSettingsForm dict={dictSlice(dict, ["admin", "common"])} initialRate={rate} />
        </div>
      </Container>
    </div>
  );
}
