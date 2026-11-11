"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FileText, GraduationCap, LayoutTemplate, Package, Store as StoreIcon, UtensilsCrossed } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { revalidateStore } from "@/lib/cache-actions";
import type { PageKind } from "@/lib/page-kind";

type T = Dictionary["pageKind"];

const OPTIONS = [
  { value: null, Icon: StoreIcon, label: "full", hint: "fullHint" },
  { value: "menu", Icon: UtensilsCrossed, label: "menu", hint: "menuHint" },
  { value: "landing", Icon: LayoutTemplate, label: "landing", hint: "landingHint" },
  { value: "product", Icon: Package, label: "product", hint: "productHint" },
  { value: "book", Icon: BookOpen, label: "book", hint: "bookHint" },
  { value: "course", Icon: GraduationCap, label: "course", hint: "courseHint" },
] as const satisfies readonly { value: PageKind | null; Icon: unknown; label: keyof T; hint: keyof T }[];

/** The six choices as cards. Controlled; used by the create form and the settings card. */
export function PageKindChoices({
  value,
  onChange,
  t,
  disabled,
}: {
  value: PageKind | null;
  onChange: (v: PageKind | null) => void;
  t: T;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value ?? "full"}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex min-w-0 flex-col items-start gap-1 rounded-xl border-2 p-3 text-start transition-colors disabled:opacity-60 ${
              on ? "border-primary bg-primary-soft/40" : "border-border bg-surface hover:border-primary/40"
            }`}
          >
            <o.Icon aria-hidden className={`h-5 w-5 ${on ? "text-primary" : "text-muted-foreground"}`} />
            <span className={`text-sm font-bold ${on ? "text-primary" : ""}`}>{t[o.label]}</span>
            <span className="text-xs leading-snug text-muted-foreground">{t[o.hint]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Settings card: saves on click, like the listing-mode toggle beside it. */
export function PageKindPicker({
  storeId,
  initial,
  dict,
}: {
  storeId: string;
  initial: PageKind | null;
  dict: Pick<Dictionary, "pageKind" | "auth">;
}) {
  const router = useRouter();
  const t = dict.pageKind;
  const [kind, setKind] = useState<PageKind | null>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(next: PageKind | null) {
    if (next === kind) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const { error: saveError } = await createClient()
      .from("stores")
      .update({ page_kind: next, updated_at: new Date().toISOString() })
      .eq("id", storeId);
    setBusy(false);
    if (saveError) {
      setError(dict.auth.errorGeneric);
      return;
    }
    setKind(next);
    setNote(t.saved);
    await revalidateStore(storeId);
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <FileText aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold leading-snug">{t.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
        </div>
      </div>
      <PageKindChoices value={kind} onChange={change} t={t} disabled={busy} />
      {(note || error) && (
        <p role={error ? "alert" : "status"} className={`mt-3 text-sm font-semibold ${error ? "text-danger" : "text-success"}`}>
          {error ?? note}
        </p>
      )}
    </section>
  );
}
