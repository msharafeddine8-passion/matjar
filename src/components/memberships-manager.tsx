"use client";
import { notifyError, notifySuccess } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, CreditCard } from "lucide-react";
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

export type Plan = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  period: string;
  description: string | null;
  active: boolean;
};

type Draft = {
  name: string;
  name_en: string;
  price: string;
  period: string;
  description: string;
};

const empty: Draft = {
  name: "",
  name_en: "",
  price: "",
  period: "monthly",
  description: "",
};

const labelClass = "text-sm font-semibold";

const PERIODS = ["monthly", "yearly", "session"] as const;

export function MembershipsManager({
  storeId,
  lang,
  dict,
  plans,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "catalogItem" | "common" | "memberships" | "merchant">;
  plans: Plan[];
}) {
  const router = useRouter();
  const t = dict.memberships;
  const c = dict.catalogItem;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  // The row being edited; null = the form adds a new plan.
  const [editingId, setEditingId] = useState<string | null>(null);
  const ops = useCatalogRowOps("store_membership_plans", dict);

  function startNew() {
    setDraft({ ...empty });
    setEditingId(null);
    setAdding(true);
  }
  function startEdit(p: Plan) {
    setDraft({
      name: p.name,
      name_en: p.name_en ?? "",
      price: p.price == null ? "" : String(p.price),
      period: p.period,
      description: p.description ?? "",
    });
    setEditingId(p.id);
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
      period: draft.period,
      description: draft.description.trim() || null,
    };
    if (editingId) {
      const ok = await updateCatalogRow("store_membership_plans", editingId, values);
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
      .from("store_membership_plans")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  const editingName = plans.find((p) => p.id === editingId)?.name;

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      {editingName && (
        <h3 className="font-bold">{c.editTitle.replace("{name}", editingName)}</h3>
      )}
      <div>
        <label className={labelClass} htmlFor="membership-name">{t.name}</label>
        <Input
          id="membership-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="membership-name-en">{`${t.name} (EN)`}</label>
        <Input
          id="membership-name-en"
          value={draft.name_en}
          onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
          className="mt-1"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="membership-price">{t.price}</label>
          <Input
            id="membership-price"
            type="number"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            className="mt-1"
          />
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="membership-period">{t.period}</label>
          <Select
            id="membership-period"
            value={draft.period}
            onChange={(e) => setDraft({ ...draft, period: e.target.value })}
            className="mt-1"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t.periods[p]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="membership-description">{t.description}</label>
        <Textarea
          id="membership-description"
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
        {plans.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {plans.map((p) => {
          const primary = lang === "en" ? p.name_en || p.name : p.name;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-2xl border bg-surface p-3 ${
                editingId === p.id ? "border-primary" : "border-border"
              }`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                <CreditCard className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-bold">{primary}</span>
                  {!p.active && (
                    <Badge variant="neutral" size="sm">
                      {c.hiddenBadge}
                    </Badge>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
                  {p.price != null && <span>{p.price}</span>}
                  {p.price != null && <span>·</span>}
                  <span>{t.periods[p.period as keyof typeof t.periods]}</span>
                </div>
                {p.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {p.description}
                  </p>
                )}
              </div>
              <CatalogRowActions
                dict={dict}
                deleteLabel={t.delete}
                busy={busy || ops.busyId === p.id}
                active={p.active}
                onEdit={() => startEdit(p)}
                onToggleActive={() => ops.setActive(p.id, !p.active)}
                onDelete={() => ops.remove(p.id, true)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
