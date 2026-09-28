"use server";

import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same one-arg wrapper as google-feed/actions.ts.
const bustTag = revalidateTag as unknown as (tag: string) => void;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * After the owner issues or voids a card, refresh the store's cached checkout
 * context so the «عندك بطاقة هدية؟» field appears (or disappears) now rather
 * than within the 5-minute cache window (lib/data/checkout.ts).
 *
 * Owner-checked before it busts anything: an unauthenticated cache-bust is a
 * lever for making a public route re-render on every request.
 */
export async function refreshGiftCardCheckout(storeId: string): Promise<void> {
  if (!UUID_RE.test(storeId)) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) return;
  bustTag(`store:${storeId}`);
}
