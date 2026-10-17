import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OS_MODULE_META, modulePerms, type OsModuleKey } from "@/lib/sectors";

// One answer to "may this person open this merchant screen?", asked of the
// database itself. staff_can() is what every table's RLS and every money RPC
// checks (true for the owner, else the staff row's permission), so a page that
// asks it can never let someone in to a screen whose data the database then
// refuses — the empty-list / failing-save trap the per-page checks kept falling
// into when each one guessed a key of its own.
//
// Owner-only modules (OS_MODULE_META.ownerOnly — the nav already hides them
// from staff) send everyone but the store's owner back to the OS home, so a
// typed URL can't open what the menu never offered.
//
// Call it after the page has confirmed the viewer manages the store at all
// (can_manage_store). Modules with no staff permission pass.
export async function requireModuleAccess(
  supabase: SupabaseClient,
  storeId: string,
  key: OsModuleKey,
  lang: string,
): Promise<void> {
  const home = `/${lang}/merchant/${storeId}`;
  if (OS_MODULE_META[key].ownerOnly) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/login`);
    const { data: own } = await supabase
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!own) redirect(home);
    return;
  }
  const need = modulePerms(key);
  if (need.length === 0) return;
  const answers = await Promise.all(
    need.map((p) =>
      supabase.rpc("staff_can", { p_store_id: storeId, p_perm: p }),
    ),
  );
  if (!answers.some((r) => r.data === true)) {
    redirect(home);
  }
}
