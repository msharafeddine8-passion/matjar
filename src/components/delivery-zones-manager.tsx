"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fieldClass } from "@/components/ui/field";
import type { Dictionary } from "@/i18n/get-dictionary";

export type ZoneRowM = {
  id: string;
  name: string;
  name_en: string | null;
  fee: number;
  min_order: number | null;
  free_over: number | null;
  eta_min_minutes: number | null;
  eta_max_minutes: number | null;
  active: boolean;
};

// Merchant CRUD for delivery zones (0172). Writes go straight through the
// delivery_zones_manage RLS policy; the storefront picks these up on the next
// render (store page zones are fetched per-request, uncached).
export function DeliveryZonesManager({
  storeId,
  dict,
  initial,
}: {
  storeId: string;
  dict: Pick<Dictionary, "common" | "merchant">;
  initial: ZoneRowM[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.merchant.zones;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(initial.length === 0);
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [freeOver, setFreeOver] = useState("");
  const [etaMin, setEtaMin] = useState("");
  const [etaMax, setEtaMax] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const { error } = await createClient().from("store_delivery_zones").insert({
      store_id: storeId,
      name: name.trim(),
      fee: Number(fee) || 0,
      min_order: Number(minOrder) > 0 ? Number(minOrder) : null,
      free_over: Number(freeOver) > 0 ? Number(freeOver) : null,
      eta_min_minutes: Number(etaMin) > 0 ? Number(etaMin) : null,
      eta_max_minutes: Number(etaMax) > 0 ? Number(etaMax) : null,
      sort_order: initial.length,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(t.added);
    setName("");
    setFee("");
    setMinOrder("");
    setFreeOver("");
    setEtaMin("");
    setEtaMax("");
    router.refresh();
  }

  async function toggle(z: ZoneRowM) {
    if (busy) return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_delivery_zones")
      .update({ active: !z.active })
      .eq("id", z.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  async function remove(z: ZoneRowM) {
    if (
      !(await confirm({
        message: t.confirmDelete.replace("{name}", z.name),
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_delivery_zones")
      .delete()
      .eq("id", z.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <Truck className="h-5 w-5 text-primary" />
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      {initial.length > 0 && (
        <div className="mt-4 space-y-2">
          {initial.map((z) => (
            <div
              key={z.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border p-3 ${z.active ? "" : "opacity-50"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{z.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.feeShort}: ${Number(z.fee)}
                  {z.min_order != null && <> · {t.minShort}: ${Number(z.min_order)}</>}
                  {z.free_over != null && <> · {t.freeShort}: ${Number(z.free_over)}+</>}
                  {z.eta_min_minutes != null && z.eta_max_minutes != null && (
                    <> · ⏱️ {z.eta_min_minutes}–{z.eta_max_minutes} {t.minutes}</>
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggle(z)}
                disabled={busy}
                aria-label={z.active ? t.deactivate : t.activate}
                className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {z.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => remove(z)}
                disabled={busy}
                aria-label={t.delete}
                className="rounded-lg border border-border p-2 text-danger transition-colors hover:border-danger disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <form onSubmit={add} className="mt-4 space-y-3 rounded-xl bg-surface-muted/50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-semibold" htmlFor="zname">{t.name}</label>
              <input id="zname" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t.namePlaceholder} className={fieldClass} />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="zfee">{t.fee}</label>
              <input id="zfee" type="number" min="0" step="0.5" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="3" className={fieldClass} />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="zmin">{t.minOrder}</label>
              <input id="zmin" type="number" min="0" step="1" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="—" className={fieldClass} />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="zfree">{t.freeOver}</label>
              <input id="zfree" type="number" min="0" step="1" value={freeOver} onChange={(e) => setFreeOver(e.target.value)} placeholder="—" className={fieldClass} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-semibold" htmlFor="zetamin">{t.etaMin}</label>
                <input id="zetamin" type="number" min="0" step="5" value={etaMin} onChange={(e) => setEtaMin(e.target.value)} placeholder="30" className={fieldClass} />
              </div>
              <div>
                <label className="text-sm font-semibold" htmlFor="zetamax">{t.etaMax}</label>
                <input id="zetamax" type="number" min="0" step="5" value={etaMax} onChange={(e) => setEtaMax(e.target.value)} placeholder="45" className={fieldClass} />
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {t.add}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          {t.add}
        </button>
      )}
    </div>
  );
}
