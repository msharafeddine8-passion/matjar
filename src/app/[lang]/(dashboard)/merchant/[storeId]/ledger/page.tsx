import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { getUsdLbpRate } from "@/lib/data/settings";
import { todayInBeirut, type LedgerBalanceRow } from "@/lib/ledger";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { LedgerHome } from "@/components/ledger/ledger-home";
import { requireLedgerAccess, UUID_RE } from "./access";

// دفتر الدين — the list of customers who owe the shop, largest first, each with
// their dollar and lira balances kept apart. Free on every plan.
export default async function LedgerPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const access = await requireLedgerAccess(supabase, lang, storeId);

  const [balancesRes, customersRes, rate] = await Promise.all([
    supabase.rpc("ledger_balances", { p_store_id: storeId }),
    // The picker for "add a customer to the book". Most shops have tens, not
    // thousands; 1000 is PostgREST's page and more than any real notebook.
    supabase
      .from("store_customers")
      .select("id, name, phone")
      .eq("store_id", storeId)
      .order("name", { ascending: true })
      .limit(1000),
    getUsdLbpRate(),
  ]);

  if (balancesRes.error) {
    console.error("[ledger] ledger_balances failed", balancesRes.error.message);
  }

  return (
    <div className="py-6 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {access.storeName}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {dict.ledger.title}
          </h1>
          <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success">
            {dict.ledger.freeBadge}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{dict.ledger.subtitle}</p>

        <div className="mt-6">
          <LedgerHome
            storeId={storeId}
            lang={lang as Locale}
            t={dict.ledger}
            rows={(balancesRes.data ?? []) as LedgerBalanceRow[]}
            loadFailed={!!balancesRes.error}
            customers={
              (customersRes.data ?? []) as { id: string; name: string; phone: string | null }[]
            }
            rate={rate}
            today={todayInBeirut()}
          />
        </div>
      </Container>
    </div>
  );
}
