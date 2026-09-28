"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ImageUpload } from "@/components/image-upload";
import { VERIFICATION_DOCS_BUCKET } from "@/lib/verification-docs";
import { fieldClass as uiFieldClass, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type Verification = {
  id: string;
  kind: string;
  title: string;
  issuer: string | null;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  /** Embedded from store_verification_docs — the merchant may see their own. */
  store_verification_docs: { doc_url: string } | null;
  /** An openable URL for that document, resolved on the server: a short-lived
   *  signed URL for a private `verification-docs` path (0314), or the legacy
   *  public URL of a pre-0314 upload. Null when it could not be resolved. */
  doc_view_url?: string | null;
  verify_url: string | null;
  status: string;
};

type Draft = {
  kind: string;
  title: string;
  issuer: string;
  number: string;
  issued_on: string;
  expires_on: string;
  doc_url: string | null;
  verify_url: string;
};

const empty: Draft = {
  kind: "license",
  title: "",
  issuer: "",
  number: "",
  issued_on: "",
  expires_on: "",
  doc_url: null,
  verify_url: "",
};

// Shared control styling from the UI library, plus the label gap this form uses.
const fieldClass = `${uiFieldClass} mt-1`;
const labelClass = "text-sm font-semibold";

function isExpired(date: string | null) {
  if (!date) return false;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

export function VerificationsManager({
  storeId,
  lang: _lang,
  dict,
  verifications,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  verifications: Verification[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.verifications;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setDraft({ ...empty });
    setAdding(true);
  }
  function cancel() {
    setAdding(false);
    setDraft(empty);
  }

  async function save() {
    setBusy(true);
    const supabase = createClient();
    // status is intentionally omitted — it defaults to 'submitted' and stays
    // merchant-controlled; only admins may set 'verified'.
    const { data: created, error } = await supabase
      .from("store_verifications")
      .insert({
        store_id: storeId,
        kind: draft.kind,
        title: draft.title.trim(),
        issuer: draft.issuer.trim() || null,
        number: draft.number.trim() || null,
        issued_on: draft.issued_on || null,
        expires_on: draft.expires_on || null,
        verify_url: draft.verify_url.trim() || null,
      })
      .select("id")
      .single();
    // The scan lands in its own table, which no public policy can read — the
    // claim is for shoppers, the paperwork is for the review queue. Written
    // second, so a failure here leaves a verification without its document
    // rather than a document with no verification to hang off.
    if (!error && created && draft.doc_url) {
      await supabase.from("store_verification_docs").insert({
        verification_id: (created as { id: string }).id,
        store_id: storeId,
        doc_url: draft.doc_url,
      });
    }
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    cancel();
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: dict.merchant.products.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("store_verifications")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  const form = (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-5">
      <div>
        <label className={labelClass} htmlFor="verif-kind">{t.kindLabel}</label>
        <Select
          id="verif-kind"
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          className="mt-1"
        >
          {Object.entries(t.kinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className={labelClass} htmlFor="verif-title">{t.titleField}</label>
        <input
          id="verif-title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="verif-issuer">{t.issuer}</label>
        <input
          id="verif-issuer"
          value={draft.issuer}
          onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="verif-number">{t.number}</label>
        <input
          id="verif-number"
          value={draft.number}
          onChange={(e) => setDraft({ ...draft, number: e.target.value })}
          className={fieldClass}
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="verif-issued-on">{t.issuedOn}</label>
          <input
            id="verif-issued-on"
            type="date"
            value={draft.issued_on}
            onChange={(e) => setDraft({ ...draft, issued_on: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="verif-expires-on">{t.expiresOn}</label>
          <input
            id="verif-expires-on"
            type="date"
            value={draft.expires_on}
            onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })}
            className={fieldClass}
          />
        </div>
      </div>
      <ImageUpload
        // PRIVATE bucket (0314, P1-PRIV-02). The file most likely to be
        // photographed here — a Lebanese commercial registration — carries the
        // owner's full name, ID number and home address. It used to land in
        // the public store-assets bucket, openable by anyone holding the URL.
        // Now it is stored under "<storeId>/..." in verification-docs, which
        // only the store's team and verification admins can read, through
        // short-lived signed links. doc_url holds the path, not a URL.
        privateBucket={VERIFICATION_DOCS_BUCKET}
        // Lower-case: the 0314 CHECK compares the first segment with
        // store_id::text, which Postgres always prints in lower case.
        folder={storeId.toLowerCase()}
        value={draft.doc_url}
        onChange={(path) => setDraft({ ...draft, doc_url: path })}
        label={t.doc}
        hint={t.docHint}
        dict={dict}
      />
      <div>
        <label className={labelClass} htmlFor="verif-url">{t.verifyUrl}</label>
        <input
          id="verif-url"
          value={draft.verify_url}
          onChange={(e) => setDraft({ ...draft, verify_url: e.target.value })}
          className={fieldClass}
        />
      </div>
      <div className="flex gap-2">
        <Button disabled={!draft.title.trim()} loading={busy} onClick={save}>
          {t.save}
        </Button>
        <Button
          variant="secondary"
          onClick={cancel}
          leftIcon={<X className="h-4 w-4" />}
        >
          {dict.merchant.doctors.cancel}
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
        {verifications.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {t.empty}
          </div>
        )}
        {verifications.map((v) => (
          <div
            key={v.id}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
          >
            {v.doc_view_url ? (
              // A signed URL is already a one-off link to the original; it is
              // not a public object the Supabase resizer can take, so it is
              // drawn as-is.
              <Image
                src={v.doc_view_url}
                alt=""
                width={56}
                height={56}
                unoptimized
                className="h-14 w-14 shrink-0 rounded-xl object-cover"
                sizes="56px"
              />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                <BadgeCheck className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-muted-foreground">
                {t.kinds[v.kind as keyof typeof t.kinds] ?? v.kind}
              </p>
              <p className="truncate font-bold">{v.title}</p>
              {(v.issuer || v.number) && (
                <p className="truncate text-sm text-muted-foreground">
                  {[v.issuer, v.number].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {v.status === "verified" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {t.verifiedDoc}
                  </span>
                ) : v.status === "rejected" ? (
                  <span className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                    {t.rejected}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {t.selfDeclared}
                  </span>
                )}
                {isExpired(v.expires_on) && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-warning">
                    {t.expired}
                  </span>
                )}
              </div>
            </div>
            <button
              disabled={busy}
              onClick={() => remove(v.id)}
              aria-label={t.delete}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
