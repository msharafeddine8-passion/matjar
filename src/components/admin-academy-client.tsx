"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Search,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { filterByQuery } from "@/lib/admin-search";
import {
  ACADEMY_CATEGORIES,
  type GuideBlock,
  type AcademyCategory,
} from "@/content/academy";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type GuideRow = {
  id: string;
  slug: string;
  category: string;
  level: string;
  title: string;
  title_en: string;
  excerpt: string;
  read_min: number;
  emoji: string;
  blocks: GuideBlock[];
  published: boolean;
  sort_order: number;
};

/** Below this many guides the list fits on a screen and a search box is noise.
 *  Production has ~10 today, so the field is close to earning its place — but
 *  "close" is the argument for a threshold rather than for showing it always. */
const SEARCH_THRESHOLD = 12;

type BlockType = "p" | "h" | "ul" | "ol" | "tip";
const BLOCK_TYPES: BlockType[] = ["p", "h", "ul", "ol", "tip"];

// The editor keeps every block as { type, text }. List blocks (ul/ol) store their
// items as newline-separated lines in `text`; on save they split back to arrays.
type EditBlock = { type: BlockType; text: string };

type Draft = {
  slug: string;
  category: string;
  level: "beginner" | "intermediate";
  title: string;
  titleEn: string;
  excerpt: string;
  readMin: number;
  emoji: string;
  sortOrder: number;
  published: boolean;
  blocks: EditBlock[];
};

function blockToEdit(b: GuideBlock): EditBlock {
  if (b.t === "ul" || b.t === "ol") {
    return { type: b.t, text: b.items.join("\n") };
  }
  return { type: b.t, text: b.text };
}

function editToBlock(b: EditBlock): GuideBlock | null {
  if (b.type === "ul" || b.type === "ol") {
    const items = b.text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return null;
    return { t: b.type, items };
  }
  const text = b.text.trim();
  if (!text) return null;
  return { t: b.type, text };
}

function emptyDraft(sortOrder: number): Draft {
  return {
    slug: "",
    category: ACADEMY_CATEGORIES[0],
    level: "beginner",
    title: "",
    titleEn: "",
    excerpt: "",
    readMin: 5,
    emoji: "",
    sortOrder,
    published: false,
    blocks: [{ type: "p", text: "" }],
  };
}

function draftFromGuide(g: GuideRow): Draft {
  return {
    slug: g.slug,
    category: g.category,
    level: g.level === "intermediate" ? "intermediate" : "beginner",
    title: g.title,
    titleEn: g.title_en,
    excerpt: g.excerpt,
    readMin: g.read_min,
    emoji: g.emoji,
    sortOrder: g.sort_order,
    published: g.published,
    blocks: g.blocks.length ? g.blocks.map(blockToEdit) : [{ type: "p", text: "" }],
  };
}

