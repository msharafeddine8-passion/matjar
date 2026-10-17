"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Check,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { localized } from "@/lib/i18n-field";
import { notifyError } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type SectionRow = {
  id: string;
  name: string;
  name_en: string | null;
  sort_order: number;
};

type Draft = { name: string; name_en: string };

const emptyDraft: Draft = { name: "", name_en: "" };

// Merchant-side manager for storefront sections (menu groups / collections /
// service groups). List, add, edit, reorder and delete — RLS-guarded direct
// writes, same authority model as BranchManager. Products get assigned to a
// section from the product form; this only owns the sections themselves.
export function SectionManager({
  storeId,
  lang,
  dict,
  initial,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "merchant">;
  initial: SectionRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.merchant.sections;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setDraft(emptyDraft);
    setEditingId("new");
  }
  function openEdit(s: SectionRow) {
    setDraft({ name: s.name ?? "", name_en: s.name_en ?? "" });
    setEditingId(s.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function save() {
    if (!draft.name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const payload = {
      name: draft.name.trim(),
      name_en: draft.name_en.trim() || null,
    };
    const { error } =
      editingId === "new"
        ? await supabase.from("store_sections").insert({
            ...payload,
            store_id: storeId,
            // New sections sort after the current last one.
            sort_order: initial.length
              ? Math.max(...initial.map((s) => s.sort_order)) + 1
              : 0,
          })
        : editingId
          ? await supabase
              .from("store_sections")
              .update(payload)
              .eq("id", editingId)
          : { error: null };
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    cancel();
    router.refresh();
  }

  async function remove(s: SectionRow) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    // Products keep existing — the FK is ON DELETE SET NULL, so they fall back
    // to the "Other" group on the storefront.
    const { error } = await createClient()
      .from("store_sections")
      .delete()
      .eq("id", s.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  // Reorder by moving the section one slot in the given direction, then
  // renumbering sort_order densely by array index (0,1,2,…). Renumbering the
  // whole list keeps up/down working even when legacy rows share a sort_order
  // (e.g. all at 0), where a two-row swap would be a no-op.
  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= initial.length) return;
    const reordered = [...initial];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setBusy(true);
    const supabase = createClient();
    const results = await Promise.all(
      reordered.map((s, i) =>
        supabase
          .from("store_sections")
          .update({ sort_order: i })
          .eq("id", s.id),
      ),
    );
    setBusy(false);
    if (results.some((r) => r.error)) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  const form = (
    <div className="rounded-2xl border border-primary/30 bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          {t.name}
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t.nameHint}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.nameEn}
          <input
            value={draft.name_en}
            onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          onClick={save}
          loading={busy}
          disabled={!draft.name.trim()}
          leftIcon={<Check className="h-4 w-4" />}
        >
          {t.save}
        </Button>
        <Button variant="ghost" onClick={cancel}>
          {t.cancel}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold">
          <Layers className="h-5 w-5 text-primary" />
          {t.title}
        </h2>
        {editingId === null && (
          <Button
            variant="secondary"
            size="sm"
            onClick={openNew}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t.add}
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      <div className="mt-4 space-y-2">
        {initial.map((s, i) =>
          editingId === s.id ? (
            <div key={s.id}>{form}</div>
          ) : (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3.5 py-2.5"
            >
              <span className="min-w-0 truncate font-semibold">
                {localized(s.name, s.name_en, lang)}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={busy || i === 0}
                  aria-label={t.moveUp}
                  title={t.moveUp}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={busy || i === initial.length - 1}
                  aria-label={t.moveDown}
                  title={t.moveDown}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => openEdit(s)}
                  aria-label={t.edit}
                  title={t.edit}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(s)}
                  aria-label={t.delete}
                  title={t.delete}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ),
        )}

        {editingId === "new" && form}

        {initial.length === 0 && editingId === null && (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            {t.empty}
          </div>
        )}
      </div>
    </div>
  );
}
