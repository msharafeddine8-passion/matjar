import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { todayInBeirut, type LedgerEntry } from "@/lib/ledger";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { LedgerCustomer } from "@/components/ledger/ledger-customer";
import { requireLedgerAccess, UUID_RE } from "../access";
import {
  bodiesOf,
  loadLastSent,
  loadWaTemplates,
} from "@/lib/wa-actions-server";

// One customer's page of the notebook: the running balance per currency, every
// line, the two big «أعطيت» / «استلمت» buttons, the WhatsApp reminder and the
// statement link.
export default async function LedgerCustomerPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string; customerId: string }>;
}) {
  const { lang, storeId, customerId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  if (!UUID_RE.test(customerId)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const access = await requireLedgerAccess(supabase, lang, storeId);

  const { data: customer } = await supabase
    .from("store_customers")
    .select("id, name, phone")
    .eq("id", customerId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (!customer) notFound();

  const [entriesRes, tokenRes, waTemplates, waLastSent] = await Promise.all([
    supabase
      .from("customer_transactions")
      .select("id, kind, amount, currency, label, happened_on, created_at, attachment_path")
      .eq("store_id", storeId)
      .eq("customer_id", customerId)
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("ledger_statement_tokens")
      .select("id, token")
      .eq("customer_id", customerId)
      .is("revoked_at", null)
      .maybeSingle(),
    // The reminder's wording (0309 overrides, else the default) and when it
    // was last sent. Both defensive: before 0309 they fall back quietly.
    loadWaTemplates(supabase, storeId),
    loadLastSent(supabase, storeId, "ledger_customer", [customerId]),
  ]);

  const entries = ((entriesRes.data ?? []) as LedgerEntry[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
  }));

  return (
    <div className="py-6 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}/ledger`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.ledger.title}
        </Link>

        <div className="mt-3">
          <LedgerCustomer
            key={customerId}
            storeId={storeId}
            storeName={access.storeName}
            lang={lang as Locale}
            t={dict.ledger}
            customer={customer as { id: string; name: string; phone: string | null }}
            entries={entries}
            token={(tokenRes.data as { id: string; token: string } | null) ?? null}
            today={todayInBeirut()}
            reminderBodies={bodiesOf(waTemplates.templates, "debt_reminder")}
            reminderLastSent={waLastSent[`${customerId}:debt_reminder`] ?? null}
            waT={dict.waActions}
          />
        </div>
      </Container>
    </div>
  );
}
