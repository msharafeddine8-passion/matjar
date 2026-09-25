import "server-only";
import { redirect } from "next/navigation";
import type { createClient } from "@/lib/supabase/server";

// Who may open دفتر الدين, decided once for both ledger screens.
//
// NO PLAN CHECK, on purpose: the ledger is free on every plan
// (FEATURES.debtLedger, OS_MODULE_META.ledger has no minPlan). The CRM screen
// next door is Pro; this one is not, and must not borrow its ProGate.
//
// The staff permission is `customers` — the key the database has gated
// customer_transactions and store_customers on since 0211 (see 0307's header).
// Checking the same key here means the screen opens for exactly the people the
// RLS lets read the rows, and nobody gets a page full of empty lists. The owner
// always passes, as staff_can() does.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LedgerAccess = {
  userId: string;
  storeName: string;
  isOwner: boolean;
};

export async function requireLedgerAccess(
  supabase: Supabase,
  lang: string,
  storeId: string,
): Promise<LedgerAccess> {
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
    .select("name, owner_id")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const s = store as { name: string; owner_id: string };
  const isOwner = s.owner_id === user.id;
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms =
      (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.customers ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  return { userId: user.id, storeName: s.name, isOwner };
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
