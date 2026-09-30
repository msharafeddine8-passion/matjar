"use client";

import { useState } from "react";
import { Minus, Plus, ShoppingCart, Wallet } from "lucide-react";
import { noteHintKey } from "@/lib/note-hint";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatLbp } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import {
  CheckoutForm,
  type PlacedOrder,
} from "@/components/checkout/checkout-form";
import { OrderPlaced } from "@/components/checkout/order-placed";
import {
  fulfillmentOptions,
  newIdempotencyKey,
  type CheckoutItem,
  type CheckoutLine,
  type CheckoutViewer,
  type StoreCheckout,
} from "@/lib/checkout";
import { assertAddableToCart, type OfferingExperience } from "@/lib/offering";

export type Variant = {
  id: string;
  label: string;
  price: number | null;
  stock: number | null;
  is_available: boolean;
  color: string | null;
  size: string | null;
  /** A service option's own duration in minutes (0321); goods leave it null. */
  durationMinutes?: number | null;
};
export type AddOn = {
  id: string;
  name: string;
  price: number;
  groupId?: string | null;
};
export type ModifierGroup = {
  id: string;
  name: string;
  nameEn: string | null;
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
};

// min-h-11 is the 44px thumb target. Measured at 390 these rendered 42px —
// close enough to look right and short enough to miss, which is the worst kind
// of near-miss. Same constant the booking panel's fields already carry.
const fieldClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";

