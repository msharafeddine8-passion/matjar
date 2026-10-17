"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Pencil, Trash2, X, ExternalLink } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type PageRow = {
  id: string;
  slug: string;
  title: string;
  title_en: string;
  body: string;
  published: boolean;
};

type Draft = {
  slug: string;
  title: string;
  titleEn: string;
  body: string;
  published: boolean;
};

function emptyDraft(): Draft {
  return { slug: "", title: "", titleEn: "", body: "", published: false };
}

function draftFromPage(p: PageRow): Draft {
  return {
    slug: p.slug,
    title: p.title,
    titleEn: p.title_en,
    body: p.body,
    published: p.published,
  };
}

export function AdminPagesClient({
  lang,
  dict,
  pages,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "auth" | "common">;
  pages: PageRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.pagesAdmin;

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);

  function startNew() {
    setDraft(emptyDraft());
    setEditingId("new");
  }
  function startEdit(p: PageRow) {
    setDraft(draftFromPage(p));
    setEditingId(p.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function save() {
    const isNew = editingId === "new";
    const currentId = isNew ? null : editingId;

    const payload = {
      slug: draft.slug.trim(),
      title: draft.title.trim(),
      title_en: draft.titleEn.trim(),
      body: draft.body,
      published: draft.published,
    };

    setBusy(true);
    const supabase = createClient();
    const { error } = isNew
      ? await supabase.from("site_pages").insert(payload)
      : await supabase.from("site_pages").update(payload).eq("id", currentId!);
    setBusy(false);
    if (error) {
      notifyError(t.saveFailed);
      return;
    }
    void logAdminAction(
      isNew ? "created" : "updated",
      "page",
      currentId ?? undefined,
      { slug: payload.slug },
    );
    cancel();
    router.refresh();
  }

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
    setBusy(true);
    const { error } = await createClient()
      .from("site_pages")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction("deleted", "page", id);
    router.refresh();
  }

  const form = (
    <Card variant="elevated" className="border-primary/30">
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            {t.slug}
            <Input
              className="mt-1.5"
              dir="ltr"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 self-end text-sm font-semibold">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) =>
                setDraft({ ...draft, published: e.target.checked })
              }
              className="h-4 w-4 accent-primary"
            />
            {t.published}
          </label>
          <label className="text-sm font-semibold">
            {t.titleAr}
            <Input
              className="mt-1.5"
              dir="rtl"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold">
            {t.titleEn}
            <Input
              className="mt-1.5"
              dir="ltr"
              value={draft.titleEn}
              onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            {t.body}
            <textarea
              className="mt-1.5 min-h-64 w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t.bodyHint}
            </span>
          </label>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            loading={busy}
            disabled={busy || !draft.slug.trim() || !draft.title.trim()}
            onClick={save}
          >
            {t.save}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={cancel}
            leftIcon={<X className="h-4 w-4" />}
          >
            {t.cancel}
          </Button>
        </div>
      </CardBody>
    </Card>
  );

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={FileText}
          title={t.title}
          subtitle={t.subtitle}
          actions={
            editingId === null ? (
              <Button
                onClick={startNew}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                {t.new}
              </Button>
            ) : undefined
          }
        />

        {editingId === "new" && <div className="mb-6">{form}</div>}

        {pages.length ? (
          <div className="space-y-2">
            {pages.map((p) =>
              editingId === p.id ? (
                <div key={p.id}>{form}</div>
              ) : (
                <Card key={p.id}>
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{p.title}</span>
                        <Badge
                          variant={p.published ? "success" : "neutral"}
                          size="sm"
                        >
                          {p.published ? t.published : t.draft}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        /p/{p.slug}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.published && (
                        <a
                          href={`/${lang}/p/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface-muted"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {t.view}
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startEdit(p)}
                        leftIcon={<Pencil className="h-4 w-4" />}
                      >
                        {t.edit}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => remove(p.id)}
                        leftIcon={<Trash2 className="h-4 w-4" />}
                        className="!text-danger"
                      >
                        {t.delete}
                      </Button>
                    </div>
                  </div>
                </Card>
              ),
            )}
          </div>
        ) : (
          editingId !== "new" && <EmptyState icon={FileText} title={t.empty} />
        )}
      </Container>
    </div>
  );
}
