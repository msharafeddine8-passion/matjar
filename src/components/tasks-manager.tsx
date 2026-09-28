"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, CircleDashed } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { beirutYmd } from "@/lib/quick-panel";

export type TaskRow = {
  id: string;
  title: string;
  due_on: string | null;
  priority: "low" | "normal" | "high";
  status: "open" | "done";
};

const priorityDot: Record<TaskRow["priority"], string> = {
  high: "bg-danger",
  normal: "bg-warning",
  low: "bg-border",
};

// Tasks & reminders module of the Business OS. Deliberately tiny: title, due
// date, priority — the "sticky notes on the counter", digitized.
export function TasksManager({
  storeId,
  lang,
  dict,
  tasks,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  tasks: TaskRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.tasks;
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [priority, setPriority] = useState<TaskRow["priority"]>("normal");
  const [busy, setBusy] = useState(false);

  const open = tasks.filter((x) => x.status === "open");
  const done = tasks.filter((x) => x.status === "done");
  const today = beirutYmd(new Date());

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const { error } = await createClient().from("store_tasks").insert({
      store_id: storeId,
      title: title.trim(),
      due_on: dueOn || null,
      priority,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    setTitle("");
    setDueOn("");
    setPriority("normal");
    router.refresh();
  }

  async function toggle(task: TaskRow) {
    const { error } = await createClient()
      .from("store_tasks")
      .update({
        status: task.status === "open" ? "done" : "open",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    const { error } = await createClient()
      .from("store_tasks")
      .delete()
      .eq("id", id);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  const fmtDue = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(
      lang === "ar" ? "ar" : "en",
      { month: "short", day: "numeric" },
    );

  const row = (task: TaskRow) => {
    const overdue =
      task.status === "open" && task.due_on != null && task.due_on < today;
    return (
      <div
        key={task.id}
        className={`flex items-center gap-3 rounded-xl border border-border bg-surface p-3 ${
          task.status === "done" ? "opacity-55" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => toggle(task)}
          aria-label={t.done}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            task.status === "done"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-transparent hover:border-primary"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${priorityDot[task.priority]}`}
          title={t.priority[task.priority]}
        />
        <span
          className={`min-w-0 flex-1 font-semibold ${
            task.status === "done" ? "line-through" : ""
          }`}
        >
          {task.title}
        </span>
        {task.due_on && (
          <Badge variant={overdue ? "danger" : "neutral"} size="sm" className="shrink-0">
            {fmtDue(task.due_on)}
          </Badge>
        )}
        <button
          type="button"
          onClick={() => remove(task.id)}
          aria-label={dict.merchant.products.delete}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div>
      <form
        onSubmit={add}
        className="flex flex-wrap items-stretch gap-2 rounded-2xl border border-border bg-surface p-3"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.add}
          className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1"
        />
        <input
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskRow["priority"])}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {(["high", "normal", "low"] as const).map((p) => (
            <option key={p} value={p}>
              {t.priority[p]}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          loading={busy}
          disabled={!title.trim()}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          {dict.os.crm.add}
        </Button>
      </form>

      {open.length ? (
        <div className="mt-4 space-y-2">{open.map(row)}</div>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
          <CircleDashed className="h-7 w-7" />
          {t.empty}
        </div>
      )}

      {done.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-bold text-muted-foreground">
            {t.done} ({done.length})
          </summary>
          <div className="mt-3 space-y-2">{done.map(row)}</div>
        </details>
      )}
    </div>
  );
}
