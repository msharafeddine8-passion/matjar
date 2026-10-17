"use client";
import { notifyError, notifySuccess } from "@/lib/notify";

import { useState } from "react";
import type { JSX } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ExternalLink, ImageIcon, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ImageUpload } from "@/components/image-upload";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import {
  CatalogRowActions,
  updateCatalogRow,
  useCatalogRowOps,
} from "@/components/catalog-row-actions";

export type PortfolioItem = {
  id: string;
  title: string;
  title_en: string | null;
  description: string | null;
  image_url: string | null;
  link: string | null;
};

type Draft = {
  title: string;
  title_en: string;
  description: string;
  image_url: string | null;
  link: string;
};

const empty: Draft = {
  title: "",
  title_en: "",
  description: "",
  image_url: null,
  link: "",
};

const labelClass = "text-sm font-semibold";

export function PortfolioManager(props: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  items: PortfolioItem[];
}): JSX.Element {
  const { storeId, lang, dict, items } = props;
  const router = useRouter();
  const t = dict.portfolio;
  const c = dict.catalogItem;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  // The row being edited; null = the form adds a new item.
  const [editingId, setEditingId] = useState<string | null>(null);
  // store_portfolio has no `active` flag and nothing references it, so its
  // rows get edit + delete only (no hide button, the plain delete warning).
  const ops = useCatalogRowOps("store_portfolio", dict);

  function startNew() {
    setDraft({ ...empty });
    setEditingId(null);
    setAdding(true);
  }
  function startEdit(item: PortfolioItem) {
    setDraft({
      title: item.title,
      title_en: item.title_en ?? "",
      description: item.description ?? "",
      image_url: item.image_url,
      link: item.link ?? "",
    });
    setEditingId(item.id);
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
      title: draft.title.trim(),
      title_en: draft.title_en.trim() || null,
      description: draft.description.trim() || null,
      image_url: draft.image_url,
      link: draft.link.trim() || null,
    };
    if (editingId) {
      const ok = await updateCatalogRow("store_portfolio", editingId, values);
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
      .from("store_portfolio")
      .insert({ store_id: storeId, ...values });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  const editingName = items.find((item) => item.id === editingId)?.title;

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      {editingName && (
        <h3 className="font-bold">{c.editTitle.replace("{name}", editingName)}</h3>
      )}
      <div>
        <label className={labelClass} htmlFor="portfolio-title">{t.name}</label>
        <Input
          id="portfolio-title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="portfolio-title-en">{t.nameEn}</label>
        <Input
          id="portfolio-title-en"
          value={draft.title_en}
          onChange={(e) => setDraft({ ...draft, title_en: e.target.value })}
          className="mt-1"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="portfolio-description">{t.description}</label>
        <Textarea
          id="portfolio-description"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="mt-1"
        />
      </div>
      <ImageUpload
        folder={`portfolio/${storeId}`}
        value={draft.image_url}
        onChange={(url) => setDraft({ ...draft, image_url: url })}
        label={t.image}
      />
      <div>
        <label className={labelClass} htmlFor="portfolio-link">{t.linkField}</label>
        <Input
          id="portfolio-link"
          value={draft.link}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          className="mt-1"
        />
      </div>
      <div className="flex gap-2">
        <Button disabled={!draft.title.trim()} loading={busy} onClick={save}>
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
        {items.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {items.map((item) => {
          const primary =
            lang === "en" ? item.title_en || item.title : item.title;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-2xl border bg-surface p-3 ${
                editingId === item.id ? "border-primary" : "border-border"
              }`}
            >
              {item.image_url ? (
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                  <Image
                    src={item.image_url}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                </span>
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{primary}</p>
                {item.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {item.description}
                  </p>
                )}
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t.view}
                  </a>
                )}
              </div>
              <CatalogRowActions
                dict={dict}
                deleteLabel={t.delete}
                busy={busy || ops.busyId === item.id}
                onEdit={() => startEdit(item)}
                onDelete={() => ops.remove(item.id, false)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