export function AdminAcademyClient({
  lang,
  dict,
  guides,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "auth" | "common" | "hub">;
  guides: GuideRow[];
}) {
  void lang;
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.academyAdmin;
  const catLabels = dict.hub.academy.categories as Record<string, string>;

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(0));
  const [busy, setBusy] = useState(false);
  // ISS-014. Local state, not the `?q=` URL param the server-rendered admin
  // queues use: this component holds an unsaved editor draft, and a navigation
  // per settled keystroke would remount it and throw away half-written guides.
  // The filter is the same matcher either way — only where it runs differs.
  const [query, setQuery] = useState("");
  const visible = filterByQuery(guides, query, (g) => [
    g.title,
    g.title_en,
    g.excerpt,
    g.slug,
    catLabels[g.category] ?? g.category,
  ]);

  function startNew() {
    setDraft(emptyDraft(guides.length));
    setEditingId("new");
  }
  function startEdit(g: GuideRow) {
    setDraft(draftFromGuide(g));
    setEditingId(g.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(emptyDraft(0));
  }

  // ---- block editor helpers ----
  function updateBlock(i: number, patch: Partial<EditBlock>) {
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    }));
  }
  function addBlock() {
    setDraft((d) => ({ ...d, blocks: [...d.blocks, { type: "p", text: "" }] }));
  }
  function removeBlock(i: number) {
    setDraft((d) => ({ ...d, blocks: d.blocks.filter((_, idx) => idx !== i) }));
  }
  function moveBlock(i: number, dir: -1 | 1) {
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.blocks.length) return d;
      const next = [...d.blocks];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, blocks: next };
    });
  }

  async function save() {
    const isNew = editingId === "new";
    const currentId = isNew ? null : editingId;
    const blocks = draft.blocks
      .map(editToBlock)
      .filter((b): b is GuideBlock => b !== null);

    const payload = {
      slug: draft.slug.trim(),
      category: draft.category,
      level: draft.level,
      title: draft.title.trim(),
      title_en: draft.titleEn.trim(),
      excerpt: draft.excerpt.trim(),
      read_min: Number(draft.readMin) || 0,
      emoji: draft.emoji.trim(),
      blocks,
      published: draft.published,
      sort_order: Number(draft.sortOrder) || 0,
    };

    setBusy(true);
    const supabase = createClient();
    const { error } = isNew
      ? await supabase.from("academy_guides").insert(payload)
      : await supabase
          .from("academy_guides")
          .update(payload)
          .eq("id", currentId!);
    setBusy(false);
    if (error) {
      notifyError(t.saveFailed);
      return;
    }
    void logAdminAction(isNew ? "created" : "updated", "academy", currentId ?? undefined, {
      slug: payload.slug,
    });
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
      .from("academy_guides")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction("deleted", "academy", id);
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
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold">
            {t.emoji}
            <Input
              className="mt-1.5"
              value={draft.emoji}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold">
            {t.category}
            <Select
              className="mt-1.5"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {ACADEMY_CATEGORIES.map((c: AcademyCategory) => (
                <option key={c} value={c}>
                  {catLabels[c] ?? c}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm font-semibold">
            {t.level}
            <Select
              className="mt-1.5"
              value={draft.level}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  level: e.target.value as Draft["level"],
                })
              }
            >
              <option value="beginner">{t.levels.beginner}</option>
              <option value="intermediate">{t.levels.intermediate}</option>
            </Select>
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
            {t.excerpt}
            <Textarea
              className="mt-1.5"
              value={draft.excerpt}
              onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold">
            {t.readMin}
            <Input
              type="number"
              className="mt-1.5"
              value={draft.readMin}
              onChange={(e) =>
                setDraft({ ...draft, readMin: Number(e.target.value) })
              }
            />
          </label>
          <label className="text-sm font-semibold">
            {t.sortOrder}
            <Input
              type="number"
              className="mt-1.5"
              value={draft.sortOrder}
              onChange={(e) =>
                setDraft({ ...draft, sortOrder: Number(e.target.value) })
              }
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
        </div>

        {/* ---- blocks editor ---- */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-bold">{t.blocks}</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={addBlock}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {t.addBlock}
            </Button>
          </div>
          <div className="space-y-2">
            {draft.blocks.map((b, i) => {
              const isList = b.type === "ul" || b.type === "ol";
              return (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-surface-muted/40 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Select
                      className="w-40"
                      value={b.type}
                      onChange={(e) =>
                        updateBlock(i, { type: e.target.value as BlockType })
                      }
                    >
                      {BLOCK_TYPES.map((bt) => (
                        <option key={bt} value={bt}>
                          {t.types[bt]}
                        </option>
                      ))}
                    </Select>
                    <div className="ms-auto flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="↑"
                        disabled={i === 0}
                        onClick={() => moveBlock(i, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-surface disabled:opacity-40"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="↓"
                        disabled={i === draft.blocks.length - 1}
                        onClick={() => moveBlock(i, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-surface disabled:opacity-40"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={t.removeBlock}
                        title={t.removeBlock}
                        onClick={() => removeBlock(i)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <Textarea
                    value={b.text}
                    onChange={(e) => updateBlock(i, { text: e.target.value })}
                    placeholder={isList ? t.listHint : t.blockText}
                  />
                  {isList && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.listHint}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
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
          icon={GraduationCap}
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

        {/* The box only appears once there is enough here to lose something in.
            On a shelf of six guides a search field is one more control to read
            past, not a shortcut. */}
        {guides.length >= SEARCH_THRESHOLD && (
          <div className="relative mb-6 sm:max-w-md">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="ps-10"
            />
          </div>
        )}

        {visible.length ? (
          <div className="space-y-2">
            {visible.map((g) =>
              editingId === g.id ? (
                <div key={g.id}>{form}</div>
              ) : (
                <Card key={g.id}>
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-2xl" aria-hidden="true">
                        {g.emoji || "📘"}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{g.title}</span>
                          <Badge variant="neutral" size="sm">
                            {catLabels[g.category] ?? g.category}
                          </Badge>
                          <Badge
                            variant={g.published ? "success" : "neutral"}
                            size="sm"
                          >
                            {g.published ? t.published : t.draft}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {g.slug}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startEdit(g)}
                        leftIcon={<Pencil className="h-4 w-4" />}
                      >
                        {t.edit}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => remove(g.id)}
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
          editingId !== "new" && (
            <EmptyState
              icon={GraduationCap}
              title={
                query
                  ? dict.admin.listSearch.noMatch.replace("{q}", query)
                  : t.empty
              }
            />
          )
        )}
      </Container>
    </div>
  );
}
