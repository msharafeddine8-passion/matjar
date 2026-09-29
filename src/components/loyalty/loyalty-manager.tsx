"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Gift, MessageCircle, Plus, RefreshCw, Search, SlidersHorizontal, Stamp, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { phoneIssue, waUrl } from "@/lib/phone";
import {
  DEFAULT_PROGRAM,
  LOYALTY_LIMITS,
  cardProgress,
  displayPhoneKey,
  loyaltyCardPath,
  memberWaNumber,
  programBalance,
  programIssue,
  rewardCost,
  type LoyaltyProgram,
  type StampScope,
} from "@/lib/loyalty";

// The merchant's loyalty screen: the program (owner only), the members, and
// per member the three things a shop actually does — give the reward, correct
// a balance with a reason, and send the card link on WhatsApp (a free wa.me
// link the merchant sends from their own phone). Every write is an RPC from
// migration 0310 that re-checks permission and plan; this file only collects
// input and explains refusals.

export type LoyaltyMember = {
  id: string;
  phone_key: string;
  display_name: string | null;
  token: string;
  stamps: number;
  points: number;
  last_activity_at: string;
};

type Option = { id: string; name: string };

const field =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

function errorText(dict: Dictionary, message: string | null | undefined): string {
  const t = dict.loyaltyCards;
  const m = (message ?? "").toLowerCase();
  if (m.includes("plan_required")) return t.common.planRequired;
  if (m.includes("not allowed") || m.includes("permission denied")) return t.common.notAllowed;
  if (m.includes("reason_required")) return t.members.reasonRequired;
  if (m.includes("insufficient_balance")) return t.members.insufficient;
  if (m.includes("not_enough")) return t.members.notEnough;
  if (m.includes("bad_phone")) return t.members.badPhone;
  if (m.includes("could not find the function") || m.includes("does not exist") || m.includes("schema cache"))
    return t.common.setupPending;
  return t.common.error;
}

