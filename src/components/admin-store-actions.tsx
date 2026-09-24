"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { revalidateStores } from "@/lib/cache-actions";
import { logAdminAction } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";

export function AdminStoreActions({
  storeId,
  approveLabel,
  rejectLabel,
  errorLabel,
  cancelLabel,
  t,
  quality,
  dq,
}: {
  storeId: string;
  approveLabel: string;
  rejectLabel: string;
  errorLabel: string;
  cancelLabel: string;
  /** The /admin/stores strings, reused so the two screens ask for a reason in
   *  exactly the same words. */
  t: Dictionary["admin"]["storesAdmin"];
  /** The public data quality gate's verdict for this store (lib/data-quality.ts),
   *  with the issues already translated. `blocked` disables approval — the only
   *  transition gated — and the list is shown for any level so the reviewer
   *  sees what the merchant still owes before deciding. */
  quality?: { level: "ok" | "incomplete" | "blocked"; issues: string[] };
  dq?: Dictionary["dataQuality"];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const blocked = quality?.level === "blocked";
  // Rejecting used to be a yes/no confirm, which is how a merchant ends up
  // refused with nothing to read. The reason IS the confirmation now.
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Always through set_store_status (0282): it refuses an unexplained refusal
   *  and stamps the actor and the time server-side. */
  async function setStatus(status: "active" | "rejected", why?: string) {
    setBusy(true);
    const { data, error: rpcError } = await createClient().rpc(
      "set_store_status",
      { p_store_id: storeId, p_status: status, p_reason: why ?? null },
    );
    setBusy(false);
    if (rpcError) return errorLabel;
    const out = (data ?? {}) as { ok?: boolean; error?: string };
    if (!out.ok) {
      if (out.error === "reason_required") return t.reasonRequired;
      if (out.error === "reason_too_long") return t.reasonTooLong;
      if (out.error === "forbidden") return t.forbidden;
      if (out.error === "not_found") return t.storeNotFound;
      return errorLabel;
    }
    void logAdminAction(status === "active" ? "approved" : "rejected", "store", storeId, {
      to: status,
      reason: why ?? null,
    });
    await revalidateStores();
    router.refresh();
    return null;
  }

  async function approve() {
    if (blocked) {
      notifyError(dq?.blockedApprove ?? errorLabel);
      return;
    }
    const message = await setStatus("active");
    if (message) notifyError(message);
  }

  async function reject() {
    if (!reason.trim()) {
      setError(t.reasonRequired);
      return;
    }
    const message = await setStatus("rejected", reason);
    if (message) {
      setError(message);
      return;
    }
    setRejecting(false);
    setReason("");
  }

  if (rejecting) {
    return (
      <div className="w-full rounded-xl border border-danger/30 bg-danger-soft/30 p-3 lg:max-w-md">
        <label htmlFor={`reject-${storeId}`} className="text-sm font-bold">
          {t.reasonHeading}
        </label>
        <Textarea
          id={`reject-${storeId}`}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          maxLength={500}
          error={!!error}
          placeholder={t.reasonPlaceholder}
          className="mt-2"
        />
        {error && (
          <p className="mt-1 text-sm font-semibold text-danger">{error}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={reject}>
            {t.reasonSave}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setRejecting(false)}
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
      {quality && quality.issues.length > 0 && dq && (
        <p
          className={`max-w-md text-xs ${blocked ? "font-semibold text-danger" : "text-muted-foreground"}`}
        >
          {blocked ? dq.blockedApprove : dq.adminHeading + ":"}{" "}
          {quality.issues.join(" · ")}
        </p>
      )}
      <div className="flex gap-2">
      <Button
        size="sm"
        disabled={busy || blocked}
        title={blocked ? dq?.blockedApprove : undefined}
        onClick={approve}
        leftIcon={<Check className="h-4 w-4" />}
      >
        {approveLabel}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setReason("");
          setError(null);
          setRejecting(true);
        }}
        leftIcon={<X className="h-4 w-4" />}
        className="!text-danger"
      >
        {rejectLabel}
      </Button>
      </div>
    </div>
  );
}
