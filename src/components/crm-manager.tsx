"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  MessageCircle,
  BookUser,
  ClipboardList,
  Gift,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { waLink } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardList, CardRow } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Dictionary } from "@/i18n/get-dictionary";
import { beirutYmd } from "@/lib/quick-panel";

export type BookCustomer = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  status: "new" | "regular" | "vip" | "inactive";
  follow_up_on: string | null;
};

export type DerivedCustomer = {
  name: string | null;
  phone: string | null;
  count: number;
  total: number;
  // profiles.id when the order was placed by a registered account. Loyalty
  // points are tracked per (user, store) since migration 0095, so only these
  // registered customers can have a redeemable balance AT THIS store.
  customerId: string | null;
  lastOrder: string | null;
};

// Behavioural segments, computed from order history — the same definitions the
// campaign sender uses server-side (migration 0164), so what a merchant filters
// here matches who a segment-targeted campaign reaches.
type Segment = "new" | "repeat" | "vip" | "inactive";

const SEGMENTS: Segment[] = ["new", "repeat", "vip", "inactive"];

const INACTIVE_MS = 60 * 24 * 60 * 60 * 1000;

function segmentsOf(c: DerivedCustomer): Segment[] {
  const segs: Segment[] = [];
  if (c.count === 1) segs.push("new");
  if (c.count >= 2) segs.push("repeat");
  if (c.count >= 3) segs.push("vip");
  if (c.lastOrder && Date.now() - new Date(c.lastOrder).getTime() > INACTIVE_MS)
    segs.push("inactive");
  return segs;
}

const segmentVariant: Record<Segment, "info" | "primary" | "warning" | "neutral"> = {
  new: "info",
  repeat: "primary",
  vip: "warning",
  inactive: "neutral",
};

type RedemptionSettingsRow = { enabled: boolean; points_per_unit: number };

const statusVariant: Record<
  BookCustomer["status"],
  "info" | "primary" | "warning" | "neutral"
> = {
  new: "info",
  regular: "primary",
  vip: "warning",
  inactive: "neutral",
};

function waHref(phone: string) {
  return waLink(phone) ?? `tel:${phone}`;
}

