"use client";

import { useEffect, useState } from "react";
import { ChevronUp, Phone } from "lucide-react";
import { CART_EVENT, cartCount, cartKey, readCart } from "@/lib/store-cart";

// The store's primary action, kept under the thumb.
//
// A storefront on a phone opens on identity — cover, name, badges, hours — and
// the thing the customer came to do (order, book) is a section further down. The
// action follows them until they reach it.
//
// It renders on the server (so it is in the first paint and works before
// hydration) and an IntersectionObserver hides it once the real engine is on
// screen — the bar never covers the control it points at, and it never clones
// that control's logic: it scrolls to it. Cart rules, variants, slot allocation
// and provider matching stay in exactly one place.
//
// Geometry matches the other two sticky bars on this app (order-sticky-actions,
// product-buy-bar): it sits on top of the tab bar's own height and adds the home
// indicator inset, so it can never cover a tab or be trapped under one.
export function StoreStickyCta({
  targetId,
  storeId,
  href,
  label,
  note,
}: {
  /** Scroll to this section. Omitted for an outbound action. */
  targetId?: string;
  /** Hide while this store's basket (`matjar-cart-<storeId>`) has items. */
  storeId?: string;
  /**
   * An outbound action instead of a scroll — `tel:` or `wa.me`.
   *
   * Four of fifteen live storefronts have no catalogue, no booking engine and
   * no request form, so there was no section to scroll to and they rendered no
   * sticky action at all. Every one of them has a phone number and a WhatsApp
   * number: the action existed, it just was not offered. On a page with nothing
   * to sell, "ring the shop" IS the transaction.
   *
   * Such a bar never hides. The observer exists so the bar cannot cover the
   * control it points at, and an outbound link has no on-page control to cover
   * — nor, on these pages, much content to sit on top of.
   */
  href?: string;
  label: string;
  /** A true one-line fact — the store name, "starts from $x". Never a promise. */
  note?: string | null;
}) {
  // Two independent reasons to step aside, tracked separately so one cannot
  // undo the other: the catalogue / booking area is on screen (the bar would
  // cover the very control it points at, or pull the customer away from a
  // half-filled booking form), or the store's basket has something in it (the
  // cart bar owns the bottom of the screen then — two stacked bars hid the
  // checkout button on a phone).
  const [inView, setInView] = useState(false);
  const [hasCart, setHasCart] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    // The heading is one line; the area under it (grid, cart, booking steps)
    // is the section wrapper the page puts around it (`sec-<key>`).
    const area = target.closest<HTMLElement>('[id^="sec-"]');
    const watched = area && area !== target ? [target, area] : [target];
    const visible = new Set<Element>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setInView(visible.size > 0);
      },
      { threshold: 0 },
    );
    watched.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [targetId]);

  useEffect(() => {
    if (!storeId) return;
    const sync = () => setHasCart(cartCount(readCart(storeId)) > 0);
    // localStorage exists only after mount — reading it here, once, is the
    // documented way to avoid an SSR/hydration mismatch.
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === cartKey(storeId)) sync();
    };
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [storeId]);

  const show = !inView && !hasCart;

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-[var(--m-tabbar-h)] z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden print:hidden">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-[var(--m-sticky-gap)] px-[var(--m-page-x)] py-2.5">
        {note ? (
          <p className="min-w-0 truncate text-sm font-semibold text-muted-foreground">
            {note}
          </p>
        ) : (
          <span />
        )}
        <a
          href={href ?? `#${targetId}`}
          {...(href
            ? // Outbound (tel:/wa.me). WhatsApp opens a different app, so it
              // gets the usual new-context hardening; tel: is harmless either
              // way and sharing one branch keeps the two from drifting.
              { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          onClick={(e) => {
            if (href || !targetId) return; // outbound: let the browser take it
            // Smooth-scroll where the browser supports it, but keep the href so
            // the bar still works with JS off and reads as a link.
            const el = document.getElementById(targetId);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="inline-flex h-[var(--m-touch)] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold whitespace-nowrap text-primary-foreground shadow-sm transition-transform active:scale-[0.97]"
        >
          {href ? (
            <Phone className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
          {label}
        </a>
      </div>
    </div>
  );
}
