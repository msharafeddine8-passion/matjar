import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { getUsdLbpRate } from "@/lib/data/settings";
import { effectivePlan, hasPlan } from "@/lib/plan-tiers";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { SITE_URL } from "@/lib/site";
import { beirutToday, type GiftCardRow } from "@/lib/gift-cards";
import { GiftCardManager } from "@/components/gift-cards/gift-card-manager";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// بطاقات الهدايا — issue, list, void, and what the shop still owes on them.
//
// OWNER ONLY: the list carries every spending code (0310 gives gift_cards an
// owner-only read policy). Staff spend a card at the POS by typing its code.
//
// Plan: issuing is Pro and Business (FEATURES.giftCards; issue_gift_card
// re-checks in the database). A store that drops below Pro sees the upgrade
// prompt AND its existing cards — they stay spendable and voidable, because
// the money on them was paid by customers.
export default async function GiftCardsPage({
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

  const { data: storeRow } = await supabase
    .from("stores")
    .select("name, plan, trial_ends_at")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!storeRow) redirect(`/${lang}/merchant`);
  const store = storeRow as { name: string; plan: string | null; trial_ends_at: string | null };
  const isPro = hasPlan(effectivePlan(store.plan, store.trial_ends_at), "pro");

  const [{ data: cardRows, error: cardsErr }, lbpRate] = await Promise.all([
    supabase
      .from("gift_cards")
      .select("id, code, token, currency, initial_amount, balance, recipient_name, note, expires_on, status, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(500),
    getUsdLbpRate(),
  ]);
  const cards = (cardRows ?? []) as GiftCardRow[];

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {store.name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t.gift.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.gift.intro}</p>

        {!isPro && (
          <div className="mt-6">
            <ProGate lang={lang} dict={dict} storeId={storeId} title={t.gate.giftTitle} body={t.gate.giftBody} compact />
          </div>
        )}

        {(isPro || cards.length > 0) && (
          <div className="mt-6">
            <GiftCardManager
              storeId={storeId}
              storeName={store.name}
              lang={lang}
              dict={dict}
              cards={cards}
              canIssue={isPro}
              lbpRate={lbpRate}
              siteUrl={SITE_URL}
              today={beirutToday()}
              setupPending={!!cardsErr}
            />
          </div>
        )}
      </Container>
    </div>
  );
}
