"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { FeatureModuleKey } from "@/lib/modules-catalog";
import type { PlanFloor } from "@/lib/feature-availability";

export type ModuleItem = {
  key: FeatureModuleKey;
  /** The plan floor from the availability registry — the tier the module's
   *  own merchant screen is gated at, and the tier /pricing prints for it. */
  floor: PlanFloor;
  /** Resolved server-side against the store's real plan. */
  locked: boolean;
  enabled: boolean;
};

// Per-store module toggles. The merchant sees their sector's capabilities and
// switches them on/off; a module whose plan floor is above the store's plan is
// locked and says which plan it needs. Writes to store_modules; the public
// store page + dashboard read the resolved set.
export function ModulesManager({
  storeId,
  dict,
  items,
}: {
  storeId: string;
  dict: Dictionary;
  items: ModuleItem[];
}) {
  const router = useRouter();
  const t = dict.os.modules;
  const labels = t.labels as Record<string, string>;
  const planName = (floor: PlanFloor) =>
    floor === "free" ? null : dict.pricing.tiers[floor].name;
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((i) => [i.key, i.enabled])),
  );

  async function toggle(item: ModuleItem, next: boolean) {
    if (item.locked && next) return; // can't enable above the store's plan
    setBusy(item.key);
    setState((s) => ({ ...s, [item.key]: next }));
    const { error } = await createClient()
      .from("store_modules")
      .upsert(
        { store_id: storeId, module_key: item.key, enabled: next },
        { onConflict: "store_id,module_key" },
      );
    setBusy(null);
    if (error) {
      setState((s) => ({ ...s, [item.key]: !next }));
      return;
    }
    router.refresh();
  }

  function Row({ item }: { item: ModuleItem }) {
    const on = state[item.key];
    const locked = item.locked;
    const plan = planName(item.floor);
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold">{labels[item.key] ?? item.key}</span>
            {plan && (
              <Badge variant="accent" size="sm">
                {plan}
              </Badge>
            )}
          </div>
          {locked && plan && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dict.features.requiresPlan.replace("{plan}", plan)}
            </p>
          )}
        </div>
        <Switch
          checked={on}
          onChange={(next) => toggle(item, next)}
          label={labels[item.key] ?? item.key}
          disabled={busy === item.key || locked}
          knob={locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
        />
      </div>
    );
  }

  const active = items.filter((i) => state[i.key]);
  const available = items.filter((i) => !state[i.key]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {t.active}
        </h2>
        <div className="space-y-2">
          {active.map((i) => (
            <Row key={i.key} item={i} />
          ))}
        </div>
      </div>
      {available.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {t.available}
          </h2>
          <div className="space-y-2">
            {available.map((i) => (
              <Row key={i.key} item={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
