"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, GripVertical, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { fieldClass } from "@/components/ui/field";
import type { Dictionary } from "@/i18n/get-dictionary";

export type CheckoutFieldRow = {
  id: string;
  label: string;
  label_en: string | null;
  field_type: "text" | "textarea" | "select";
  options: string[];
  required: boolean;
  active: boolean;
};

const labelClass = "text-sm font-semibold";

// Store-level custom checkout fields (0180). Answers ride along as a jsonb blob
// on the order — nothing here touches price/stock.
export function CheckoutFieldsManager({
  storeId,
  dict,
  initial,
}: {
  storeId: string;
  dict: Pick<Dictionary, "common" | "merchant">;
  initial: CheckoutFieldRow[];
}) {
  const router = useRouter();
  const t = dict.merchant.checkoutFields;
  const [rows, setRows] = useState<CheckoutFieldRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [type, setType] = useState<"text" | "textarea" | "select">("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);

  function reset() {
    setLabel("");
    setLabelEn("");
    setType("text");
    setOptions("");
    setRequired(false);
  }

  async function add() {
    const opts =
      type === "select"
        ? options
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
    if (busy || !label.trim() || (type === "select" && opts.length < 2)) return;
    setBusy(true);
    const { data, error } = await createClient()
      .from("store_checkout_fields")
      .insert({
        store_id: storeId,
        label: label.trim(),
        label_en: labelEn.trim() || null,
        field_type: type,
        options: opts,
        required,
        sort_order: rows.length,
      })
      .select("id, label, label_en, field_type, options, required, active")
      .single();
    setBusy(false);
    if (error || !data) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setRows([...rows, data as unknown as CheckoutFieldRow]);
    reset();
    setOpen(false);
    notifySuccess(t.added);
    router.refresh();
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_checkout_fields")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setRows(rows.filter((r) => r.id !== id));
    router.refresh();
  }

  async function toggle(id: string, active: boolean) {
    setBusy(true);
    const { error } = await createClient()
      .from("store_checkout_fields")
      .update({ active })
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setRows(rows.map((r) => (r.id === id ? { ...r, active } : r)));
    router.refresh();
  }

  const typeLabel: Record<string, string> = {
    text: t.typeText,
    textarea: t.typeTextarea,
    select: t.typeSelect,
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <ClipboardList className="h-5 w-5 text-primary" />
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      {rows.length > 0 && (
        <div className="mt-4 space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`flex items-center gap-2 rounded-xl border border-border p-3 ${
                r.active ? "" : "opacity-50"
              }`}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {r.label}
                  {r.required && (
                    <span className="ms-1 text-danger">*</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {typeLabel[r.field_type]}
                  {r.field_type === "select" && r.options.length > 0
                    ? ` · ${r.options.join("، ")}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(r.id, !r.active)}
                className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-bold transition-colors hover:border-primary hover:text-primary"
              >
                {r.active ? t.hide : t.show}
              </button>
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label={t.delete}
                className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-danger hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="cf_label">
                {t.label}
              </label>
              <input
                id="cf_label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t.labelPlaceholder}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="cf_label_en">
                {t.labelEn}
              </label>
              <input
                id="cf_label_en"
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                dir="ltr"
                className={fieldClass}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="cf_type">
                {t.type}
              </label>
              <select
                id="cf_type"
                value={type}
                onChange={(e) =>
                  setType(e.target.value as "text" | "textarea" | "select")
                }
                className={fieldClass}
              >
                <option value="text">{t.typeText}</option>
                <option value="textarea">{t.typeTextarea}</option>
                <option value="select">{t.typeSelect}</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {t.required}
            </label>
          </div>
          {type === "select" && (
            <div>
              <label className={labelClass} htmlFor="cf_options">
                {t.options}
              </label>
              <input
                id="cf_options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder={t.optionsPlaceholder}
                className={fieldClass}
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={add}
              disabled={busy || !label.trim()}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {t.save}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {dict.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          {t.add}
        </button>
      )}
    </div>
  );
}
