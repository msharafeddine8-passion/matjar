"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { isActivePath } from "@/components/nav-link";

export function NavDropdown({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; accent?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Highlight the trigger when one of its links is the current page.
  const hasActiveChild = items.some((it) => isActivePath(pathname, it.href));

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-current={hasActiveChild ? "page" : undefined}
        className="flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground xl:px-3 transition-colors hover:bg-surface-muted hover:text-foreground aria-[current=page]:bg-surface-muted aria-[current=page]:text-foreground"
      >
        {label}
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 min-w-48 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              aria-current={isActivePath(pathname, it.href) ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-muted aria-[current=page]:bg-surface-muted ${
                it.accent
                  ? "text-warning hover:text-warning"
                  : "text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground"
              }`}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
