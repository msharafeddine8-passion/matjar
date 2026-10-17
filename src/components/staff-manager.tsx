"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Dictionary } from "@/i18n/get-dictionary";
import { CardList, CardRow } from "@/components/ui/card";

type Perms = Record<(typeof PERM_KEYS)[number], boolean>;
type Staff = {
  id: string;
  email: string | null;
  role: string;
  permissions: Record<string, boolean> | null;
};

// Every permission RLS actually enforces, so an owner can grant what the
// database checks. This listed three; staff_can() is called with ten across the
// policies, and the seven missing here could never be granted to anyone — the
// areas they guard were closed to all staff permanently, with no way for the
// owner to open them and nothing anywhere saying so.
//
// The three that already existed stay first on purpose, so an owner's muscle
// memory still lands on the same toggles.
const PERM_KEYS = [
  "orders",
  "products",
  "bookings",
  "inventory",
  "customers",
  "pos",
  "suppliers",
  "expenses",
  "classes",
  "tasks",
] as const;

function normalize(p: Record<string, boolean> | null): Perms {
  // Default missing keys to false so the toggle matches enforcement, which
  // coalesces a missing permission to false (staff_can, items/pos pages).
  return Object.fromEntries(
    PERM_KEYS.map((k) => [k, p?.[k] ?? false]),
  ) as Perms;
}

export function StaffManager({
  storeId,
  dict,
  staff,
  maxStaff,
}: {
  storeId: string;
  dict: Pick<Dictionary, "auth" | "common" | "merchant">;
  staff: Staff[];
  maxStaff: number;
}) {
  const atLimit = staff.length >= maxStaff;
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [perms, setPerms] = useState<Record<string, Perms>>(
    Object.fromEntries(staff.map((s) => [s.id, normalize(s.permissions)])),
  );

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setBusy(true);
    setMsg(null);
    const email = String(new FormData(formEl).get("email"));
    const supabase = createClient();
    const { data, error } = await supabase.rpc("add_store_staff", {
      p_store_id: storeId,
      p_email: email,
      p_role: "staff",
    });
    setBusy(false);
    if (error || data === "not_owner") {
      setMsg(dict.auth.errorGeneric);
      return;
    }
    if (data === "not_found") {
      setMsg(dict.merchant.staffNotFound);
      return;
    }
    if (data === "self") {
      setMsg(dict.merchant.staffSelf);
      return;
    }
    formEl.reset();
    setMsg(dict.merchant.staffAdded);
    router.refresh();
  }

  async function togglePerm(staffId: string, key: keyof Perms) {
    const current = perms[staffId] ?? normalize(null);
    const next = { ...current, [key]: !current[key] };
    setPerms((p) => ({ ...p, [staffId]: next }));
    const { error } = await createClient()
      .from("store_staff")
      .update({ permissions: next })
      .eq("id", staffId);
    if (error) {
      // Revert the optimistic flip — a "revoked" permission must never look
      // revoked while still active in the database.
      setPerms((p) => ({ ...p, [staffId]: current }));
      notifyError(dict.auth.errorGeneric);
    }
  }

  async function remove(id: string) {
    // ISS-030. This used to read dict.merchant.products.confirmDelete — the
    // dialog asked "delete this product?" while removing a person from the
    // team. The two actions are not alike: removing staff revokes someone's
    // access to a live store and cannot be undone from this screen, and a
    // confirm that describes the wrong action is worse than none, because it
    // trains the reader that the words in these dialogs do not matter.
    if (
      !(await confirm({
        message: dict.merchant.staffConfirmRemove,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_staff")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {atLimit ? (
        <p className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          {dict.merchant.staffLimitReached.replace("{max}", String(maxStaff))}
        </p>
      ) : (
        <form onSubmit={onAdd} className="flex gap-2">
          <Input
            name="email"
            type="email"
            required
            placeholder={dict.merchant.staffEmail}
            className="flex-1 min-w-0"
          />
          <Button type="submit" loading={busy}>
            {dict.merchant.staffAdd}
          </Button>
        </form>
      )}
      {msg && (
        <p className="mt-2 text-sm font-medium text-muted-foreground">{msg}</p>
      )}

      {staff.length ? (
        <CardList className="mt-5">
          {staff.map((s) => {
            const sp = perms[s.id] ?? normalize(s.permissions);
            return (
              <CardRow key={s.id}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{s.email}</span>
                  <button
                    onClick={() => remove(s.id)}
                    disabled={busy}
                    aria-label={dict.merchant.staffRemoveLabel.replace(
                      "{email}",
                      s.email ?? "",
                    )}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    {dict.merchant.perms.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PERM_KEYS.map((key) => (
                      <label
                        key={key}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          sp[key]
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={sp[key]}
                          onChange={() => togglePerm(s.id, key)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {dict.merchant.perms[key]}
                      </label>
                    ))}
                  </div>
                </div>
              </CardRow>
            );
          })}
        </CardList>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          {dict.merchant.noStaff}
        </p>
      )}
    </div>
  );
}
