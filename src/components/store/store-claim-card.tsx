"use client";

import { useState } from "react";
import { CheckCircle2, Store as StoreIcon } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

type ClaimKind = "claim" | "correct" | "remove";

/** What request_store_claim (0338) answers when it refuses. */
const KNOWN_CODES = ["name", "phone", "not_found", "already_claimed", "rate_limited"] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

/**
 * «هيدا محلّك؟» — the way a real owner steps into an unclaimed page.
 *
 * One sheet, three requests: claim, correct, remove. The owner of a business who
 * finds it listed may want any of them, and the last must be as easy to find as
 * the first. Nothing is taken over here: the RPC only files a request, and an
 * admin checks who is asking before anything changes (admin_resolve_store_claim).
 */
export function StoreClaimCard({
  storeId,
  storeName,
  supportHref,
  dict,
}: {
  storeId: string;
  storeName: string;
  /** Support WhatsApp with this store's name and link already written. */
  supportHref: string;
  dict: Pick<Dictionary, "directory" | "common">;
}) {
  const t = dict.directory.claim;
  const [kind, setKind] = useState<ClaimKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<"name" | "phone" | null>(null);
  const [done, setDone] = useState<"sent" | "duplicate" | null>(null);

  function open(next: ClaimKind) {
    setKind(next);
    setError(null);
    setFieldError(null);
    setDone(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!kind || busy) return;
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    setBusy(true);
    setError(null);
    setFieldError(null);
    const { data, error: rpcError } = await createClient().rpc("request_store_claim", {
      p_store_id: storeId,
      p_kind: kind,
      p_name: value("name"),
      p_phone: value("phone"),
      p_email: value("email") || null,
      p_note: value("note") || null,
    });
    setBusy(false);
    const res = data as { ok?: boolean; duplicate?: boolean; code?: string } | null;
    if (rpcError || !res) {
      setError(t.errors.generic);
      return;
    }
    if (res.ok) {
      setDone(res.duplicate ? "duplicate" : "sent");
      return;
    }
    const code = res.code as KnownCode | undefined;
    if (code === "name" || code === "phone") setFieldError(code);
    setError(code && KNOWN_CODES.includes(code) ? t.errors[code] : t.errors.generic);
  }

  const title = kind
    ? t.form[`${kind}Title`].replace("{store}", storeName)
    : "";

  return (
    <section
      id="claim"
      aria-labelledby="claim-title"
      className="mt-4 scroll-mt-24 rounded-2xl border border-primary/25 bg-primary-soft/40 p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <StoreIcon aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="claim-title" className="text-lg font-extrabold">
            {t.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
        </div>
      </div>

      <div className="mt-4">
        <Button full onClick={() => open("claim")}>
          {t.cta}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 text-sm font-semibold">
        <button
          type="button"
          onClick={() => open("correct")}
          className="inline-flex min-h-11 items-center text-primary underline-offset-2 hover:underline"
        >
          {t.correctLink}
        </button>
        <button
          type="button"
          onClick={() => open("remove")}
          className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t.removeLink}
        </button>
        <a
          href={supportHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t.whatsapp}
        </a>
      </div>

      <BottomSheet
        open={kind !== null}
        onClose={() => setKind(null)}
        title={title}
        closeLabel={dict.common.close}
      >
        {done ? (
          <div className="py-6 text-center" role="status">
            <CheckCircle2 aria-hidden className="mx-auto h-12 w-12 text-success" />
            <p className="mt-3 text-lg font-bold">
              {done === "sent" ? t.success.title : t.success.duplicateTitle}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {done === "sent" ? t.success.body : t.success.duplicateBody}
            </p>
            <div className="mt-5">
              <Button variant="secondary" full onClick={() => setKind(null)}>
                {dict.common.close}
              </Button>
            </div>
          </div>
        ) : kind ? (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t.form[`${kind}Intro`]}
            </p>
            <Field label={t.form.name} htmlFor="claim-name" required>
              <Input
                id="claim-name"
                name="name"
                autoComplete="name"
                required
                maxLength={120}
                error={fieldError === "name"}
              />
            </Field>
            <Field label={t.form.phone} htmlFor="claim-phone" required hint={t.form.phoneHint}>
              <Input
                id="claim-phone"
                name="phone"
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                required
                maxLength={40}
                error={fieldError === "phone"}
              />
            </Field>
            <Field label={t.form.email} htmlFor="claim-email" hint={kind === "claim" ? t.form.emailHint : undefined}>
              <Input
                id="claim-email"
                name="email"
                type="email"
                dir="ltr"
                inputMode="email"
                autoComplete="email"
                maxLength={200}
              />
            </Field>
            <Field label={t.form[`${kind}Note`]} htmlFor="claim-note">
              <Textarea id="claim-note" name="note" maxLength={1000} />
            </Field>
            {error && (
              <p role="alert" className="text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            <Button type="submit" full loading={busy}>
              {t.form[`${kind}Submit`]}
            </Button>
          </form>
        ) : null}
      </BottomSheet>
    </section>
  );
}
