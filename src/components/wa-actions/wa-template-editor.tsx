"use client";

import { useRef, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DEFAULT_WA_TEMPLATES,
  WA_LOCALES,
  WA_SAMPLE_VALUES,
  WA_TEMPLATE_KEYS,
  WA_TEMPLATE_VARS,
  composeWaMessage,
  previewSegments,
  type ResolvedTemplates,
  type WaLocale,
  type WaTemplateKey,
  type WaVar,
} from "@/lib/wa-templates";

const MAX_BODY = 1000;

type Draft = Record<WaTemplateKey, Record<WaLocale, { body: string; custom: boolean }>>;

/**
 * The merchant's wording for every WhatsApp button. One card per message; in
 * each, Arabic and English tabs, variable chips that insert at the cursor, a
 * live preview with sample data, save, and reset to the original text.
 *
 * Saving writes public.store_wa_templates (0309) — overrides only, owner only.
 * "Reset" deletes the override, so the default in code applies again. Before
 * 0309 is applied (`ready` false) the editor still previews, and says plainly
 * that saving waits on the database update.
 */
export function WaTemplateEditor({
  storeId,
  storeName,
  uiLang,
  initial,
  ready,
  cancelLabel,
  t,
}: {
  storeId: string;
  storeName: string;
  uiLang: string;
  initial: ResolvedTemplates;
  ready: boolean;
  cancelLabel: string;
  t: Dictionary["waActions"];
}) {
  const [draft, setDraft] = useState<Draft>(() => structuredClone(initial) as Draft);
  const [saved, setSaved] = useState<Draft>(() => structuredClone(initial) as Draft);
  const e = t.editor;

  return (
    <div className="space-y-3">
      {!ready && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          {e.notReady}
        </p>
      )}
      {WA_TEMPLATE_KEYS.map((key) => (
        <KeyCard
          key={key}
          templateKey={key}
          storeId={storeId}
          storeName={storeName}
          uiLang={uiLang}
          ready={ready}
          cancelLabel={cancelLabel}
          t={t}
          value={draft[key]}
          savedValue={saved[key]}
          onChange={(locale, body) =>
            setDraft((d) => ({
              ...d,
              [key]: { ...d[key], [locale]: { ...d[key][locale], body } },
            }))
          }
          onSaved={(locale, body, custom) => {
            setDraft((d) => ({ ...d, [key]: { ...d[key], [locale]: { body, custom } } }));
            setSaved((d) => ({ ...d, [key]: { ...d[key], [locale]: { body, custom } } }));
          }}
        />
      ))}
    </div>
  );
}

