"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { Check, Clock, Truck, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatLbp, formatUsd } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import { localized } from "@/lib/i18n-field";
import { phoneIssue } from "@/lib/phone";
import { waLink, buildOrderMessage } from "@/lib/whatsapp";
import {
  buildOrderParams,
  canRedeemLoyalty,
  changeForValue,
  checkoutBlock,
  checkoutTotals,
  classifyFailure,
  fulfillmentOptions,
  initialChoices,
  selectedZone,
  type CheckoutChoices,
  type CheckoutField,
  type CheckoutItem,
  type CheckoutLine,
  type CheckoutViewer,
  type Fulfillment,
  type StoreCheckout,
} from "@/lib/checkout";
import {
  CheckoutGiftCard,
  redeemGiftCardForOrder,
} from "@/components/gift-cards/checkout-gift-card";

// THE checkout form. One per platform, not one per page.
//
// MJ-024: the store cart and the product buy box each had their own, and they
// disagreed about what a customer may supply — a coupon the merchant was
// advertising could not be typed on a product page, a merchant's required
// checkout question was collected on one route and skipped on the other, and a
// store with delivery zones could not be ordered from at all outside the cart
// (0229 made the server refuse rather than silently deliver for free). Both
// surfaces now render this, and differ only in what they put in the basket:
// the cart passes many lines with no variants, the buy box passes one line with
// a variant, its add-ons and its per-item note.
//
// What this component does NOT decide is in src/lib/checkout.ts: the totals,
// the block reasons and the RPC arguments. This file is the controls and the
// wire call, nothing more, so that a change to what a checkout charges cannot
// be made here by accident.

export type PlacedOrder = {
  orderId: string;
  /** Frozen at placement: the caller clears its cart immediately, and a total
   *  derived from a cleared cart reads $0.00 on the confirmation screen. */
  total: number;
  /** "Tell the merchant on WhatsApp", frozen for the same reason. */
  waUrl: string | null;
  /** What was ordered, frozen for the same reason — §28 wants a summary on the
   *  success screen, and by the time it renders the cart it came from is
   *  already empty. Names and counts only: the amount of record is `total`. */
  lines: readonly { id: string; name: string; quantity: number }[];
  /** What happened to a gift card applied at checkout (0310) — paid how much,
   *  or why it could not be applied. Absent when no card was entered. */
  giftCardNote?: string;
};

// min-h-11 is the 44px thumb minimum. These measured 42px at 390 — two pixels
// short is still a miss, and every one of them is on the money path.
const fieldClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";

