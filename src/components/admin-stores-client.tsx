"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Check,
  X,
  Ban,
  Play,
  FileText,
  BadgeCheck,
  Crown,
  Sparkles,
  Landmark,
  Store as StoreIcon,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { revalidateStores } from "@/lib/cache-actions";
import { logAdminAction, type AuditVerb } from "@/lib/audit";
import { matchesQuery } from "@/lib/admin-search";
import { regions } from "@/lib/catalog";
import type { IssueCode, QualityLevel } from "@/lib/data-quality";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { OverflowMenu, type OverflowAction } from "@/components/overflow-menu";

export type AdminStore = {
  id: string;
  name: string;
  region: string | null;
  status: "pending" | "active" | "suspended" | "rejected";
  plan: "free" | "basic" | "pro" | "business";
  isVerified: boolean;
  featuredUntil: string | null;
  commercialRegNo: string | null;
  commercialRegVerified: boolean;
  typeName: string | null;
  ownerName: string | null;
  /** NULL means no reason was ever recorded — never an empty string, and never
   *  a default sentence. Twenty stores were suspended before there was anywhere
   *  to write one, and pretending otherwise is what this screen is fixing. */
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  /** The public data quality gate (lib/data-quality.ts), computed on the
   *  server from the row. `blocked` cannot be made active from this screen. */
  quality: { level: QualityLevel; issues: IssueCode[] };
};

const qualityVariant: Record<QualityLevel, "success" | "warning" | "danger"> = {
  ok: "success",
  incomplete: "warning",
  blocked: "danger",
};

const statusVariant: Record<
  AdminStore["status"],
  "neutral" | "success" | "warning" | "danger"
> = {
  pending: "warning",
  active: "success",
  suspended: "danger",
  rejected: "neutral",
};

function chip(active: boolean) {
  return active
    ? "bg-primary text-primary-foreground border-primary"
    : "bg-surface text-foreground border-border hover:border-primary/40";
}

