"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";

export type CourierCompany = {
  id: string;
  name: string;
  coverage: string | null;
  pricing_note: string | null;
};

export function StoreCouriersManager({
  storeId,
  dict,
  companies,
  selected,
  loadFailed = false,
}: {
  storeId: string;
  dict: Dictionary;
  companies: CourierCompany[];
  selected: Record<string, { price: string }>;
  /** The store's current couriers failed to load: saving would act on a
   *  blank picture, so the form shows an error and refuses to save. */
  loadFailed?: boolean;
}) {
  const router = useRouter();
  const t = dict.merchant.couriers;
  const [state, setState] = useState<
    Record<string, { enabled: boolean; price: string }>
  >(() => {
    const s: Record<string, { enabled: boolean; price: string }> = {};
    for (const c of companies) {
      s[c.id] = {
        enabled: c.id in selected,
        price: selected[c.id]?.price ?? "",
      };
    }
    return s;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (loadFailed) {
      // The current choices never loaded, so we can't tell what to keep.
      notifyError(dict.common.loadError);
      return;
    }
    setBusy(true);
    setSaved(false);
    const supabase = createClient();
    // Upsert what is ticked, then delete only what was unticked. Deleting
    // everything first meant a failed insert wiped the store's couriers, and
    // it also threw away each row's `note`, which this form never shows.
    const rows = companies
      .filter((c) => state[c.id]?.enabled)
      .map((c) => ({
        store_id: storeId,
        company_id: c.id,
        price:
          state[c.id].price.trim() === "" ? null : Number(state[c.id].price),
      }));
    const ins = rows.length
      ? await supabase
          .from("store_couriers")
          .upsert(rows, { onConflict: "store_id,company_id" })
      : { error: null };
    if (ins.error) {
      setBusy(false);
      console.error("[couriers] upsert failed", ins.error);
      notifyError(dict.auth.errorGeneric);
      return;
    }
    const unticked = companies
      .filter((c) => !state[c.id]?.enabled)
      .map((c) => c.id);
    const del = unticked.length
      ? await supabase
          .from("store_couriers")
          .delete()
          .eq("store_id", storeId)
          .in("company_id", unticked)
      : { error: null };
    setBusy(false);
    if (del.error) {
      console.error("[couriers] delete failed", del.error);
      notifyError(dict.auth.errorGeneric);
      router.refresh();
      return;
    }
    setSaved(true);
    router.refresh();
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <h2 className="font-bold">{t.title}</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t.noneAvailable}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Truck className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-bold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
      </div>

      {loadFailed && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-semibold text-danger">
          {dict.common.loadError}
        </p>
      )}
      <ul className="space-y-2">
        {companies.map((c) => {
          const row = state[c.id];
          return (
            <li
              key={c.id}
              className={`rounded-xl border p-3 transition-colors ${
                row.enabled ? "border-primary/40 bg-primary-soft/30" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        [c.id]: { ...s[c.id], enabled: e.target.checked },
                      }))
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="truncate">{c.name}</span>
                </label>
                {row.enabled && (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.price}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        [c.id]: { ...s[c.id], price: e.target.value },
                      }))
                    }
                    placeholder={t.pricePlaceholder}
                    className="w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
                  />
                )}
              </div>
              {(c.coverage || c.pricing_note) && (
                <p className="mt-1 ps-6 text-xs text-muted-foreground">
                  {[c.coverage, c.pricing_note].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || loadFailed}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          {busy ? dict.account.saving : dict.account.save}
        </button>
        {saved && (
          <span className="text-sm font-semibold text-primary">
            {dict.account.saved}
          </span>
        )}
      </div>
    </div>
  );
}
