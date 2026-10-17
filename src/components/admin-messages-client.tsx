"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Trash2 } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { notifyError } from "@/lib/notify";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

// One flattened message ready for the moderation list. The server page joins
// sender + store names into these so this client stays a pure render surface.
export type MessageRow = {
  id: string;
  body: string;
  createdAt: string;
  sender: string;
  store: string | null;
};

export function AdminMessagesClient({
  lang,
  dict,
  rows,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "common">;
  rows: MessageRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.messagesAdmin;
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (r) =>
        r.body.toLowerCase().includes(query) ||
        r.sender.toLowerCase().includes(query),
    );
  }, [rows, q]);

  async function remove(id: string) {
    if (
      !(await confirm({
        message: t.deleteConfirm,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusyId(id);
    const { error } = await createClient()
      .from("messages")
      .delete()
      .eq("id", id);
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("deleted", "message", id);
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={MessageSquare}
          title={t.title}
          subtitle={t.subtitle}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t.messages} value={rows.length.toLocaleString("en-US")} />
        </div>

        <div className="relative mt-6 max-w-sm">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.title}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState className="mt-6" icon={MessageSquare} title={t.empty} />
        ) : (
          <div data-animate className="mt-6 space-y-2">
            {filtered.map((r) => (
              <Card key={r.id}>
                <CardBody className="flex flex-wrap items-start gap-4 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{r.sender}</span>
                      {r.store && (
                        <Badge variant="neutral" size="sm">
                          {t.store} · {r.store}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 break-words text-sm text-foreground">
                      {r.body}
                    </p>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString(
                        lang === "ar" ? "ar" : "en",
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === r.id}
                      onClick={() => remove(r.id)}
                      aria-label={t.delete}
                      leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                      className="!text-danger"
                    >
                      {t.delete}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
