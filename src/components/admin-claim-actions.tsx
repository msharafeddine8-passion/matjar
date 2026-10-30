"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Trash2, X } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { revalidateDirectory } from "@/lib/cache-actions";
import { logAdminAction } from "@/lib/audit";
import { notifyError } from "@/lib/notify";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Field, Input, Textarea } from "@/components/ui/field";

type Action = "approve" | "reject" | "remove" | "done";
type ErrorCode = "user_not_found" | "already_claimed" | "already_resolved" | "not_found";
const KNOWN: readonly string[] = ["user_not_found", "already_claimed", "already_resolved", "not_found"];

/**
 * The three outcomes of a request, weighted by what the requester asked for:
 * the action they want is the primary button. Approving asks for the account to
 * hand the store to, because being the owner of a business and having a Matjar
 * account are two different facts and only an admin has checked the first.
 */
export function AdminClaimActions({
  requestId,
  storeId,
  kind,
  suggestedEmail,
  dict,
}: {
  requestId: string;
  storeId: string;
  kind: "claim" | "correct" | "remove";
  suggestedEmail: string | null;
  dict: Pick<Dictionary, "adminClaims" | "common">;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.adminClaims;
  const [busy, setBusy] = useState<Action | null>(null);
  const [approving, setApproving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  async function resolve(action: Action, email?: string, note?: string): Promise<string | null> {
    setBusy(action);
    const { data, error } = await createClient().rpc("admin_resolve_store_claim", {
      p_request_id: requestId,
      p_action: action,
      p_owner_email: email ?? null,
      p_note: note ?? null,
    });
    setBusy(null);
    const res = data as { ok?: boolean; code?: string } | null;
    if (error || !res) return t.errors.generic;
    if (!res.ok) {
      const code = res.code ?? "";
      return KNOWN.includes(code) ? t.errors[code as ErrorCode] : t.errors.generic;
    }
    void logAdminAction(action === "approve" ? "approved" : action === "reject" ? "rejected" : "updated", "store", storeId, {
      claim_request: requestId,
      action,
    });
    await revalidateDirectory(storeId);
    router.refresh();
    return null;
  }

  async function confirmThen(action: Exclude<Action, "approve">) {
    const copy = {
      reject: { title: t.rejectTitle, message: t.rejectBody },
      remove: { title: t.removeTitle, message: t.removeBody },
      done: { title: t.doneTitle, message: t.doneBody },
    }[action];
    const yes = await confirm({
      ...copy,
      confirmLabel: t.confirm,
      cancelLabel: t.cancel,
      danger: action === "remove",
    });
    if (!yes) return;
    const failed = await resolve(action);
    if (failed) notifyError(failed);
  }

  async function onApprove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSheetError(null);
    const failed = await resolve(
      "approve",
      String(form.get("email") ?? "").trim(),
      String(form.get("note") ?? "").trim() || undefined,
    );
    if (failed) setSheetError(failed);
    else setApproving(false);
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
      {kind !== "correct" && (
        <Button
          size="sm"
          variant={kind === "claim" ? "primary" : "secondary"}
          disabled={busy != null}
          onClick={() => {
            setSheetError(null);
            setApproving(true);
          }}
        >
          <Check aria-hidden className="h-4 w-4" />
          {t.approve}
        </Button>
      )}
      <Button
        size="sm"
        variant={kind === "correct" ? "primary" : "secondary"}
        loading={busy === "done"}
        disabled={busy != null}
        onClick={() => confirmThen("done")}
      >
        <CheckCheck aria-hidden className="h-4 w-4" />
        {t.done}
      </Button>
      <Button
        size="sm"
        variant={kind === "remove" ? "danger" : "secondary"}
        loading={busy === "remove"}
        disabled={busy != null}
        onClick={() => confirmThen("remove")}
      >
        <Trash2 aria-hidden className="h-4 w-4" />
        {t.remove}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={busy === "reject"}
        disabled={busy != null}
        onClick={() => confirmThen("reject")}
      >
        <X aria-hidden className="h-4 w-4" />
        {t.reject}
      </Button>

      <BottomSheet
        open={approving}
        onClose={() => setApproving(false)}
        title={t.approveTitle}
        closeLabel={dict.common.close}
      >
        <form onSubmit={onApprove} className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{t.approveBody}</p>
          <Field label={t.emailLabel} htmlFor={`claim-email-${requestId}`} required>
            <Input
              id={`claim-email-${requestId}`}
              name="email"
              type="email"
              dir="ltr"
              required
              defaultValue={suggestedEmail ?? ""}
            />
          </Field>
          <Field label={t.noteOptional} htmlFor={`claim-note-${requestId}`}>
            <Textarea id={`claim-note-${requestId}`} name="note" maxLength={1000} />
          </Field>
          {sheetError && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {sheetError}
            </p>
          )}
          <Button type="submit" full loading={busy === "approve"}>
            {t.approve}
          </Button>
        </form>
      </BottomSheet>
    </div>
  );
}
