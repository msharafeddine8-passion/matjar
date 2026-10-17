"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { logAdminAction } from "@/lib/audit";
import { Container } from "@/components/ui/container";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { regions as catalogRegions } from "@/lib/catalog";
import type { MarketRegion } from "@/lib/data/market";

export type MarketCityRow = {
  id: string;
  region: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
  is_active: boolean;
};

type Draft = Omit<MarketCityRow, "id">;

const empty: Draft = {
  region: "",
  name_ar: "",
  name_en: "",
  sort_order: 0,
  is_active: true,
};

const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function MarketCityManager({
  lang,
  dict,
  cities,
  regions,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "common">;
  cities: MarketCityRow[];
  regions?: MarketRegion[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.types; // reuse generic field labels
  const m = dict.admin.market;
  const regionList: MarketRegion[] =
    regions && regions.length
      ? regions
      : catalogRegions.map((r) => ({ key: r.key, name: r.name[lang] }));
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);

  const regionName = (key: string) =>
    regionList.find((r) => r.key === key)?.name ?? key;

  function startNew() {
    setDraft({
      ...empty,
      region: regionList[0]?.key ?? "",
      sort_order: cities.length,
    });
    setEditingId("new");
  }
  function startEdit(item: MarketCityRow) {
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
      ? await supabase.from("market_cities").insert(draft)
      : editingId
        ? await supabase.from("market_cities").update(draft).eq("id", editingId)
        : { error: null };
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    if (isNew) {
      void logAdminAction("created", "market_city", null, {
        name: draft.name_en,
      });
    } else if (currentId) {
      void logAdminAction("updated", "market_city", currentId);
    }
    cancel();
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("market_cities")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("deleted", "market_city", id);
    router.refresh();
  }

  const form = (
    <div className="rounded-2xl border border-primary/30 bg-surface p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          {m.regionLabel}
          <select
            className={`${fieldClass} mt-1`}
            value={draft.region}
            onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          >
            {regionList.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
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
          disabled={busy || !draft.name_ar || !draft.name_en}
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
              {m.citiesTitle}
            </h1>
            <p className="mt-2 text-muted-foreground">{m.citiesSubtitle}</p>
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
          {cities.length === 0 && editingId !== "new" && (
            <div className="rounded-2xl border border-dashed border-border py-10 sm:py-16 text-center text-muted-foreground">
              {t.empty}
            </div>
          )}
          {cities.map((item) =>
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
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      {regionName(item.region)}
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
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-surface-muted"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => remove(item.id)}
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
