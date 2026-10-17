import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isBusiness } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { ExpenseManager, type Expense } from "@/components/expense-manager";
import { BooksLock } from "@/components/books-lock";
import { requireModuleAccess } from "@/lib/staff-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

export default async function AccountingPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.merchant.accounting;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);
  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id, books_locked_until")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isBusiness(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} requiredPlan="business" />;
  }

  // Staff: the permission the module's own tables check (requireModuleAccess).
  await requireModuleAccess(supabase, storeId, "accounting", lang);
  const isOwner =
    (store as unknown as { owner_id: string }).owner_id === user.id;

  const [{ data: acctData }, { data: expData }] = await Promise.all([
    // Money totals aggregated server-side (migration 0087) so they can't
    // truncate past the 1000-row cap. The expense LIST below is display-only and
    // bounded — its total comes from the RPC, not from summing the fetched rows.
    supabase.rpc("store_accounting", { p_store_id: storeId }),
    supabase
      .from("store_expenses")
      .select("id, label, amount, category, spent_on")
      .eq("store_id", storeId)
      .order("spent_on", { ascending: false })
      .limit(200),
  ]);

  const acct = (acctData ?? {}) as {
    online_revenue?: number;
    online_realized?: number;
    online_pending?: number;
    pos_revenue?: number;
    total_expenses?: number;
    supplier_dues?: number;
  };
  const expenses = (expData ?? []) as Expense[];

  // Revenue leads with REALIZED (completed orders, net of refunds) so profit
  // isn't inflated by orders still in progress. Pending is shown separately so
  // nothing is hidden.
  const onlineRealized = Number(acct.online_realized ?? 0);
  const onlinePending = Number(acct.online_pending ?? 0);
  const posRevenue = Number(acct.pos_revenue ?? 0);
  const revenue = onlineRealized + posRevenue;
  const totalExpenses = Number(acct.total_expenses ?? 0);
  const profit = revenue - totalExpenses;
  const supplierDues = Number(acct.supplier_dues ?? 0);

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Wallet className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-success" />
              {t.revenue}
            </p>
            <p className="mt-1 text-2xl font-extrabold text-success">
              {money(revenue)}
            </p>
            {posRevenue > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                {dict.os.finance.online} {money(onlineRealized)} ·{" "}
                {dict.os.finance.pos} {money(posRevenue)}
              </p>
            )}
            {onlinePending > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-warning">
                {dict.os.finance.pending}: {money(onlinePending)}
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TrendingDown className="h-4 w-4 text-danger" />
              {t.expenses}
            </p>
            <p className="mt-1 text-2xl font-extrabold text-danger">
              {money(totalExpenses)}
            </p>
          </div>
          <div
            className={`rounded-2xl p-4 ${profit >= 0 ? "bg-primary text-primary-foreground" : "bg-danger-strong text-danger-strong-foreground"}`}
          >
            <p className="text-xs font-medium opacity-80">{t.profit}</p>
            <p className="mt-1 text-2xl font-extrabold">{money(profit)}</p>
          </div>
        </div>

        {supplierDues > 0 && (
          <Link
            href={`/${lang}/merchant/${storeId}/suppliers`}
            className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 transition-colors hover:border-warning/50"
          >
            <span className="text-sm font-bold text-warning">
              {dict.os.finance.supplierDues}
            </span>
            <span className="text-lg font-extrabold tabular-nums text-warning">
              {money(supplierDues)}
            </span>
          </Link>
        )}

        <div className="mt-6">
          <ExpenseManager storeId={storeId} dict={dict} expenses={expenses} />
        </div>

        {/* Owner only: closing a period is not a day-to-day action, and staff
            should not be able to seal or unseal the books they work in. */}
        {isOwner && (
          <div className="mt-6">
            <BooksLock
              storeId={storeId}
              lockedUntil={
                (store as unknown as { books_locked_until: string | null })
                  .books_locked_until
              }
              labels={{
                title: dict.os.finance.lockTitle,
                body: dict.os.finance.lockBody,
                current: dict.os.finance.lockCurrent,
                none: dict.os.finance.lockNone,
                save: dict.os.finance.lockSave,
                saving: dict.os.finance.lockSaving,
                saved: dict.os.finance.lockSaved,
                confirm: dict.os.finance.lockConfirm,
                confirmYes: dict.common.confirm,
                confirmNo: dict.common.cancel,
                error: dict.common.actionFailed,
              }}
            />
          </div>
        )}
      </Container>
    </div>
  );
}
