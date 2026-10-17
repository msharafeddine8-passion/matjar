"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";

// ===== Edit / hide / delete for the OS catalogue managers =====
//
// Units, rental vehicles, ticket types, membership plans, courses, classes,
// resources and portfolio items used to be add + delete only. A typo in a price
// meant deleting the row and re-adding it — and since those rows carry
// customer history (subscriptions, enrollments, sold tickets, rentals, stays),
// "delete and re-add" was also how that history got thrown away.
//
// Three things here, shared so the eight managers behave the same:
//
//   • Edit lives in each manager (its own form, prefilled); this only draws
//     the pencil.
//   • Hide = the table's `active` flag. Every storefront read of these tables
//     already filters `active = true`, so it is the honest "stop selling this"
//     without touching anything a customer already holds.
//   • Delete warns that history is affected, and when the database refuses it
//     with a foreign-key violation (23503 — plans/courses/ticket types/vehicles
//     that customers have used can no longer be deleted) says so in words and
//     points at edit or hide instead.
//
// Writes go straight to the table, as the managers' inserts already did; the
// `*_manage` RLS policies on each table (FOR ALL, can_manage_store/staff_can)
// are what allow or refuse them.

export const FK_VIOLATION = "23503";

export function isFkViolation(
  error: { code?: string | null } | null | undefined,
): boolean {
  return error?.code === FK_VIOLATION;
}

export type CatalogTable =
  | "accommodation_units"
  | "rental_vehicles"
  | "event_ticket_types"
  | "store_membership_plans"
  | "store_courses"
  | "store_classes"
  | "store_resources"
  | "store_portfolio";

/** Delete + show/hide for one table, with the copy and the 23503 handling. */
export function useCatalogRowOps(table: CatalogTable, dict: Dictionary) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.catalogItem;
  const [busyId, setBusyId] = useState<string | null>(null);

  /** `hideable`: the table has an `active` flag, so the warning can offer it. */
  async function remove(id: string, hideable: boolean): Promise<void> {
    if (
      !(await confirm({
        message: hideable ? t.confirmDelete : t.confirmDeleteNoHide,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusyId(id);
    const { data, error } = await createClient()
      .from(table)
      .delete()
      .eq("id", id)
      .select("id");
    setBusyId(null);
    if (error || !data?.length) {
      if (error && !isFkViolation(error))
        console.error(`[${table}] delete failed`, error);
      notifyError(isFkViolation(error) ? t.deleteBlocked : dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  async function setActive(id: string, active: boolean): Promise<void> {
    setBusyId(id);
    const { data, error } = await createClient()
      .from(table)
      .update({ active })
      .eq("id", id)
      .select("id");
    setBusyId(null);
    // A zero-row result is RLS saying no without an error; treat it as one.
    if (error || !data?.length) {
      if (error) console.error(`[${table}] active toggle failed`, error);
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(active ? t.activated : t.deactivated);
    router.refresh();
  }

  return { remove, setActive, busyId };
}

/** Save an edit: update by id, `.select` so an RLS miss is not a silent no-op. */
export async function updateCatalogRow(
  table: CatalogTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await createClient()
    .from(table)
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error(`[${table}] update failed`, error);
    return false;
  }
  return true;
}

const btn =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border transition-colors disabled:opacity-60 lg:h-9 lg:w-9";

/** The row's buttons: edit · hide/show (when the table has `active`) · delete. */
export function CatalogRowActions({
  dict,
  deleteLabel,
  busy,
  active,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  dict: Dictionary;
  deleteLabel: string;
  busy?: boolean;
  /** Omit for a table with no `active` flag — no hide button is drawn. */
  active?: boolean;
  onEdit: () => void;
  onToggleActive?: () => void;
  onDelete: () => void;
}) {
  const t = dict.catalogItem;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={onEdit}
        aria-label={t.edit}
        title={t.edit}
        className={`${btn} text-muted-foreground hover:border-primary hover:text-primary`}
      >
        <Pencil className="h-4 w-4" aria-hidden />
      </button>
      {active !== undefined && onToggleActive && (
        <button
          type="button"
          disabled={busy}
          onClick={onToggleActive}
          aria-label={active ? t.deactivate : t.activate}
          title={active ? t.deactivate : t.activate}
          className={`${btn} text-muted-foreground hover:border-primary hover:text-primary`}
        >
          {active ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        aria-label={deleteLabel}
        title={deleteLabel}
        className={`${btn} text-danger hover:bg-danger-soft`}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
