"use client";
import { notifyError, notifySuccess } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CatalogRowActions,
  updateCatalogRow,
  useCatalogRowOps,
} from "@/components/catalog-row-actions";

export type ClassRow = {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  day_of_week: number;
  start_time: string;
  capacity: number;
  price: number | null;
  active: boolean;
};

type Draft = {
  name: string;
  name_en: string;
  day_of_week: string;
  start_time: string;
  capacity: string;
  price: string;
  description: string;
};

const empty: Draft = {
  name: "",
  name_en: "",
  day_of_week: "1",
  start_time: "18:00",
  capacity: "10",
  price: "",
  description: "",
};

const labelClass = "text-sm font-semibold";

export function ClassesManager({
  storeId,
  lang,
  dict,
  classes,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "catalogItem" | "classes" | "common" | "merchant">;
  classes: ClassRow[];
}) {
  const router = useRouter();
  const t = dict.classes;
  const c = dict.catalogItem;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  // The row being edited; null = the form adds a new class.
  const [editingId, setEditingId] = useState<string | null>(null);
  const ops = useCatalogRowOps("store_classes", dict);

  function startNew() {
    setDraft({ ...empty });
    setEditingId(null);
    setAdding(true);
  }
  function startEdit(row: ClassRow) {
    setDraft({
      name: row.name,
      name_en: row.name_en ?? "",
      day_of_week: String(row.day_of_week),
      // time columns come back as HH:MM:SS; <input type="time"> wants HH:MM.
      start_time: row.start_time.slice(0, 5),
      capacity: String(row.capacity),
      price: row.price == null ? "" : String(row.price),
      description: row.description ?? "",
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
      description: draft.description.trim() || null,
      day_of_week: Number(draft.day_of_week),
      start_time: draft.start_time || "18:00",
      capacity: Number(draft.capacity) || 10,
      price: draft.price === "" ? null : Number(draft.price),
    };
    if (editingId) {
      const ok = await updateCatalogRow("store_classes", editingId, values);
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
      .from("store_classes")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  const editingName = classes.find((row) => row.id === editingId)?.name;

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      {editingName && (
        <h3 className="font-bold">{c.editTitle.replace("{name}", editingName)}</h3>
      )}
      <div>
        <label className={labelClass} htmlFor="cls-name">{t.name}</label>
        <Input
          id="cls-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="cls-name-en">{`${t.name} (EN)`}</label>
        <Input
          id="cls-name-en"
          value={draft.name_en}
          onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
          className="mt-1"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="cls-day">{t.day}</label>
          <Select
            id="cls-day"
            value={draft.day_of_week}
            onChange={(e) => setDraft({ ...draft, day_of_week: e.target.value })}
            className="mt-1"
          >
            {t.days.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="cls-start">{t.startTime}</label>
          <Input
            id="cls-start"
            type="time"
            value={draft.start_time}
            onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="cls-capacity">{t.capacity}</label>
          <Input
            id="cls-capacity"
            type="number"
            min={1}
            value={draft.capacity}
            onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
            className="mt-1"
          />
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="cls-price">{t.price}</label>
          <Input
            id="cls-price"
            type="number"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="cls-description">{t.description}</label>
        <Textarea
          id="cls-description"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="mt-1"
        />
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
        {classes.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {classes.map((row) => {
          const primary = lang === "en" ? row.name_en || row.name : row.name;
          return (
            <div
              key={row.id}
              className={`flex items-center gap-3 rounded-2xl border bg-surface p-3 ${
                editingId === row.id ? "border-primary" : "border-border"
              }`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                <CalendarClock className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-bold">{primary}</span>
                  {!row.active && (
                    <Badge variant="neutral" size="sm">
                      {c.hiddenBadge}
                    </Badge>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
                  <span>{t.days[row.day_of_week]}</span>
                  <span>·</span>
                  <span>{row.start_time}</span>
                  <span>·</span>
                  <span>{row.capacity}</span>
                  {row.price != null && <span>·</span>}
                  {row.price != null && <span>{row.price}</span>}
                </div>
                {row.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {row.description}
                  </p>
                )}
              </div>
              <CatalogRowActions
                dict={dict}
                deleteLabel={t.delete}
                busy={busy || ops.busyId === row.id}
                active={row.active}
                onEdit={() => startEdit(row)}
                onToggleActive={() => ops.setActive(row.id, !row.active)}
                onDelete={() => ops.remove(row.id, true)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
