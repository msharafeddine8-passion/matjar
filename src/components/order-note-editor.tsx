"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { saveStaffNote } from "@/lib/order-staff-note";

// Internal, staff-only note on an order. Merchants can jot a handling reminder
// ("call before delivery", "gift wrap") that customers never see — and, from
// 0314, cannot read through the API either: the note lives in
// order_staff_notes (staff_can(store, 'orders') only) instead of
// orders.store_note, which the ordering customer's own row exposed. The save
// falls back to the old column while 0314 is not applied
// (src/lib/order-staff-note.ts).
export function OrderNoteEditor({
  orderId,
  storeId,
  note,
  labels,
  errorLabel,
}: {
  orderId: string;
  storeId: string;
  note: string | null;
  labels: {
    title: string;
    add: string;
    placeholder: string;
    save: string;
    cancel: string;
    saved: string;
  };
  errorLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    const ok = await saveStaffNote(createClient(), {
      orderId,
      storeId,
      note: value,
    });
    setBusy(false);
    if (!ok) {
      notifyError(errorLabel);
      return;
    }
    notifySuccess(labels.saved);
    setOpen(false);
    router.refresh();
  }

  if (open) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <StickyNote className="h-4 w-4" />
          {labels.title}
        </span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={labels.placeholder}
          rows={2}
          className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="relative inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-bold whitespace-nowrap text-primary-foreground shadow-sm transition-[transform,box-shadow,background-color] duration-150 select-none hover:bg-primary-hover hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55"
          >
            {labels.save}
          </button>
          <button
            onClick={() => {
              setValue(note ?? "");
              setOpen(false);
            }}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            {labels.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {note ? (
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold text-foreground">
                {labels.title}:{" "}
              </span>
              {note}
            </span>
          </p>
          <button
            onClick={() => setOpen(true)}
            aria-label={labels.title}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          {labels.add}
        </button>
      )}
    </div>
  );
}