export function LoyaltyManager({
  storeId,
  storeName,
  lang,
  dict,
  isOwner,
  program,
  products,
  sections,
  members,
  siteUrl,
  setupPending,
}: {
  storeId: string;
  storeName: string;
  lang: string;
  dict: Dictionary;
  isOwner: boolean;
  program: LoyaltyProgram | null;
  products: Option[];
  sections: Option[];
  members: LoyaltyMember[];
  siteUrl: string;
  setupPending: boolean;
}) {
  const t = dict.loyaltyCards;
  return (
    <div className="space-y-8">
      {setupPending && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          {t.common.setupPending}
        </p>
      )}
      {isOwner ? (
        <ProgramForm
          storeId={storeId}
          dict={dict}
          initial={program}
          products={products}
          sections={sections}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          {program ? t.program.ownerOnly : t.program.none}
        </p>
      )}
      <MemberList
        storeId={storeId}
        storeName={storeName}
        lang={lang}
        dict={dict}
        program={program}
        members={members}
        siteUrl={siteUrl}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

function ProgramForm({
  storeId,
  dict,
  initial,
  products,
  sections,
}: {
  storeId: string;
  dict: Dictionary;
  initial: LoyaltyProgram | null;
  products: Option[];
  sections: Option[];
}) {
  const t = dict.loyaltyCards;
  const router = useRouter();
  const [p, setP] = useState<LoyaltyProgram>(initial ?? DEFAULT_PROGRAM);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof LoyaltyProgram>(k: K, v: LoyaltyProgram[K]) =>
    setP((cur) => ({ ...cur, [k]: v }));
  const issue = programIssue(p);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (issue) {
      notifyError(t.program.issues[issue]);
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc("set_loyalty_program", {
      p_store_id: storeId,
      p_kind: p.kind,
      p_is_active: p.isActive,
      p_stamps_required: p.stampsRequired,
      p_stamp_scope: p.stampScope,
      p_scope_product_id: p.stampScope === "product" ? p.scopeProductId : null,
      p_scope_section_id: p.stampScope === "section" ? p.scopeSectionId : null,
      p_points_per_usd: p.pointsPerUsd,
      p_redeem_threshold: p.redeemThreshold,
      p_reward_label: p.rewardLabel,
      p_reward_label_en: p.rewardLabelEn,
    });
    setBusy(false);
    if (error) {
      notifyError(errorText(dict, error.message));
      return;
    }
    notifySuccess(t.common.saved);
    router.refresh();
  }

  const kinds = [
    { k: "stamps" as const, label: t.program.kindStamps, hint: t.program.kindStampsHint, Icon: Stamp },
    { k: "points" as const, label: t.program.kindPoints, hint: t.program.kindPointsHint, Icon: Star },
  ];
  const scopes: { v: StampScope; label: string }[] = [
    { v: "order", label: t.program.scopeOrder },
    { v: "product", label: t.program.scopeProduct },
    { v: "section", label: t.program.scopeSection },
  ];

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">{t.program.title}</h2>
          <p className="text-sm text-muted-foreground">{t.program.intro}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <Switch checked={p.isActive} onChange={(v) => set("isActive", v)} label={t.program.active} />
          {t.program.active}
        </label>
      </div>
      {!p.isActive && <p className="text-sm text-muted-foreground">{t.program.paused}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        {kinds.map(({ k, label, hint, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => set("kind", k)}
            aria-pressed={p.kind === k}
            className={`flex items-start gap-3 rounded-xl border p-3 text-start transition-colors ${
              p.kind === k ? "border-primary bg-primary-soft" : "border-border hover:border-primary/40"
            }`}
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${p.kind === k ? "text-primary" : "text-muted-foreground"}`} />
            <span>
              <span className="block text-sm font-bold">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      {p.kind === "stamps" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold">{t.program.stampsRequired}</span>
            <input
              type="number"
              inputMode="numeric"
              min={LOYALTY_LIMITS.stampsMin}
              max={LOYALTY_LIMITS.stampsMax}
              value={p.stampsRequired}
              onChange={(e) => set("stampsRequired", Math.trunc(Number(e.target.value)))}
              className={field}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t.program.stampsExample}</span>
          </label>
          <fieldset className="text-sm">
            <legend className="font-semibold">{t.program.scope}</legend>
            <div className="mt-1 space-y-1.5">
              {scopes.map((s) => (
                <label key={s.v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="stamp_scope"
                    checked={p.stampScope === s.v}
                    onChange={() => set("stampScope", s.v)}
                    className="accent-primary"
                  />
                  {s.label}
                </label>
              ))}
            </div>
            {p.stampScope === "product" && (
              <select
                aria-label={t.program.chooseProduct}
                value={p.scopeProductId ?? ""}
                onChange={(e) => set("scopeProductId", e.target.value || null)}
                className={field}
              >
                <option value="">{t.program.chooseProduct}</option>
                {products.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            {p.stampScope === "section" &&
              (sections.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">{t.program.noSections}</p>
              ) : (
                <select
                  aria-label={t.program.chooseSection}
                  value={p.scopeSectionId ?? ""}
                  onChange={(e) => set("scopeSectionId", e.target.value || null)}
                  className={field}
                >
                  <option value="">{t.program.chooseSection}</option>
                  {sections.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ))}
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold">{t.program.pointsPerUsd}</span>
            <input
              type="number"
              inputMode="numeric"
              min={LOYALTY_LIMITS.rateMin}
              max={LOYALTY_LIMITS.rateMax}
              value={p.pointsPerUsd}
              onChange={(e) => set("pointsPerUsd", Math.trunc(Number(e.target.value)))}
              className={field}
            />
          </label>
          <label className="block text-sm">
            <span className="font-semibold">{t.program.redeemThreshold}</span>
            <input
              type="number"
              inputMode="numeric"
              min={LOYALTY_LIMITS.thresholdMin}
              value={p.redeemThreshold}
              onChange={(e) => set("redeemThreshold", Math.trunc(Number(e.target.value)))}
              className={field}
            />
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold">{t.program.reward}</span>
          <input
            dir="auto"
            maxLength={LOYALTY_LIMITS.rewardMax}
            value={p.rewardLabel ?? ""}
            onChange={(e) => set("rewardLabel", e.target.value || null)}
            placeholder={t.program.rewardPlaceholder}
            className={field}
          />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">{t.program.rewardEn}</span>
          <input
            dir="ltr"
            maxLength={LOYALTY_LIMITS.rewardMax}
            value={p.rewardLabelEn ?? ""}
            onChange={(e) => set("rewardLabelEn", e.target.value || null)}
            placeholder={t.program.rewardEnPlaceholder}
            className={field}
          />
        </label>
      </div>

      <div className="space-y-1 rounded-xl bg-surface-muted/60 px-4 py-3 text-xs text-muted-foreground">
        <p>{t.program.howEarned}</p>
        {p.kind === "points" && <p>{t.program.accountNote}</p>}
      </div>

      {issue && <p className="text-sm font-semibold text-danger">{t.program.issues[issue]}</p>}

      <button
        type="submit"
        disabled={busy || !!issue}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? t.common.saving : t.common.save}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function MemberList({
  storeId,
  storeName,
  lang,
  dict,
  program,
  members,
  siteUrl,
}: {
  storeId: string;
  storeName: string;
  lang: string;
  dict: Dictionary;
  program: LoyaltyProgram | null;
  members: LoyaltyMember[];
  siteUrl: string;
}) {
  const t = dict.loyaltyCards;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, "").replace(/^0+/, "");
    if (!s) return members;
    return members.filter(
      (m) =>
        (m.display_name ?? "").toLowerCase().includes(s) ||
        (digits.length > 0 && m.phone_key.includes(digits)),
    );
  }, [q, members]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (phoneIssue(phone) === "missing" || phoneIssue(phone) === "tooShort") {
      notifyError(t.members.badPhone);
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc("loyalty_add_member", {
      p_store_id: storeId,
      p_phone: phone,
      p_name: name.trim() || null,
    });
    setBusy(false);
    if (error) {
      notifyError(errorText(dict, error.message));
      return;
    }
    setPhone("");
    setName("");
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">{t.members.title}</h2>
          <p className="text-sm text-muted-foreground">
            {t.members.count.replace("{n}", members.length.toLocaleString("en-US"))}
          </p>
        </div>
        <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 sm:w-72">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.members.search}
            aria-label={t.members.search}
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </label>
      </div>

      <form onSubmit={add} className="grid gap-2 rounded-2xl border border-dashed border-border p-4 sm:grid-cols-[1fr_1fr_auto]">
        <p className="text-sm font-bold sm:col-span-3">{t.members.addTitle}</p>
        <input
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t.members.phone}
          aria-label={t.members.phone}
          className={`${field} mt-0`}
          required
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.members.name}
          aria-label={t.members.name}
          maxLength={80}
          className={`${field} mt-0`}
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {t.members.add}
        </button>
      </form>

      {members.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {t.members.empty}
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.members.noMatch}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {shown.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              program={program}
              storeName={storeName}
              lang={lang}
              dict={dict}
              siteUrl={siteUrl}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberRow({
  member,
  program,
  storeName,
  lang,
  dict,
  siteUrl,
}: {
  member: LoyaltyMember;
  program: LoyaltyProgram | null;
  storeName: string;
  lang: string;
  dict: Dictionary;
  siteUrl: string;
}) {
  const t = dict.loyaltyCards;
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const kind = program?.kind ?? (member.points > 0 && member.stamps === 0 ? "points" : "stamps");
  const balance = programBalance(kind, member);
  const per = program ? rewardCost(program) : 0;
  const prog = per > 0 ? cardProgress(balance, per) : null;
  const link = `${siteUrl}${loyaltyCardPath(lang, member.token)}`;
  const wa = memberWaNumber(member.phone_key);
  const message = (member.display_name ? t.members.waMessage : t.members.waMessageNoName)
    .replace("{name}", member.display_name ?? "")
    .replace("{store}", storeName)
    .replace("{link}", link);
  const lastActivity = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Beirut",
  }).format(new Date(member.last_activity_at));

  async function giveReward() {
    if (!program) return;
    const ok = await confirm({
      message: t.members.confirmReward.replace("{n}", String(per)),
      confirmLabel: t.members.giveReward,
      cancelLabel: t.common.cancel,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await createClient().rpc("loyalty_redeem_reward", { p_account_id: member.id });
    setBusy(false);
    if (error) {
      notifyError(errorText(dict, error.message));
      return;
    }
    notifySuccess(t.members.rewardGiven);
    router.refresh();
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    const n = Math.trunc(Number(delta));
    if (!n || Math.abs(n) > LOYALTY_LIMITS.adjustMax) return;
    if (reason.trim().length < LOYALTY_LIMITS.noteMin) {
      notifyError(t.members.reasonRequired);
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc("loyalty_adjust", {
      p_account_id: member.id,
      p_kind: kind,
      p_delta: n,
      p_note: reason.trim(),
    });
    setBusy(false);
    if (error) {
      notifyError(errorText(dict, error.message));
      return;
    }
    setDelta("");
    setReason("");
    setOpen(false);
    router.refresh();
  }

  // A card link that reached the wrong person: a fresh token (0318) makes the
  // old /loyalty/<token> 404. The balance lives on the member, not the link.
  async function rotateLink() {
    const ok = await confirm({
      message: t.members.confirmRotate,
      confirmLabel: t.members.rotateLink,
      cancelLabel: t.common.cancel,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await createClient().rpc("rotate_loyalty_card_link", { p_account_id: member.id });
    setBusy(false);
    if (error) {
      notifyError(errorText(dict, error.message));
      return;
    }
    notifySuccess(t.members.rotated);
    router.refresh();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold" dir="auto">
            {member.display_name || t.members.unnamed}
          </p>
          <p className="text-xs text-muted-foreground">
            <bdi dir="ltr">{displayPhoneKey(member.phone_key)}</bdi>
            {" · "}
            {t.members.lastActivity.replace("{date}", lastActivity)}
          </p>
        </div>
        <div className="text-end">
          <p className="text-sm font-extrabold tabular-nums">
            {kind === "stamps" && program
              ? t.members.progressStamps
                  .replace("{n}", String(Math.max(balance, 0)))
                  .replace("{total}", String(program.stampsRequired))
              : t.members.progressPoints.replace("{n}", Math.max(balance, 0).toLocaleString("en-US"))}
          </p>
          {prog && prog.rewardsReady > 0 ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
              <Gift className="h-3.5 w-3.5" />
              {t.members.rewardReady}
              {prog.rewardsReady > 1 ? ` ×${prog.rewardsReady}` : ""}
            </span>
          ) : prog ? (
            <p className="text-xs text-muted-foreground">
              {t.members.toNext.replace("{n}", prog.toNext.toLocaleString("en-US"))}
            </p>
          ) : null}
        </div>
      </div>

      {prog && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(prog.ratio * 100)}%` }} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {prog && prog.rewardsReady > 0 && (
          <button
            type="button"
            onClick={giveReward}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-success-strong px-3 py-1.5 text-xs font-bold text-success-strong-foreground disabled:opacity-60"
          >
            <Gift className="h-3.5 w-3.5" />
            {t.members.giveReward}
          </button>
        )}
        {wa ? (
          <a
            href={waUrl(wa, message)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
          >
            <MessageCircle className="h-3.5 w-3.5 text-success" />
            {t.members.sendCard}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{t.members.noWa}</span>
        )}
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t.common.copied : t.common.copy}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t.members.openCard}
        </a>
        <button
          type="button"
          onClick={rotateLink}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40 disabled:opacity-60"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t.members.rotateLink}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/40"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t.members.adjust}
        </button>
      </div>

      {open && (
        <form onSubmit={adjust} className="grid gap-2 rounded-xl bg-surface-muted/60 p-3 sm:grid-cols-[8rem_1fr_auto]">
          <input
            type="number"
            inputMode="numeric"
            dir="ltr"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder={t.members.delta}
            aria-label={t.members.delta}
            className={`${field} mt-0`}
            required
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.members.reasonPlaceholder}
            aria-label={t.members.reason}
            maxLength={LOYALTY_LIMITS.noteMax}
            className={`${field} mt-0`}
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {t.members.apply}
          </button>
        </form>
      )}
    </li>
  );
}
