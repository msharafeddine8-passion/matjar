import type { Dictionary } from "@/i18n/get-dictionary";
import type { RunRow } from "../automation-manager";

export function StatusPill({
  status,
  dict,
}: {
  status: RunRow["status"];
  dict: Pick<Dictionary, "os">;
}) {
  const t = dict.os.automations.status;
  const map: Record<RunRow["status"], { cls: string; label: string }> = {
    fired: { cls: "bg-success-soft text-success", label: t.fired },
    skipped: { cls: "bg-surface-muted text-muted-foreground", label: t.skipped },
    error: { cls: "bg-danger-soft text-danger", label: t.error },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${s.cls}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "fired"
            ? "bg-success"
            : status === "error"
              ? "bg-danger"
              : "bg-muted-foreground/50"
        }`}
      />
      {s.label}
    </span>
  );
}
