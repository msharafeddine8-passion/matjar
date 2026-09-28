"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

// The app's BottomSheet is the phone modal and is `lg:hidden` by design. The
// ledger needs the same surface on a laptop at the till, so above lg the same
// content renders as an inline panel where it was opened instead of a modal —
// one form, never two copies of it in the DOM.

const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** true at Tailwind lg and up. Read synchronously on the client, so a sheet
 *  opened on a laptop is the inline panel from its first frame. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

export function LedgerSheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const desktop = useIsDesktop();

  if (!desktop) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={title}
        closeLabel={closeLabel}
        footer={footer}
      >
        {children}
      </BottomSheet>
    );
  }

  if (!open) return null;
  return (
    <section
      aria-label={title}
      className="mt-4 rounded-2xl border border-border bg-surface shadow-md"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-h4">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-4 pb-4">{children}</div>
      {footer && <div className="border-t border-border p-4">{footer}</div>}
    </section>
  );
}
