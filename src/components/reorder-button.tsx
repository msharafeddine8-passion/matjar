"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { ReorderSheet, type ActivityCopy } from "@/components/activity/reorder-sheet";

// "Order again" on a past order.
//
// It used to overwrite the store's whole cart with the old lines, blind: items
// since switched off, sold out, given variants (which the grid cart would then
// charge at the base price) or turned into services all went straight back in,
// and whatever the customer had already put in that cart was wiped. It now
// opens the same checked reorder sheet as the activity centre — current
// prices, what changed, what cannot come back and why — and merges into the
// cart instead of replacing it.
export function ReorderButton({
  orderId,
  storeId,
  storeName,
  lang,
  label,
  closeLabel,
  copy,
  className,
}: {
  orderId: string;
  storeId: string;
  storeName: string;
  lang: string;
  label: string;
  closeLabel: string;
  copy: ActivityCopy;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
        }
      >
        <RotateCcw className="h-4 w-4" />
        {label}
      </button>
      <ReorderSheet
        open={open}
        onClose={() => setOpen(false)}
        orderId={orderId}
        storeId={storeId}
        storeName={storeName}
        lang={lang}
        copy={copy}
        closeLabel={closeLabel}
      />
    </>
  );
}
