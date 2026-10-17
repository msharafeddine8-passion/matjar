"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { beirutYmd } from "@/lib/quick-panel";
import { providerIcon } from "@/lib/sectors";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import { ImageUpload } from "@/components/image-upload";
import { fieldClass as uiFieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type Doctor = {
  id: string;
  name: string;
  specialty: string | null;
  photo_url: string | null;
  bio: string | null;
};

export type ProviderService = {
  id: string;
  name: string;
  nameEn: string | null;
};

type Draft = { name: string; specialty: string; photo_url: string | null; bio: string };

const empty: Draft = { name: "", specialty: "", photo_url: null, bio: "" };
// Shared control styling from the UI library, plus the label gap this form uses.
const fieldClass = `${uiFieldClass} mt-1`;
const labelClass = "text-sm font-semibold";

/**
 * Per-provider "which services this provider offers" toggles.
 * Backed by the `service_providers` join table. No rows for a service means
 * any provider can deliver it, so an empty selection here is meaningful.
 */
function ProviderServices({
  storeId,
  doctorId,
  services,
  initialLinked,
  dict,
  lang,
}: {
  storeId: string;
  doctorId: string;
  services: ProviderService[];
  initialLinked: string[];
  dict: Pick<Dictionary, "auth" | "common" | "merchant">;
  lang: Locale;
}) {
  const router = useRouter();
  const t = dict.merchant.doctors;
  const [linked, setLinked] = useState<Set<string>>(() => new Set(initialLinked));
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(serviceId: string) {
    const turnOn = !linked.has(serviceId);
    setBusyId(serviceId);
    // Optimistic local update.
    setLinked((prev) => {
      const next = new Set(prev);
      if (turnOn) next.add(serviceId);
      else next.delete(serviceId);
      return next;
    });
    const supabase = createClient();
    const { error } = turnOn
      ? await supabase
          .from("service_providers")
          .insert({ store_id: storeId, product_id: serviceId, doctor_id: doctorId })
      : await supabase
          .from("service_providers")
          .delete()
          .eq("product_id", serviceId)
          .eq("doctor_id", doctorId);
    setBusyId(null);
    if (error) {
      // Roll back the optimistic change.
      setLinked((prev) => {
        const next = new Set(prev);
        if (turnOn) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">{t.services}</p>
      {services.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{t.noServices}</p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.servicesHint}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {services.map((s) => {
              const active = linked.has(s.id);
              const label = lang === "en" ? s.nameEn || s.name : s.name;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => toggle(s.id)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-60 ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface hover:bg-surface-muted"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5" />}
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function DoctorManager({
  storeId,
  dict,
  doctors,
  services,
  assignments,
  lang,
  category,
}: {
  storeId: string;
  dict: Pick<Dictionary, "auth" | "common" | "merchant">;
  doctors: Doctor[];
  services: ProviderService[];
  assignments: Record<string, string[]>;
  lang: Locale;
  /** The store's sector key — picks a sector-appropriate provider icon. */
  category?: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.merchant.doctors;
  const ProviderIcon = providerIcon(category);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setDraft({ ...empty });
    setEditingId("new");
  }
  function startEdit(d: Doctor) {
    setDraft({
      name: d.name,
      specialty: d.specialty ?? "",
      photo_url: d.photo_url,
      bio: d.bio ?? "",
    });
    setEditingId(d.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(empty);
  }

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const payload = {
      store_id: storeId,
      name: draft.name.trim(),
      specialty: draft.specialty.trim() || null,
      photo_url: draft.photo_url,
      bio: draft.bio.trim() || null,
    };
    const { error } =
      editingId === "new"
        ? await supabase.from("doctors").insert(payload)
        : await supabase
            .from("doctors")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", editingId!);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  async function remove(id: string) {
    // bookings.doctor_id is ON DELETE SET NULL: removing a provider silently
    // orphans their upcoming appointments. Count them and say so first.
    const { count } = await createClient()
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("doctor_id", id)
      .in("status", ["pending", "accepted", "scheduled"])
      .gte("requested_date", beirutYmd(new Date()));
    const upcoming = count ?? 0;
    const message =
      upcoming > 0
        ? t.confirmDeleteBookings.replace("{count}", String(upcoming))
        : t.confirmDelete;
    if (!(await confirm({ message, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("doctors")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      <ImageUpload
        folder={storeId}
        value={draft.photo_url}
        onChange={(url) => setDraft({ ...draft, photo_url: url })}
        label={t.photo}
      />
      <div>
        <label className={labelClass} htmlFor="doctor-name">{t.name}</label>
        <input
          id="doctor-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder={t.namePlaceholder}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="doctor-specialty">{t.specialty}</label>
        <input
          id="doctor-specialty"
          value={draft.specialty}
          onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
          placeholder={t.specialtyPlaceholder}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="doctor-bio">{t.bio}</label>
        <textarea
          id="doctor-bio"
          value={draft.bio}
          onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
          rows={2}
          placeholder={t.bioPlaceholder}
          className={fieldClass}
        />
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!draft.name.trim()}
          loading={busy}
          onClick={save}
        >
          {busy ? t.saving : t.save}
        </Button>
        <Button variant="secondary" onClick={cancel} leftIcon={<X className="h-4 w-4" />}>
          {t.cancel}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        {editingId === null && (
          <Button onClick={startNew} className="shrink-0" leftIcon={<Plus className="h-4 w-4" />}>
            {t.add}
          </Button>
        )}
      </div>

      {editingId === "new" && <div className="mt-4">{form}</div>}

      <div className="mt-4 space-y-2">
        {doctors.length === 0 && editingId !== "new" && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {doctors.map((d) =>
          editingId === d.id ? (
            <div key={d.id}>{form}</div>
          ) : (
            <div
              key={d.id}
              className="rounded-2xl border border-border bg-surface p-3"
            >
              <div className="flex items-center gap-3">
                {d.photo_url ? (
                  <Image
                    src={d.photo_url}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                    sizes="48px"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
                    <ProviderIcon className="h-5 w-5" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{d.name}</p>
                  {d.specialty && (
                    <p className="text-sm text-muted-foreground">{d.specialty}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(d)}
                  aria-label={`${t.edit} — ${d.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-surface-muted"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(d.id)}
                  aria-label={`${t.delete} — ${d.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <ProviderServices
                storeId={storeId}
                doctorId={d.id}
                services={services}
                initialLinked={assignments[d.id] ?? []}
                dict={dict}
                lang={lang}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