// ===== The stages =====
//
// §25: "staged sections, not one giant form". Measured before this existed, the
// checkout was twenty-one sibling blocks in one `space-y-4` column and the
// confirm button sat 1,738px down a 844px screen — the customer scrolled past
// the summary, the coupon, the totals, the fulfilment pick, the zone, the
// address, the change, the name, the phone, the note and the merchant's own
// questions with nothing telling them where they were or how much was left.
//
// What this is NOT is a wizard. A wizard means several submits, or one submit
// reconstructed from remembered state, and this is the form that places a real
// order against place_order / place_guest_order. It stays ONE <form> with ONE
// submit; only the reading of it is staged. The blocks inside each stage are
// the same blocks in the same order — nothing was moved between stages except
// into the stage it already belonged to.
function Stage({
  n,
  title,
  action,
  children,
}: {
  n: number;
  title: string;
  /** A control that belongs to the stage's header rather than its body — only
   *  "عدّل" on the basket today. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-extrabold tabular-nums text-primary"
          >
            {n}
          </span>
          {title}
        </h3>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function CheckoutForm({
  lang,
  dict,
  store,
  viewer,
  lines,
  items,
  idempotencyKey,
  lbpRate = 0,
  onBack,
  onPlaced,
  onRemoveLine,
  onFulfillmentChange,
  editLabel,
  showCodLine = true,
  confirmNote,
  extraCustomFields,
}: {
  lang: Locale;
  dict: Dictionary;
  store: StoreCheckout;
  viewer: CheckoutViewer;
  /** The basket as the customer reads it. */
  lines: CheckoutLine[];
  /** The same basket as the RPC wants it. */
  items: CheckoutItem[];
  /** Minted by the caller when the customer ENTERS the checkout (see
   *  newIdempotencyKey). Owned there rather than here so that backing out,
   *  editing the basket and returning is a new attempt — otherwise the RPC's
   *  idempotency branch would answer the second basket with the first order. */
  idempotencyKey: string;
  lbpRate?: number;
  onBack: () => void;
  onPlaced: (order: PlacedOrder) => void;
  /** Drop one line after the server names it short. Omitted on a single-item
   *  surface, where there is nothing to drop but the order itself. */
  onRemoveLine?: (lineId: string) => void;
  /** Told when the customer switches delivery/pickup, for a caller that words
   *  something around it — the product page's cash-on-delivery panel says who
   *  the money is handed to, which is the part the shopper is picturing. */
  onFulfillmentChange?: (fulfillment: Fulfillment) => void;
  /** Wording for the "edit" affordance on the order summary. */
  editLabel?: string;
  /** The buy box carries its own cash-on-delivery panel directly above this
   *  form, so it turns this line off rather than saying it twice. */
  showCodLine?: boolean;
  /** A last line above the confirm button. */
  confirmNote?: string;
  /** Surface-specific values that ride inside p_custom_fields — today only the
   *  product page's `scheduled_for`. */
  extraCustomFields?: Record<string, string>;
}) {
  const [choices, setChoices] = useState<CheckoutChoices>(() =>
    initialChoices(store),
  );
  const [addressValue, setAddressValue] = useState(viewer.defaultAddress);
  const [changeChoice, setChangeChoice] = useState("none");
  const [changeCustom, setChangeCustom] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  // A gift card is checked before the order and spent right after it exists
  // (components/gift-cards/checkout-gift-card.tsx).
  const [giftCode, setGiftCode] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  // The line the server said was short, so the customer can drop just that one
  // instead of guessing which item blocked an otherwise fine order.
  const [shortLineId, setShortLineId] = useState<string | null>(null);

  const set = <K extends keyof CheckoutChoices>(
    key: K,
    value: CheckoutChoices[K],
  ) => setChoices((c) => ({ ...c, [key]: value }));

  const labelOf = (f: CheckoutField) => localized(f.label, f.labelEn, lang);
  const totals = checkoutTotals(store, choices, lines);
  const zone = selectedZone(store, choices);
  const options = fulfillmentOptions(store);
  const delivery = choices.fulfillment === "delivery";
  const redeemable = canRedeemLoyalty(store);
  const block = checkoutBlock(store, choices, lines, totals, labelOf);
  // Only the two minimums disable the button — they are standing conditions the
  // customer can act on by changing the basket. A missing required field is
  // reported on submit, next to the field, rather than by greying out the only
  // control that would explain why.
  const hardBlocked =
    block?.kind === "belowStoreMinimum" || block?.kind === "belowZoneMinimum";

  function blockMessage(): string | null {
    if (!block) return null;
    switch (block.kind) {
      case "belowStoreMinimum":
        return `${dict.store.belowMin} (${formatUsd(block.amount)})`;
      case "belowZoneMinimum":
        return dict.store.zoneMinWarn.replace("{n}", formatUsd(block.amount));
      case "zoneRequired":
        return dict.store.zoneRequired;
      case "missingField":
        return dict.store.fieldRequired.replace("{field}", block.label);
      default:
        return null;
    }
  }

  function failureMessage(message: string | null): string {
    const f = classifyFailure(message);
    switch (f.kind) {
      case "outOfStock": {
        if (f.productName) {
          const match = lines.find(
            (l) => l.name === f.productName || f.productName!.startsWith(l.name),
          );
          setShortLineId(match?.id ?? null);
          return dict.store.outOfStockNamed.replace("{name}", f.productName);
        }
        setShortLineId(null);
        return dict.store.outOfStock;
      }
      case "couponAlreadyUsed":
        return dict.store.couponAlreadyUsed;
      case "belowStoreMinimum":
        return dict.store.belowStoreMin;
      case "zoneRequired":
        return dict.store.zoneRequired;
      case "belowZoneMinimum":
      case "badZone":
        return dict.store.belowZoneMin;
      case "modifierRequired":
        return dict.store.modifierNeeded;
      case "rateLimited":
        return dict.store.tooManyOrders;
      default:
        return dict.auth.errorGeneric;
    }
  }

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    // Guests cannot call validate_coupon (locked to authenticated to stop code
    // enumeration). Their code is applied server-side inside place_guest_order;
    // here we accept it and say it will apply at checkout.
    if (!viewer.loggedIn) {
      setChoices((c) => ({ ...c, couponCode: code, couponDiscount: 0 }));
      setCouponMsg(dict.store.couponGuestNote);
      return;
    }
    setCouponBusy(true);
    setCouponMsg(null);
    const { data, error } = await createClient().rpc("validate_coupon", {
      p_store_id: store.storeId,
      p_code: code,
      p_subtotal: totals.subtotal,
    });
    setCouponBusy(false);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { valid: boolean; discount: number; reason: string }
      | undefined;
    if (error || !row || !row.valid) {
      const reasons: Record<string, string> = {
        invalid: dict.store.couponInvalid,
        expired: dict.store.couponExpired,
        used_up: dict.store.couponUsedUp,
        min_order: dict.store.couponMinOrder,
      };
      setCouponMsg(reasons[row?.reason ?? "invalid"] ?? dict.store.couponInvalid);
      setChoices((c) => ({ ...c, couponCode: null, couponDiscount: 0 }));
      return;
    }
    setChoices((c) => ({
      ...c,
      couponCode: code,
      couponDiscount: Number(row.discount) || 0,
    }));
    setCouponMsg(null);
  }

  const waUrl =
    store.whatsapp && lines.length
      ? waLink(
          store.whatsapp,
          buildOrderMessage({
            greeting: dict.store.waGreeting,
            storeName: store.storeName,
            lines: lines.map((l) => ({
              name: l.name,
              qty: l.quantity,
              lineTotal: formatUsd(l.unitPrice * l.quantity),
            })),
            totalLabel: dict.store.total,
            total: formatUsd(totals.subtotal),
            address: viewer.defaultAddress || null,
          }),
        )
      : null;

  // Abandoned-cart capture. Fires only from here, at the moment the customer
  // taps confirm — typing a phone number is not consent to be contacted, but
  // tapping the button that sends it to the store is. It can NEVER throw, and
  // the returned promise resolves on error too, so awaiting it cannot break the
  // order path.
  function captureCheckoutIntent(phone: string, name: string): Promise<void> {
    const trimmed = phone.trim();
    if (trimmed.length < 4 || items.length === 0) return Promise.resolve();
    try {
      return Promise.resolve(
        createClient()
          .rpc("record_checkout_intent", {
            p_store_id: store.storeId,
            p_phone: trimmed,
            p_name: name.trim() || null,
            p_items: lines.map((l) => ({
              product_id: l.id,
              name: l.name,
              quantity: l.quantity,
            })),
          })
          .then(
            () => undefined,
            () => undefined,
          ),
      );
    } catch {
      /* never affect checkout */
      return Promise.resolve();
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const blocked = blockMessage();
    if (block && blocked) {
      setOrderError(blocked);
      return;
    }
    setPlacing(true);
    setOrderError(null);
    const form = new FormData(e.currentTarget);
    const contact = {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      address: String(form.get("address") ?? ""),
      note: String(form.get("note") ?? ""),
      deliveryInstructions: String(form.get("delivery_instructions") ?? ""),
    };
    // A cash-on-delivery order is only worth placing if the merchant can reach
    // the person who placed it. The field was  with no format check,
    // so "123" was accepted and the merchant found out at the door. Blocks only
    // what is not a phone number by any reading — a foreign number still goes
    // through, because somebody ordering from abroad for family here is a real
    // customer and refusing them would be worse than a WhatsApp button that
    // happens not to work.
    if (phoneIssue(contact.phone) === "tooShort") {
      setPlacing(false);
      setOrderError(dict.store.phoneTooShort);
      return;
    }
    
    // Awaited but bounded: the intent must land BEFORE the order insert whose
    // trigger clears it, and a hung network may only delay checkout, not block
    // it. Worst case on timeout is one stale abandoned-cart nudge.
    await Promise.race([
      captureCheckoutIntent(contact.phone, contact.name),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const customFields: Record<string, string> = {};
    for (const f of store.checkoutFields) {
      const v = (choices.customFieldAnswers[f.id] ?? "").trim();
      if (v) customFields[labelOf(f)] = v;
    }

    const { rpc, params } = buildOrderParams({
      store,
      choices,
      items,
      contact,
      changeFor: changeForValue(choices, changeChoice, changeCustom),
      guest: !user,
      idempotencyKey,
      customFields,
      extraCustomFields,
    });

    const { data: orderId, error } = await supabase.rpc(rpc, params);
    // Spend the gift card only once the order exists; never throws.
    const giftCardNote =
      !error && orderId && giftCode
        ? await redeemGiftCardForOrder({ orderId: orderId as string, code: giftCode, dict })
        : undefined;
    setPlacing(false);
    // `!orderId` matters as much as `error`. Both RPCs return the new order's
    // uuid, but their idempotency branch re-selects the existing row and
    // returns whatever that finds — so a lost race, or a key that matched
    // nothing, returns NULL with no error at all. Reading only `error` turned
    // that into a confirmation screen, a cleared cart, and a customer waiting
    // for an order that was never placed.
    if (error || !orderId) {
      setOrderError(failureMessage(error?.message ?? null));
      return;
    }
    onPlaced({
      orderId: orderId as string,
      total: totals.grandTotal,
      waUrl,
      lines: lines.map((l) => ({
        id: l.id,
        name: l.name,
        quantity: l.quantity,
      })),
      giftCardNote,
    });
  }

  const showBreakdown =
    totals.couponDiscount > 0 ||
    totals.pointsDiscount > 0 ||
    totals.deliveryFee > 0;

  // Does stage 2 have anything in it? Delivery always brings the address, the
  // instructions and the change-for row, so it alone is enough; the rest are
  // the merchant's own optional blocks. Mirrors the render conditions below
  // exactly — if a block is added there, it belongs here too.
  const showFulfillmentStage =
    options.length > 1 ||
    store.branches.length > 1 ||
    !!store.prepTime ||
    !!store.paymentNote ||
    (totals.belowStoreMinimum && store.minOrder != null) ||
    delivery;

  return (
    <form onSubmit={submit} className="space-y-5">
      <Stage
        n={1}
        title={dict.store.yourOrder}
        action={
          <button
            type="button"
            onClick={onBack}
            className="relative shrink-0 text-sm font-semibold text-primary before:absolute before:-inset-x-3 before:-inset-y-3 before:content-[''] hover:underline"
          >
            {editLabel ?? dict.store.editOrder}
          </button>
        }
      >
      {/* What is being ordered — before anything asks for input. The customer
          is about to hand over money for a list they could otherwise no longer
          see. */}
      <div>
        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li
              key={l.id}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="font-semibold">{l.name}</span>
                <span className="ms-1.5 text-muted-foreground" dir="ltr">
                  ×{l.quantity}
                </span>
              </span>
              <Money
                value={l.unitPrice * l.quantity}
                cents
                className="shrink-0 text-muted-foreground"
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Coupon — most orders have none, so it is a folded question rather than
          the first field on the page. */}
      <details className="group rounded-xl border border-border">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors group-open:text-foreground hover:text-foreground">
          {choices.couponCode
            ? `${choices.couponCode} ✓`
            : dict.store.haveCoupon}
        </summary>
        <div className="px-4 pb-4">
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder={dict.store.couponCode}
              className={`${fieldClass} mt-0 flex-1 uppercase`}
            />
            <button
              type="button"
              onClick={applyCoupon}
              disabled={couponBusy || !couponInput.trim()}
              className="shrink-0 rounded-xl border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {dict.store.couponApply}
            </button>
          </div>
          {couponMsg && (
            <p className="mt-1 text-sm font-medium text-danger">{couponMsg}</p>
          )}
        </div>
      </details>

      {store.acceptsGiftCards && (
        <CheckoutGiftCard
          dict={dict}
          lang={lang}
          storeId={store.storeId}
          code={giftCode}
          onCode={setGiftCode}
        />
      )}

      {/* Loyalty redemption (store opt-in + this customer holds points here) */}
      {redeemable && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted/50 p-3">
          <input
            type="checkbox"
            checked={choices.redeemLoyalty}
            onChange={(e) => set("redeemLoyalty", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm">
            <span className="font-semibold">
              {dict.store.loyaltyRedeemTitle}
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              {dict.store.loyaltyRedeemDesc.replace(
                "{n}",
                store.loyaltyPoints.toLocaleString("en-US"),
              )}
            </span>
          </span>
        </label>
      )}

      {/* Totals */}
      <div className="space-y-1 border-t border-border pt-3 text-sm">
        {showBreakdown && (
          <div className="flex justify-between text-muted-foreground">
            <span>{dict.store.subtotal}</span>
            <Money value={totals.subtotal} cents />
          </div>
        )}
        {totals.couponDiscount > 0 && (
          <div className="flex justify-between text-primary">
            <span>{dict.store.discount}</span>
            {/* The sign rides INSIDE the isolate — "−" left outside is a bidi
                neutral and lands on the wrong end in Arabic ("$12−"). */}
            <Money value={totals.couponDiscount} cents prefix="−" />
          </div>
        )}
        {totals.pointsDiscount > 0 && (
          <div className="flex justify-between text-primary">
            <span>
              {dict.store.loyaltyDiscount.replace(
                "{n}",
                totals.pointsUsed.toLocaleString("en-US"),
              )}
            </span>
            <Money value={totals.pointsDiscount} cents prefix="−" />
          </div>
        )}
        {totals.deliveryFee > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>{dict.store.deliveryFeeLabel}</span>
            <Money value={totals.deliveryFee} cents prefix="+" />
          </div>
        )}
        <div className="flex justify-between text-lg font-extrabold">
          <span>{dict.store.total}</span>
          <Money value={totals.grandTotal} cents />
        </div>
        {lbpRate > 0 && (
          <p className="text-end text-xs font-normal text-muted-foreground">
            {formatLbp(totals.grandTotal, lbpRate, lang)}
          </p>
        )}
      </div>

      {showCodLine && (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
          <Wallet className="h-4 w-4 shrink-0" />
          {dict.store.codNote}
        </p>
      )}
      </Stage>

      {/* Rendered only when it has something in it. A pickup-only store with
          one branch and no prep note has nothing to say here, and a numbered
          heading over an empty box is worse than no heading. */}
      {showFulfillmentStage && (
      <Stage n={2} title={dict.store.fulfillment}>
      {options.length > 1 && (
        <div>
          {/* No repeated label — the stage heading above IS this question. */}
          <div className="grid grid-cols-2 gap-2">
            {options.map((opt: Fulfillment) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  set("fulfillment", opt);
                  onFulfillmentChange?.(opt);
                }}
                className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
                  choices.fulfillment === opt
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {opt === "delivery" ? dict.store.delivery : dict.store.pickup}
              </button>
            ))}
          </div>
        </div>
      )}

      {store.branches.length > 1 && (
        <div>
          <label className="text-sm font-semibold" htmlFor="branch">
            {dict.store.chooseBranch}
          </label>
          <select
            id="branch"
            required
            value={choices.branchId}
            onChange={(e) => set("branchId", e.target.value)}
            className={fieldClass}
          >
            {store.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.area || b.address || "—"}
              </option>
            ))}
          </select>
        </div>
      )}

      {(store.prepTime || store.paymentNote) && (
        <div className="space-y-1 rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-muted-foreground">
          {store.prepTime && (
            <p>
              <span className="font-semibold">{dict.store.prep}:</span>{" "}
              {store.prepTime}
            </p>
          )}
          {store.paymentNote && (
            <p>
              <span className="font-semibold">{dict.store.payment}:</span>{" "}
              {store.paymentNote}
            </p>
          )}
        </div>
      )}

      {totals.belowStoreMinimum && store.minOrder != null && (
        <p className="rounded-xl bg-danger-soft px-4 py-2.5 text-sm font-semibold text-danger">
          {dict.store.belowMin} ({formatUsd(store.minOrder)})
        </p>
      )}

      {delivery && store.zones.length > 0 && (
        <div>
          <label className="text-sm font-semibold" htmlFor="dzone">
            {dict.store.deliveryZone}
          </label>
          <select
            id="dzone"
            required
            value={choices.zoneId}
            onChange={(e) => set("zoneId", e.target.value)}
            className={fieldClass}
          >
            {store.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {lang === "en" && z.nameEn?.trim() ? z.nameEn : z.name}
                {" — "}
                {z.fee > 0 ? formatUsd(z.fee) : dict.store.freeDelivery}
              </option>
            ))}
          </select>
          {zone && (
            <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {zone.etaMin != null && zone.etaMax != null && (
                <p className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  {dict.store.zoneEta
                    .replace("{min}", String(zone.etaMin))
                    .replace("{max}", String(zone.etaMax))}
                </p>
              )}
              {zone.freeOver != null && totals.deliveryFee > 0 && (
                <p className="flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 shrink-0" />
                  {dict.store.freeOverHint.replace(
                    "{n}",
                    formatUsd(zone.freeOver),
                  )}
                </p>
              )}
              {totals.deliveryFee === 0 && zone.freeOver != null && (
                <p className="flex items-center gap-1.5 font-semibold text-success">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  {dict.store.freeDeliveryApplied}
                </p>
              )}
            </div>
          )}
          {totals.belowZoneMinimum && zone?.minOrder != null && (
            <p className="mt-1.5 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
              {dict.store.zoneMinWarn.replace("{n}", formatUsd(zone.minOrder))}
            </p>
          )}
        </div>
      )}

      {delivery && (
        <div>
          <label className="text-sm font-semibold" htmlFor="address">
            {dict.store.address}
          </label>
          {viewer.savedAddresses.length > 1 && (
            <select
              aria-label={dict.account.address.useSaved}
              className={fieldClass}
              value={
                viewer.savedAddresses.some((a) => a.value === addressValue)
                  ? addressValue
                  : ""
              }
              onChange={(e) => setAddressValue(e.target.value)}
            >
              <option value="">{dict.account.address.useSaved}</option>
              {viewer.savedAddresses.map((a, i) => (
                <option key={i} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
          <input
            id="address"
            name="address"
            type="text"
            required
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            placeholder={dict.store.addressPlaceholder}
            className={fieldClass}
          />
        </div>
      )}

      {delivery && (
        <div>
          <label
            className="text-sm font-semibold"
            htmlFor="delivery_instructions"
          >
            {dict.store.deliveryInstructions}
          </label>
          <input
            id="delivery_instructions"
            name="delivery_instructions"
            type="text"
            placeholder={dict.store.deliveryInstructionsPlaceholder}
            className={fieldClass}
          />
        </div>
      )}

      {delivery && (
        <div>
          <span className="text-sm font-semibold">{dict.store.changeFor}</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {[
              { v: "none", label: dict.store.noChange },
              { v: "20", label: "$20" },
              { v: "50", label: "$50" },
              { v: "100", label: "$100" },
              { v: "custom", label: dict.store.changeCustom },
            ].map((c) => (
              <button
                key={c.v}
                type="button"
                onClick={() => setChangeChoice(c.v)}
                className={`relative rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors before:absolute before:-inset-y-2 before:content-[''] ${
                  changeChoice === c.v
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {c.label}
              </button>
            ))}
            {changeChoice === "custom" && (
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={changeCustom}
                onChange={(e) => setChangeCustom(e.target.value)}
                placeholder="$"
                className="w-24 rounded-full border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            )}
          </div>
        </div>
      )}
      </Stage>
      )}

      <Stage n={showFulfillmentStage ? 3 : 2} title={dict.store.yourDetails}>
      {!viewer.loggedIn && (
        <div>
          <label className="text-sm font-semibold" htmlFor="name">
            {dict.store.name}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder={dict.store.namePlaceholder}
            className={fieldClass}
          />
        </div>
      )}

      <div>
        <label className="text-sm font-semibold" htmlFor="phone">
          {dict.store.phone}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          required
          placeholder="+961 …"
          className={fieldClass}
        />
        {/* MP-007: the number is shared with the store at confirm time, and the
            store may follow up. Said on every checkout, not just the cart. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.store.checkoutPhoneNote}
        </p>
      </div>

      <div>
        <label className="text-sm font-semibold" htmlFor="note">
          {dict.store.note}
        </label>
        <textarea
          id="note"
          name="note"
          rows={2}
          placeholder={dict.store.notePlaceholder}
          className={fieldClass}
        />
      </div>

      {/* Merchant-defined custom fields (gift note, floor number, …). */}
      {store.checkoutFields.map((f) => {
        const val = choices.customFieldAnswers[f.id] ?? "";
        const setAnswer = (v: string) =>
          setChoices((c) => ({
            ...c,
            customFieldAnswers: { ...c.customFieldAnswers, [f.id]: v },
          }));
        return (
          <div key={f.id}>
            <label className="text-sm font-semibold" htmlFor={`cf_${f.id}`}>
              {labelOf(f)}
              {f.required && <span className="ms-1 text-danger">*</span>}
            </label>
            {f.fieldType === "textarea" ? (
              <textarea
                id={`cf_${f.id}`}
                rows={2}
                value={val}
                onChange={(e) => setAnswer(e.target.value)}
                className={fieldClass}
              />
            ) : f.fieldType === "select" ? (
              <select
                id={`cf_${f.id}`}
                value={val}
                onChange={(e) => setAnswer(e.target.value)}
                className={fieldClass}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`cf_${f.id}`}
                type="text"
                value={val}
                onChange={(e) => setAnswer(e.target.value)}
                className={fieldClass}
              />
            )}
          </div>
        );
      })}

      {!viewer.loggedIn && (
        <p className="text-xs text-muted-foreground">
          {dict.store.guestHint}{" "}
          <Link
            href={`/${lang}/login`}
            className="font-semibold text-primary hover:underline"
          >
            {dict.store.guestLogin}
          </Link>
        </p>
      )}
      </Stage>

      {orderError && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-danger">{orderError}</p>
          {/* The order is atomic, so we cannot silently ship a partial basket —
              but the customer's intent is to buy the rest, so make that one tap
              instead of a hunt through the cart. */}
          {shortLineId && onRemoveLine && (
            <button
              type="button"
              onClick={() => {
                onRemoveLine(shortLineId);
                setShortLineId(null);
                setOrderError(null);
              }}
              className="relative inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-bold whitespace-nowrap text-primary-foreground shadow-sm transition-[transform,box-shadow,background-color] duration-150 select-none hover:bg-primary-hover hover:shadow-md active:scale-[0.97]"
            >
              {dict.store.removeAndContinue}
            </button>
          )}
        </div>
      )}

      {confirmNote && (
        <p className="text-xs font-semibold text-success">{confirmNote}</p>
      )}

      {/* Desktop keeps exactly the row it always had — §44. */}
      <div className="hidden gap-2 lg:flex">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-surface-muted"
        >
          {dict.store.back}
        </button>
        <button
          type="submit"
          disabled={placing || hardBlocked}
          className="sf-buy flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {placing ? dict.store.placing : dict.store.confirmOrder}
        </button>
      </div>

      {/* Phones: the confirm follows the thumb, and carries the amount.
          Measured before this existed, the confirm button sat at y=1738 on an
          844px screen while the total was stated once, near the top, and
          scrolled away 1,200px earlier — so the last thing a cash-on-delivery
          customer saw before committing was a button with no number on it.
          §25: "the final amount must always be clear".

          The figure comes from `totals.grandTotal`, the same value the button
          places and the same one the totals block prints. There is no second
          arithmetic here and no second submit: this IS the form's submit
          button, moved, and the in-flow row above is hidden below `lg` so
          exactly one is ever present.

          z-[45] and an opaque background on purpose. The store profile's own
          sticky CTA and the product page's buy bar both sit at
          `bottom-[var(--m-tabbar-h)] z-40` with identical geometry, and one of
          them can still be on screen behind this. Sitting one layer above with
          a solid surface replaces that bar rather than stacking a second one
          on top of it — and stays under the tab bar's z-50, which must never
          be covered. */}
      <div className="fixed inset-x-0 bottom-[var(--m-tabbar-h)] z-[45] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-[var(--m-sticky-gap)] px-[var(--m-page-x)] py-2.5">
          <button
            type="button"
            onClick={onBack}
            className="h-[var(--m-touch)] shrink-0 rounded-xl border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted"
          >
            {dict.store.back}
          </button>
          <button
            type="submit"
            disabled={placing || hardBlocked}
            className="sf-buy flex h-[var(--m-touch)] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-[transform,background-color] duration-150 select-none hover:bg-primary-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
          >
            {placing ? (
              dict.store.placing
            ) : (
              <>
                <span className="truncate">{dict.store.confirmOrder}</span>
                <span aria-hidden>·</span>
                <Money value={totals.grandTotal} cents />
              </>
            )}
          </button>
        </div>
      </div>
      {/* Room for that bar, so the merchant's last custom field is never
          trapped underneath it. */}
      <div aria-hidden className="h-16 lg:hidden" />
    </form>
  );
}