export function ProductOrder({
  lang,
  dict,
  productId,
  productName,
  checkout,
  viewer,
  basePrice,
  stock,
  variants,
  addons,
  modifierGroups = [],
  allowScheduling = false,
  lbpRate = 0,
  category = null,
  ctaLabel,
  offering,
  soldOutLabel,
}: {
  lang: Locale;
  dict: Dictionary;
  productId: string;
  /** The line name on the order summary and in the WhatsApp message. */
  productName: string;
  /**
   * This store's checkout — the SAME object the store cart is handed. Before
   * MJ-024 the buy box was given four booleans and built its own RPC call,
   * which is how it came to omit the delivery zone, the coupon, the loyalty
   * opt-in, the merchant's custom fields and the guest path all at once.
   */
  checkout: StoreCheckout;
  viewer: CheckoutViewer;
  basePrice: number;
  stock: number | null;
  variants: Variant[];
  addons: AddOn[];
  modifierGroups?: ModifierGroup[];
  allowScheduling?: boolean;
  lbpRate?: number;
  /** Store sector — decides which note example the shopper is shown. */
  category?: string | null;
  /** Primary CTA wording chosen by the offering resolver: "أضف إلى السلة" for a
   *  good, "أضف إلى الطلب" for a menu item. Omitted = the generic order label. */
  ctaLabel?: string;
  /** The resolved offering. The buy box is the only place a product page can
   *  build a basket, so it asks the resolver's one cart test itself before it
   *  opens the checkout — a service handed to this component by mistake gets
   *  the resolver's refusal, not an order. */
  offering?: Pick<OfferingExperience, "addableToCart" | "cta">;
  /** Sold-out wording in the offering's own noun ("نفد المخزون" for a good,
   *  "مش متوفّر هلّق" for a dish). Omitted = the retail phrase. */
  soldOutLabel?: string;
}) {
  // Apparel variants carry color/size → render a 2-step picker; legacy flat
  // variants (no color/size) keep the single pill row.
  const structured =
    variants.length > 0 && variants.some((v) => v.color || v.size);
  const colors = structured
    ? [
        ...new Set(
          variants.filter((v) => v.color).map((v) => v.color as string),
        ),
      ]
    : [];
  const [variantId, setVariantId] = useState<string | null>(
    structured ? null : (variants[0]?.id ?? null),
  );
  const [selectedColor, setSelectedColor] = useState<string | null>(
    colors[0] ?? null,
  );
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [itemNote, setItemNote] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [qty, setQty] = useState(1);
  const [checkingOut, setCheckingOut] = useState(false);
  // One key per checkout attempt, minted when the customer opens the checkout.
  const [attemptKey, setAttemptKey] = useState(newIdempotencyKey);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // A mirror of the shared form's fulfilment pick, used ONLY to word the
  // cash-on-delivery panel below — who the customer hands the money to is the
  // part they are actually picturing. The choice itself, and the sending of it,
  // belong to the form; this listens.
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">(
    fulfillmentOptions(checkout)[0] ?? "delivery",
  );

  const variant = variants.find((v) => v.id === variantId) ?? null;
  // Sizes offered for the chosen color (or all variants when there's no color
  // axis, i.e. size-only products).
  const sizesForColor = colors.length
    ? variants.filter((v) => v.color === selectedColor)
    : variants;
  const hasSizeAxis = sizesForColor.some((v) => v.size);
  // A structured product needs an explicit final pick before it can be ordered.
  const mustPick = structured && variantId === null;
  const variantStock = variant ? variant.stock : stock;
  const soldOut =
    mustPick ||
    (variant ? !variant.is_available : false) ||
    (variantStock != null && variantStock <= 0);
  const maxQty = variantStock ?? Infinity;

  const unitBase = variant?.price ?? basePrice;
  const addonsSum = addons
    .filter((a) => selectedAddons.includes(a.id))
    .reduce((s, a) => s + a.price, 0);
  const unitPrice = unitBase + addonsSum;
  const total = unitPrice * qty;

  // Modifier groups (food): options carry a groupId; ungrouped options are flat
  // add-ons rendered as before. Selection rules (required / min / max) are
  // enforced here for UX and re-enforced server-side in the order RPC.
  const groupedAddons = (id: string) => addons.filter((a) => a.groupId === id);
  const ungroupedAddons = addons.filter((a) => !a.groupId);
  const selectedInGroup = (id: string) =>
    groupedAddons(id).filter((a) => selectedAddons.includes(a.id)).length;
  const groupFloor = (g: ModifierGroup) =>
    Math.max(g.minSelect, g.required ? 1 : 0);
  const unmetGroup = modifierGroups.find(
    (g) => selectedInGroup(g.id) < groupFloor(g),
  );
  const modifiersOk = !unmetGroup;

  function toggleAddon(id: string) {
    const addon = addons.find((a) => a.id === id);
    const group = addon?.groupId
      ? modifierGroups.find((g) => g.id === addon.groupId)
      : null;
    setSelectedAddons((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (group) {
        const inGroup = addons
          .filter((a) => a.groupId === group.id)
          .map((a) => a.id);
        const chosen = s.filter((x) => inGroup.includes(x));
        // Single-select group (max 1): replace the current pick.
        if (group.maxSelect === 1) {
          return [...s.filter((x) => !inGroup.includes(x)), id];
        }
        // Multi-select with a cap: ignore clicks past the max.
        if (group.maxSelect != null && chosen.length >= group.maxSelect) {
          return s;
        }
      }
      return [...s, id];
    });
  }

  // The basket, in the two shapes a checkout needs. This is the whole reason
  // the buy box exists as a separate surface: it is the only one that can name
  // a variant, its add-ons and a per-item note, and both RPCs have priced all
  // three since 0194/0221. Everything else about the checkout — the zone, the
  // coupon, the loyalty opt-in, the merchant's custom fields, the guest path —
  // is the shared form's, and is no longer this component's business.
  const orderItems: CheckoutItem[] = [
    {
      product_id: productId,
      quantity: qty,
      variant_id: variantId,
      addon_ids: selectedAddons,
      note: itemNote.trim() || undefined,
    },
  ];
  const chosenAddons = addons.filter((a) => selectedAddons.includes(a.id));
  const lines: CheckoutLine[] = [
    {
      id: productId,
      // Read back the way the merchant will read it on the order: the variant
      // and the add-ons are what distinguish this line from the same product
      // ordered differently. The server builds the stored name the same way.
      name: [
        productName,
        variant ? ` - ${variant.label}` : "",
        chosenAddons.length
          ? ` (+ ${chosenAddons.map((a) => a.name).join(", ")})`
          : "",
      ].join(""),
      quantity: qty,
      unitPrice: unitPrice,
    },
  ];
  // Schedule-for-later rides inside p_custom_fields, which is where 0194 reads
  // it from. Unparseable or past values are dropped server-side.
  const extraCustomFields =
    allowScheduling && scheduledFor
      ? { scheduled_for: new Date(scheduledFor).toISOString() }
      : undefined;

  function startCheckout() {
    // Throws for a service or a directory-only row. Nothing below this line
    // may run for an offering the resolver says has no basket.
    if (offering) assertAddableToCart(offering);
    setAttemptKey(newIdempotencyKey());
    setCheckingOut(true);
  }

  // Same test, rendered: a page that handed a non-addable offering to the buy
  // box gets the honest sentence instead of a quantity stepper. After the
  // hooks above on purpose — React needs them called in the same order.
  if (offering && !offering.addableToCart) {
    return (
      <p className="text-sm text-muted-foreground">{dict.offering.notAddable}</p>
    );
  }

  // The order exists. Same confirmation the store cart shows — the reference,
  // the amount, the "tell the merchant on WhatsApp" button and a tracking link
  // the session can actually read. This surface used to answer a placed order
  // with a push to /orders, which a guest has no use for at all.
  if (placed) {
    return (
      <OrderPlaced
        lang={lang}
        dict={dict}
        order={placed}
        loggedIn={viewer.loggedIn}
        storeName={checkout.storeName}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Variants — apparel: color → size; legacy: single pill row */}
      {structured ? (
        <div className="space-y-4">
          {colors.length > 0 && (
            <div>
              <span className="text-sm font-semibold">
                {dict.product.selectColor}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {colors.map((c) => {
                  const vs = variants.filter((v) => v.color === c);
                  const cOut = vs.every(
                    (v) => !v.is_available || (v.stock != null && v.stock <= 0),
                  );
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={cOut}
                      onClick={() => {
                        setSelectedColor(c);
                        // Color-only (single variant) selects it directly;
                        // otherwise wait for a size pick.
                        setVariantId(vs.length === 1 ? vs[0].id : null);
                      }}
                      className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:line-through disabled:opacity-40 ${
                        selectedColor === c
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {hasSizeAxis && (
            <div>
              <span className="text-sm font-semibold">
                {dict.product.selectSize}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {sizesForColor.map((v) => {
                  const vOut =
                    !v.is_available || (v.stock != null && v.stock <= 0);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={vOut}
                      onClick={() => {
                        setVariantId(v.id);
                        if (v.stock != null)
                          setQty((q) => Math.min(q, Math.max(1, v.stock!)));
                      }}
                      className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:line-through disabled:opacity-40 ${
                        variantId === v.id
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      {v.size ?? v.label}
                      {v.price != null && (
                        <span className="ms-1 text-xs font-normal text-muted-foreground">
                          <Money value={v.price} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {mustPick && (
            <p className="text-xs font-semibold text-muted-foreground">
              {hasSizeAxis
                ? dict.product.pickSizeHint
                : dict.product.pickColorHint}
            </p>
          )}
        </div>
      ) : (
        variants.length > 0 && (
          <div>
            <span className="text-sm font-semibold">
              {dict.product.selectVariant}
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {variants.map((v) => {
                const vOut =
                  !v.is_available || (v.stock != null && v.stock <= 0);
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={vOut}
                    onClick={() => {
                      setVariantId(v.id);
                      if (v.stock != null)
                        setQty((q) => Math.min(q, Math.max(1, v.stock!)));
                    }}
                    className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      variantId === v.id
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {v.label}
                    {v.price != null && (
                      <span className="ms-1 text-xs font-normal text-muted-foreground">
                        <Money value={v.price} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Modifier groups (food): each group its own selection rules */}
      {modifierGroups.map((g) => {
        const opts = groupedAddons(g.id);
        if (opts.length === 0) return null;
        const single = g.maxSelect === 1;
        const label = lang === "en" && g.nameEn?.trim() ? g.nameEn : g.name;
        const floor = groupFloor(g);
        const hint = single
          ? floor >= 1
            ? dict.product.modRequiredOne
            : dict.product.modPickOne
          : g.maxSelect != null
            ? dict.product.modUpTo.replace("{n}", String(g.maxSelect))
            : floor >= 1
              ? dict.product.modAtLeast.replace("{n}", String(floor))
              : dict.product.modOptional;
        const unmet = selectedInGroup(g.id) < floor;
        return (
          <div key={g.id}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{label}</span>
              <span
                className={`text-xs font-semibold ${unmet ? "text-danger" : "text-muted-foreground"}`}
              >
                {hint}
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {opts.map((a) => {
                const checked = selectedAddons.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                      checked
                        ? "border-primary bg-primary-soft"
                        : "border-border"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={`mod-${g.id}`}
                        checked={checked}
                        onChange={() => toggleAddon(a.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      {a.name}
                    </span>
                    {a.price > 0 && (
                      <Money
                        value={a.price}
                        prefix="+ "
                        className="font-bold text-primary"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Flat add-ons (no group) */}
      {ungroupedAddons.length > 0 && (
        <div>
          <span className="text-sm font-semibold">{dict.product.addons}</span>
          <div className="mt-2 space-y-2">
            {ungroupedAddons.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center justify-between rounded-xl border border-border px-4 py-2.5 text-sm"
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={selectedAddons.includes(a.id)}
                    onChange={() => toggleAddon(a.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  {a.name}
                </span>
                <Money
                  value={a.price}
                  prefix="+ "
                  className="font-bold text-primary"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Per-item special instructions */}
      <div>
        <label className="text-sm font-semibold" htmlFor="item-note">
          {dict.product.itemNote}
        </label>
        <input
          id="item-note"
          value={itemNote}
          onChange={(e) => setItemNote(e.target.value)}
          placeholder={
            (dict.product.itemNoteHints as Record<string, string>)[
              noteHintKey(category)
            ] ?? dict.product.itemNotePlaceholder
          }
          className={fieldClass}
        />
      </div>

      {/* Schedule for later (food) */}
      {allowScheduling && (
        <div>
          <label className="text-sm font-semibold" htmlFor="scheduled-for">
            {dict.product.scheduleFor}
          </label>
          <input
            id="scheduled-for"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className={fieldClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {dict.product.scheduleHint}
          </p>
        </div>
      )}

      {/* How payment works — said, not implied.
          The absence of a card field is not a promise; a Lebanese shopper who
          has never used this site reads "online order" as "give a stranger your
          card". So the fact that decides the order is written directly above the
          button that places it, on the product page as well as in the cart, and
          again on the confirmation step where the phone and address are asked
          for. It carries no store data and no condition: cash on receipt is how
          every order on the platform is settled. */}
      <div className="flex items-start gap-2.5 rounded-xl bg-success-soft px-3.5 py-3 text-success">
        <Wallet className="mt-0.5 h-4.5 w-4.5 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-bold">{dict.product.codTitle}</span>
          <span className="mt-0.5 block text-xs leading-relaxed">
            {/* Before the fulfilment pick the line has to hold for both modes;
                after it, say the specific one — who the customer hands the money
                to is the part they are actually picturing. */}
            {!checkingOut
              ? dict.product.codBody
              : fulfillment === "pickup"
                ? dict.product.codPickup
                : dict.product.codDelivery}
          </span>
        </span>
      </div>

      {/* Quantity + total */}
      {!checkingOut && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {dict.product.quantity}
            </span>
            {/* 36 × 36 measured at 390 — the two most-tapped controls in the
                buy box, both under the 44px minimum. The design wants the small
                square, so the hit area grows with a transparent pseudo-element
                instead of the button (36 + 2×4 = 44), which is exactly what
                store/quantity-stepper.tsx already does for the cart. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-surface-muted"
                aria-label="-"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span dir="ltr" className="w-6 text-center font-bold tabular-nums">
                {qty}
              </span>
              <button
                type="button"
                disabled={qty >= maxQty}
                onClick={() => setQty((q) => q + 1)}
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-surface-muted disabled:opacity-40"
                aria-label="+"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              {/* The amount goes through <Money> rather than a bare
                  formatUsd(): the label and the figure sit in one RTL run, and
                  an unisolated "$22.17" reorders against it. */}
              <span className="text-lg font-extrabold">
                {dict.product.total}: <Money value={total} />
              </span>
              {lbpRate > 0 && (
                <p className="text-xs text-muted-foreground">
                  {formatLbp(total, lbpRate, lang)}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={soldOut || !modifiersOk}
              onClick={startCheckout}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShoppingCart className="h-4 w-4" />
              {soldOut
                ? (soldOutLabel ?? dict.product.outOfStock)
                : !modifiersOk
                  ? dict.product.modChoose
                  : (ctaLabel ?? dict.product.buyNow)}
            </button>
          </div>
        </>
      )}

      {/* Checkout — the same form the store cart uses. Everything it asks for
          (zone, coupon, loyalty, branch, change, the merchant own fields) is
          asked here too, and a guest is no longer bounced to /login. */}
      {checkingOut && (
        <div className="border-t border-border pt-4">
          <CheckoutForm
            lang={lang}
            dict={dict}
            store={checkout}
            viewer={viewer}
            lines={lines}
            items={orderItems}
            idempotencyKey={attemptKey}
            lbpRate={lbpRate}
            editLabel={dict.store.back}
            onBack={() => setCheckingOut(false)}
            onFulfillmentChange={setFulfillment}
            onPlaced={setPlaced}
            extraCustomFields={extraCustomFields}
            // The buy box carries its own cash-on-delivery panel a few lines
            // above, so the form does not say it a second time.
            showCodLine={false}
            confirmNote={dict.product.codConfirmNote}
          />
        </div>
      )}
    </div>
  );
}