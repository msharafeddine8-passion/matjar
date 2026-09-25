"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronDown, MessageSquarePlus } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { regions } from "@/lib/catalog";
import {
  CONTACT_KINDS,
  DEMAND_LIMITS,
  demandErrorFromMessage,
  normalizeRegion,
  validateDemand,
  type ContactKind,
  type DemandError,
} from "@/lib/demand";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

// «ما لقيت يلي بدّك ياه؟» — the zero-result search, turned into a request.
//
// Collapsed by default to ONE line, the same height open or not until the
// person chooses to open it, so an empty results page never jumps. Everything
// but the query is optional; the contact field says, in the same breath as
// asking, what the number is for and that it can be left empty.
//
// Writes only through `submit_demand` (migration 0306), which re-validates and
// rate-limits. The limits used here come from src/lib/demand.ts, the same
// numbers the RPC enforces.

export interface DemandCaptureProps {
  lang: Locale;
  /** The query that returned nothing; prefilled and editable. */
  q: string;
  /** Surface or sector the search came from (e.g. "search", "food"). */
  section?: string | null;
  /** Region key from the search, if any (see `regions` in lib/catalog). */
  region?: string | null;
  /** Only the form's own namespace: this is a client component, and the whole
   *  dictionary would ride along in the page payload for one form. */
  dict: Pick<Dictionary, "demand">;
}

type FieldName = "q" | "area" | "contact" | "note";

export function DemandCapture({
  lang,
  q,
  section = "search",
  region = null,
  dict,
}: DemandCaptureProps) {
  const t = dict.demand;
  const uid = useId();
  const panelId = `${uid}-panel`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(q);
  const [regionKey, setRegionKey] = useState<string>(
    normalizeRegion(region) ?? "",
  );
  const [area, setArea] = useState("");
  const [kind, setKind] = useState<ContactKind>("whatsapp");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{
    field: FieldName | null;
    code: DemandError;
  } | null>(null);

  // A new search can reuse this instance (client navigation keeps the tree):
  // start over for the new query rather than showing the old one, or the old
  // "thank you". React's documented adjust-state-on-prop-change pattern.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setQuery(q);
    setDone(false);
    setError(null);
  }

  const errFor = (f: FieldName) =>
    error && error.field === f ? t.errors[error.code] : undefined;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const v = validateDemand({
      q: query,
      section,
      region: regionKey || null,
      area,
      contact,
      contactKind: contact.trim() ? kind : null,
      note,
    });
    if (!v.ok) {
      setError({ field: v.field, code: v.error });
      return;
    }
    setError(null);
    setSending(true);
    const { error: rpcError } = await createClient().rpc(
      "submit_demand",
      v.payload,
    );
    setSending(false);
    if (rpcError) {
      const code = demandErrorFromMessage(rpcError.message);
      const field: FieldName | null =
        code === "invalid_contact"
          ? "contact"
          : code === "query_too_short" || code === "query_too_long"
            ? "q"
            : code === "area_too_long"
              ? "area"
              : code === "note_too_long"
                ? "note"
                : null;
      setError({ field, code });
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div
        role="status"
        className="flex min-h-11 items-start gap-3 rounded-2xl border border-border bg-surface p-4"
      >
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-success"
          aria-hidden="true"
        />
        <div>
          <p className="font-bold">{t.successTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.successBody}</p>
        </div>
      </div>
    );
  }

  const isEmail = kind === "email";
  const generalError =
    error && error.field === null ? t.errors[error.code] : null;

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-start text-sm font-semibold hover:bg-surface-muted"
      >
        <MessageSquarePlus
          className="h-5 w-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span className="flex-1">{t.prompt}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      <div id={panelId}>
        {open && (
          <form
            onSubmit={onSubmit}
            noValidate
            className="space-y-4 border-t border-border p-4"
            aria-label={t.title}
          >
            <Field
              label={t.queryLabel}
              htmlFor={`${uid}-q`}
              required
              error={errFor("q")}
            >
              <Input
                id={`${uid}-q`}
                value={query}
                maxLength={DEMAND_LIMITS.q}
                onChange={(e) => setQuery(e.target.value)}
                error={!!errFor("q")}
                autoComplete="off"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.regionLabel} htmlFor={`${uid}-region`}>
                <Select
                  id={`${uid}-region`}
                  value={regionKey}
                  onChange={(e) => setRegionKey(e.target.value)}
                >
                  <option value="">{t.regionAny}</option>
                  {regions.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name[lang]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={
                  <>
                    {t.areaLabel}{" "}
                    <span className="font-normal text-muted-foreground">
                      {t.optional}
                    </span>
                  </>
                }
                htmlFor={`${uid}-area`}
                error={errFor("area")}
              >
                <Input
                  id={`${uid}-area`}
                  value={area}
                  maxLength={DEMAND_LIMITS.area}
                  placeholder={t.areaPlaceholder}
                  onChange={(e) => setArea(e.target.value)}
                  error={!!errFor("area")}
                  autoComplete="address-level2"
                />
              </Field>
            </div>

            <Field
              label={t.contactLabel}
              group
              hint={t.contactHint}
              error={errFor("contact")}
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  aria-label={t.contactKindLabel}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ContactKind)}
                  className="sm:w-40 sm:shrink-0"
                >
                  {CONTACT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.kinds[k]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={t.contactLabel}
                  type={isEmail ? "email" : "tel"}
                  inputMode={isEmail ? "email" : "tel"}
                  dir="ltr"
                  value={contact}
                  maxLength={DEMAND_LIMITS.contact}
                  placeholder={
                    isEmail
                      ? t.contactPlaceholderEmail
                      : t.contactPlaceholderPhone
                  }
                  onChange={(e) => setContact(e.target.value)}
                  error={!!errFor("contact")}
                  autoComplete={isEmail ? "email" : "tel"}
                  className="text-start"
                />
              </div>
            </Field>

            <Field
              label={
                <>
                  {t.noteLabel}{" "}
                  <span className="font-normal text-muted-foreground">
                    {t.optional}
                  </span>
                </>
              }
              htmlFor={`${uid}-note`}
              error={errFor("note")}
            >
              <Textarea
                id={`${uid}-note`}
                value={note}
                maxLength={DEMAND_LIMITS.note}
                rows={3}
                placeholder={t.notePlaceholder}
                onChange={(e) => setNote(e.target.value)}
                error={!!errFor("note")}
              />
            </Field>

            {generalError && (
              <p className="text-sm font-medium text-danger" role="alert">
                {generalError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={sending}>
                {t.submit}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {t.cancel}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
