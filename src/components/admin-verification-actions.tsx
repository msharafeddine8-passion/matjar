"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

// Admin-only approve/reject island. RLS lets super-admins update any
// store_verifications row, so the mutation runs straight from the client.
export function AdminVerificationActions({
  id,
  dict,
}: {
  id: string;
  dict: Pick<Dictionary, "admin" | "auth" | "common" | "verifications">;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const t = dict.verifications;

  async function setStatus(status: "verified" | "rejected") {
    if (
      status === "rejected" &&
      !(await confirm({
        message: dict.admin.confirmRejectVerification,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_verifications")
      .update({ status })
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction(
      status === "verified" ? "approved" : "rejected",
      "verification",
      id,
      { to: status },
    );
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setStatus("verified")}
        disabled={busy}
        leftIcon={<Check className="h-4 w-4" />}
      >
        {t.approve}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setStatus("rejected")}
        disabled={busy}
        leftIcon={<X className="h-4 w-4" />}
        className="!text-danger !border-danger/30 hover:!bg-danger/5"
      >
        {t.reject}
      </Button>
    </div>
  );
}
