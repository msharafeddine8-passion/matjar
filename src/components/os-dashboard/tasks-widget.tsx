import { ListTodo, CircleCheck } from "lucide-react";
import { WidgetCard } from "./widget-card";

// ===== OS dashboard — TasksWidget =====
// Top 3 open tasks from the store_tasks book (0068) + total open count.
// Managing them happens on the tasks page; this is the "don't forget" glance.

export type TaskRow = {
  id: string;
  title: string;
  priority: "low" | "normal" | "high";
  due_on: string | null;
};

const PRIORITY_DOT: Record<TaskRow["priority"], string> = {
  high: "bg-danger",
  normal: "bg-primary",
  low: "bg-muted-foreground/40",
};

export function TasksWidget({
  title,
  openLabel,
  empty,
  viewAll,
  href,
  tasks,
  openCount,
  lang,
}: {
  title: string;
  /** "{n} open" template. */
  openLabel: string;
  empty: string;
  viewAll: string;
  href: string;
  tasks: TaskRow[];
  openCount: number;
  lang: string;
}) {
  return (
    <WidgetCard
      title={
        openCount > 0
          ? `${title} · ${openLabel.replace("{n}", String(openCount))}`
          : title
      }
      Icon={ListTodo}
      action={{ label: viewAll, href }}
    >
      {tasks.length ? (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-xl bg-surface-muted/60 px-3 py-2.5"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {t.title}
              </span>
              {t.due_on && (
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {new Date(`${t.due_on}T00:00:00Z`).toLocaleDateString(
                    lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                    { month: "short", day: "numeric", timeZone: "UTC" },
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CircleCheck className="h-4 w-4 text-success" />
          {empty}
        </p>
      )}
    </WidgetCard>
  );
}
