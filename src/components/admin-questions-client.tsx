"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, ExternalLink, Trash2 } from "lucide-react";
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
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type QuestionRow = {
  id: string;
  productId: string;
  productName: string | null;
  askerName: string;
  question: string;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
};

const TABS = ["all", "answered", "unanswered"] as const;
type Tab = (typeof TABS)[number];

function isAnswered(row: QuestionRow): boolean {
  return typeof row.answer === "string" && row.answer.trim().length > 0;
}

export function AdminQuestionsClient({
  lang,
  dict,
  rows,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "common">;
  rows: QuestionRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.questionsAdmin;
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    let answered = 0;
    for (const r of rows) if (isAnswered(r)) answered++;
    return {
      all: rows.length,
      answered,
      unanswered: rows.length - answered,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      const answered = isAnswered(r);
      const matchTab =
        tab === "all"
          ? true
          : tab === "answered"
            ? answered
            : !answered;
      const matchQ =
        !query ||
        r.question.toLowerCase().includes(query) ||
        r.askerName.toLowerCase().includes(query);
      return matchTab && matchQ;
    });
  }, [rows, tab, q]);

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
      .from("product_questions")
      .delete()
      .eq("id", id);
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("deleted", "question", id);
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={HelpCircle}
          title={t.title}
          subtitle={t.subtitle}
        />

        <div className="grid grid-cols-3 gap-3">
          <Stat label={t.all} value={counts.all.toLocaleString("en-US")} />
          <Stat
            label={t.answered}
            value={counts.answered.toLocaleString("en-US")}
          />
          <Stat
            label={t.unanswered}
            value={counts.unanswered.toLocaleString("en-US")}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-1.5">
          {TABS.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t[s]}
              <span className="ms-1.5 opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>

        <div className="relative mt-4 max-w-sm">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.question}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState className="mt-6" icon={HelpCircle} title={t.empty} />
        ) : (
          <div data-animate className="mt-6 space-y-2">
            {filtered.map((r) => {
              const answered = isAnswered(r);
              return (
                <Card key={r.id}>
                  <CardBody className="flex flex-wrap items-start gap-4 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold break-words">
                          {r.question}
                        </span>
                        <Badge
                          variant={answered ? "success" : "warning"}
                          size="sm"
                        >
                          {answered ? t.answered : t.unanswered}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {r.askerName} ·{" "}
                        {new Date(r.createdAt).toLocaleDateString()}
                      </div>
                      {r.answer && (
                        <div className="mt-2 text-sm text-muted-foreground break-words">
                          {r.answer}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <ButtonLink
                        href={`/${lang}/product/${r.productId}`}
                        target="_blank"
                        variant="secondary"
                        size="sm"
                        leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                      >
                        {r.productName ?? t.product}
                      </ButtonLink>
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
              );
            })}
          </div>
        )}
      </Container>
    </div>
  );
}