function KeyCard({
  templateKey,
  storeId,
  storeName,
  uiLang,
  ready,
  cancelLabel,
  t,
  value,
  savedValue,
  onChange,
  onSaved,
}: {
  templateKey: WaTemplateKey;
  storeId: string;
  storeName: string;
  uiLang: string;
  ready: boolean;
  cancelLabel: string;
  t: Dictionary["waActions"];
  value: Record<WaLocale, { body: string; custom: boolean }>;
  savedValue: Record<WaLocale, { body: string; custom: boolean }>;
  onChange: (locale: WaLocale, body: string) => void;
  onSaved: (locale: WaLocale, body: string, custom: boolean) => void;
}) {
  const e = t.editor;
  const confirm = useConfirm();
  const [locale, setLocale] = useState<WaLocale>(uiLang === "en" ? "en" : "ar");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const body = value[locale].body;
  const dirty = body !== savedValue[locale].body;
  const anyCustom = WA_LOCALES.some((l) => savedValue[l].custom);
  const allowed = WA_TEMPLATE_VARS[templateKey];
  const sample = { ...WA_SAMPLE_VALUES[locale], store_name: storeName || WA_SAMPLE_VALUES[locale].store_name };
  const segs = previewSegments(body, sample, allowed);
  const flagged = [
    ...new Map(
      segs
        .filter((s) => s.kind === "unknown" || s.kind === "unavailable")
        .map((s) => [s.text, s] as const),
    ).values(),
  ];
  const sent = composeWaMessage({ body, values: sample, locale });
  const trimmed = body.trim();
  const invalid = !trimmed ? e.empty : trimmed.length > MAX_BODY ? e.tooLongBody : null;

  function insertVar(name: WaVar) {
    const el = area.current;
    const token = `{${name}}`;
    if (!el) {
      onChange(locale, body + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    onChange(locale, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (invalid || !ready) return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_wa_templates")
      .upsert(
        { store_id: storeId, key: templateKey, locale, body: trimmed },
        { onConflict: "store_id,key,locale" },
      );
    setBusy(false);
    if (error) {
      notifyError(e.saveFailed);
      return;
    }
    onSaved(locale, trimmed, true);
    notifySuccess(e.saved);
  }

  async function reset() {
    if (!ready) return;
    const ok = await confirm({ message: e.resetConfirm, confirmLabel: e.reset, cancelLabel });
    if (!ok) return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_wa_templates")
      .delete()
      .eq("store_id", storeId)
      .eq("key", templateKey)
      .eq("locale", locale);
    setBusy(false);
    if (error) {
      notifyError(e.saveFailed);
      return;
    }
    onSaved(locale, DEFAULT_WA_TEMPLATES[templateKey][locale], false);
    notifySuccess(e.resetDone);
  }

  return (
    <details className="group rounded-2xl border border-border bg-surface shadow-xs">
      <summary className="flex min-h-14 cursor-pointer select-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 font-bold">
            {t.keys[templateKey]}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                anyCustom ? "bg-primary-soft text-primary" : "bg-surface-muted text-muted-foreground"
              }`}
            >
              {anyCustom ? e.custom : e.default}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t.keyHints[templateKey]}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-border px-4 pb-4 pt-3">
        <div role="tablist" className="inline-flex rounded-xl border border-border p-0.5">
          {WA_LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={locale === l}
              onClick={() => setLocale(l)}
              lang={l}
              className={`min-h-9 rounded-lg px-3 text-sm font-bold transition-colors ${
                locale === l
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l === "ar" ? t.langAr : t.langEn}
              {savedValue[l].custom && <span aria-hidden> •</span>}
            </button>
          ))}
        </div>

        <textarea
          ref={area}
          value={body}
          onChange={(ev) => onChange(locale, ev.target.value)}
          dir={locale === "ar" ? "rtl" : "ltr"}
          lang={locale}
          rows={7}
          maxLength={MAX_BODY + 200}
          className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {e.chars.split("{n}").join(String(trimmed.length))}
        </p>

        <p className="mt-3 text-xs font-bold text-muted-foreground">{e.vars}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {allowed.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              className="min-h-9 rounded-full border border-border bg-surface px-3 text-xs font-semibold transition-colors hover:border-primary/40"
            >
              {t.vars[v]} <bdi dir="ltr" className="text-muted-foreground">{`{${v}}`}</bdi>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{e.varsHint}</p>

        <p className="mt-4 text-xs font-bold text-muted-foreground">
          {e.preview} <span className="font-normal">({e.previewHint})</span>
        </p>
        <div
          dir={locale === "ar" ? "rtl" : "ltr"}
          lang={locale}
          className="mt-1.5 whitespace-pre-wrap break-words rounded-2xl rounded-ss-sm bg-surface-muted px-4 py-3 text-sm leading-relaxed"
        >
          {segs.map((s, i) =>
            s.kind === "text" ? (
              <span key={i}>{s.text}</span>
            ) : s.kind === "value" ? (
              <span key={i} className="font-semibold">
                {s.text}
              </span>
            ) : (
              <mark
                key={i}
                className="rounded bg-warning-soft px-0.5 text-warning"
                dir="ltr"
              >
                {s.text}
              </mark>
            ),
          )}
        </div>
        {flagged.map((s) => (
          <p key={s.text} className="mt-1 text-xs text-warning">
            {(s.kind === "unknown" ? e.unknownVar : e.unavailableVar)
              .split("{name}")
              .join(s.text)}
          </p>
        ))}
        {sent.truncated && <p className="mt-1 text-xs text-warning">{e.tooLong}</p>}
        {invalid && <p className="mt-1 text-xs text-danger">{invalid}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="md"
            onClick={save}
            loading={busy}
            disabled={!ready || !dirty || !!invalid}
          >
            {busy ? e.saving : e.save}
          </Button>
          <Button
            size="md"
            variant="ghost"
            onClick={reset}
            disabled={!ready || busy || !savedValue[locale].custom}
            leftIcon={<RotateCcw className="h-4 w-4" />}
          >
            {e.reset}
          </Button>
        </div>
      </div>
    </details>
  );
}
