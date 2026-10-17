"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus, Send, CheckCircle2 } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";

// Customer-facing lead / inquiry capture for directory-only listing sectors
// (real estate, automotive). Writes an on-platform lead via the create_lead RPC
// (migration 0190) instead of losing the inquiry to WhatsApp. Guests allowed —
// the RPC grants anon and rate-limits by phone. Self-contained: resolves the
// signed-in user on the client so the server store page stays unchanged.
export function LeadForm({
  storeId,
  lang,
  dict,
  kinds,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "leadForm">;
  kinds: string[];
}) {
  const t = dict.leadForm;
  const [kind, setKind] = useState(kinds[0] ?? "contact");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setName(
          (user.user_metadata?.full_name as string | undefined) ??
            user.email ??
            "",
        );
      }
    });
  }, []);

  async function submit() {
    if (name.trim().length < 2 || phone.trim().length < 4 || busy) return;
    setBusy(true);
    const { error } = await createClient().rpc("create_lead", {
      p_store_id: storeId,
      p_product_id: null,
      p_kind: kind,
      p_name: name.trim(),
      p_phone: phone.trim(),
      p_message: message.trim() || null,
    });
    setBusy(false);
    if (error) {
      notifyError(
        error.message?.includes("rate_limited")
          ? t.rateLimited
          : dict.common.actionFailed,
      );
      return;
    }
    setSent(true);
  }

  const kindLabel = (k: string) =>
    (t.kinds as Record<string, string>)[k] ?? k;

  if (sent) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
        <h3 className="mt-2 text-lg font-extrabold">{t.sentTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t.sentNote}</p>
        <button
          onClick={() => {
            setSent(false);
            setMessage("");
          }}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
        >
          {t.another}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-5">
      <h3 className="flex items-center gap-2 text-lg font-extrabold">
        <MessageSquarePlus className="h-5 w-5 text-primary" />
        {t.title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      {kinds.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-bold transition-colors ${
                kind === k
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:bg-surface-muted"
              }`}
            >
              {kindLabel(k)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.name}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.phone}
            inputMode="tel"
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t.messageHint}
          rows={2}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <Button
          onClick={submit}
          loading={busy}
          disabled={name.trim().length < 2 || phone.trim().length < 4}
          leftIcon={<Send className="h-4 w-4" />}
        >
          {t.send}
        </Button>
        <p className="text-xs text-muted-foreground">{t.privacyNote}</p>
      </div>
    </div>
  );
}
