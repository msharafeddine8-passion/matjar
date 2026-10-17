"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { Container } from "@/components/ui/container";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type MarketCategoryRow = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
};

type Draft = Omit<MarketCategoryRow, "id">;

const empty: Draft = {
  slug: "",
  name_ar: "",
  name_en: "",
  sort_order: 0,
  is_active: true,
};

const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function MarketCategoryManager({
  lang,
  dict,
  categories,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "auth" | "common">;
  categories: MarketCategoryRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.types; // reuse generic field labels (name/slug/save…)
  const m = dict.admin.market;
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setDraft({ ...empty, sort_order: categories.length });
    setEditingId("new");
  }
  function startEdit(item: MarketCategoryRow) {
    const { id: _id, ...rest } = item;
    void _id;
    setDraft(rest);
    setEditingId(item.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(empty);
  }

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const isNew = editingId === "new";
    const currentId = editingId;
    const { error } = isNew
      ? await supabase.from("market_categories").insert(draft)
      : await supabase
          .from("market_categories")
          .update(draft)
          .eq("id", editingId!);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    if (isNew) {
      void logAdminAction("created", "market_category", null, {
        name: draft.name_en,
      });
    } else {
      void logAdminAction("updated", "market_category", currentId);
    }
    cancel();
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("market_categories")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction("deleted", "market_category", id);
    router.refresh();
  }

  const form = (
    <div className="rounded-2xl border border-primary/30 bg-surface p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          {t.nameAr}
          <input
            className={`${fieldClass} mt-1`}
            value={draft.name_ar}
            onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })}
          />
        </label>
        <label className="text-sm font-semibold">
          {t.nameEn}
          <input
            className={`${fieldClass} mt-1`}
            value={draft.name_en}
            onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
          />
        </label>
        <label className="text-sm font-semibold">
          {t.slug}
          <input
            className={`${fieldClass} mt-1`}
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
          />
        </label>
        <label className="text-sm font-semibold">
          {t.sortOrder}
          <input
            type="number"
            className={`${fieldClass} mt-1`}
            value={draft.sort_order}
            onChange={(e) =>
              setDraft({ ...draft, sort_order: Number(e.target.value) })
            }
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm font-semibold">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          {t.active}
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          disabled={busy || !draft.name_ar || !draft.name_en || !draft.slug}
          onClick={save}
          className="relative inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-bold whitespace-nowrap text-primary-foreground shadow-sm transition-[transform,box-shadow,background-color] duration-150 select-none hover:bg-primary-hover hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55"
        >
          {busy ? t.saving : t.save}
        </button>
        <button
          onClick={cancel}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
        >
          <X className="h-4 w-4" />
          {t.cancel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="py-10">
      <Container>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {m.categoriesTitle}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {m.categoriesSubtitle}
            </p>
          </div>
          {editingId === null && (
            <button
              onClick={startNew}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              <Plus className="h-4 w-4" />
              {t.add}
            </button>
          )}
        </div>

        {editingId === "new" && <div className="mt-6">{form}</div>}

        <div className="mt-6 space-y-2">
          {categories.length === 0 && editingId !== "new" && (
            <div className="rounded-2xl border border-dashed border-border py-10 sm:py-16 text-center text-muted-foreground">
              {t.empty}
            </div>
          )}
          {categories.map((item) =>
            editingId === item.id ? (
              <div key={item.id}>{form}</div>
            ) : (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">
                      {lang === "ar" ? item.name_ar : item.name_en}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.slug}
                    </span>
                    {!item.is_active && (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        {t.inactiveBadge}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => startEdit(item)}
                    aria-label={t.edit}
                    title={t.edit}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-surface-muted"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => remove(item.id)}
                    aria-label={t.delete}
                    title={t.delete}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </Container>
    </div>
  );
}
