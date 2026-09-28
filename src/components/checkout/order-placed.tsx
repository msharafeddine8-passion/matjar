"use client";

import Link from "next/link";
import { Check, MessageCircle, Store as StoreIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { PlacedOrder } from "@/components/checkout/checkout-form";
import { TagSource } from "@/components/attribution/tag-source";

// What a customer sees the moment an order exists — the same screen whichever
// page placed it.
//
// The product page used to answer a successful order with `router.push('/orders')`
// and nothing else. That was wrong twice over: a guest has no /orders to be
// pushed to (which is part of why the buy box refused guests at all), and even
// a signed-in customer was handed a list and left to find their own row. Both
// surfaces now end here, so the reference number, the amount and the "tell the
// merchant" button are not a property of the route the order came in through.
export function OrderPlaced({
  lang,
  dict,
  order,
  loggedIn,
  storeName = null,
}: {
  lang: Locale;
  dict: Dictionary;
  order: PlacedOrder;
  loggedIn: boolean;
  /** WHO the order went to. §28 asks a success screen for reference, merchant,
   *  summary, status and what happens next; this screen had three of the five
   *  and named nobody. On a platform where the next thing that happens is a
   *  merchant phoning you, the shop's name is not decoration — it is how the
   *  customer recognises the call. Read from the caller's own checkout context
   *  (`store.storeName` / `checkout.storeName`), never invented; omitted, the
   *  line simply does not render. */
  storeName?: string | null;
}) {
  // `lines` rides on the placed order rather than arriving as a prop, for the
  // same reason `total` does: the caller clears its cart on the line after
  // this component is handed the result, so anything derived from that cart
  // reads empty here. Frozen at placement, it cannot.
  const { orderId, total, waUrl, lines, giftCardNote } = order;
  return (
    <div className="mt-6 rounded-2xl border border-success/30 bg-success-soft p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-strong text-success-strong-foreground">
        <Check className="h-6 w-6" />
      </div>
      {/* Source attribution + transaction_completed (0312); renders nothing. */}
      <TagSource kind="order" orderId={orderId} />
      <h3 className="mt-3 text-lg font-extrabold">
        {dict.store.orderPlacedTitle}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {dict.store.orderPlacedNote}
      </p>

      {/* The reference, as text a customer can keep. The tracking link below
          only helps someone who still has the tab; a cash-on-delivery buyer who
          closes it had nothing at all to quote. These are the same 8 characters
          the merchant sees on their orders screen, so reading it down the phone
          resolves to the same order. */}
      {orderId && (
        <div className="mx-auto mt-4 max-w-xs rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground">
            {dict.os.track.orderRef}
          </p>
          <p
            dir="ltr"
            className="mt-0.5 select-all text-xl font-extrabold tracking-wider"
          >
            #{orderId.slice(0, 8)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {dict.os.track.orderRefHint}
          </p>
        </div>
      )}

      {/* What was paid, and what happens now — the two questions the customer
          actually has at this exact moment. */}
      <div className="mx-auto mt-4 max-w-xs rounded-xl border border-border bg-surface px-4 py-3 text-start">
        {/* Icon rather than a label, exactly as /orders/[id] names the shop —
            "المتجر" reads wrong above a clinic, and the icon carries the
            meaning in both locales without inventing a noun for the sector. */}
        {storeName && (
          <p className="mb-2 flex items-center gap-1.5 border-b border-border pb-2 text-sm font-bold">
            <StoreIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span dir="auto" className="min-w-0 truncate">
              {storeName}
            </span>
          </p>
        )}
        {lines.length > 0 && (
          <ul className="mb-2 space-y-1 border-b border-border pb-2">
            {lines.map((l) => (
              <li
                key={l.id}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span dir="auto" className="min-w-0 truncate">
                  {l.name}
                </span>
                <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
                  ×{l.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {dict.store.total}
          </span>
          <Money value={total} cents className="text-lg font-extrabold" />
        </div>
        {/* A gift card applied at checkout is a PAYMENT on the order (0310):
            the total above stays the amount of record; this line says what
            the card paid and what is left, or why it was not applied. */}
        {giftCardNote && (
          <p className="mt-2 border-t border-border pt-2 text-sm font-semibold">{giftCardNote}</p>
        )}
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {dict.orders.nextPending}
        </p>
      </div>

      <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        {waUrl && (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "whatsapp" })}
          >
            <MessageCircle className="h-4 w-4" />
            {dict.store.notifyMerchantWa}
          </a>
        )}
        {/* The order they JUST placed, not the list it landed in — each through
            the route their own session can read. */}
        {loggedIn ? (
          <Link
            href={
              orderId ? `/${lang}/orders/${orderId}` : `/${lang}/orders`
            }
            className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
          >
            {orderId ? dict.os.track.trackLink : dict.store.viewMyOrders}
          </Link>
        ) : (
          orderId && (
            <Link
              href={`/${lang}/track/${orderId}`}
              className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
            >
              {dict.os.track.trackLink}
            </Link>
          )
        )}
      </div>
      {!loggedIn && orderId && (
        <p className="mt-3 text-xs font-semibold text-muted-foreground">
          {dict.os.track.saveLink}
        </p>
      )}
    </div>
  );
}
