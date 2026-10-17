"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserRoundCog, ArrowLeftRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

// Danger-zone card: hand the whole store to another account by email. Built for
// the "opened the store FOR someone" flow. Goes through the guarded
// transfer_store_ownership RPC (0169) — owner-only, target must already have an
// account. On success the CALLER just lost access, so we leave to /merchant.
export function TransferOwnership({
  storeId,
  storeName,
  lang,
  dict,
}: {
  storeId: string;
  storeName: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "merchant">;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.merchant.transfer;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    if (!target || busy) return;
    if (
      !(await confirm({
        title: t.confirmTitle,
        message: t.confirmBody
          .replace("{store}", storeName)
          .replace("{email}", target),
        confirmLabel: t.confirmAction,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;

    setBusy(true);
    const { data, error } = await createClient().rpc(
      "transfer_store_ownership",
      { p_store_id: storeId, p_email: target },
    );
    setBusy(false);

    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    if (data === "not_found") {
      notifyError(t.notFound);
      return;
    }
    if (data === "self") {
      notifyError(t.self);
      return;
    }
    if (data !== "ok") {
      notifyError(dict.common.actionFailed);
      return;
    }

    notifySuccess(t.done.replace("{email}", target));
    // The caller is no longer the owner — this store's pages will now redirect
    // them away, so leave cleanly to their dashboard.
    router.push(`/${lang}/merchant`);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-danger/30 bg-danger-soft/30 p-5">
      <h2 className="flex items-center gap-2 font-bold text-danger">
        <UserRoundCog className="h-5 w-5" />
        {t.title}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{t.hint}</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.emailPlaceholder}
          dir="ltr"
          className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-danger focus:ring-2 focus:ring-danger/15 placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-danger px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <ArrowLeftRight className="h-4 w-4" />
          {busy ? t.transferring : t.action}
        </button>
      </form>
    </div>
  );
}
