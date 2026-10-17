"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Filter,
  Play,
  Plus,
  Check,
  Bell,
  MessageCircle,
  Sparkles,
  Ticket,
  ShoppingBag,
  ShoppingCart,
  PackageCheck,
  PackageX,
  Star,
  Wallet,
  BadgeDollarSign,
  AlertTriangle,
  Wand2,
  Clock,
  CalendarClock,
  UserX,
  Moon,
  type LucideIcon,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FlowStep } from "@/components/automation/flow-step";
import { StatusPill } from "@/components/automation/status-pill";
import { RecipeCard } from "@/components/automation/recipe-card";
import { TriggerPicker } from "@/components/automation/trigger-picker";
import { ConditionFields } from "@/components/automation/condition-fields";
import { ActionEditor } from "@/components/automation/action-editor";
import { AutomationListItem } from "@/components/automation/automation-list-item";
import { CardListUl } from "@/components/ui/card";

// ===== Contract (fixed vocabulary — matches migration 0117) =====
export type TriggerKey =
  | "order_created"
  | "order_completed"
  | "order_abandoned"
  | "low_stock"
  | "new_review"
  | "payment_recorded"
  | "booking_reminder"
  | "customer_inactive";

export type ActionType = "notify" | "whatsapp" | "loyalty" | "coupon";

export type Conditions = {
  min_total?: number;
  location_id?: string;
  max_rating?: number;
  hours_before?: number;
  inactive_days?: number;
};

export type Action =
  | { type: "notify"; title: string; body: string }
  | { type: "whatsapp"; message: string }
  | { type: "loyalty"; points: number }
  | { type: "coupon"; percent: number };

export type AutomationRow = {
  id: string;
  name: string | null;
  trigger: TriggerKey;
  conditions: Conditions | null;
  actions: Action[] | null;
  enabled: boolean;
  created_at: string;
};

export type RunRow = {
  id: string;
  automation_id: string | null;
  trigger: string;
  status: "fired" | "skipped" | "error";
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type LocationOption = {
  id: string;
  name: string | null;
  region: string | null;
};

const TRIGGERS: TriggerKey[] = [
  "order_created",
  "order_completed",
  "order_abandoned",
  "low_stock",
  "new_review",
  "payment_recorded",
  "booking_reminder",
  "customer_inactive",
];

const TRIGGER_ICON: Record<TriggerKey, LucideIcon> = {
  order_created: ShoppingBag,
  order_completed: PackageCheck,
  order_abandoned: ShoppingCart,
  low_stock: PackageX,
  new_review: Star,
  payment_recorded: Wallet,
  booking_reminder: CalendarClock,
  customer_inactive: UserX,
};

// Which optional conditions make sense per trigger.
const TRIGGER_CONDS: Record<
  TriggerKey,
  {
    minTotal?: boolean;
    location?: boolean;
    maxRating?: boolean;
    hoursBefore?: boolean;
    inactiveDays?: boolean;
  }
> = {
  order_created: { minTotal: true, location: true },
  order_completed: { minTotal: true, location: true },
  order_abandoned: {},
  low_stock: { location: true },
  new_review: { maxRating: true },
  payment_recorded: { minTotal: true, location: true },
  booking_reminder: { hoursBefore: true },
  customer_inactive: { inactiveDays: true },
};

const ACTION_TYPES: ActionType[] = ["notify", "whatsapp", "loyalty", "coupon"];

const ACTION_ICON: Record<ActionType, LucideIcon> = {
  notify: Bell,
  whatsapp: MessageCircle,
  loyalty: Sparkles,
  coupon: Ticket,
};

// Per-action-type accent (used on chips + node tints). Kept as full class strings
// so Tailwind's JIT picks them up.
const ACTION_TINT: Record<ActionType, string> = {
  notify: "bg-info-soft text-info",
  whatsapp: "bg-success-soft text-success",
  loyalty: "bg-primary-soft text-primary",
  coupon: "bg-warning-soft text-warning",
};

function defaultAction(type: ActionType): Action {
  switch (type) {
    case "notify":
      return { type: "notify", title: "", body: "" };
    case "whatsapp":
      return { type: "whatsapp", message: "" };
    case "loyalty":
      return { type: "loyalty", points: 10 };
    case "coupon":
      return { type: "coupon", percent: 10 };
  }
}

function timeAgo(iso: string, lang: Locale) {
  const diff = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "en", {
    numeric: "auto",
  });
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return rtf.format(0, "minute");
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return rtf.format(-hrs, "hour");
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return rtf.format(-days, "day");
  const months = Math.round(days / 30);
  return rtf.format(-months, "month");
}

