"use client";

import { useState } from "react";
import { Send, Megaphone } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Audience = "all" | "merchants" | "customers";
const AUDIENCES: Audience[] = ["all", "merchants", "customers"];

// Admin tool: broadcast a message (e.g. today's exchange rate, an announcement)
// to a chosen audience. Delivered as an IN-APP notification to every recipient
// (the guaranteed channel — shows in the bell) + web push for any subscriber,
// via the admin-gated /api/push/broadcast route.
//
// There is deliberately NO logAdminAction() call here, and adding one would
// double-log. This is the highest-blast-radius action an admin has and for a
// long time it was the only one with no audit trail at all (ISS-009) — precisely
// because the record depended on a client remembering to write it. Migration
// 0294 moved the write inside admin_broadcast_notify, in the same transaction
// as the notification fan-out, so the log row exists if and only if the
// broadcast actually went out. Nothing on this side can skip it.
export function AdminBroadcast({ dict }: { dict: Pick<Dictionary, "auth" | "common" | "push"> }) {
  const t = dict.push;
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) return;
    if (
      !(await confirm({
        message: t.adminConfirm,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
      }))
    )
      return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/push/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message, audience }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(t.adminReached.replace("{n}", String(data.recipients ?? 0)));
        setMessage("");
        setTitle("");
      } else setResult(dict.auth.errorGeneric);
    } catch {
      setResult(dict.auth.errorGeneric);
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-4 flex items-center gap-2 font-bold">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Megaphone className="h-5 w-5" />
          </span>
          {t.adminTitle}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-muted-foreground">
              {t.audLabel}
            </span>
            {AUDIENCES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors ${
                  audience === a
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {t.audiences[a]}
              </button>
            ))}
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.adminHeading}
          />
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.adminField}
            rows={2}
          />
          <Button
            onClick={send}
            disabled={busy || !message.trim()}
            loading={busy}
            leftIcon={<Send className="h-4 w-4" />}
          >
            {t.adminSend}
          </Button>
          {result && (
            <p className="text-sm font-semibold text-muted-foreground">
              {result}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
