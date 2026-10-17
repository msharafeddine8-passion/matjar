"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Check,
  Star,
  Crosshair,
  Clock,
  Boxes,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";
import { WEEK_DAYS, type WeekHours } from "@/lib/hours";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type BranchRow = {
  id: string;
  name: string | null;
  address: string | null;
  region: string | null;
  area: string | null;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
  is_primary: boolean;
  is_active: boolean;
  /** Null means "inherit the store's hours" — what every branch meant before
   *  0301 added the column, and still what a new branch means. */
  hours: WeekHours | null;
};

type Draft = Omit<BranchRow, "id" | "is_primary">;

const emptyDraft: Draft = {
  name: "",
  address: "",
  region: "",
  area: "",
  phone: "",
  whatsapp: "",
  lat: null,
  lng: null,
  is_active: true,
  hours: null,
};

const DEFAULT_SPAN = { open: "09:00", close: "18:00" };

export function BranchManager({
  storeId,
  lang,
  dict,
  initial,
  stockSeparate,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "os">;
  initial: BranchRow[];
  /** stores.branch_stock_separate — the merchant's own declaration (0301).
   *  Advisory: it changes the copy below and nothing about how stock moves. */
  stockSeparate: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.branches;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [separate, setSeparate] = useState(stockSeparate);

  function openNew() {
    setDraft(emptyDraft);
    setEditingId("new");
  }
  function openEdit(b: BranchRow) {
    setDraft({
      name: b.name ?? "",
      address: b.address ?? "",
      region: b.region ?? "",
      area: b.area ?? "",
      phone: b.phone ?? "",
      whatsapp: b.whatsapp ?? "",
      lat: b.lat,
      lng: b.lng,
      is_active: b.is_active,
      hours: b.hours,
    });
    setEditingId(b.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setDraft((d) => ({
          ...d,
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        })),
      () => notifyError(dict.common.actionFailed),
    );
  }

  // The primary branch must stay active — order/POS branch attribution defaults
  // to it, so it can never be turned off.
  const editingPrimary =
    initial.find((b) => b.id === editingId)?.is_primary ?? false;

  // ---- Per-branch hours (0301) ------------------------------------------
  // Null hours means "inherit the store's", so the toggle is null vs object
  // rather than a third stored state. Turning it off drops back to null
  // instead of writing an empty object, which stores.hours already treats as
  // "not configured" — two ways to say the same thing is how the badge and
  // the printed hours end up disagreeing.
  function setOwnHours(own: boolean) {
    setDraft((d) => ({ ...d, hours: own ? (d.hours ?? {}) : null }));
  }
  function toggleDay(day: string, open: boolean) {
    setDraft((d) => {
      const next: WeekHours = { ...(d.hours ?? {}) };
      if (open) next[day] = next[day] ?? DEFAULT_SPAN;
      else delete next[day];
      return { ...d, hours: next };
    });
  }
  function setTime(day: string, key: "open" | "close", value: string) {
    setDraft((d) => {
      const cur = d.hours ?? {};
      return {
        ...d,
        hours: {
          ...cur,
          [day]: { ...(cur[day] ?? DEFAULT_SPAN), [key]: value },
        },
      };
    });
  }

  async function saveStockDeclaration(next: boolean) {
    setSeparate(next);
    setBusy(true);
    const { error } = await createClient()
      .from("stores")
      .update({ branch_stock_separate: next })
      .eq("id", storeId);
    setBusy(false);
    if (error) {
      setSeparate(!next);
      notifyError(dict.common.actionFailed);
    }
  }

  async function makePrimary(b: BranchRow) {
    setBusy(true);
    const { error } = await createClient()
      .from("store_locations")
      .update({ is_primary: true })
      .eq("id", b.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const payload = {
      name: draft.name?.trim() || null,
      address: draft.address?.trim() || null,
      region: draft.region || null,
      area: draft.area?.trim() || null,
      phone: draft.phone?.trim() || null,
      whatsapp: draft.whatsapp?.trim() || null,
      lat: draft.lat,
      lng: draft.lng,
      is_active: editingPrimary ? true : draft.is_active,
      // {} would be a branch that claims its own hours and lists none, which
      // reads as "closed all week" to isOpenNow. Collapse it to inherit.
      hours:
        draft.hours && Object.keys(draft.hours).length > 0 ? draft.hours : null,
    };
    const { error } =
      editingId === "new"
        ? await supabase
            .from("store_locations")
            .insert({ ...payload, store_id: storeId })
        : editingId
          ? await supabase
              .from("store_locations")
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

  async function remove(b: BranchRow) {
    // The primary can't be deleted — a store must always keep one primary
    // branch. Make another branch primary first, then delete this one.
    if (b.is_primary) {
      notifyError(t.cantDeletePrimary);
      return;
    }
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_locations")
      .delete()
      .eq("id", b.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  const regionName = (key: string | null) =>
    regions.find((r) => r.key === key)?.name[lang] ?? "";

  const form = (
    <div className="rounded-2xl border border-primary/30 bg-surface p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold sm:col-span-2">
          {t.name}
          <input
            value={draft.name ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t.nameHint}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold sm:col-span-2">
          {t.address}
          <input
            value={draft.address ?? ""}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.region}
          <select
            value={draft.region ?? ""}
            onChange={(e) => setDraft({ ...draft, region: e.target.value })}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">—</option>
            {regions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name[lang]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {t.area}
          <input
            value={draft.area ?? ""}
            onChange={(e) => setDraft({ ...draft, area: e.target.value })}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.phone}
          <input
            value={draft.phone ?? ""}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            inputMode="tel"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.whatsapp}
          <input
            value={draft.whatsapp ?? ""}
            onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })}
            inputMode="tel"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      {/* Per-branch hours. A Tripoli branch and a Halba branch keeping
          different hours is ordinary; before 0301 there was one set of hours
          for the whole business and no way to say so. */}
      <div className="mt-4 rounded-xl border border-border bg-surface-muted/40 p-4">
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <Clock className="h-4 w-4 text-primary" />
          {t.hoursTitle}
        </h4>
        <label className="relative mt-2 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold before:absolute before:-inset-1 before:content-['']">
          <input
            type="checkbox"
            checked={draft.hours != null}
            onChange={(e) => setOwnHours(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {draft.hours != null ? t.hoursOwn : t.hoursInherit}
        </label>

        {draft.hours != null && (
          <div className="mt-2 space-y-1.5">
            {WEEK_DAYS.map((day) => {
              const span = draft.hours?.[day];
              return (
                <div key={day} className="flex flex-wrap items-center gap-2">
                  <label className="relative flex min-h-[44px] w-28 shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold before:absolute before:-inset-1 before:content-['']">
                    <input
                      type="checkbox"
                      checked={!!span}
                      onChange={(e) => toggleDay(day, e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    {dict.os.hours.days[day]}
                  </label>
                  {span ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{dict.os.hours.from}</span>
                      <input
                        type="time"
                        dir="ltr"
                        value={span.open}
                        onChange={(e) => setTime(day, "open", e.target.value)}
                        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-primary"
                      />
                      <span>{dict.os.hours.to}</span>
                      <input
                        type="time"
                        dir="ltr"
                        value={span.close}
                        onChange={(e) => setTime(day, "close", e.target.value)}
                        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-primary"
                      />
                    </div>
                  ) : (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                      {dict.os.hours.closed}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={locate}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Crosshair className="h-4 w-4" />
          {t.useLocation}
        </button>
        {draft.lat != null && draft.lng != null && (
          <span className="text-sm font-semibold text-primary">{t.located}</span>
        )}
        <label className="ms-auto flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={editingPrimary ? true : draft.is_active}
            disabled={editingPrimary}
            onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            className="h-4 w-4"
          />
          {t.active}
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          {t.save}
        </button>
        <button
          onClick={cancel}
          className="rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mt-6 space-y-3">
      {/* ISS-023's actual recommendation: say out loud that branches share one
          stock pool. It was true before this component existed and is still
          true — what was missing was anywhere that admitted it. The checkbox
          is a declaration, not a switch: it records that this merchant needs
          separate stock, and the note underneath refuses to imply it works. */}
      <section className="rounded-2xl border border-border bg-surface-muted/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Boxes className="h-4 w-4 text-primary" />
          {t.stockTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.stockShared}</p>
        <label className="relative mt-3 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold before:absolute before:-inset-1 before:content-['']">
          <input
            type="checkbox"
            checked={separate}
            disabled={busy}
            onChange={(e) => saveStockDeclaration(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t.stockSeparateLabel}
        </label>
        {separate && (
          <p className="mt-1 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
            {t.stockSeparateNote}
          </p>
        )}
      </section>

      {initial.map((b) =>
        editingId === b.id ? (
          <div key={b.id}>{form}</div>
        ) : (
          <div
            key={b.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-surface p-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 font-bold">
                  <MapPin className="h-4 w-4 text-primary" />
                  {b.name?.trim() || regionName(b.region) || t.link}
                </span>
                {b.is_primary && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">
                    <Star className="h-3 w-3" />
                    {t.primary}
                  </span>
                )}
                {!b.is_active && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                    {t.inactive}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[b.address, regionName(b.region), b.area, b.phone]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {b.hours && Object.keys(b.hours).length > 0
                  ? t.hoursOwn
                  : t.hoursInherit}
              </p>
            </div>
            {/* 32px icon buttons get a 44px hit area from the pseudo-element
                rather than a bigger box, so the row keeps its density. */}
            <div className="flex shrink-0 gap-1">
              {!b.is_primary && (
                <button
                  onClick={() => makePrimary(b)}
                  aria-label={t.makePrimary}
                  title={t.makePrimary}
                  className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-warning-soft hover:text-warning"
                >
                  <Star className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => openEdit(b)}
                aria-label={t.edit}
                title={t.edit}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-surface-muted hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => remove(b)}
                aria-label={t.delete}
                title={t.delete}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ),
      )}

      {editingId === "new" && form}

      {initial.length === 0 && editingId === null && (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
          {t.empty}
        </div>
      )}

      {editingId === null && (
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          {t.add}
        </button>
      )}
    </div>
  );
}
