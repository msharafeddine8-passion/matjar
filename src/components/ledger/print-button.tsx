"use client";

import { Printer } from "lucide-react";

// The statement's only client JavaScript. "PDF" is the browser's own
// Print → Save as PDF: no PDF library in the bundle and nothing to pay for.
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-bold shadow-xs hover:border-primary/40 print:hidden"
    >
      <Printer className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
