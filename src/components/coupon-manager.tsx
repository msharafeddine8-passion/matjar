"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Ticket } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { beirutEndOfDayIso, isoToBeirutYmd } from "@/lib/beirut-day";
import { fieldClass as uiFieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Dictionary } from "@/i18n/get-dictionary";

export type Coupon = {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_order: number | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  once_per_customer: boolean;
};

type Draft = {
  code: string;
  type: "percent" | "fixed";
  value: string;
  min_order: string;
  expires_at: string;
  max_uses: string;
  is_active: boolean;
  once_per_customer: boolean;
};

const empty: Draft = {
  code: "",
  type: "percent",
  value: "",
  min_order: "",
  expires_at: "",
  max_uses: "",
  is_active: true,
  once_per_customer: false,
};

// Shared control styling from the UI library, plus the label gap this form uses.
const fieldClass = `${uiFieldClass} mt-1`;
const labelClass = "text-sm font-semibold";

export function CouponManager({
  storeId,
  dict,
  coupons,
}: {
  storeId: string;
  dict: Pick<Dictionary, "auth" | "common" | "merchant">;
  coupons: Coupon[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.merchant.coupons;
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setDraft({ ...empty });
    setEditingId("new");
  }
  function startEdit(c: Coupon) {
    setDraft({
      code: c.code,
      type: c.type,
      value: String(c.value),
      min_order: c.min_order != null ? String(c.min_order) : "",
      expires_at: isoToBeirutYmd(c.expires_at),
      max_uses: c.max_uses != null ? String(c.max_uses) : "",
      is_active: c.is_active,
      once_per_customer: c.once_per_customer ?? false,
    });
    setEditingId(c.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(empty);
  }

  async function save() {
    // Percent coupons can't exceed 100% — otherwise the discount RPC
    // (subtotal * value / 100) would refund more than the order total.
    if (
      draft.type === "percent" &&
      (Number(draft.value) > 100 || Number(draft.value) < 0)
    ) {
      notifyError(t.percentTooHigh);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const payload = {
      store_id: storeId,
      code: draft.code.trim().toUpperCase(),
      type: draft.type,
      value: Number(draft.value) || 0,
      min_order: draft.min_order.trim() === "" ? null : Number(draft.min_order),
      // The END of that day in Beirut, with Beirut's offset for that date. A
      // bare "YYYY-MM-DD" is stored as 00:00 UTC — the coupon died 2–3 hours
      // into its last day.
      expires_at:
        draft.expires_at === "" ? null : beirutEndOfDayIso(draft.expires_at),
      max_uses: draft.max_uses.trim() === "" ? null : Number(draft.max_uses),
      is_active: draft.is_active,
      once_per_customer: draft.once_per_customer,
    };
    const { error } =
      editingId === "new"
        ? await supabase.from("coupons").insert(payload)
        : await supabase
            .from("coupons")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", editingId!);
    setBusy(false);
    if (error) {
      // 23505 = the (store, code) unique index; 23514 = coupons_value_range
      // (percent 0–100) or another CHECK on the row.
      notifyError(
        error.code === "23505"
          ? t.duplicateCode
          : error.code === "23514"
            ? draft.type === "percent"
              ? t.percentTooHigh
              : t.invalidValue
            : dict.auth.errorGeneric,
      );
      return;
    }
    cancel();
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("coupons")
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="coupon-code">{t.code}</label>
          <input
            id="coupon-code"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            placeholder={t.codePlaceholder}
            className={`${fieldClass} uppercase`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="coupon-type">{t.type}</label>
          <select
            id="coupon-type"
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as "percent" | "fixed" })
            }
            className={fieldClass}
          >
            <option value="percent">{t.percent}</option>
            <option value="fixed">{t.fixed}</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="coupon-value">{t.value}</label>
          <input id="coupon-value" type="number" min="0" step="0.01" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="coupon-min-order">{t.minOrder}</label>
          <input id="coupon-min-order" type="number" min="0" step="0.01" value={draft.min_order} onChange={(e) => setDraft({ ...draft, min_order: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="coupon-expires">{t.expires}</label>
          <input id="coupon-expires" type="date" value={draft.expires_at} onChange={(e) => setDraft({ ...draft, expires_at: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="coupon-max-uses">{t.maxUses}</label>
          <input id="coupon-max-uses" type="number" min="1" step="1" value={draft.max_uses} onChange={(e) => setDraft({ ...draft, max_uses: e.target.value })} className={fieldClass} />
        </div>
        <label className="flex items-center gap-2 self-end text-sm font-semibold">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} className="h-4 w-4 accent-primary" />
          {t.active}
        </label>
        {/* max_uses caps the code across everyone; this caps it per person.
            Without it, a "10% off, 100 uses" code is one customer's standing
            discount rather than a hundred customers' first order. */}
        <label className="flex items-center gap-2 self-end text-sm font-semibold">
          <input type="checkbox" checked={draft.once_per_customer} onChange={(e) => setDraft({ ...draft, once_per_customer: e.target.checked })} className="h-4 w-4 accent-primary" />
          {t.oncePerCustomer}
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!draft.code.trim() || !draft.value}
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
        {coupons.length === 0 && editingId !== "new" && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {coupons.map((c) =>
          editingId === c.id ? (
            <div key={c.id}>{form}</div>
          ) : (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Ticket className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{c.code}</span>
                  <Badge variant="success" size="sm">
                    {c.type === "percent" ? `${c.value}%` : `$${c.value}`}
                  </Badge>
                  {!c.is_active && (
                    <Badge variant="neutral" size="sm">
                      {t.inactiveBadge}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.used_count} {t.used}
                  {c.max_uses != null ? ` / ${c.max_uses}` : ""}
                  {c.expires_at ? ` · ${isoToBeirutYmd(c.expires_at)}` : ""}
                </p>
              </div>
              <button onClick={() => startEdit(c)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-surface-muted">
                <Pencil className="h-4 w-4" />
              </button>
              <button disabled={busy} onClick={() => remove(c.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft disabled:opacity-60">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
