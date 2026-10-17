import { AlertTriangle } from "lucide-react";

// What a merchant screen shows when its read failed. Without it a failed query
// rendered as an empty list or a row of zeros — indistinguishable from "you
// have nothing yet", which is a lie a merchant then acts on (re-adding stock,
// thinking a month had no sales). Server-safe: no client hooks, no icon props.
export function LoadError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm font-semibold text-danger ${className ?? ""}`}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
