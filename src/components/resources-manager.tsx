"use client";
import { notifyError, notifySuccess } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CatalogRowActions,
  updateCatalogRow,
  useCatalogRowOps,
} from "@/components/catalog-row-actions";

export type Resource = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  open_hour: number;
  close_hour: number;
  active: boolean;
};

type Draft = {
  name: string;
  name_en: string;
  price: string;
  open_hour: string;
  close_hour: string;
};

const empty: Draft = {
  name: "",
  name_en: "",
  price: "",
  open_hour: "8",
  close_hour: "24",
};

const labelClass = "text-sm font-semibold";

export function ResourcesManager({
  storeId,
  lang,
  dict,
  resources,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  resources: Resource[];
}) {
  const router = useRouter();
  const t = dict.resources;
  const c = dict.catalogItem;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  // The row being edited; null = the form adds a new resource.
  const [editingId, setEditingId] = useState<string | null>(null);
  const ops = useCatalogRowOps("store_resources", dict);

  function startNew() {
    setDraft({ ...empty });
    setEditingId(null);
    setAdding(true);
  }
  function startEdit(row: Resource) {
    setDraft({
      name: row.name,
      name_en: row.name_en ?? "",
      price: row.price == null ? "" : String(row.price),
      open_hour: String(row.open_hour),
      close_hour: String(row.close_hour),
    });
    setEditingId(row.id);
    setAdding(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(empty);
  }

  async function save() {
    setBusy(true);
    const values = {
      name: draft.name.trim(),
      name_en: draft.name_en.trim() || null,
      price: draft.price === "" ? null : Number(draft.price),
      open_hour: Number(draft.open_hour) || 8,
      close_hour: Number(draft.close_hour) || 24,
    };
    if (editingId) {
      const ok = await updateCatalogRow("store_resources", editingId, values);
      setBusy(false);
      if (!ok) {
        notifyError(dict.common.actionFailed);
        return;
      }
      notifySuccess(c.saved);
      cancel();
      router.refresh();
      return;
    }
    const { error } = await createClient()
      .from("store_resources")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  const editingName = resources.find((row) => row.id === editingId)?.name;

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      {editingName && (
        <h3 className="font-bold">{c.editTitle.replace("{name}", editingName)}</h3>
      )}
      <div>
        <label className={labelClass} htmlFor="resource-name">{t.name}</label>
        <Input
          id="resource-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="resource-name-en">{`${t.name} (EN)`}</label>
        <Input
          id="resource-name-en"
          value={draft.name_en}
          onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="resource-price">{t.price}</label>
        <Input
          id="resource-price"
          type="number"
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          className="mt-1"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="resource-open-hour">{t.openHour}</label>
          <Input
            id="resource-open-hour"
            type="number"
            min={0}
            max={23}
            value={draft.open_hour}
            onChange={(e) => setDraft({ ...draft, open_hour: e.target.value })}
            className="mt-1"
          />
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="resource-close-hour">{t.closeHour}</label>
          <Input
            id="resource-close-hour"
            type="number"
            min={1}
            max={24}
            value={draft.close_hour}
            onChange={(e) => setDraft({ ...draft, close_hour: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button disabled={!draft.name.trim()} loading={busy} onClick={save}>
          {editingId ? c.saveChanges : t.save}
        </Button>
        <Button
          variant="secondary"
          onClick={cancel}
          leftIcon={<X className="h-4 w-4" />}
        >
          {editingId ? c.cancelEdit : dict.merchant.doctors.cancel}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-end">
        {!adding && (
          <Button
            onClick={startNew}
            className="shrink-0"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t.add}
          </Button>
        )}
      </div>

      {adding && <div className="mt-4">{form}</div>}

      <div className="mt-4 space-y-2">
        {resources.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {resources.map((r) => {
          const primary =
            lang === "en" ? r.name_en || r.name : r.name;
          const secondary =
            lang === "en" ? (r.name_en ? r.name : null) : r.name_en;
          return (
            <div
              key={r.id}
              className={`flex items-center gap-3 rounded-2xl border bg-surface p-3 ${
                editingId === r.id ? "border-primary" : "border-border"
              }`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                <CalendarClock className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-bold">{primary}</span>
                  {!r.active && (
                    <Badge variant="neutral" size="sm">
                      {c.hiddenBadge}
                    </Badge>
                  )}
                </p>
                {secondary && (
                  <p className="truncate text-sm text-muted-foreground">
                    {secondary}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                  {r.price != null && (
                    <span>
                      {t.price}: {r.price}
                    </span>
                  )}
                  <span className="tabular-nums">
                    {r.open_hour}:00 – {r.close_hour}:00
                  </span>
                </div>
              </div>
              <CatalogRowActions
                dict={dict}
                deleteLabel={t.delete}
                busy={busy || ops.busyId === r.id}
                active={r.active}
                onEdit={() => startEdit(r)}
                onToggleActive={() => ops.setActive(r.id, !r.active)}
                onDelete={() => ops.remove(r.id, true)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
