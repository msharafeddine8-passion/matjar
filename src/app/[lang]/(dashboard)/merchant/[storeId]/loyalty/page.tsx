import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan, hasPlan } from "@/lib/plan-tiers";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { SITE_URL } from "@/lib/site";
import { programFromRow } from "@/lib/loyalty";
import { LoyaltyManager, type LoyaltyMember } from "@/components/loyalty/loyalty-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// بطاقة الولاء — the store's stamp card / points program and its members.
//
// Who: the owner (program + members) and staff with the `customers`
// permission (members only) — the key 0310 gates loyalty_accounts /
// loyalty_events / store_loyalty_members on, so the screen opens for exactly
// the people the database lets read the rows.
//
// Plan: Pro and Business (FEATURES.loyaltyStamps). Below Pro the page shows the
// shared upgrade prompt; the database refuses configuring or adding stamps
// below Pro regardless of what this page renders.
//
// Before 0310 is applied every read below fails softly (unknown table /
// function) and the page renders an empty program and member list with a
// "being set up" note — nothing throws.
export default async function LoyaltyPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.loyaltyCards;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", { p_store_id: storeId });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: storeRow } = await supabase
    .from("stores")
    .select("name, owner_id, plan, trial_ends_at")
    .eq("id", storeId)
    .maybeSingle();
  if (!storeRow) redirect(`/${lang}/merchant`);
  const store = storeRow as { name: string; owner_id: string; plan: string | null; trial_ends_at: string | null };
  const isOwner = store.owner_id === user.id;

  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms = (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.customers ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  const back = (
    <Link
      href={`/${lang}/merchant/${storeId}`}
      className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronPrev className="h-4 w-4" />
      {store.name}
    </Link>
  );

  if (!hasPlan(effectivePlan(store.plan, store.trial_ends_at), "pro")) {
    return (
      <div className="py-10">
        <Container className="max-w-3xl">
          {back}
          <div className="mt-6">
            <ProGate
              lang={lang}
              dict={dict}
              storeId={storeId}
              title={t.gate.loyaltyTitle}
              body={t.gate.loyaltyBody}
              compact
            />
          </div>
        </Container>
      </div>
    );
  }

  const [programRes, membersRes, productsRes, sectionsRes] = await Promise.all([
    supabase
      .from("loyalty_programs")
      .select(
        "kind, is_active, stamps_required, stamp_scope, scope_product_id, scope_section_id, points_per_usd, redeem_threshold, reward_label, reward_label_en",
      )
      .eq("store_id", storeId)
      .maybeSingle(),
    supabase.rpc("store_loyalty_members", { p_store_id: storeId }),
    isOwner
      ? supabase
          .from("products")
          .select("id, name")
          .eq("store_id", storeId)
          .is("deleted_at", null)
          .order("name")
          .limit(500)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    isOwner
      ? supabase.from("store_sections").select("id, name").eq("store_id", storeId).order("sort_order").limit(200)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const setupPending = !!programRes.error || !!membersRes.error;
  const members = ((membersRes.data ?? []) as LoyaltyMember[]).map((m) => ({
    ...m,
    stamps: Number(m.stamps) || 0,
    points: Number(m.points) || 0,
  }));

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        {back}
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t.nav.loyalty}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.feature.loyaltyDesc}</p>
        <div className="mt-6">
          <LoyaltyManager
            storeId={storeId}
            storeName={store.name}
            lang={lang}
            dict={dict}
            isOwner={isOwner}
            program={programRes.error ? null : programFromRow(programRes.data)}
            products={(productsRes.data ?? []) as { id: string; name: string }[]}
            sections={(sectionsRes.data ?? []) as { id: string; name: string }[]}
            members={members}
            siteUrl={SITE_URL}
            setupPending={setupPending}
          />
        </div>
      </Container>
    </div>
  );
}
