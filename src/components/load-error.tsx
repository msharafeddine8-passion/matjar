"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCw } from "lucide-react";

// A server read failed. Said as a failure, with a way to try again — never
// dressed up as the empty state, which told a merchant with forty orders that
// they had none and offered to help them get their first.
export function LoadError({
  title,
  body,
  retryLabel,
  className = "",
}: {
  title: string;
  body?: string;
  retryLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="alert"
      className={`rounded-2xl border border-danger/30 bg-danger-soft p-6 text-center ${className}`}
    >
      <AlertTriangle className="mx-auto h-7 w-7 text-danger" aria-hidden />
      <p className="mt-3 font-bold text-foreground">{title}</p>
      {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
      <button
        type="button"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        <RotateCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} aria-hidden />
        {retryLabel}
      </button>
    </div>
  );
}
