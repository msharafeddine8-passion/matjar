import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { toCategoryKey } from "@/lib/catalog";
import { sectorConfig } from "@/lib/sectors";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  CrmManager,
  type BookCustomer,
  type DerivedCustomer,
} from "@/components/crm-manager";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";
import { requireModuleAccess } from "@/lib/staff-access";
import { mergeCrmRows, type CrmRow } from "@/lib/crm-merge";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One already-grouped customer, as store_customer_order_totals returns it. */
type CustomerTotals = {
  customer_key: string;
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  order_count: number;
  total_spent: number;
  last_order: string | null;
};

// CRM module of the Business OS: the merchant's customer book + customers
// derived from orders. The page title speaks the sector's language (patients
// for clinics, leads for real estate…).
export default async function StoreCustomersPage({
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

  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isPro(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }

  // Staff: the permission the module's own tables check (requireModuleAccess).
  await requireModuleAccess(supabase, storeId, "customers", lang);
  const category = toCategoryKey(
    (store as unknown as { business_types: { slug: string } | null })
      .business_types?.slug,
    `store ${storeId}`,
  );
  const noun = dict.os.nouns[sectorConfig[category].customersNoun];

  const [
    { data: bookData },
    { data: ordersData },
    { data: bookingsData },
    { data: loyaltyData },
  ] = await Promise.all([
    supabase
      .from("store_customers")
      .select("id, name, phone, notes, status, follow_up_on")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
    // Aggregated in the database. This used to pull every order for the store
    // and add them up here, which PostgREST silently truncates at 1000 rows —
    // so past a thousand orders every customer's lifetime spend was wrong, and
    // wrong quietly, with a plausible number in its place.
    supabase.rpc("store_customer_order_totals", { p_store_id: storeId }),
    // Booking customers too — a padel/clinic customer who only booked (never
    // ordered) must still appear here with their name + phone.
    // A cancelled or rejected booking is not a visit: counting it made a
    // customer who booked and cancelled twice look like a regular.
    supabase
      .from("bookings")
      .select("customer_id, customer_name, phone, created_at")
      .eq("store_id", storeId)
      .not("status", "in", "(cancelled,rejected)"),
    // Available loyalty points per registered customer (RLS-safe reader).
    supabase.rpc("store_customer_loyalty", { p_store_id: storeId }),
  ]);
  const book = (bookData ?? []) as BookCustomer[];

  const balances: Record<string, number> = {};
  ((loyaltyData ?? []) as { uid: string; balance: number }[]).forEach((r) => {
    balances[r.uid] = Number(r.balance);
  });

  // The RPC groups a guest on the phone text exactly as typed, so «03 123456»
  // and «+9613123456» arrive as two customers. Order rows first (they carry
  // the spend), then booking customers (no revenue, but real people with a
  // name + phone), all folded by account id or canonical phone.
  const rows: CrmRow[] = [
    ...((ordersData ?? []) as CustomerTotals[]).map((r) => ({
      name: r.customer_name,
      phone: r.phone,
      count: r.order_count,
      total: Number(r.total_spent),
      customerId: r.customer_id,
      lastOrder: r.last_order,
    })),
    ...((bookingsData ?? []) as {
      customer_id: string | null;
      customer_name: string | null;
      phone: string | null;
      created_at: string;
    }[]).map((b) => ({
      name: b.customer_name,
      phone: b.phone,
      count: 1,
      total: 0,
      customerId: b.customer_id,
      lastOrder: b.created_at,
    })),
  ];
  const derived: DerivedCustomer[] = mergeCrmRows(rows).sort(
    (a, b) => b.total - a.total,
  );

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
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{noun}</h1>

        {/* ISS-034: a CRM with nothing in either tab is the screen a merchant
            arrives at on day one, and it used to say only "no orders yet" in a
            dashed box on one of the two tabs. The book below still offers its
            own "add a customer" form — this says where the OTHER half of the
            list comes from, and it is only rendered when both halves are empty
            so it never sits on top of a working CRM. */}
        {book.length === 0 && derived.length === 0 && (
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="customers"
            title={dict.os.crm.emptyDerived}
            className="mt-6"
          />
        )}

        <div className="mt-6">
          <CrmManager
            storeId={storeId}
            dict={dictSlice(dict, ["auth", "common", "merchant", "os"])}
            book={book}
            derived={derived}
            balances={balances}
          />
        </div>
      </Container>
    </div>
  );
}
