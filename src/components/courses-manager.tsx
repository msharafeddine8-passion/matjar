"use client";
import { notifyError, notifySuccess } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CatalogRowActions,
  updateCatalogRow,
  useCatalogRowOps,
} from "@/components/catalog-row-actions";

export type CourseRow = {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  price: number | null;
  duration: string | null;
  schedule: string | null;
  level: string | null;
  active: boolean;
};

type Draft = {
  name: string;
  name_en: string;
  description: string;
  price: string;
  duration: string;
  schedule: string;
  level: string;
};

const empty: Draft = {
  name: "",
  name_en: "",
  description: "",
  price: "",
  duration: "",
  schedule: "",
  level: "",
};

const labelClass = "text-sm font-semibold";

export function CoursesManager({
  storeId,
  lang,
  dict,
  courses,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  courses: CourseRow[];
}) {
  const router = useRouter();
  const t = dict.courses;
  const c = dict.catalogItem;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  // The row being edited; null = the form adds a new course.
  const [editingId, setEditingId] = useState<string | null>(null);
  const ops = useCatalogRowOps("store_courses", dict);

  function startNew() {
    setDraft({ ...empty });
    setEditingId(null);
    setAdding(true);
  }
  function startEdit(row: CourseRow) {
    setDraft({
      name: row.name,
      name_en: row.name_en ?? "",
      description: row.description ?? "",
      price: row.price == null ? "" : String(row.price),
      duration: row.duration ?? "",
      schedule: row.schedule ?? "",
      level: row.level ?? "",
    });
    setEditingId(row.id);
    setAdding(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(empty);
  }

  async function save() {
    setBusy(true);
    const values = {
      name: draft.name.trim(),
      name_en: draft.name_en.trim() || null,
      description: draft.description.trim() || null,
      price: draft.price === "" ? null : Number(draft.price),
      duration: draft.duration.trim() || null,
      schedule: draft.schedule.trim() || null,
      level: draft.level.trim() || null,
    };
    if (editingId) {
      const ok = await updateCatalogRow("store_courses", editingId, values);
      setBusy(false);
      if (!ok) {
        notifyError(dict.common.actionFailed);
        return;
      }
      notifySuccess(c.saved);
      cancel();
      router.refresh();
      return;
    }
    const { error } = await createClient()
      .from("store_courses")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  const editingName = courses.find((row) => row.id === editingId)?.name;

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      {editingName && (
        <h3 className="font-bold">{c.editTitle.replace("{name}", editingName)}</h3>
      )}
      <div>
        <label className={labelClass} htmlFor="course-name">{t.name}</label>
        <Input
          id="course-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="course-name-en">{t.nameEn}</label>
        <Input
          id="course-name-en"
          value={draft.name_en}
          onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="course-description">{t.description}</label>
        <Textarea
          id="course-description"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="mt-1"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="course-price">{t.price}</label>
          <Input
            id="course-price"
            type="number"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            className="mt-1"
          />
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="course-level">{t.level}</label>
          <Input
            id="course-level"
            value={draft.level}
            onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="course-duration">{t.duration}</label>
        <Input
          id="course-duration"
          value={draft.duration}
          onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
          placeholder={t.durationHint}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="course-schedule">{t.schedule}</label>
        <Input
          id="course-schedule"
          value={draft.schedule}
          onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
          placeholder={t.scheduleHint}
          className="mt-1"
        />
      </div>
      <div className="flex gap-2">
        <Button disabled={!draft.name.trim()} loading={busy} onClick={save}>
          {editingId ? c.saveChanges : t.save}
        </Button>
        <Button
          variant="secondary"
          onClick={cancel}
          leftIcon={<X className="h-4 w-4" />}
        >
          {editingId ? c.cancelEdit : dict.merchant.doctors.cancel}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-end">
        {!adding && (
          <Button
            onClick={startNew}
            className="shrink-0"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t.add}
          </Button>
        )}
      </div>

      {adding && <div className="mt-4">{form}</div>}

      <div className="mt-4 space-y-2">
        {courses.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {courses.map((row) => {
          const primary = lang === "en" ? row.name_en || row.name : row.name;
          const meta = [
            row.duration,
            row.schedule,
            row.level,
            row.price != null ? String(row.price) : null,
          ].filter((part) => part && part.trim() !== "");
          return (
            <div
              key={row.id}
              className={`flex items-center gap-3 rounded-2xl border bg-surface p-3 ${
                editingId === row.id ? "border-primary" : "border-border"
              }`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                <GraduationCap className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-bold">{primary}</span>
                  {!row.active && (
                    <Badge variant="neutral" size="sm">
                      {c.hiddenBadge}
                    </Badge>
                  )}
                </p>
                {meta.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
                    {meta.map((part, i) => (
                      <span key={i} className="flex items-center gap-x-1">
                        {i > 0 && <span>·</span>}
                        <span>{part}</span>
                      </span>
                    ))}
                  </div>
                )}
                {row.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {row.description}
                  </p>
                )}
              </div>
              <CatalogRowActions
                dict={dict}
                deleteLabel={t.delete}
                busy={busy || ops.busyId === row.id}
                active={row.active}
                onEdit={() => startEdit(row)}
                onToggleActive={() => ops.setActive(row.id, !row.active)}
                onDelete={() => ops.remove(row.id, true)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
