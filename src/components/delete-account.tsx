"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Trash2 } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { releaseDeviceOnSignOut } from "@/lib/native-push";
import { Button, ButtonLink } from "@/components/ui/button";

export type DeletionPreview = {
  stores: number;
  open_orders: number;
  orders: number;
  reviews: number;
  listings: number;
  addresses: number;
};

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-danger focus:ring-2 focus:ring-danger/15 placeholder:text-muted-foreground";

/**
 * Self-serve account deletion (B-12). Both app stores require this to exist as
 * a route the customer can take themselves; the privacy policy previously only
 * offered "message us on WhatsApp".
 *
 * Three deliberate choices:
 *
 * 1. The consequences are spelled out BEFORE the control, split into what goes
 *    and what stays, with this account's real numbers — a warning that says
 *    "some data may be retained" teaches the reader nothing.
 * 2. The confirmation is the account's own email address, typed. useConfirm()
 *    is the repo's dialog for destructive actions and is right for deleting a
 *    listing, but this is the one action with nothing behind it, and a dialog
 *    where the dangerous answer is one click away is not the right shape. The
 *    RPC enforces the same check server-side, so this is not merely decorative.
 * 3. It refuses, with a reason and a way forward, rather than doing something
 *    destructive quietly: a store owner would take their whole shop and every
 *    order their customers placed with it; an open order would lose the
 *    delivery address a merchant is about to drive to.
 */
export function DeleteAccount({
  lang,
  dict,
  email,
  preview,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "account" | "common">;
  email: string;
  preview: DeletionPreview;
}) {
  const router = useRouter();
  const t = dict.account.deleteAccount;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockedByStore = preview.stores > 0;
  const blockedByOrders = preview.open_orders > 0;
  const blocked = blockedByStore || blockedByOrders;
  const matches =
    typed.trim().toLowerCase() === email.trim().toLowerCase() && email !== "";

  async function remove() {
    if (!matches || blocked) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // Same ordering as LogoutButton, and for the same reason: the device push
    // token row must be dropped while the session still satisfies its RLS
    // policy. The cascade would take the row anyway, but the native side also
    // needs to unregister locally, and that only happens here.
    await releaseDeviceOnSignOut(supabase);

    const { error: rpcError } = await supabase.rpc("delete_my_account", {
      p_confirm: typed.trim(),
    });

    if (rpcError) {
      setBusy(false);
      const code = rpcError.message ?? "";
      setError(
        code.includes("owns_store")
          ? t.blockedStore
          : code.includes("open_orders")
            ? t.blockedOrders.replace("{n}", String(preview.open_orders))
            : code.includes("confirm_mismatch")
              ? t.mismatch
              : dict.common.actionFailed,
      );
      return;
    }

    // The account is gone server-side and its refresh tokens went with it, so
    // the session can never be renewed. signOut() clears the cookie this
    // browser is still holding, and refresh() drops the client router cache —
    // which is still holding RSC payloads rendered for a user that no longer
    // exists.
    await supabase.auth.signOut();
    router.replace(`/${lang}`);
    router.refresh();
  }

  return (
    <section className="mt-10 rounded-2xl border border-danger/30 bg-surface p-6 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-danger">
        <TriangleAlert className="h-5 w-5 shrink-0" />
        {t.title}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{t.hint}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
          <h3 className="text-sm font-bold">{t.goneTitle}</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>{t.goneProfile}</li>
            <li>{t.goneAddresses.replace("{n}", String(preview.addresses))}</li>
            <li>{t.goneSaved}</li>
            <li>{t.goneMessages}</li>
            <li>{t.goneListings.replace("{n}", String(preview.listings))}</li>
            <li>{t.goneLoyalty}</li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
          <h3 className="text-sm font-bold">{t.staysTitle}</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>{t.staysOrders.replace("{n}", String(preview.orders))}</li>
            <li>{t.staysReviews.replace("{n}", String(preview.reviews))}</li>
            <li>{t.staysCrm}</li>
          </ul>
        </div>
      </div>

      {blockedByStore ? (
        <div className="mt-5 rounded-xl border border-warning/40 bg-warning-soft p-4">
          <p className="text-sm font-semibold">{t.blockedStore}</p>
          <ButtonLink
            href={`/${lang}/merchant`}
            variant="secondary"
            size="sm"
            className="mt-3"
          >
            {t.blockedStoreAction}
          </ButtonLink>
        </div>
      ) : blockedByOrders ? (
        <div className="mt-5 rounded-xl border border-warning/40 bg-warning-soft p-4">
          <p className="text-sm font-semibold">
            {t.blockedOrders.replace("{n}", String(preview.open_orders))}
          </p>
          <ButtonLink
            href={`/${lang}/orders`}
            variant="secondary"
            size="sm"
            className="mt-3"
          >
            {t.blockedOrdersAction}
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-5">
          <label className="text-sm font-semibold" htmlFor="delete-confirm">
            {t.confirmHint.replace("{email}", email)}
          </label>
          <input
            id="delete-confirm"
            type="email"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            className={`${fieldClass} text-start`}
            placeholder={t.placeholder}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button
            variant="danger"
            className="mt-4"
            disabled={!matches || busy}
            loading={busy}
            onClick={remove}
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            {busy ? t.working : t.action}
          </Button>
          {error && (
            <p className="mt-3 text-sm font-semibold text-danger">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}
