import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  WA_LOCALES,
  resolveTemplates,
  type ResolvedTemplates,
  type WaLocale,
  type WaTargetType,
  type WaTemplateKey,
  type WaTemplateOverride,
} from "@/lib/wa-templates";

// Server reads for the WhatsApp action buttons. Both are DEFENSIVE by design:
// before migration 0309 is applied the two tables do not exist, the queries
// return an error, and the buttons carry on with the default wording and no
// «آخر إرسال». Nothing here throws.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The store's wording for every key and locale: overrides where the merchant
 *  saved one, defaults from code for the rest. `ready` is false when the
 *  overrides table could not be read (not yet migrated). */
export async function loadWaTemplates(
  supabase: Supabase,
  storeId: string,
): Promise<{ templates: ResolvedTemplates; ready: boolean }> {
  try {
    const { data, error } = await supabase
      .from("store_wa_templates")
      .select("key, locale, body")
      .eq("store_id", storeId);
    if (error) return { templates: resolveTemplates(null), ready: false };
    return {
      templates: resolveTemplates((data ?? []) as WaTemplateOverride[]),
      ready: true,
    };
  } catch {
    return { templates: resolveTemplates(null), ready: false };
  }
}

/** Just the bodies of one key, per locale — what a button needs. */
export function bodiesOf(
  templates: ResolvedTemplates,
  key: WaTemplateKey,
): Record<WaLocale, string> {
  const out = {} as Record<WaLocale, string>;
  for (const l of WA_LOCALES) out[l] = templates[key][l].body;
  return out;
}

/** Latest tap per (target, key), as "targetId:key" → ISO time. Empty when the
 *  log cannot be read (not yet migrated, or no permission). */
export async function loadLastSent(
  supabase: Supabase,
  storeId: string,
  targetType: WaTargetType,
  targetIds: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (targetIds.length === 0) return out;
  try {
    // Chunked: a long order list must not turn into one enormous URL.
    for (let i = 0; i < targetIds.length; i += 150) {
      const chunk = targetIds.slice(i, i + 150);
      const { data, error } = await supabase
        .from("wa_action_log")
        .select("target_id, key, created_at")
        .eq("store_id", storeId)
        .eq("target_type", targetType)
        .in("target_id", chunk)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) return out;
      for (const r of (data ?? []) as { target_id: string; key: string; created_at: string }[]) {
        const k = `${r.target_id}:${r.key}`;
        if (!out[k]) out[k] = r.created_at;
      }
    }
  } catch {
    /* best effort */
  }
  return out;
}
