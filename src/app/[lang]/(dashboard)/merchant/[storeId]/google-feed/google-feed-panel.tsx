"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Check, Loader2, Power } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { revalidateGoogleFeed } from "./actions";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground disabled:opacity-60";

type T = Dictionary["googleFeed"];

// The three controls that write to `stores`: the two policies and the switch.
// They go through the same path every storefront setting already uses — the
// browser client's UPDATE, allowed for the owner by the `stores_update` policy
// — and the database has the last word (guard_google_feed, 0308): it refuses
// to switch the feed on without both policies or below Pro, whatever this
// component believes.
export function GoogleFeedPanel({
  storeId,
  t,
  feedUrl,
  policiesHref,
  initialReturnPolicy,
  initialShippingPolicy,
  enabled,
  canActivate,
  disabled,
  statusKey,
  onSince,
}: {
  storeId: string;
  t: T;
  feedUrl: string;
  policiesHref: string;
  initialReturnPolicy: string;
  initialShippingPolicy: string;
  enabled: boolean;
  canActivate: boolean;
  /** The 0308 columns are not on the database yet. */
  disabled: boolean;
  statusKey: "on" | "off" | "paused";
  onSince: string | null;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, old WebView): the URL is on screen
      // and selectable, which is the fallback.
    }
  }

  async function savePolicies(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error: err } = await createClient()
      .from("stores")
      .update({
        return_policy: String(form.get("return_policy") ?? "").trim() || null,
        shipping_policy: String(form.get("shipping_policy") ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", storeId);
    setSaving(false);
    if (err) {
      setError(t.errors.generic);
      return;
    }
    await revalidateGoogleFeed(storeId);
    setSaved(true);
    router.refresh();
  }

  async function toggle(next: boolean) {
    setToggling(true);
    setError(null);
    const { error: err } = await createClient()
      .from("stores")
      .update({ google_feed_enabled: next })
      .eq("id", storeId);
    setToggling(false);
    if (err) {
      const msg = err.message ?? "";
      setError(
        msg.includes("google_feed_requires_policies")
          ? t.errors.policies
          : msg.includes("google_feed_requires_plan")
            ? t.errors.plan
            : t.errors.generic,
      );
      return;
    }
    await revalidateGoogleFeed(storeId);
    router.refresh();
  }

  const badge =
    statusKey === "on"
      ? "bg-success-soft text-success"
      : statusKey === "paused"
        ? "bg-warning-soft text-warning"
        : "bg-surface-muted text-muted-foreground";

  return (
    <>
      {/* Status, link and switch */}
      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold">{t.statusTitle}</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge}`}>
            {t.status[statusKey]}
          </span>
        </div>
        {onSince && <p className="mt-1 text-xs text-muted-foreground">{onSince}</p>}
        {statusKey === "paused" && (
          <p className="mt-3 text-sm text-warning">{t.pausedBody}</p>
        )}
        {statusKey === "off" && (
          <p className="mt-3 text-sm text-muted-foreground">{t.offBody}</p>
        )}

        <label className="mt-5 block text-sm font-semibold" htmlFor="google-feed-url">
          {t.feedUrlLabel}
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="google-feed-url"
            readOnly
            value={feedUrl}
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-muted px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:border-primary"
          >
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            {copied ? t.copied : t.copy}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{t.feedUrlHint}</p>

        <div className="mt-5">
          {enabled ? (
            <button
              type="button"
              disabled={toggling || disabled}
              onClick={() => toggle(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-bold transition-colors hover:border-danger hover:text-danger disabled:opacity-60"
            >
              {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {toggling ? t.working : t.deactivate}
            </button>
          ) : (
            <button
              type="button"
              disabled={toggling || !canActivate}
              onClick={() => toggle(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {toggling ? t.working : t.activate}
            </button>
          )}
          {!enabled && !canActivate && (
            <p className="mt-2 text-xs text-muted-foreground">{t.activateBlocked}</p>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </section>

      {/* Both policies — Google asks for them, the storefront shows them */}
      <form
        onSubmit={savePolicies}
        className="rounded-2xl border border-border bg-surface p-6"
      >
        <h2 className="font-bold">{t.policiesTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.policiesBody}</p>

        <label className="mt-4 block text-sm font-semibold" htmlFor="return_policy">
          {t.returnPolicy}
        </label>
        <textarea
          id="return_policy"
          name="return_policy"
          rows={3}
          maxLength={2000}
          defaultValue={initialReturnPolicy}
          placeholder={t.returnPolicyPlaceholder}
          disabled={disabled}
          className={fieldClass}
        />

        <label className="mt-4 block text-sm font-semibold" htmlFor="shipping_policy">
          {t.shippingPolicy}
        </label>
        <textarea
          id="shipping_policy"
          name="shipping_policy"
          rows={3}
          maxLength={2000}
          defaultValue={initialShippingPolicy}
          placeholder={t.shippingPolicyPlaceholder}
          disabled={disabled}
          className={fieldClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t.shippingPolicyHint}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || disabled}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t.saving : t.save}
          </button>
          {saved && <span className="text-sm font-semibold text-primary">{t.saved}</span>}
          <Link
            href={policiesHref}
            className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t.viewPolicies}
          </Link>
        </div>
      </form>
    </>
  );
}
