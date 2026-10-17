"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Megaphone,
  Send,
  Users,
  Heart,
  UsersRound,
  Repeat,
  Crown,
  Moon,
  Link2,
  Check,
  type LucideIcon,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";

// ===== Contract (matches migrations 0122 + 0164) =====
export type Audience =
  | "followers"
  | "customers"
  | "all"
  | "repeat"
  | "vip"
  | "inactive";

export type CampaignRow = {
  id: string;
  title: string | null;
  body: string;
  url: string | null;
  audience: Audience;
  sent_count: number;
  created_at: string;
};

export type AudienceCounts = {
  followers: number;
  customers: number;
  all: number;
  repeat: number;
  vip: number;
  inactive: number;
};

const AUDIENCES: Audience[] = [
  "all",
  "followers",
  "customers",
  "repeat",
  "vip",
  "inactive",
];

const AUDIENCE_ICON: Record<Audience, LucideIcon> = {
  all: UsersRound,
  followers: Heart,
  customers: Users,
  repeat: Repeat,
  vip: Crown,
  inactive: Moon,
};

function timeAgo(iso: string, lang: Locale) {
  const diff = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en", {
    numeric: "auto",
  });
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return rtf.format(0, "minute");
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return rtf.format(-hrs, "hour");
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return rtf.format(-days, "day");
  const months = Math.round(days / 30);
  return rtf.format(-months, "month");
}

export function CampaignManager({
  storeId,
  lang,
  dict,
  initial,
  counts,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "os">;
  initial: CampaignRow[];
  counts: AudienceCounts;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.campaigns;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [busy, setBusy] = useState(false);

  const audienceCount = (a: Audience) => counts[a];
  const targetCount = audienceCount(audience);

  async function send() {
    if (!body.trim()) {
      notifyError(t.errors.empty_body);
      return;
    }
    // A campaign is a push + in-app message to real people; it can't be
    // unsent. Say how many and to whom before it goes.
    if (
      !(await confirm({
        message: t.confirmSend
          .replace("{n}", String(targetCount))
          .replace("{audience}", (t.audiences as Record<string, string>)[audience] ?? audience),
        confirmLabel: t.confirmSendYes,
        cancelLabel: dict.common.cancel,
      }))
    ) {
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().rpc("send_store_campaign", {
      p_store_id: storeId,
      p_title: title.trim() || null,
      p_body: body.trim(),
      p_url: url.trim() || null,
      p_audience: audience,
    });
    setBusy(false);

    if (error) {
      // The RPC raises bare codes (e.g. 'rate_limited'); map known ones to a
      // friendly localized message, else fall back to a generic failure.
      const code = (error.message ?? "").toLowerCase();
      const friendly =
        code.includes("rate_limited")
          ? t.errors.rate_limited
          : code.includes("empty_body")
            ? t.errors.empty_body
            : code.includes("bad_audience")
              ? t.errors.bad_audience
              : code.includes("not_authorized")
                ? t.errors.not_authorized
                : code.includes("plan_required")
                  ? t.errors.plan_required
                  : code.includes("bad_url")
                    ? t.errors.bad_url
                    : dict.common.actionFailed;
      notifyError(friendly);
      return;
    }

    const sent = (data as { sent?: number } | null)?.sent ?? 0;
    notifySuccess(t.sentToast.replace("{n}", String(sent)));
    setTitle("");
    setBody("");
    setUrl("");
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-10">
      {/* ===== Compose ===== */}
      <section className="rounded-3xl border border-primary/30 bg-surface p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-2 text-sm font-bold text-primary">
          <Megaphone className="h-4 w-4" />
          {t.composeTitle}
        </div>

        {/* Audience */}
        <div>
          <span className="text-sm font-semibold">{t.audienceLabel}</span>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {AUDIENCES.map((a) => {
              const AIcon = AUDIENCE_ICON[a];
              const active = audience === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-3 text-center transition-all ${
                    active
                      ? "border-primary bg-primary-soft text-primary shadow-sm"
                      : "border-border bg-surface text-foreground hover:border-primary/40"
                  }`}
                >
                  <AIcon
                    className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span className="text-xs font-bold">{t.audiences[a]}</span>
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {audienceCount(a)} {t.recipientsUnit}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Title (optional) */}
        <label className="mt-5 block text-sm font-semibold">
          {t.titleLabel}
          <span className="ms-1 text-xs font-normal text-muted-foreground">
            {t.optional}
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.titleHint}
            maxLength={80}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>

        {/* Body (required) */}
        <label className="mt-4 block text-sm font-semibold">
          {t.bodyLabel}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t.bodyHint}
            rows={3}
            maxLength={500}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>

        {/* Link (optional) */}
        <label className="mt-4 block text-sm font-semibold">
          <span className="flex items-center gap-1">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            {t.linkLabel}
            <span className="text-xs font-normal text-muted-foreground">
              {t.optional}
            </span>
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t.linkHint}
            dir="ltr"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={send}
            loading={busy}
            disabled={!body.trim()}
            leftIcon={<Send className="h-4 w-4" />}
          >
            {t.send}
          </Button>
          <span className="text-xs font-semibold text-muted-foreground">
            {t.willReach.replace("{n}", String(targetCount))}
          </span>
        </div>
      </section>

      {/* ===== Recent campaigns ===== */}
      <section>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t.recentTitle}
        </h2>
        <div className="mt-4 space-y-3">
          {initial.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              {t.recentEmpty}
            </div>
          ) : (
            initial.map((c) => {
              const AIcon = AUDIENCE_ICON[c.audience];
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-border bg-surface p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <Megaphone className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {c.title?.trim() && (
                        <p className="font-bold leading-tight">{c.title}</p>
                      )}
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {c.body}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge variant="primary" size="sm">
                          <AIcon className="h-3 w-3" />
                          {t.audiences[c.audience]}
                        </Badge>
                        <Badge variant="success" size="sm">
                          <Check className="h-3 w-3" />
                          {t.sentCount.replace("{n}", String(c.sent_count))}
                        </Badge>
                      </div>
                    </div>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={c.created_at}
                    >
                      {timeAgo(c.created_at, lang)}
                    </time>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
