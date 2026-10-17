"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CardList, CardRow } from "@/components/ui/card";
import { notifyError } from "@/lib/notify";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";

export type SavedSearchRow = {
  id: string;
  q: string | null;
  category: string | null;
  region: string | null;
  city: string | null;
};

export function SavedSearchesManager({
  rows,
  lang,
  dict,
}: {
  rows: SavedSearchRow[];
  lang: Locale;
  dict: Pick<Dictionary, "common" | "savedSearch">;
}) {
  const router = useRouter();
  const t = dict.savedSearch;
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    const { error } = await createClient()
      .from("saved_searches")
      .delete()
      .eq("id", id);
    setBusy(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  const regionName = (key: string) =>
    regions.find((r) => r.key === key)?.name[lang] ?? key;

  if (rows.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="mb-3 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
        <Bell className="h-5 w-5 text-primary" />
        {t.title}
      </h2>
      <CardList>
        {rows.map((r) => {
          const parts = [
            r.q,
            r.category,
            r.region ? regionName(r.region) : null,
            r.city,
          ].filter(Boolean);
          return (
            <CardRow
              key={r.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex flex-wrap gap-1.5">
                {parts.length ? (
                  parts.map((p, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t.allListings}
                  </span>
                )}
              </div>
              <button
                disabled={busy === r.id}
                onClick={() => remove(r.id)}
                className="flex shrink-0 items-center rounded-lg border border-border px-2.5 py-1.5 text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </CardRow>
          );
        })}
      </CardList>
    </div>
  );
}
