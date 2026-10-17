"use server";

import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Server actions client components call after a mutation, so the cross-request
// caches (see src/lib/data/*) refresh immediately instead of waiting out their
// TTL. revalidateTag itself is cheap — it just marks the tag stale.
//
// What is NOT cheap is letting anybody call it. A server action is a public
// POST endpoint: these used to bust tags for whoever asked, signed in or not,
// so a loop could keep the public listing, every product page and every
// storefront permanently uncached and re-rendering on each request. Every
// action now checks who is asking first, the same way the gift-card action
// does (merchant/[storeId]/gift-cards/actions.ts):
//
//   • a signed-in user, always;
//   • where an id names something, someone allowed to change that thing — the
//     store's managers (can_manage_store), the listing's seller, or an admin
//     holding the matching section (admin_can).
//
// A refused call returns quietly instead of throwing: the mutation it follows
// has already succeeded, and the tag still expires on its own TTL.
//
// Next 16's revalidateTag type gained a required Cache-Components profile arg,
// but for `unstable_cache` tags the single-arg form is still the documented
// on-demand invalidator (see the caching-without-cache-components guide). Call
// it through a one-arg-typed wrapper so we hit that runtime behaviour.
const bustTag = revalidateTag as unknown as (tag: string) => void;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supa = Awaited<ReturnType<typeof createClient>>;

/** The signed-in caller, or null. */
async function caller(): Promise<{ supabase: Supa; userId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

async function adminCan(supabase: Supa, section: string): Promise<boolean> {
  const { data } = await supabase.rpc("admin_can", { section });
  return data === true;
}

async function canManageStore(supabase: Supa, storeId: string): Promise<boolean> {
  if (!UUID_RE.test(storeId)) return false;
  const { data } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  return data === true;
}

/** Bust the cached active-store listing (store created / edited / approved).
 *  Merchants call it after editing their own store and admins after a status
 *  change; neither names a store, so the bar is a signed-in caller. */
export async function revalidateStores() {
  if (!(await caller())) return;
  bustTag("stores");
}

/** Bust the cached USD→LBP rate (admin changed it). Admin-only: the only
 *  caller is the admin settings screen. */
export async function revalidateRate() {
  const who = await caller();
  if (!who || !(await adminCan(who.supabase, "settings"))) return;
  bustTag("usd_lbp_rate");
}

/** Bust a product's cached public view (product created / edited / deleted).
 *  With an id: only that product's store managers, or a deals admin (the admin
 *  deals screen edits other stores' products). */
export async function revalidateProduct(id?: string) {
  const who = await caller();
  if (!who) return;
  if (id) {
    if (!UUID_RE.test(id)) return;
    // products_select shows the owner and permitted staff their own rows,
    // soft-deleted ones included — which is what a delete-then-bust needs.
    const { data } = await who.supabase
      .from("products")
      .select("store_id")
      .eq("id", id)
      .maybeSingle();
    const storeId = (data as { store_id: string } | null)?.store_id;
    const allowed =
      (storeId != null && (await canManageStore(who.supabase, storeId))) ||
      (await adminCan(who.supabase, "deals"));
    if (!allowed) return;
  }
  bustTag("products");
  if (id) bustTag(`product:${id}`);
}

/**
 * Bust one store's cached public page (see getPublicStoreView, tagged
 * `store:<id>` with a 300s TTL).
 *
 * The storefront's product list is baked into that cached view, so
 * revalidateProduct() alone does not refresh it — its `products` tag is a
 * different cache. Anything that changes what a store sells has to bust this
 * too, or the merchant looks at their own shop, sees the old catalogue, and
 * concludes the change didn't save.
 *
 * Only someone who can manage that store (or a stores admin).
 */
export async function revalidateStore(id: string) {
  const who = await caller();
  if (!who || !UUID_RE.test(id)) return;
  const allowed =
    (await canManageStore(who.supabase, id)) ||
    (await adminCan(who.supabase, "stores"));
  if (!allowed) return;
  bustTag(`store:${id}`);
}

/** Bust a Sunday-Market listing's cached public view (created / edited /
 *  moderated). With an id: the listing's seller or a market admin. */
export async function revalidateListing(id?: string) {
  const who = await caller();
  if (!who) return;
  if (id) {
    if (!UUID_RE.test(id)) return;
    const { data } = await who.supabase
      .from("listings")
      .select("seller_id")
      .eq("id", id)
      .maybeSingle();
    const sellerId = (data as { seller_id: string } | null)?.seller_id;
    // No row: the seller has just hard-deleted it (my-listings-manager), so
    // there is nobody left to compare against. Busting the tag of a listing
    // that no longer exists only drops a stale copy of a gone page.
    const allowed =
      sellerId === undefined ||
      sellerId === who.userId ||
      (await adminCan(who.supabase, "market"));
    if (!allowed) return;
  }
  bustTag("listings");
  if (id) bustTag(`listing:${id}`);
}
