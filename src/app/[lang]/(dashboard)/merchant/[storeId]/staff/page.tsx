import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro, planStaffLimit } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { StaffManager } from "@/components/staff-manager";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free/basic stores see the upsell instead.
  const plan = await getStorePlan(storeId);
  if (!isPro(plan)) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }

  const { data: staffData } = await supabase
    .from("store_staff")
    .select("id, email, role, permissions")
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });
  const staff = (staffData ?? []) as {
    id: string;
    email: string | null;
    role: string;
    permissions: Record<string, boolean> | null;
  }[];

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.merchant.staffTitle}
        </h1>
        <div className="mt-6">
          <StaffManager
            storeId={storeId}
            dict={dictSlice(dict, ["auth", "common", "merchant"])}
            staff={staff}
            maxStaff={planStaffLimit(plan)}
          />
        </div>
      </Container>
    </div>
  );
}