export type Draft = {
  name: string;
  trigger: TriggerKey;
  minTotal: string;
  locationId: string;
  maxRating: string;
  hoursBefore: string;
  inactiveDays: string;
  actions: Action[];
};

const emptyDraft: Draft = {
  name: "",
  trigger: "order_created",
  minTotal: "",
  locationId: "",
  maxRating: "",
  hoursBefore: "",
  inactiveDays: "",
  actions: [{ type: "whatsapp", message: "" }],
};

export function AutomationManager({
  storeId,
  storeName,
  lang,
  dict,
  initial,
  runs,
  locations,
}: {
  storeId: string;
  storeName: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "os">;
  initial: AutomationRow[];
  runs: RunRow[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.automations;

  const [editingId, setEditingId] = useState<string | null>(null); // "new" | row id | null
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [pendingRecipe, setPendingRecipe] = useState<string | null>(null);

  const existingNames = useMemo(
    () => new Set(initial.map((a) => (a.name ?? "").trim())),
    [initial],
  );

  const locationName = (id: string | undefined) => {
    if (!id) return t.conditions.anyLocation;
    const l = locations.find((x) => x.id === id);
    return l?.name?.trim() || l?.region || t.conditions.location;
  };

  // ===== Recipes (one-tap presets). Payload text is localized via the dict. =====
  const recipes = useMemo(() => {
    const r = t.recipes;
    const wa = (msg: string) => msg.replace("{store}", storeName);
    return [
      {
        id: "thanks",
        Icon: MessageCircle,
        tint: "bg-success-soft text-success",
        name: r.thanks.name,
        desc: r.thanks.desc,
        trigger: "order_completed" as TriggerKey,
        conditions: {} as Conditions,
        actions: [
          { type: "whatsapp", message: wa(r.thanks.message) },
        ] as Action[],
      },
      {
        id: "abandonedCart",
        Icon: ShoppingCart,
        tint: "bg-danger-soft text-danger",
        name: r.abandonedCart.name,
        desc: r.abandonedCart.desc,
        trigger: "order_abandoned" as TriggerKey,
        conditions: {} as Conditions,
        actions: [
          { type: "whatsapp", message: wa(r.abandonedCart.message) },
        ] as Action[],
      },
      {
        id: "reviewReq",
        Icon: Star,
        tint: "bg-warning-soft text-warning",
        name: r.reviewReq.name,
        desc: r.reviewReq.desc,
        trigger: "order_completed" as TriggerKey,
        conditions: {} as Conditions,
        actions: [
          { type: "whatsapp", message: wa(r.reviewReq.message) },
        ] as Action[],
      },
      {
        id: "lowStock",
        Icon: PackageX,
        tint: "bg-info-soft text-info",
        name: r.lowStock.name,
        desc: r.lowStock.desc,
        trigger: "low_stock" as TriggerKey,
        conditions: {} as Conditions,
        actions: [
          {
            type: "notify",
            title: r.lowStock.notifyTitle,
            body: r.lowStock.notifyBody,
          },
        ] as Action[],
      },
      {
        id: "loyalty",
        Icon: Sparkles,
        tint: "bg-primary-soft text-primary",
        name: r.loyalty.name,
        desc: r.loyalty.desc,
        trigger: "order_completed" as TriggerKey,
        conditions: { min_total: 50 } as Conditions,
        actions: [{ type: "loyalty", points: 10 }] as Action[],
      },
      {
        id: "bigOrder",
        Icon: BadgeDollarSign,
        tint: "bg-primary-soft text-primary",
        name: r.bigOrder.name,
        desc: r.bigOrder.desc,
        trigger: "order_created" as TriggerKey,
        conditions: { min_total: 100 } as Conditions,
        actions: [
          {
            type: "notify",
            title: r.bigOrder.notifyTitle,
            body: r.bigOrder.notifyBody,
          },
        ] as Action[],
      },
      {
        id: "badReview",
        Icon: AlertTriangle,
        tint: "bg-danger-soft text-danger",
        name: r.badReview.name,
        desc: r.badReview.desc,
        trigger: "new_review" as TriggerKey,
        conditions: { max_rating: 2 } as Conditions,
        actions: [
          {
            type: "notify",
            title: r.badReview.notifyTitle,
            body: r.badReview.notifyBody,
          },
        ] as Action[],
      },
      {
        id: "bookingReminder",
        Icon: Clock,
        tint: "bg-info-soft text-info",
        name: r.bookingReminder.name,
        desc: r.bookingReminder.desc,
        trigger: "booking_reminder" as TriggerKey,
        conditions: { hours_before: 1 } as Conditions,
        actions: [
          { type: "whatsapp", message: wa(r.bookingReminder.message) },
        ] as Action[],
      },
      {
        id: "winback",
        Icon: Moon,
        tint: "bg-primary-soft text-primary",
        name: r.winback.name,
        desc: r.winback.desc,
        trigger: "customer_inactive" as TriggerKey,
        conditions: { inactive_days: 30 } as Conditions,
        actions: [{ type: "coupon", percent: 10 }] as Action[],
      },
    ];
  }, [t, storeName]);

  async function enableRecipe(recipe: (typeof recipes)[number]) {
    setPendingRecipe(recipe.id);
    const { error } = await createClient()
      .from("automations")
      .insert({
        store_id: storeId,
        name: recipe.name,
        trigger: recipe.trigger,
        conditions: recipe.conditions,
        actions: recipe.actions,
        enabled: true,
      });
    setPendingRecipe(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(t.enabledToast);
    router.refresh();
  }

  // ===== Builder open/edit =====
  function openNew() {
    setDraft(emptyDraft);
    setEditingId("new");
  }
  function openEdit(a: AutomationRow) {
    const c = a.conditions ?? {};
    setDraft({
      name: a.name ?? "",
      trigger: a.trigger,
      minTotal: c.min_total != null ? String(c.min_total) : "",
      locationId: c.location_id ?? "",
      maxRating: c.max_rating != null ? String(c.max_rating) : "",
      hoursBefore: c.hours_before != null ? String(c.hours_before) : "",
      inactiveDays: c.inactive_days != null ? String(c.inactive_days) : "",
      actions: (a.actions ?? []).length
        ? (a.actions as Action[])
        : [defaultAction("notify")],
    });
    setEditingId(a.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function setActionField(idx: number, patch: Partial<Action>) {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a, i) =>
        i === idx ? ({ ...a, ...patch } as Action) : a,
      ),
    }));
  }
  function addAction(type: ActionType) {
    setDraft((d) => ({ ...d, actions: [...d.actions, defaultAction(type)] }));
  }
  function removeAction(idx: number) {
    setDraft((d) => ({ ...d, actions: d.actions.filter((_, i) => i !== idx) }));
  }

  async function save() {
    if (!draft.actions.length) {
      notifyError(t.noActions);
      return;
    }
    const flags = TRIGGER_CONDS[draft.trigger];
    const conditions: Conditions = {};
    if (flags.minTotal && draft.minTotal.trim())
      conditions.min_total = Number(draft.minTotal);
    if (flags.location && draft.locationId)
      conditions.location_id = draft.locationId;
    if (flags.maxRating && draft.maxRating.trim())
      conditions.max_rating = Number(draft.maxRating);
    if (flags.hoursBefore && draft.hoursBefore.trim())
      conditions.hours_before = Math.max(1, Number(draft.hoursBefore) || 1);
    if (flags.inactiveDays && draft.inactiveDays.trim())
      conditions.inactive_days = Math.max(1, Number(draft.inactiveDays) || 30);

    // Normalise numeric action params.
    const actions: Action[] = draft.actions.map((a) => {
      if (a.type === "loyalty")
        return { type: "loyalty", points: Math.max(0, Number(a.points) || 0) };
      if (a.type === "coupon")
        return {
          type: "coupon",
          percent: Math.min(100, Math.max(0, Number(a.percent) || 0)),
        };
      return a;
    });

    const payload = {
      name: draft.name.trim() || t.triggers[draft.trigger],
      trigger: draft.trigger,
      conditions,
      actions,
    };

    setBusy(true);
    const supabase = createClient();
    const { error } =
      editingId === "new"
        ? await supabase
            .from("automations")
            .insert({ ...payload, store_id: storeId, enabled: true })
        : editingId
          ? await supabase
              .from("automations")
              .update(payload)
              .eq("id", editingId)
          : { error: null };
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(editingId === "new" ? t.enabledToast : t.savedToast);
    cancel();
    router.refresh();
  }

  async function toggle(a: AutomationRow) {
    setBusy(true);
    const { error } = await createClient()
      .from("automations")
      .update({ enabled: !a.enabled })
      .eq("id", a.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  async function remove(a: AutomationRow) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("automations")
      .delete()
      .eq("id", a.id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  // ===== Human-readable summary for a saved automation =====
  function conditionChips(c: Conditions | null): string[] {
    if (!c) return [];
    const out: string[] = [];
    if (c.min_total != null) out.push(`${t.condMinTotal} $${c.min_total}`);
    if (c.location_id) out.push(`${t.condLocation}: ${locationName(c.location_id)}`);
    if (c.max_rating != null) out.push(`${t.condMaxRating} ${c.max_rating}★`);
    if (c.hours_before != null)
      out.push(`${t.condHoursBefore} ${c.hours_before} ${t.hoursUnit}`);
    if (c.inactive_days != null)
      out.push(`${t.condInactiveDays} ${c.inactive_days} ${t.daysUnit}`);
    return out;
  }
  function actionLabel(a: Action): string {
    if (a.type === "loyalty")
      return `${t.actions.loyalty} +${a.points} ${t.pointsUnit}`;
    if (a.type === "coupon")
      return `${t.actions.coupon} ${a.percent}${t.percentOff}`;
    return t.actions[a.type];
  }

  const flags = TRIGGER_CONDS[draft.trigger];
  const showLocation = !!flags.location && locations.length > 0;
  const hasAnyCond =
    !!flags.minTotal ||
    showLocation ||
    !!flags.maxRating ||
    !!flags.hoursBefore ||
    !!flags.inactiveDays;

  // ===== Builder form (shared by new + edit) =====
  const form = (
    <div className="rounded-3xl border border-primary/30 bg-surface p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center gap-2 text-sm font-bold text-primary">
        <Wand2 className="h-4 w-4" />
        {editingId === "new" ? t.customTitle : t.edit}
      </div>

      <label className="block text-sm font-semibold">
        {t.nameLabel}
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder={t.nameHint}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
      </label>

      {/* Vertical When → If → Do flow */}
      <div className="mt-5">
        {/* WHEN */}
        <FlowStep
          Icon={Zap}
          nodeClass="bg-gradient-to-br from-primary to-info text-white"
          label={t.whenLabel}
          hint={t.whenHint}
        >
          <TriggerPicker
            value={draft.trigger}
            items={TRIGGERS.map((tr) => ({
              tr,
              Icon: TRIGGER_ICON[tr],
              label: t.triggers[tr],
            }))}
            onSelect={(tr) =>
              setDraft((d) => ({
                ...d,
                trigger: tr,
                // reset conditions that no longer apply
                minTotal: TRIGGER_CONDS[tr].minTotal ? d.minTotal : "",
                locationId: TRIGGER_CONDS[tr].location ? d.locationId : "",
                maxRating: TRIGGER_CONDS[tr].maxRating ? d.maxRating : "",
                hoursBefore: TRIGGER_CONDS[tr].hoursBefore ? d.hoursBefore : "",
                inactiveDays: TRIGGER_CONDS[tr].inactiveDays
                  ? d.inactiveDays
                  : "",
              }))
            }
          />
        </FlowStep>

        {/* IF */}
        <FlowStep
          Icon={Filter}
          nodeClass="bg-warning-soft text-warning"
          label={t.ifLabel}
          hint={t.ifHint}
        >
          <ConditionFields
            flags={flags}
            showLocation={showLocation}
            hasAnyCond={hasAnyCond}
            draft={draft}
            locations={locations}
            t={t}
            onDraftChange={(patch) => setDraft({ ...draft, ...patch })}
          />
        </FlowStep>

        {/* DO */}
        <FlowStep
          Icon={Play}
          nodeClass="bg-success-soft text-success"
          label={t.doLabel}
          hint={t.doHint}
          last
        >
          <div className="space-y-3">
            {draft.actions.map((a, idx) => (
              <ActionEditor
                key={idx}
                action={a}
                Icon={ACTION_ICON[a.type]}
                tint={ACTION_TINT[a.type]}
                t={t}
                onFieldChange={(patch) => setActionField(idx, patch)}
                onRemove={() => removeAction(idx)}
              />
            ))}

            {/* Add-action chips */}
            <div className="flex flex-wrap gap-2 pt-1">
              {ACTION_TYPES.map((type) => {
                const AIcon = ACTION_ICON[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addAction(type)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <AIcon className="h-3.5 w-3.5" />
                    {t.actions[type]}
                  </button>
                );
              })}
            </div>
          </div>
        </FlowStep>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          {t.save}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mt-8 space-y-10">
      {/* ===== Recipe gallery ===== */}
      <section>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-extrabold tracking-tight">
            {t.recipesTitle}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.recipesSubtitle}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {recipes.map((r) => {
            const added = existingNames.has(r.name.trim());
            const pending = pendingRecipe === r.id;
            return (
              <RecipeCard
                key={r.id}
                Icon={r.Icon}
                tint={r.tint}
                name={r.name}
                desc={r.desc}
                added={added}
                pending={pending}
                addedLabel={t.added}
                enableLabel={t.enable}
                onEnable={() => enableRecipe(r)}
              />
            );
          })}
        </div>
      </section>

      {/* ===== Custom builder ===== */}
      <section>
        {editingId === "new" ? (
          form
        ) : (
          <button
            type="button"
            onClick={openNew}
            className="flex w-full items-center gap-4 rounded-3xl border border-dashed border-primary/40 bg-gradient-to-br from-primary/5 to-transparent p-5 text-start transition-colors hover:border-primary"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Wand2 className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">{t.customTitle}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {t.customSubtitle}
              </span>
            </span>
            <span className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
              <Plus className="h-4 w-4" />
              {t.newButton}
            </span>
          </button>
        )}
      </section>

      {/* ===== Existing automations ===== */}
      <section>
        <h2 className="text-lg font-extrabold tracking-tight">{t.listTitle}</h2>
        <div className="mt-4 space-y-3">
          {initial.length === 0 && editingId !== "new" && (
            <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              {t.listEmpty}
            </div>
          )}
          {initial.map((a) =>
            editingId === a.id ? (
              <div key={a.id}>{form}</div>
            ) : (
              <AutomationListItem
                key={a.id}
                a={a}
                t={t}
                TriggerIcon={TRIGGER_ICON[a.trigger]}
                chips={conditionChips(a.conditions)}
                actionChips={(a.actions ?? []).map((ac) => ({
                  tint: ACTION_TINT[ac.type],
                  Icon: ACTION_ICON[ac.type],
                  label: actionLabel(ac),
                }))}
                busy={busy}
                onToggle={() => toggle(a)}
                onEdit={() => openEdit(a)}
                onRemove={() => remove(a)}
              />
            ),
          )}
        </div>
      </section>

      {/* ===== Activity feed ===== */}
      <section>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t.activityTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.activitySubtitle}
        </p>
        <div className="mt-4">
          {runs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              {t.activityEmpty}
            </div>
          ) : (
            <CardListUl>
              {runs.map((run) => {
                const auto = initial.find((a) => a.id === run.automation_id);
                const name =
                  auto?.name?.trim() ||
                  (auto ? t.triggers[auto.trigger] : t.unknownAutomation);
                return (
                  <li key={run.id} className="flex items-center gap-3 px-4 py-3">
                    <StatusPill status={run.status} dict={dict} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.triggers[run.trigger as TriggerKey] ?? run.trigger}
                      </p>
                    </div>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={run.created_at}
                    >
                      {timeAgo(run.created_at, lang)}
                    </time>
                  </li>
                );
              })}
            </CardListUl>
          )}
        </div>
      </section>
    </div>
  );
}
