"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, BedDouble, Save, X } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { fieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CatalogRowActions,
  updateCatalogRow,
  useCatalogRowOps,
} from "@/components/catalog-row-actions";

export type UnitRow = {
  id: string;
  name: string;
  unit_type: string | null;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  base_nightly_price: number;
  weekend_price: number | null;
  min_nights: number;
  cleaning_fee: number;
  security_deposit: number;
  active: boolean;
};

const field = `${fieldClass} mt-1`;

// Merchant unit management for accommodation (0191). Add / edit / hide /
// delete units; RLS (units_manage, FOR ALL, staff_can 'products') scopes every
// write to the store's managers. The same form adds and edits: "edit" fills it
// from the row and the submit becomes an update.
export function UnitManager({
  storeId,
  dict,
  initial,
}: {
  storeId: string;
  dict: Pick<Dictionary, "auth" | "catalogItem" | "common" | "os">;
  initial: UnitRow[];
}) {
  const router = useRouter();
  const t = dict.os.units;
  const c = dict.catalogItem;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ops = useCatalogRowOps("accommodation_units", dict);

  function startEdit(u: UnitRow) {
    setEditing(u);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const values = {
      name,
      unit_type: String(form.get("unit_type") ?? "").trim() || null,
      max_guests: Number(form.get("max_guests")) || 2,
      bedrooms: Number(form.get("bedrooms")) || 1,
      bathrooms: Number(form.get("bathrooms")) || 1,
      base_nightly_price: Number(form.get("nightly")) || 0,
      weekend_price: Number(form.get("weekend")) || null,
      min_nights: Number(form.get("min_nights")) || 1,
      cleaning_fee: Number(form.get("cleaning")) || 0,
      security_deposit: Number(form.get("deposit")) || 0,
    };
    setBusy(true);
    if (editing) {
      const ok = await updateCatalogRow("accommodation_units", editing.id, values);
      setBusy(false);
      if (!ok) {
        notifyError(dict.common.actionFailed);
        return;
      }
      notifySuccess(c.saved);
      setEditing(null);
      router.refresh();
      return;
    }
    const { error } = await createClient()
      .from("accommodation_units")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    formEl.reset();
    router.refresh();
  }

  // Remounting on the edited row's id is what swaps the defaultValues in.
  const v = editing;

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        {initial.length ? (
          <div className="space-y-3">
            {initial.map((u) => (
              <div
                key={u.id}
                className={`flex items-center gap-3 rounded-xl border bg-surface p-3 ${
                  editing?.id === u.id ? "border-primary" : "border-border"
                }`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                  <BedDouble className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-semibold">{u.name}</span>
                    {!u.active && (
                      <Badge variant="neutral" size="sm">
                        {c.hiddenBadge}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {u.max_guests} · {u.bedrooms} · ${u.base_nightly_price}
                    {u.weekend_price ? ` / $${u.weekend_price}` : ""}
                  </p>
                </div>
                <CatalogRowActions
                  dict={dict}
                  deleteLabel={t.delete}
                  busy={ops.busyId === u.id}
                  active={u.active}
                  onEdit={() => startEdit(u)}
                  onToggleActive={() => ops.setActive(u.id, !u.active)}
                  onDelete={() => ops.remove(u.id, true)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
      </div>

      <form
        ref={formRef}
        key={v?.id ?? "new"}
        onSubmit={submit}
        className={`space-y-3 rounded-2xl border bg-surface p-5 ${
          v ? "border-primary" : "border-border"
        }`}
      >
        <h3 className="font-bold">
          {v ? c.editTitle.replace("{name}", v.name) : t.add}
        </h3>
        <div>
          <label className="text-sm font-semibold">
            {t.name}
            <input name="name" required defaultValue={v?.name ?? ""} className={field} />
          </label>
        </div>
        <div>
          <label className="text-sm font-semibold">
            {t.type}
            <input name="unit_type" defaultValue={v?.unit_type ?? ""} className={field} />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm font-semibold">
            {t.guests}
            <input name="max_guests" type="number" min="1" defaultValue={v?.max_guests ?? 2} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.bedrooms}
            <input name="bedrooms" type="number" min="0" defaultValue={v?.bedrooms ?? 1} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.bathrooms}
            <input name="bathrooms" type="number" min="0" defaultValue={v?.bathrooms ?? 1} className={field} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold">
            {t.nightly}
            <input name="nightly" type="number" min="0" step="0.01" defaultValue={v?.base_nightly_price ?? ""} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.weekend}
            <input name="weekend" type="number" min="0" step="0.01" defaultValue={v?.weekend_price ?? ""} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.minNights}
            <input name="min_nights" type="number" min="1" defaultValue={v?.min_nights ?? 1} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.cleaning}
            <input name="cleaning" type="number" min="0" step="0.01" defaultValue={v?.cleaning_fee ?? 0} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.deposit}
            <input name="deposit" type="number" min="0" step="0.01" defaultValue={v?.security_deposit ?? 0} className={field} />
          </label>
        </div>
        <Button
          type="submit"
          full
          loading={busy}
          leftIcon={v ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        >
          {v ? c.saveChanges : t.save}
        </Button>
        {v && (
          <Button
            type="button"
            variant="secondary"
            full
            onClick={() => setEditing(null)}
            leftIcon={<X className="h-4 w-4" />}
          >
            {c.cancelEdit}
          </Button>
        )}
      </form>
    </div>
  );
}
