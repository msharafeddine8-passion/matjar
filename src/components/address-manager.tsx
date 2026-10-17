"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Pencil, Trash2, Star, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fieldClass as uiFieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";

// Shared control styling from the UI library, plus the label gap this form uses.
const fieldClass = `${uiFieldClass} mt-1.5`;
const labelClass = "text-sm font-semibold";

export type AddressRow = {
  id: string;
  label: string | null;
  region: string | null;
  city: string | null;
  street: string | null;
  building: string | null;
  floor: string | null;
  details: string | null;
  phone: string | null;
  is_default: boolean;
};

/** Human-readable one-line summary of an address, region localised. */
export function formatAddress(a: AddressRow, lang: Locale): string {
  const regionName =
    regions.find((r) => r.key === a.region)?.name[lang] ?? a.region ?? "";
  return [a.street, a.building, a.floor, a.city, regionName, a.details]
    .filter(Boolean)
    .join("، ");
}

export function AddressManager({
  lang,
  dict,
  rows,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "account" | "auth" | "common">;
  rows: AddressRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.account.address;
  // null = form closed; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withUser<T>(fn: (uid: string) => Promise<T>) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    return fn(user.id);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>, id: string | null) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const makeDefault = form.get("is_default") === "on";
    const payload = {
      label: String(form.get("label")) || null,
      region: String(form.get("region")) || null,
      city: String(form.get("city")) || null,
      street: String(form.get("street")) || null,
      building: String(form.get("building")) || null,
      floor: String(form.get("floor")) || null,
      details: String(form.get("details")) || null,
      phone: String(form.get("phone")) || null,
      updated_at: new Date().toISOString(),
    };

    const ok = await withUser(async (uid) => {
      const supabase = createClient();
      // First address is always the default; otherwise honour the checkbox.
      const shouldDefault = rows.length === 0 || makeDefault;
      if (shouldDefault) {
        // Clear any existing default first to respect the one-default index.
        await supabase
          .from("addresses")
          .update({ is_default: false })
          .eq("user_id", uid)
          .eq("is_default", true);
      }
      if (id) {
        const { error: e2 } = await supabase
          .from("addresses")
          .update({ ...payload, is_default: shouldDefault })
          .eq("id", id);
        return !e2;
      }
      const { error: e2 } = await supabase.from("addresses").insert({
        ...payload,
        user_id: uid,
        is_default: shouldDefault,
      });
      return !e2;
    });

    setBusy(false);
    if (!ok) {
      setError(dict.auth.errorGeneric);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function makeDefault(id: string) {
    setBusy(true);
    await withUser(async (uid) => {
      const supabase = createClient();
      await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("user_id", uid)
        .eq("is_default", true);
      await supabase
        .from("addresses")
        .update({ is_default: true })
        .eq("id", id);
    });
    setBusy(false);
    router.refresh();
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        message: t.confirmDelete,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("addresses").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }

  const blank: AddressRow = {
    id: "",
    label: "",
    region: "",
    city: "",
    street: "",
    building: "",
    floor: "",
    details: "",
    phone: "",
    is_default: rows.length === 0,
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-bold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
      </div>

      {/* Saved-address list */}
      {rows.length === 0 && editing === null && (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      )}
      <ul className="space-y-3">
        {rows.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AddressFields
                lang={lang}
                dict={dict}
                initial={a}
                busy={busy}
                error={error}
                onSubmit={(e) => onSubmit(e, a.id)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {a.label || t.title}
                  </span>
                  {a.is_default && (
                    <Badge variant="primary" size="sm">
                      {t.defaultBadge}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {formatAddress(a, lang)}
                </p>
                {a.phone && (
                  <p className="mt-0.5 text-sm text-muted-foreground" dir="ltr">
                    <span dir="ltr">{a.phone}</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {!a.is_default && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => makeDefault(a.id)}
                    className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
                  >
                    <Star className="h-3.5 w-3.5" />
                    {t.makeDefault}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(a.id)}
                  className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t.edit}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(a.id)}
                  className="flex items-center gap-1 text-xs font-semibold text-danger hover:underline disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.delete}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {/* Add-new form / button */}
      {editing === "new" ? (
        <AddressFields
          lang={lang}
          dict={dict}
          initial={blank}
          busy={busy}
          error={error}
          onSubmit={(e) => onSubmit(e, null)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        editing === null && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing("new");
            }}
            className="flex items-center gap-1.5 rounded-xl border border-dashed border-primary/50 px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary-soft"
          >
            <Plus className="h-4 w-4" />
            {t.addNew}
          </button>
        )
      )}
    </div>
  );
}

function AddressFields({
  lang,
  dict,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "account" | "auth" | "common">;
  initial: AddressRow;
  busy: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const t = dict.account.address;
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-primary/30 bg-background p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="label">
            {t.label}
          </label>
          <input
            id="label"
            name="label"
            type="text"
            defaultValue={initial.label ?? ""}
            placeholder={t.labelPlaceholder}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="region">
            {t.region}
          </label>
          <select
            id="region"
            name="region"
            defaultValue={initial.region ?? ""}
            className={fieldClass}
          >
            <option value="">{t.selectRegion}</option>
            {regions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name[lang]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="city">
            {t.city}
          </label>
          <input id="city" name="city" type="text" defaultValue={initial.city ?? ""} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="street">
            {t.street}
          </label>
          <input id="street" name="street" type="text" defaultValue={initial.street ?? ""} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="building">
            {t.building}
          </label>
          <input id="building" name="building" type="text" defaultValue={initial.building ?? ""} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="floor">
            {t.floor}
          </label>
          <input id="floor" name="floor" type="text" defaultValue={initial.floor ?? ""} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="phone">
            {t.phone}
          </label>
          <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={initial.phone ?? ""} placeholder="+961 …" className={fieldClass} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="details">
          {t.details}
        </label>
        <textarea id="details" name="details" rows={2} defaultValue={initial.details ?? ""} placeholder={t.detailsPlaceholder} className={fieldClass} />
      </div>

      {!initial.is_default && (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="is_default" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />
          {t.makeDefault}
        </label>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          loading={busy}
          leftIcon={<Check className="h-4 w-4" />}
        >
          {busy ? dict.account.saving : dict.account.save}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
        {error && (
          <span className="text-sm font-semibold text-danger">{error}</span>
        )}
      </div>
    </form>
  );
}
