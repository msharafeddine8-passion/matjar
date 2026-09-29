"use client";
import { revalidateListing } from "@/lib/cache-actions";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageIcon, Pencil, Trash2, RefreshCw, CircleCheck, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { ListingCard } from "@/lib/data/market";
import { formatUsd } from "@/lib/currency";
import { CardList, CardRow } from "@/components/ui/card";
import { renewOpensAt } from "@/lib/market-renew";

const STATUSES = ["all", "active", "pending", "sold", "expired", "rejected", "draft"] as const;

const statusStyle: Record<string, string> = {
  active: "bg-success-soft text-success",
  pending: "bg-warning-soft text-warning",
  sold: "bg-foreground text-background",
  expired: "bg-warning-soft text-warning",
  rejected: "bg-danger-soft text-danger",
  draft: "bg-surface-muted text-muted-foreground",
};

export function MyListingsManager({
  listings,
  lang,
  dict,
}: {
  listings: ListingCard[];
  lang: Locale;
  dict: Dictionary;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.market;
  const [tab, setTab] = useState<(typeof STATUSES)[number]>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = listings.filter((l) => tab === "all" || l.status === tab);
  const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Beirut",
    }).format(d);

  async function patch(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    const { error } = await createClient()
      .from("listings")
      .update(patch)
      .eq("id", id);
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    await revalidateListing(id);
    router.refresh();
  }
  async function remove(id: string) {
    if (
      !(await confirm({
        message: t.form.confirmDelete,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(id);
    const { error } = await createClient()
      .from("listings")
      .delete()
      .eq("id", id);
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    await revalidateListing(id);
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/40"
            }`}
          >
            {t.tabs[s]}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <CardList className="mt-4">
          {filtered.map((l) => (
            <CardRow key={l.id} className="flex items-center gap-3 p-3">
              {l.image ? (
                <Image src={l.image} alt={l.title} width={56} height={56} className="h-14 w-14 shrink-0 rounded-lg object-cover" sizes="56px" />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                  <ImageIcon className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{l.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusStyle[l.status]}`}>
                    {t.statusLabels[l.status as keyof typeof t.statusLabels]}
                  </span>
                </div>
                {l.price != null && (
                  <p className="text-sm text-primary">{formatUsd(l.price)}</p>
                )}
                {l.status === "rejected" && l.moderationNote && (
                  // The moderator's reason (0313). Stored as a reason key so it
                  // reads in the seller's language; free text passes through.
                  <p className="mt-0.5 text-xs text-danger">
                    {dict.moderation.rejectedBecause.replace(
                      "{reason}",
                      (dict.moderation.rejectReasons as Record<string, string>)[
                        l.moderationNote
                      ] ?? l.moderationNote,
                    )}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <Link href={`/${lang}/market/${l.id}/edit`} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-surface-muted">
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
                {l.status === "active" && (
                  <>
                    {/* Once a week (0317): before that the database keeps the
                        old date, so the button says when it opens instead. */}
                    {(() => {
                      const opens = renewOpensAt(l.createdAt);
                      const label = opens
                        ? t.form.renewOpensOn.replace("{date}", fmtDay(opens))
                        : t.form.renew;
                      return (
                        <button
                          disabled={busy === l.id || opens !== null}
                          onClick={() => patch(l.id, { created_at: new Date().toISOString() })}
                          title={label}
                          aria-label={label}
                          className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-surface-muted disabled:opacity-60"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      );
                    })()}
                    <button disabled={busy === l.id} onClick={() => patch(l.id, { status: "sold" })} title={t.form.markSold} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-surface-muted disabled:opacity-60">
                      <CircleCheck className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {(l.status === "sold" || l.status === "expired") && (
                  <button disabled={busy === l.id} onClick={() => patch(l.id, { status: "active", created_at: new Date().toISOString() })} title={l.status === "expired" ? t.form.renew : t.form.markActive} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-surface-muted disabled:opacity-60">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button disabled={busy === l.id} onClick={() => remove(l.id)} className="flex h-8 items-center rounded-lg border border-border px-2.5 text-danger transition-colors hover:bg-danger-soft disabled:opacity-60">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </CardRow>
          ))}
        </CardList>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
          {t.myListingsEmpty}
        </div>
      )}
    </div>
  );
}
