"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Dictionary } from "@/i18n/get-dictionary";

// Customer-facing cancel for a pending order or an open booking. Calls the
// SECURITY DEFINER RPC so only the owner + allowed status can cancel.
export function OrderCancelButton({
  id,
  kind,
  dict,
}: {
  id: string;
  kind: "order" | "booking";
  dict: Pick<Dictionary, "auth" | "booking" | "common" | "orders">;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = kind === "booking" ? dict.booking.cancel : dict.orders.cancel;
  const confirmMsg =
    kind === "booking" ? dict.booking.cancelConfirm : dict.orders.cancelConfirm;

  async function cancel() {
    if (
      !(await confirm({
        message: confirmMsg,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    const rpc = kind === "order" ? "cancel_my_order" : "cancel_my_booking";
    const { error: e } = await createClient().rpc(rpc, { p_id: id });
    setBusy(false);
    if (e) {
      setError(
        e.message?.includes("cancel_too_late")
          ? dict.booking.cancelTooLate
          : dict.auth.errorGeneric,
      );
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={cancel}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl border border-danger/30 px-4 py-2.5 text-sm font-bold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
      >
        <X className="h-4 w-4" />
        {label}
      </button>
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