// CRM module of the Business OS: the merchant's own customer book (walk-ins,
// phone customers) side by side with customers derived from platform orders.
export function CrmManager({
  storeId,
  dict,
  book,
  derived,
  balances = {},
}: {
  storeId: string;
  dict: Dictionary;
  book: BookCustomer[];
  derived: DerivedCustomer[];
  // customerId (profiles.id) → available loyalty points. Only registered
  // customers appear; everyone else defaults to 0.
  balances?: Record<string, number>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.crm;
  const [tab, setTab] = useState<"book" | "orders">("book");
  const [query, setQuery] = useState("");
  const [seg, setSeg] = useState<Segment | "all">("all");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  // Per-store redemption opt-in + rate (migration 0107). Loaded on mount via the
  // manager-guarded reader; redemption controls stay hidden until it resolves.
  const [redemption, setRedemption] = useState<{
    enabled: boolean;
    rate: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    createClient()
      .rpc("get_loyalty_redemption", { p_store_id: storeId })
      .then(({ data }) => {
        if (!active) return;
        const row = (
          Array.isArray(data) ? data[0] : data
        ) as RedemptionSettingsRow | undefined;
        setRedemption(
          row
            ? { enabled: !!row.enabled, rate: Number(row.points_per_unit) || 100 }
            : { enabled: false, rate: 100 },
        );
      });
    return () => {
      active = false;
    };
  }, [storeId]);

  const bookPhones = new Set(book.map((c) => c.phone).filter(Boolean));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await createClient().from("store_customers").insert({
      store_id: storeId,
      name: name.trim(),
      phone: phone.trim() || null,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    setName("");
    setPhone("");
    router.refresh();
  }

  async function quickAdd(c: DerivedCustomer) {
    setBusy(true);
    const { error } = await createClient().from("store_customers").insert({
      store_id: storeId,
      name: c.name ?? c.phone ?? "—",
      phone: c.phone,
      status: "regular",
    });
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  async function setStatus(id: string, status: BookCustomer["status"]) {
    const { error } = await createClient()
      .from("store_customers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  async function saveNotes(id: string, notes: string) {
    const { error } = await createClient()
      .from("store_customers")
      .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) notifyError(dict.auth.errorGeneric);
  }

  async function setFollowUp(id: string, date: string) {
    const { error } = await createClient()
      .from("store_customers")
      .update({
        follow_up_on: date || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: t.confirmDelete, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    const { error } = await createClient()
      .from("store_customers")
      .delete()
      .eq("id", id);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    router.refresh();
  }

  const q = query.trim().toLowerCase();
  const filteredBook = book.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q),
  );
  const filteredDerived = derived.filter((c) => {
    if (
      q &&
      !(c.name ?? "").toLowerCase().includes(q) &&
      !(c.phone ?? "").toLowerCase().includes(q)
    )
      return false;
    return seg === "all" || segmentsOf(c).includes(seg);
  });

  // Segment counts for the filter chips (over all derived customers).
  const segCounts: Record<Segment, number> = {
    new: 0,
    repeat: 0,
    vip: 0,
    inactive: 0,
  };
  for (const c of derived)
    for (const s of segmentsOf(c)) segCounts[s] += 1;

  const tabBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-muted-foreground hover:border-primary/40"
    }`;

  const segChip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-muted-foreground hover:border-primary/40"
    }`;

  const today = beirutYmd(new Date());
  const dueFollowUps = book
    .filter((c) => c.follow_up_on != null && c.follow_up_on <= today)
    .sort((a, b) => (a.follow_up_on! < b.follow_up_on! ? -1 : 1));

  return (
    <div>
      {/* Follow-ups due (clinic deep pack — works for every sector). */}
      {dueFollowUps.length > 0 && (
        <section className="mb-4 rounded-2xl border border-primary/30 bg-primary-soft/40 p-4">
          <h2 className="font-bold text-primary">{t.followUpsTitle}</h2>
          <CardList className="mt-3">
            {dueFollowUps.map((c) => (
              <CardRow
                key={c.id}
                className="flex items-center gap-3 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{c.name}</span>
                  <span
                    className="text-xs tabular-nums text-muted-foreground"
                    dir="ltr"
                  >
                    {c.follow_up_on}
                  </span>
                </span>
                {/* The WhatsApp button stays 36px so the row does not grow, but
                    a transparent pseudo carries the hit area to 48px (WCAG
                    2.5.5). The 12px flex gap absorbs the overhang exactly, so
                    adjacent targets never overlap. */}
                {c.phone && (
                  <a
                    href={waHref(c.phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="WhatsApp"
                    className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-whatsapp text-whatsapp-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-whatsapp-hover"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setFollowUp(c.id, "")}
                  className="relative flex h-9 shrink-0 items-center rounded-lg border border-border px-3 text-xs font-bold transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:border-primary hover:text-primary"
                >
                  {t.followUpDone}
                </button>
              </CardRow>
            ))}
          </CardList>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTab("book")} className={tabBtn(tab === "book")}>
          <BookUser className="h-4 w-4" />
          {t.book} ({book.length})
        </button>
        <button type="button" onClick={() => setTab("orders")} className={tabBtn(tab === "orders")}>
          <ClipboardList className="h-4 w-4" />
          {t.fromOrders} ({derived.length})
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 sm:max-w-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.search}
          className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {tab === "book" ? (
        <>
          <form
            onSubmit={add}
            className="mt-4 flex flex-wrap items-stretch gap-2 rounded-2xl border border-border bg-surface p-3"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.name}
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t.phone}
              dir="ltr"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Button
              type="submit"
              loading={busy}
              disabled={!name.trim()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {t.add}
            </Button>
          </form>

          {filteredBook.length ? (
            <div className="mt-4 space-y-2">
              {filteredBook.map((c) => (
                <details
                  key={c.id}
                  className="group rounded-2xl border border-border bg-surface"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
                      {c.name.trim().charAt(0) || "؟"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{c.name}</span>
                      {c.phone && (
                        <span
                          dir="ltr"
                          className="block text-sm tabular-nums text-muted-foreground"
                        >
                          <span dir="ltr">{c.phone}</span>
                        </span>
                      )}
                    </span>
                    <Badge variant={statusVariant[c.status]} size="sm" className="shrink-0">
                      {t.status[c.status]}
                    </Badge>
                    {c.phone && (
                      <a
                        href={waHref(c.phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="WhatsApp"
                        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-whatsapp text-whatsapp-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-whatsapp-hover"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    )}
                  </summary>
                  <div className="border-t border-border p-4">
                    {/* The status pills sit 6px apart, too close to grow the hit
                        area with a pseudo without the overhangs overlapping and
                        making taps land on the wrong status. Below lg they get
                        real 44px height instead; lg:py-1 restores the compact
                        desktop pill. */}
                    <div className="flex flex-wrap gap-1.5">
                      {(["new", "regular", "vip", "inactive"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStatus(c.id, s)}
                          className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-bold transition-colors lg:min-h-0 lg:py-1 ${
                            c.status === s
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {t.status[s]}
                        </button>
                      ))}
                    </div>
                    <label className="mt-3 block text-sm">
                      <span className="font-semibold text-muted-foreground">
                        {t.followUp}
                      </span>
                      <input
                        type="date"
                        defaultValue={c.follow_up_on ?? ""}
                        onChange={(e) => setFollowUp(c.id, e.target.value)}
                        className="mt-1 block h-11 rounded-lg border border-border bg-surface px-3 text-sm tabular-nums outline-none focus:border-primary lg:h-auto lg:py-2"
                      />
                    </label>
                    <textarea
                      defaultValue={c.notes ?? ""}
                      onBlur={(e) => saveNotes(c.id, e.target.value)}
                      placeholder={t.notes}
                      rows={2}
                      className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      className="mt-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft lg:min-h-0 lg:py-1"
                    >
                      <Trash2 className="h-4 w-4" />
                      {dict.merchant.products.delete}
                    </button>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
              {t.empty}
            </div>
          )}
        </>
      ) : (
        <>
          {redemption && (
            <RedemptionSettings
              storeId={storeId}
              value={redemption}
              dict={dict}
              onSaved={setRedemption}
            />
          )}
          {/* Behavioural segment filter — the same segments campaigns target. */}
          {derived.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSeg("all")}
                className={segChip(seg === "all")}
              >
                {t.segAll} ({derived.length})
              </button>
              {SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeg(s)}
                  className={segChip(seg === s)}
                >
                  {t.segments[s]} ({segCounts[s]})
                </button>
              ))}
            </div>
          )}
          {filteredDerived.length ? (
            <CardList className="mt-4">
              {filteredDerived.map((c, i) => {
            const points = c.customerId ? (balances[c.customerId] ?? 0) : 0;
            return (
              <CardRow key={i}>
                {/* Four shrink-0 columns on one unwrapped row left the name
                    about 40px wide on a 360px screen. Below lg the row wraps
                    and `order` promotes the two fields a merchant actually
                    decides on — who it is and what they are worth — onto the
                    first line; points, and the action, drop underneath.
                    lg:flex-nowrap plus lg:order-none restores the desktop row
                    exactly. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap">
                  <span className="order-1 min-w-0 flex-1 lg:order-none">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-bold">
                        {c.name ?? c.phone ?? "—"}
                      </span>
                      {segmentsOf(c).map((s) => (
                        <Badge key={s} variant={segmentVariant[s]} size="sm">
                          {t.segments[s]}
                        </Badge>
                      ))}
                    </span>
                    <span className="block text-sm tabular-nums text-muted-foreground">
                      {c.phone ? <span dir="ltr">{c.phone}</span> : null}
                      {c.phone ? " · " : ""}
                      {c.count} {dict.merchant.ordersCount}
                    </span>
                  </span>
                  {points > 0 && (
                    // w-full below lg would stretch the pill itself, so the
                    // line break lives on a wrapper that lg:contents dissolves.
                    <span className="order-3 w-full lg:contents">
                      <Badge
                        variant="primary"
                        size="sm"
                        className="shrink-0 tabular-nums"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {points.toLocaleString("en-US")} {t.points}
                      </Badge>
                    </span>
                  )}
                  <span className="order-2 shrink-0 font-bold tabular-nums text-primary lg:order-none">
                    <Money value={c.total} />
                  </span>
                  {c.phone && !bookPhones.has(c.phone) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => quickAdd(c)}
                      className="order-4 flex h-11 w-full shrink-0 items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60 lg:order-none lg:h-auto lg:w-auto lg:justify-start lg:py-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.addToBook}
                    </button>
                  )}
                </div>
                {c.customerId && points > 0 && redemption?.enabled && (
                  <RedeemControl
                    storeId={storeId}
                    customerId={c.customerId}
                    balance={points}
                    pointsPerUnit={redemption.rate}
                    dict={dict}
                  />
                )}
              </CardRow>
            );
          })}
            </CardList>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
              {t.emptyDerived}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Redeem a registered customer's loyalty points (e.g. as an in-store discount).
// Points are a PER-(user, store) balance (migration 0095): this redeems from what
// the customer earned at THIS store. The server RPC re-checks that the caller
// manages the store, that the store has opted in to redemption (0107), recomputes
// the per-store balance, and caps the redemption.
function RedeemControl({
  storeId,
  customerId,
  balance,
  pointsPerUnit,
  dict,
}: {
  storeId: string;
  customerId: string;
  balance: number;
  pointsPerUnit: number;
  dict: Dictionary;
}) {
  const router = useRouter();
  const t = dict.os.crm;
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // How much discount the entered points are worth at this store's rate.
  const enteredPoints = Math.floor(Number(points)) || 0;
  const discountValue =
    pointsPerUnit > 0 ? enteredPoints / pointsPerUnit : 0;

  async function submit() {
    const p = Math.floor(Number(points));
    if (!p || p <= 0 || busy) return;
    if (p > balance) {
      notifyError(t.insufficientPoints);
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc("redeem_loyalty_points", {
      p_store_id: storeId,
      p_customer_id: customerId,
      p_points: p,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      const m = error.message ?? "";
      notifyError(
        m.includes("insufficient_points")
          ? t.insufficientPoints
          : dict.common.actionFailed,
      );
      return;
    }
    notifySuccess(t.redeemSuccess);
    setPoints("");
    setNote("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-bold transition-colors hover:border-primary hover:text-primary lg:min-h-0 lg:py-1.5"
      >
        <Gift className="h-3.5 w-3.5" />
        {t.redeem}
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-muted/50 p-3">
      <label className="text-xs font-semibold">
        <span className="mb-1 block text-muted-foreground">
          {t.redeemAmount}
          {enteredPoints > 0 && (
            <span className="ms-1 font-bold tabular-nums text-primary" dir="ltr">
              {t.redeemValue} ${discountValue.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </span>
          )}
        </span>
        <input
          type="number"
          min="1"
          max={balance}
          step="1"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="h-11 w-28 rounded-lg border border-border bg-surface px-3 text-sm tabular-nums outline-none focus:border-primary lg:h-auto lg:py-2"
        />
      </label>
      <label className="min-w-0 flex-1 text-xs font-semibold">
        <span className="mb-1 block text-muted-foreground">{t.redeemNote}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.redeemNoteHint}
          className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary lg:h-auto lg:py-2"
        />
      </label>
      <Button
        type="button"
        size="sm"
        onClick={submit}
        loading={busy}
        disabled={!points}
      >
        {t.redeemConfirm}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t.cancel}
      </Button>
    </div>
  );
}

// Merchant opt-in for this store's loyalty redemption (migration 0107): a switch
// to turn redemption on/off and the points-per-$1 conversion rate. Redemption is
// off by default, so a merchant deliberately chooses to fund it. Persisted via
// the manager-guarded set_loyalty_redemption RPC.
function RedemptionSettings({
  storeId,
  value,
  dict,
  onSaved,
}: {
  storeId: string;
  value: { enabled: boolean; rate: number };
  dict: Dictionary;
  onSaved: (v: { enabled: boolean; rate: number }) => void;
}) {
  const t = dict.os.crm;
  const [enabled, setEnabled] = useState(value.enabled);
  const [rate, setRate] = useState(String(value.rate));
  const [busy, setBusy] = useState(false);

  async function save() {
    const r = Math.floor(Number(rate));
    if (!r || r < 1 || busy) return;
    setBusy(true);
    const { error } = await createClient().rpc("set_loyalty_redemption", {
      p_store_id: storeId,
      p_enabled: enabled,
      p_points_per_unit: r,
    });
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    onSaved({ enabled, rate: r });
    notifySuccess(t.redemptionSaved);
  }

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">{t.redemptionSettings}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t.redemptionHint}
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label={t.enableRedemption}
          className="mt-0.5"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {enabled && (
          <label className="text-xs font-semibold">
            <span className="mb-1 block text-muted-foreground">
              {t.pointsPerUnit}
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              dir="ltr"
              className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
        )}
        <Button
          type="button"
          size="sm"
          onClick={save}
          loading={busy}
          disabled={!Math.floor(Number(rate))}
          className="ms-auto"
        >
          {t.save}
        </Button>
      </div>
    </section>
  );
}
