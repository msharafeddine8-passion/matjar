"use client";
import { notifyError, notifySuccess } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Crown, RotateCcw, CreditCard } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import {
  addPlanPeriod,
  planCharge,
  planRank,
  type PlanKey,
} from "@/lib/plan-tiers";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type SubRow = {
  id: string;
  name: string;
  plan: string;
  subId: string | null;
  expiresAt: string | null;
  payments: number;
};

function Row({
  row,
  lang,
  dict,
}: {
  row: SubRow;
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "auth" | "common">;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.subs;
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [tier, setTier] = useState<PlanKey>("pro");
  // The default charge comes from PLAN_TIERS (annual = promo while the window
  // is open, standard after) — it used to be a hardcoded 12 / 120, prices no
  // tier has had since the repricing. Still editable: a negotiated amount is a
  // real thing. Picking another tier or period resets it to that default.
  const [amount, setAmount] = useState(() =>
    String(planCharge("pro", "monthly", new Date())),
  );
  const [busy, setBusy] = useState(false);

  // Read the clock once for the expiry badge; harmless in render for a status display.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const expiresMs = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
  const paid = planRank(row.plan) >= planRank("basic");
  const planLabel =
    row.plan === "business"
      ? t.business
      : row.plan === "pro"
        ? t.pro
        : row.plan === "basic"
          ? t.basic
          : t.free;
  const expired = expiresMs != null && expiresMs <= now;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  function changePeriod(p: "monthly" | "yearly") {
    setPeriod(p);
    setAmount(String(planCharge(tier, p, new Date())));
  }
  function changeTier(next: PlanKey) {
    setTier(next);
    setAmount(String(planCharge(next, period, new Date())));
  }

  async function activate() {
    if (
      !(await confirm({
        message: dict.admin.confirmActivateSub,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
      }))
    )
      return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // A renewal of the SAME tier extends from the current expiry, so paying
    // early never costs the merchant the days they had left. A new tier (or a
    // lapsed one) starts now: an upgrade bought today runs from today.
    const nowDate = new Date();
    const renewing =
      row.plan === tier && expiresMs != null && expiresMs > nowDate.getTime();
    const start = renewing ? new Date(expiresMs) : nowDate;
    const expires = addPlanPeriod(start, period);
    // A failed step stops the chain and is reported for what it was: these
    // three writes used to run with their errors discarded, so a store could
    // be shown upgraded with no subscription row behind it, which is exactly
    // the row the nightly expiry job reads.
    const fail = (msg: string, err: unknown) => {
      console.error("[admin-subs] activate failed", err);
      setBusy(false);
      notifyError(msg);
      router.refresh();
    };

    let subId = row.subId;
    if (subId) {
      const { data: updated, error: subErr } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          plan: tier,
          expires_at: expires.toISOString(),
          ...(renewing ? {} : { started_at: nowDate.toISOString() }),
          updated_at: nowDate.toISOString(),
        })
        .eq("id", subId)
        .select("id");
      if (subErr || !updated?.length) return fail(t.subFailed, subErr);
    } else {
      const { data: created, error: subErr } = await supabase
        .from("subscriptions")
        .insert({
          store_id: row.id,
          plan: tier,
          status: "active",
          started_at: nowDate.toISOString(),
          expires_at: expires.toISOString(),
        })
        .select("id")
        .single();
      subId = (created as { id: string } | null)?.id ?? null;
      if (subErr || !subId) return fail(t.subFailed, subErr);
    }
    const { error: payErr } = await supabase.from("payments").insert({
      store_id: row.id,
      subscription_id: subId,
      amount: Number(amount) || 0,
      period,
      method: "manual",
      recorded_by: user?.id ?? null,
    });
    if (payErr) return fail(t.paymentFailed, payErr);
    // Recording a payment sets the PLAN and nothing else.
    //
    // It used to also set is_verified, which made "موثّق" mean "paid". Those are
    // different promises: Pro is a tier a merchant bought, verified is a claim
    // Matjar makes to a customer that it checked something. A badge its own
    // subject can purchase is not evidence.
    //
    // The card already renders the two separately — ProBadge from `plan`, the
    // tick from `is_verified` — so nothing is lost visually. And verification now
    // has a real path: the merchant submits to store_verifications and an admin
    // approves it (0272). That queue should be the only thing that moves this.
    const { data: planned, error } = await supabase
      .from("stores")
      .update({ plan: tier })
      .eq("id", row.id)
      .select("id");
    if (error || !planned?.length) return fail(t.planFailed, error);
    setBusy(false);
    void logAdminAction("activated", "subscription", row.id, {
      period,
      plan: tier,
      expires_at: expires.toISOString(),
    });
    notifySuccess(t.activated.replace("{date}", fmt(expires.toISOString())));
    router.refresh();
  }

  async function downgrade() {
    if (
      !(await confirm({
        message: dict.admin.confirmDowngrade,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const supabase = createClient();
    const { error: subErr } = await supabase
      .from("subscriptions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("store_id", row.id)
      .eq("status", "active");
    if (subErr) {
      // Leave the plan alone, so the store and its subscription row never
      // disagree about whether it is paying.
      console.error("[admin-subs] cancel subscription failed", subErr);
      setBusy(false);
      notifyError(dict.auth.errorGeneric);
      return;
    }
    const { error } = await supabase
      .from("stores")
      .update({ plan: "free" })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction("downgraded", "subscription", row.id);
    router.refresh();
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">{row.name}</h3>
            <Badge variant={paid ? "warning" : "neutral"} size="sm">
              {paid && <Crown className="h-3 w-3" />}
              {planLabel}
            </Badge>
            {paid && row.expiresAt && (
              <Badge variant={expired ? "danger" : "success"} size="sm">
                {expired ? t.expired : t.active} · {t.expires}{" "}
                {fmt(row.expiresAt)}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {row.payments} {t.payments}
            </span>
          </div>
          {paid && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={downgrade}
              leftIcon={<RotateCcw className="h-4 w-4" />}
            >
              {t.downgrade}
            </Button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <Field label={t.plan} htmlFor="sub-tier" className="w-36">
            <Select
              value={tier}
              onChange={(e) => changeTier(e.target.value as PlanKey)}
            >
              <option value="basic">{t.basic}</option>
              <option value="pro">{t.pro}</option>
              <option value="business">{t.business}</option>
            </Select>
          </Field>
          <Field label={t.period} htmlFor="sub-period" className="w-40">
            <Select
              value={period}
              onChange={(e) =>
                changePeriod(e.target.value as "monthly" | "yearly")
              }
            >
              <option value="monthly">{t.monthly}</option>
              <option value="yearly">{t.yearly}</option>
            </Select>
          </Field>
          <Field label={t.amount} htmlFor="sub-amount" className="w-32">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Button
            disabled={busy}
            loading={busy}
            onClick={activate}
            leftIcon={<Crown className="h-4 w-4" />}
          >
            {busy ? t.saving : t.activate}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function AdminSubsClient({
  lang,
  dict,
  rows,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "auth" | "common">;
  rows: SubRow[];
}) {
  const t = dict.admin.subs;
  const [query, setQuery] = useState("");
  const filtered = rows.filter(
    (r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={CreditCard} title={t.title} subtitle={t.subtitle} />

        <div className="relative mb-6 sm:max-w-md">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            className="ps-10"
          />
        </div>

        {filtered.length ? (
          <div data-animate className="space-y-3">
            {filtered.map((r) => (
              <Row key={r.id} row={r} lang={lang} dict={dict} />
            ))}
          </div>
        ) : (
          <EmptyState icon={CreditCard} title={t.empty} />
        )}
      </Container>
    </div>
  );
}
