"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Ticket, Save, X } from "lucide-react";
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

export type TicketTypeRow = {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  price: number;
  capacity: number | null;
  sold: number;
  active: boolean;
};

const field = `${fieldClass} mt-1`;

// Merchant ticket-type management for events (0193). Add / edit / hide /
// delete ticket types; RLS (ticket_types_manage, FOR ALL, staff_can
// 'products') scopes writes to the store's managers. `sold` is read-only
// (driven by buy_tickets) and is never in an update; capacity cannot be edited
// below what is already sold. A type with sales cannot be deleted (its tickets
// keep it — 23503); hide it instead.
export function TicketTypeManager({
  storeId,
  dict,
  initial,
}: {
  storeId: string;
  dict: Dictionary;
  initial: TicketTypeRow[];
}) {
  const router = useRouter();
  const t = dict.os.tickets;
  const c = dict.catalogItem;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<TicketTypeRow | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ops = useCatalogRowOps("event_ticket_types", dict);

  function startEdit(tt: TicketTypeRow) {
    setEditing(tt);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const formEl = ev.currentTarget;
    const form = new FormData(formEl);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const capRaw = String(form.get("capacity") ?? "").trim();
    const values = {
      name,
      name_en: String(form.get("name_en") ?? "").trim() || null,
      description: String(form.get("description") ?? "").trim() || null,
      price: Number(form.get("price")) || 0,
      capacity: capRaw === "" ? null : Math.max(0, Number(capRaw)),
    };
    setBusy(true);
    if (editing) {
      const ok = await updateCatalogRow("event_ticket_types", editing.id, values);
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
      .from("event_ticket_types")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    formEl.reset();
    router.refresh();
  }

  const cur = editing;

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        {initial.length ? (
          <div className="space-y-3">
            {initial.map((tt) => {
              const left = tt.capacity == null ? null : tt.capacity - tt.sold;
              return (
                <div
                  key={tt.id}
                  className={`flex items-center gap-3 rounded-xl border bg-surface p-3 ${
                    cur?.id === tt.id ? "border-primary" : "border-border"
                  }`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                    <Ticket className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-semibold">{tt.name}</span>
                      {!tt.active && (
                        <Badge variant="neutral" size="sm">
                          {c.hiddenBadge}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ${tt.price} · {tt.sold} {t.soldCount}
                      {left != null ? ` · ${left} ${t.remaining}` : ` · ${t.unlimited}`}
                    </p>
                  </div>
                  <CatalogRowActions
                    dict={dict}
                    deleteLabel={t.delete}
                    busy={ops.busyId === tt.id}
                    active={tt.active}
                    onEdit={() => startEdit(tt)}
                    onToggleActive={() => ops.setActive(tt.id, !tt.active)}
                    onDelete={() => ops.remove(tt.id, true)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
      </div>

      <form
        ref={formRef}
        key={cur?.id ?? "new"}
        onSubmit={submit}
        className={`space-y-3 rounded-2xl border bg-surface p-5 ${
          cur ? "border-primary" : "border-border"
        }`}
      >
        <h3 className="font-bold">
          {cur ? c.editTitle.replace("{name}", cur.name) : t.add}
        </h3>
        <div>
          <label className="text-sm font-semibold">
            {t.name}
            <input name="name" required defaultValue={cur?.name ?? ""} className={field} />
          </label>
        </div>
        <div>
          <label className="text-sm font-semibold">
            {t.nameEn}
            <input name="name_en" defaultValue={cur?.name_en ?? ""} className={field} />
          </label>
        </div>
        <div>
          <label className="text-sm font-semibold">
            {t.description}
            <input name="description" defaultValue={cur?.description ?? ""} className={field} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold">
            {t.price}
            <input name="price" type="number" min="0" step="0.01" defaultValue={cur?.price ?? ""} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {t.capacity}
            <input
              name="capacity"
              type="number"
              // Never below what has already been sold.
              min={cur?.sold ?? 0}
              defaultValue={cur?.capacity ?? ""}
              placeholder={t.unlimited}
              className={field}
            />
          </label>
        </div>
        <Button
          type="submit"
          full
          loading={busy}
          leftIcon={cur ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        >
          {cur ? c.saveChanges : t.save}
        </Button>
        {cur && (
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
