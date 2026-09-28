import "server-only";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { Container } from "@/components/ui/container";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan, hasPlan, planProductLimit } from "@/lib/plan-tiers";
import { todayInBeirut } from "@/lib/ledger";
import { OPENING_LABEL, type ImportEntity } from "@/lib/import-mapping";
import { ImportWizard } from "./import-wizard";

// The one import screen, for products, customers and ledger opening balances.
// Rendered by merchant/[storeId]/import (all three) and by the older
// merchant/[storeId]/products/import (products first), so there is one importer.
//
// PLAN: none for customers and ledger (the ledger and the customer rows are
// free on every plan). Products follow what the DATABASE enforces: after
// migration 0311, import_products has no plan gate (the product cap still
// applies); before it, it refuses anything below Pro. import_rules() — added by
// 0311 — says which of the two is live, and a failed call means "before".
//
// PERMISSION: products need the staff `products` key, customers and balances
// need `customers` — the keys RLS gates those rows on. The owner has both.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Every row, page by page: PostgREST caps a single response (1,000 rows on
 *  Supabase by default), and a duplicate check that silently saw only the
 *  first 1,000 products would create the 1,001st as a twin. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  max = 20000,
): Promise<T[] | null> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; from < max; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) return null;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function ImportPage({
  params,
  initial,
}: {
  params: Promise<{ lang: string; storeId: string }>;
  initial: ImportEntity;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.importer;

  const supabase: Supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", { p_store_id: storeId });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: storeRow } = await supabase
    .from("stores")
    .select("id, name, owner_id, plan, trial_ends_at")
    .eq("id", storeId)
    .maybeSingle();
  if (!storeRow) redirect(`/${lang}/merchant`);
  const store = storeRow as {
    name: string;
    owner_id: string;
    plan: string | null;
    trial_ends_at: string | null;
  };

  const isOwner = store.owner_id === user.id;
  let perms: Record<string, boolean> = {};
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    perms = (staffRow?.permissions as Record<string, boolean> | null) ?? {};
  }
  const canProducts = isOwner || (perms.products ?? false);
  const canCustomers = isOwner || (perms.customers ?? false);
  if (!canProducts && !canCustomers) redirect(`/${lang}/merchant/${storeId}`);

  const plan = effectivePlan(store.plan, store.trial_ends_at);
  const limit = planProductLimit(plan);

  // Which rules the database enforces. Absent function (before 0311) → the
  // old ones: products on Pro only, no name fallback.
  const rulesRes = await supabase.rpc("import_rules");
  const rules = (rulesRes.error ? null : rulesRes.data) as
    | { all_tiers?: boolean; name_match?: boolean }
    | null;
  const allTiers = rules?.all_tiers === true;
  const nameMatchActive = rules?.name_match === true;
  const productsLocked = canProducts && !allTiers && !hasPlan(plan, "pro");

  const [productsRows, customerRows, openingRows] = await Promise.all([
    canProducts
      ? fetchAll<{ id: string; sku: string | null; name: string }>((from, to) =>
          supabase
            .from("products")
            .select("id, sku, name")
            .eq("store_id", storeId)
            .is("deleted_at", null)
            .order("created_at")
            .range(from, to),
        )
      : Promise.resolve([] as { id: string; sku: string | null; name: string }[]),
    canCustomers
      ? fetchAll<{ id: string; name: string; phone: string | null }>((from, to) =>
          supabase
            .from("store_customers")
            .select("id, name, phone")
            .eq("store_id", storeId)
            .order("created_at")
            .range(from, to),
        )
      : Promise.resolve([] as { id: string; name: string; phone: string | null }[]),
    canCustomers
      ? fetchAll<{ customer_id: string; currency: string }>((from, to) =>
          supabase
            .from("customer_transactions")
            .select("customer_id, currency")
            .eq("store_id", storeId)
            .eq("label", OPENING_LABEL)
            .order("created_at")
            .range(from, to),
        )
      : Promise.resolve([] as { customer_id: string; currency: string }[]),
  ]);

  // A tab whose duplicate check could not load is not offered: importing
  // without it could double a catalogue or a customer list.
  const entities: ImportEntity[] = [];
  if (canProducts && productsRows) entities.push("products");
  if (canCustomers && customerRows) entities.push("customers");
  if (canCustomers && customerRows && openingRows) entities.push("ledger");
  if (entities.length === 0) redirect(`/${lang}/merchant/${storeId}`);

  return (
    <div className="py-6 sm:py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="relative inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {store.name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <FileSpreadsheet className="h-7 w-7 shrink-0 text-primary" aria-hidden />
          {t.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t.subtitle}</p>

        <div className="mt-6">
          <ImportWizard
            storeId={storeId}
            lang={lang}
            entities={entities}
            initial={entities.includes(initial) ? initial : entities[0]}
            productsLocked={productsLocked}
            planLimit={Number.isFinite(limit) ? limit : null}
            nameMatchActive={nameMatchActive}
            existingProducts={productsRows ?? []}
            existingCustomers={customerRows ?? []}
            existingOpenings={(openingRows ?? []).map((r) => `${r.customer_id}:${r.currency}`)}
            todayIso={todayInBeirut()}
            t={t}
          />
        </div>
      </Container>
    </div>
  );
}
