"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same one-arg wrapper as lib/cache-actions.ts: for `unstable_cache` tags the
// single-argument form is the documented on-demand invalidator.
const bustTag = revalidateTag as unknown as (tag: string) => void;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refresh the cached public feed and policies page for one store, right after
 * its owner switches the feed or edits a policy — otherwise the feed would keep
 * answering the old way for up to an hour (it is ISR-cached, see
 * app/feeds/[slug]/google.xml/route.ts).
 *
 * Owner-checked before it busts anything: an unauthenticated action that
 * invalidates caches is a lever for making a crawler-hit route render on every
 * request, which is exactly the bill vercel-cost-guard exists to prevent.
 */
export async function revalidateGoogleFeed(storeId: string): Promise<void> {
  if (!UUID_RE.test(storeId)) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase
    .from("stores")
    .select("slug")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) return;
  const slug = (data as { slug: string | null }).slug;
  revalidatePath(`/feeds/${storeId}/google.xml`);
  if (slug) revalidatePath(`/feeds/${slug}/google.xml`);
  bustTag(`store:${storeId}`);
}
