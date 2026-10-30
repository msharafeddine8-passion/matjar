"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Store as StoreIcon } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { revalidateStore } from "@/lib/cache-actions";
import type { ListingMode } from "@/lib/store-experience";
import { Switch } from "@/components/ui/switch";

/**
 * The owner's own decision: take orders and bookings through Matjar, or only be
 * seen here. Saves on the toggle rather than with the long settings form below,
 * because it changes what the whole storefront is, not one of its terms.
 * Existing orders are unaffected; the database only refuses new ones.
 */
export function ListingModeToggle({
  storeId,
  initial,
  dict,
}: {
  storeId: string;
  initial: ListingMode;
  dict: Pick<Dictionary, "showcase" | "auth">;
}) {
  const router = useRouter();
  const t = dict.showcase;
  const [mode, setMode] = useState<ListingMode>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const on = mode === "showcase";

  async function change(next: boolean) {
    const nextMode: ListingMode = next ? "showcase" : "full";
    setBusy(true);
    setError(null);
    setNote(null);
    const { error: saveError } = await createClient()
      .from("stores")
      .update({ listing_mode: nextMode, updated_at: new Date().toISOString() })
      .eq("id", storeId);
    setBusy(false);
    if (saveError) {
      setError(dict.auth.errorGeneric);
      return;
    }
    setMode(nextMode);
    setNote(next ? t.toggleOnNote : t.toggleSaved);
    await revalidateStore(storeId);
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <StoreIcon aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold leading-snug">{t.question}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t.toggleBody}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2 pt-1">
          <span className="hidden text-sm font-semibold sm:inline">{t.toggleLabel}</span>
          <Switch
            checked={on}
            onChange={change}
            label={t.toggleLabel}
            disabled={busy}
          />
        </span>
      </div>
      {(note || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-3 text-sm font-semibold ${error ? "text-danger" : "text-success"}`}
        >
          {error ?? note}
        </p>
      )}
    </section>
  );
}