export function AdminStoresClient({
  lang,
  dict,
  stores,
}: {
  lang: Locale;
  dict: Dictionary;
  stores: AdminStore[];
}) {
  const router = useRouter();
  const t = dict.admin.storesAdmin;
  const [busy, setBusy] = useState<string | null>(null);
  // Which store is having its reason written, and for which outcome. Suspending
  // and rejecting no longer go through a yes/no confirm: typing the sentence the
  // merchant will read IS the confirmation, and there is no path past it.
  const [reasonFor, setReasonFor] = useState<{
    id: string;
    status: "suspended" | "rejected";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  // Seed the search from ?q= so a "Pro request" notification lands pre-filtered
  // on the requesting store instead of the whole list.
  const initialQuery = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<AdminStore["status"] | "all">("all");
  const [region, setRegion] = useState<string | "all">("all");

  async function patch(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    const { error } = await createClient()
      .from("stores")
      .update(patch)
      .eq("id", id);
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    let verb: AuditVerb;
    if (patch.status) verb = "status_changed";
    else if ("plan" in patch) verb = "plan_changed";
    else if ("is_verified" in patch)
      verb = patch.is_verified ? "verified" : "unverified";
    else if ("featured_until" in patch)
      verb = patch.featured_until ? "featured" : "unfeatured";
    else if ("commercial_reg_verified" in patch)
      verb = patch.commercial_reg_verified ? "verified" : "unverified";
    else verb = "updated";
    void logAdminAction(verb, "store", id, patch);
    await revalidateStores();
    router.refresh();
  }

  /**
   * Status goes through set_store_status (0282), never through a plain update:
   * the RPC is what refuses a suspension with no explanation and what stamps the
   * actor and the timestamp server-side. It returns an outcome instead of
   * raising so each refusal can be told apart — a Postgres error string cannot
   * distinguish "you forgot the reason" from "you are not an admin".
   *
   * Resolves to an error message to show, or null on success.
   */
  async function writeStatus(
    id: string,
    next: AdminStore["status"],
    reasonText?: string,
  ): Promise<string | null> {
    setBusy(id);
    const { data, error } = await createClient().rpc("set_store_status", {
      p_store_id: id,
      p_status: next,
      p_reason: reasonText ?? null,
    });
    setBusy(null);
    if (error) return dict.auth.errorGeneric;
    const out = (data ?? {}) as { ok?: boolean; error?: string };
    if (!out.ok) {
      if (out.error === "reason_required") return t.reasonRequired;
      if (out.error === "reason_too_long") return t.reasonTooLong;
      if (out.error === "forbidden") return t.forbidden;
      if (out.error === "not_found") return t.storeNotFound;
      return dict.auth.errorGeneric;
    }
    void logAdminAction("status_changed", "store", id, {
      status: next,
      reason: reasonText ?? null,
    });
    await revalidateStores();
    router.refresh();
    return null;
  }

  function openReason(id: string, status: "suspended" | "rejected") {
    setReasonFor({ id, status });
    setReason("");
    setReasonError(null);
  }

  async function submitReason() {
    if (!reasonFor) return;
    if (!reason.trim()) {
      setReasonError(t.reasonRequired);
      return;
    }
    const message = await writeStatus(reasonFor.id, reasonFor.status, reason);
    if (message) {
      setReasonError(message);
      return;
    }
    setReasonFor(null);
    setReason("");
  }

  /** A store the gate holds as `blocked` cannot be made active — the only
   *  transition gated. Suspending, rejecting and everything else stay open, so
   *  no existing merchant is locked out of anything they have today. */
  function gateBlocks(id: string, next: AdminStore["status"]): boolean {
    if (next !== "active") return false;
    const store = stores.find((s) => s.id === id);
    return store?.quality.level === "blocked";
  }

  async function applyStatus(id: string, next: AdminStore["status"]) {
    if (gateBlocks(id, next)) {
      notifyError(dict.dataQuality.blockedApprove);
      return;
    }
    const message = await writeStatus(id, next);
    if (message) notifyError(message);
  }

  const filtered = stores.filter((s) => {
    if (status !== "all" && s.status !== status) return false;
    if (region !== "all" && s.region !== region) return false;
    // Was `s.name.toLowerCase().includes(...)`, which is the wrong comparison
    // for an Arabic-first roster: "أحمد" and "احمد" are the same shop to
    // everyone except that expression. matchesQuery folds the hamza, the
    // harakat and the tatweel the same way the command palette does, and the
    // owner's name is in the haystack because "which store does this person
    // own" is how an admin arrives here from a support message.
    if (!matchesQuery(query, [s.name, s.ownerName, s.typeName])) return false;
    return true;
  });

  const statuses: (AdminStore["status"] | "all")[] = [
    "all",
    "pending",
    "active",
    "suspended",
    "rejected",
  ];

  const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={StoreIcon} title={t.title} subtitle={t.subtitle} />

        <div className="relative sm:max-w-md">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            className="ps-10"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${chip(status === s)}`}
            >
              {s === "all" ? t.allStatuses : t.statusLabels[s]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setRegion("all")}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${chip(region === "all")}`}
          >
            {t.allRegions}
          </button>
          {regions.map((r) => (
            <button
              key={r.key}
              onClick={() => setRegion(r.key)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${chip(region === r.key)}`}
            >
              {r.name[lang]}
            </button>
          ))}
        </div>

        <p className="mt-6 text-sm font-semibold text-muted-foreground">
          {filtered.length}
        </p>

        {filtered.length ? (
          <div data-animate className="mt-2 space-y-3">
            {filtered.map((s) => (
              <Card key={s.id}>
                <CardBody>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-base font-extrabold text-primary">
                    {initial(s.name)}
                  </span>
                  <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold">{s.name}</h3>
                    <Badge variant={statusVariant[s.status]} size="sm">
                      {t.statusLabels[s.status]}
                    </Badge>
                    {s.isVerified && (
                      <Badge variant="primary" size="sm">
                        <BadgeCheck className="h-3 w-3" />
                      </Badge>
                    )}
                    {s.plan !== "free" && (
                      <Badge variant="warning" size="sm">
                        <Crown className="h-3 w-3" />
                        {dict.admin.plans[s.plan]}
                      </Badge>
                    )}
                    {s.quality.level !== "ok" && (
                      <Badge variant={qualityVariant[s.quality.level]} size="sm">
                        {dict.dataQuality.levels[s.quality.level]}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {s.typeName}
                    {s.ownerName ? ` · ${t.owner}: ${s.ownerName}` : null}
                  </p>
                  {s.commercialRegNo && (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm">
                      <Landmark className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold">{dict.admin.reg}:</span>
                      <span dir="ltr" className="font-mono">
                        {s.commercialRegNo}
                      </span>
                      {s.commercialRegVerified && (
                        <BadgeCheck className="h-4 w-4 text-primary" />
                      )}
                    </p>
                  )}
                  {/* What the gate found, in the reviewer's words. Nothing here
                      is written back — the list is for the owner to act on by
                      hand or to hand to the merchant. */}
                  {s.quality.issues.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-semibold">
                        {dict.dataQuality.adminHeading}:
                      </span>{" "}
                      {s.quality.issues
                        .map((code) => dict.dataQuality.issues[code])
                        .join(" · ")}
                    </p>
                  )}
                  </div>
                </div>

                {(() => {
                  const featured =
                    s.featuredUntil != null &&
                    new Date(s.featuredUntil) > new Date();
                  const menuActions: OverflowAction[] = [
                    // The generic "verify" toggle is gone: stores.is_verified
                    // records nothing (what was checked, by whom, against
                    // what), lib/trust.ts ignores it, yet it still fed the
                    // «موثّق» discovery filter. The badge is earned through
                    // admin/verifications. Clearing a leftover flag stays.
                    ...(s.isVerified
                      ? [
                          {
                            label: t.unverify,
                            Icon: BadgeCheck,
                            active: true,
                            disabled: busy === s.id,
                            onClick: () => patch(s.id, { is_verified: false }),
                          },
                        ]
                      : []),
                    {
                      label: featured
                        ? dict.admin.unfeature
                        : dict.admin.feature,
                      Icon: Sparkles,
                      active: featured,
                      disabled: busy === s.id,
                      onClick: () =>
                        patch(s.id, {
                          featured_until: featured
                            ? null
                            : new Date(
                                Date.now() + 30 * 24 * 60 * 60 * 1000,
                              ).toISOString(),
                        }),
                    },
                  ];
                  if (s.commercialRegNo) {
                    menuActions.push({
                      label: s.commercialRegVerified
                        ? dict.admin.unverifyReg
                        : dict.admin.verifyReg,
                      Icon: Landmark,
                      active: s.commercialRegVerified,
                      disabled: busy === s.id,
                      onClick: () =>
                        patch(s.id, {
                          commercial_reg_verified: !s.commercialRegVerified,
                        }),
                    });
                  }
                  return (
                    <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                      {s.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy === s.id || s.quality.level === "blocked"}
                            title={
                              s.quality.level === "blocked"
                                ? dict.dataQuality.blockedApprove
                                : undefined
                            }
                            onClick={() => applyStatus(s.id, "active")}
                            leftIcon={<Check className="h-4 w-4" />}
                          >
                            {dict.admin.approve}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy === s.id}
                            onClick={() => openReason(s.id, "rejected")}
                            leftIcon={<X className="h-4 w-4" />}
                            className="!text-danger"
                          >
                            {dict.admin.reject}
                          </Button>
                        </>
                      )}
                      {s.status === "active" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === s.id}
                          onClick={() => openReason(s.id, "suspended")}
                          leftIcon={<Ban className="h-4 w-4" />}
                          className="!text-danger"
                        >
                          {t.suspend}
                        </Button>
                      )}
                      {(s.status === "suspended" ||
                        s.status === "rejected") && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy === s.id || s.quality.level === "blocked"}
                            title={
                              s.quality.level === "blocked"
                                ? dict.dataQuality.blockedApprove
                                : undefined
                            }
                            onClick={() => applyStatus(s.id, "active")}
                            leftIcon={<Play className="h-4 w-4" />}
                          >
                            {t.activate}
                          </Button>
                          {/* The 20 stores suspended before 0282 carry no
                              reason, and their owners were never told one. This
                              records it now without moving the status. */}
                          {s.statusReason == null && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy === s.id}
                              onClick={() =>
                                openReason(
                                  s.id,
                                  s.status as "suspended" | "rejected",
                                )
                              }
                              leftIcon={<FileText className="h-4 w-4" />}
                            >
                              {t.addReason}
                            </Button>
                          )}
                        </>
                      )}
                      <select
                        value={s.plan}
                        disabled={busy === s.id}
                        onChange={(e) =>
                          // The plan and nothing else. This used to also write
                          // is_verified = true for any paid tier, which made a
                          // purchase set a trust column — the same coupling
                          // admin-subs-client.tsx already removed. Verification
                          // moves only through its own toggles and the
                          // store_verifications queue (see lib/trust.ts).
                          patch(s.id, { plan: e.target.value })
                        }
                        aria-label={dict.admin.planLabel}
                        title={dict.admin.planLabel}
                        className="h-9 rounded-lg border border-border bg-surface px-2 text-sm font-semibold outline-none focus:border-primary disabled:opacity-50"
                      >
                        <option value="free">{dict.admin.plans.free}</option>
                        <option value="basic">{dict.admin.plans.basic}</option>
                        <option value="pro">{dict.admin.plans.pro}</option>
                        <option value="business">
                          {dict.admin.plans.business}
                        </option>
                      </select>
                      <OverflowMenu
                        actions={menuActions}
                        label={dict.admin.moreActions}
                        disabled={busy === s.id}
                      />
                    </div>
                  );
                })()}
                </div>

                {/* What was decided, by whom, and when. A status with no
                    provenance is exactly what made 20 suspensions unexplainable
                    to the merchants living with them. The who/when line shows on
                    every row — an approval is a decision too; the reason box is
                    only for the two outcomes that owe the merchant a sentence,
                    because set_store_status clears the reason on the way back to
                    active rather than leaving a stale one attached. */}
                {(s.statusChangedAt ||
                  s.status === "suspended" ||
                  s.status === "rejected") && (
                  <div className="mt-3 rounded-xl border border-border bg-surface-muted/50 p-3">
                    {(s.status === "suspended" || s.status === "rejected") && (
                      <>
                        <p className="text-sm font-bold">{t.recordedReason}</p>
                        {s.statusReason ? (
                          <p className="mt-1 whitespace-pre-line text-sm">
                            {s.statusReason}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm italic text-muted-foreground">
                            {t.noReasonRecorded}
                          </p>
                        )}
                      </>
                    )}
                    {s.statusChangedAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.changedBy}: {s.statusChangedByName ?? t.unknownActor}{" "}
                        · {t.changedAt} {fmtDate(s.statusChangedAt)}
                      </p>
                    )}
                  </div>
                )}

                {reasonFor?.id === s.id && (
                  <div className="mt-3 rounded-xl border border-danger/30 bg-danger-soft/30 p-3">
                    <label
                      htmlFor={`reason-${s.id}`}
                      className="text-sm font-bold"
                    >
                      {t.reasonHeading}
                    </label>
                    <Textarea
                      id={`reason-${s.id}`}
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setReasonError(null);
                      }}
                      maxLength={500}
                      error={!!reasonError}
                      placeholder={t.reasonPlaceholder}
                      className="mt-2"
                    />
                    {reasonError && (
                      <p className="mt-1 text-sm font-semibold text-danger">
                        {reasonError}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy === s.id}
                        onClick={submitReason}
                      >
                        {t.reasonSave}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === s.id}
                        onClick={() => setReasonFor(null)}
                      >
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                )}
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={StoreIcon} title={t.empty} />
        )}
      </Container>
    </div>
  );
}
