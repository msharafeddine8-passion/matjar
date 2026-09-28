"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart, MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { categoryStyles, type CategoryKey } from "@/lib/catalog";
import { attributeSummary } from "@/lib/attributes";
import { effectivePrice } from "@/lib/pricing";
import { waLink, buildOrderMessage } from "@/lib/whatsapp";
import { formatUsd } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import type { WeekHours } from "@/lib/hours";
import { localized } from "@/lib/i18n-field";
import { groupBySection, type SectionInfo } from "@/lib/sections";
import { categoryIcons } from "@/components/category-icon";
import { PriceTag, BundleIncludes } from "@/components/store/product-price";
import { QuantityStepper } from "@/components/store/quantity-stepper";
import { CartSheet } from "@/components/store/cart-sheet";
import {
  DeliveryWindow,
  NO_WINDOW,
  windowIso,
  type WindowPick,
} from "@/components/store/delivery-window";
import { CatalogueFilters } from "@/components/store/catalogue-filters";
import {
  applyFilters,
  emptyFilters,
  filtersActive,
  type CatalogueFilterState,
} from "@/lib/catalogue-filters";
// The two components below are the only heavy things on this page that a
// browsing visitor never sees, so they are the only ones fetched late. The
// TYPE comes from the real module — `import type` is erased, it opens no
// dependency — while the component itself comes from the thunk. See
// store/lazy-checkout.tsx for why that thunk has to be a client module.
import type { PlacedOrder } from "@/components/checkout/checkout-form";
import { CheckoutForm, OrderPlaced } from "@/components/store/lazy-checkout";
import { newIdempotencyKey } from "@/lib/checkout";
import type {
  CheckoutItem,
  CheckoutLine,
  CheckoutViewer,
  StoreCheckout,
} from "@/lib/checkout";
import { resolveOffering } from "@/lib/offering";

// Delivery zone (migration 0172). The type now lives with the rest of the
// checkout contract in src/lib/checkout.ts — re-exported here only so the
// existing importers (store-products-section, the store page) keep working.
export type { DeliveryZone } from "@/lib/checkout";

// ===========================================================================
// What is in this file, and what deliberately is not — M-017
// ===========================================================================
//
// The audit row describes 1,540 lines carrying "catalogue, cart, coupon,
// loyalty and checkout at once". Most of that had already gone: the arithmetic
// to `lib/checkout.ts`, the form to `checkout/checkout-form.tsx`, the sector
// engines to `store/lazy-engines.tsx`. What was left was 921 lines, and the
// remaining split was made along what the CUSTOMER is doing, not along a line
// budget:
//
//   • narrowing the catalogue → store/catalogue-filters.tsx (and MJ-013's new
//     range control landed there rather than growing this file again)
//   • reading a price          → store/product-price.tsx
//   • changing a quantity      → store/quantity-stepper.tsx
//   • checking the basket      → store/cart-sheet.tsx
//   • choosing a delivery slot → store/delivery-window.tsx
//   • paying                   → checkout/, and now fetched on demand
//
// WHAT STAYED, ON PURPOSE. The cart itself — `cart`, `setQty`, the two
// localStorage effects, `items`, `total`, `lines`, `orderItems`, `waUrl`, the
// idempotency key and the placed order — is one piece of state that the
// storefront, the sticky bar, the sheet and the checkout all read. Splitting it
// would put a second component in charge of part of the basket, and this is the
// money path.
//
// `renderList` and `Card` stayed for the plainer reason: a product card reads
// the cart, the setter, the layout, the sector's icon, the sector's gradient,
// the locale, the dictionary and the add-to-cart label. Lifting it out means
// threading eight or nine props to save a hundred lines of JSX that nothing
// else renders — the cure the audit row explicitly warns against.

type Product = {
  id: string;
  name: string;
  nameEn?: string | null;
  brand?: string | null;
  price: number;
  discountPrice?: number | null;
  imageUrl?: string | null;
  attributes?: Record<string, string> | null;
  flashPrice?: number | null;
  flashStart?: string | null;
  flashEnd?: string | null;
  stock?: number | null;
  sectionId?: string | null;
  /**
   * Has variants, so it must not be quick-added. `cart` is keyed by product id
   * alone and every p_items entry it builds omits variant_id — the server would
   * charge the base price and decrement products.stock, while the price and the
   * stock that matter both live on the variant. These go to the product page,
   * which has the picker.
   */
  hasVariants?: boolean;
  isBundle?: boolean;
  includes?: { name: string; nameEn: string | null; quantity: number }[];
  /** 0299. Null on every product that predates it. */
  soldBy?: string | null;
  unitMeasure?: string | null;
  unitAmount?: number | null;
};

const GRID_CATEGORIES = new Set<CategoryKey>([
  "retail",
  "realEstate",
  "automotive",
]);

export function StoreProducts({
  lang,
  dict,
  category,
  isBooking,
  products,
  checkout,
  viewer,
  lbpRate = 0,
  sections = [],
  layout = null,
  initialBrand = null,
  hours = null,
}: {
  lang: Locale;
  dict: Dictionary;
  category: CategoryKey;
  isBooking: boolean;
  products: Product[];
  /** What this store's checkout offers — zones, coupons, loyalty, the
   *  merchant's own questions. One object rather than fifteen loose props, so
   *  a surface cannot be handed half of a checkout (MJ-024). */
  checkout: StoreCheckout;
  /** The per-customer half: signed in, saved addresses. */
  viewer: CheckoutViewer;
  lbpRate?: number;
  layout?: "grid" | "menu" | "showcase" | null;
  initialBrand?: string | null;
  sections?: SectionInfo[];
  /** The store's own opening hours (stores.hours). The delivery-window picker
   *  is derived from these and hidden entirely when the merchant has not set
   *  any — see src/lib/delivery-windows.ts. */
  hours?: WeekHours | null;
}) {
  const router = useRouter();
  const storeId = checkout.storeId;
  const [cart, setCart] = useState<Record<string, number>>({});
  const cartKey = `matjar-cart-${storeId}`;

  // Persist the cart per store so a refresh / accidental navigation doesn't
  // wipe it (a common drop-off point). Loaded on mount to avoid SSR mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(cartKey);
      if (saved) setCart(JSON.parse(saved));
    } catch {
      /* ignore corrupt storage */
    }
  }, [cartKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    try {
      if (Object.keys(cart).length) {
        localStorage.setItem(cartKey, JSON.stringify(cart));
      } else {
        localStorage.removeItem(cartKey);
      }
    } catch {
      /* ignore */
    }
  }, [cart, cartKey]);

  const [checkingOut, setCheckingOut] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  // The chosen delivery window. Kept HERE rather than inside the picker
  // because the picker lives in the checkout panel and unmounts whenever the
  // basket empties — a shopper who clears their cart, changes their mind and
  // refills it keeps the slot they had chosen, exactly as before the split.
  // Empty = order now, which is what every order has been until this existed.
  const [windowPick, setWindowPick] = useState<WindowPick>(NO_WINDOW);
  const scheduledFor = windowIso(windowPick);
  // One idempotency key per checkout ATTEMPT — re-minted every time the
  // customer enters the checkout, so a basket they edited and re-confirmed is
  // a new order rather than the RPC handing back the earlier one.
  const [attemptKey, setAttemptKey] = useState(newIdempotencyKey);
  // The placed order, frozen at success: the cart is cleared on the very next
  // line, and everything the confirmation screen shows — the total, the
  // WhatsApp message — is derived from the cart.
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  // What the shopper has narrowed the grid to. Brand arrives pre-set when a
  // product page linked here with ?brand=.
  const [filters, setFilters] = useState<CatalogueFilterState>(() =>
    emptyFilters(
      initialBrand &&
        products.some((p) => (p.brand?.trim() ?? "") === initialBrand)
        ? initialBrand
        : null,
    ),
  );

  const Icon = categoryIcons[category];
  const style = categoryStyles[category];
  // Layout: the merchant's chosen template overrides the sector default. "menu"
  // is the compact row list; "grid"/"showcase" are both image-top card grids
  // (showcase = fewer, larger cards).
  const effectiveLayout =
    layout ?? (GRID_CATEGORIES.has(category) ? "grid" : "menu");
  const isRow = effectiveLayout === "menu";
  const isShowcase = effectiveLayout === "showcase";
  const isGrid = !isRow; // image-top card (grid or showcase) vs. row list
  // Every row this grid receives is a good (`item_kind !== 'service'` — the
  // section splits them before handing them over), so the offering is the
  // sector's goods experience: a dish in a restaurant, a product elsewhere.
  // The resolver decides the button's noun — "أضف إلى الطلب" on a menu, "أضف
  // إلى السلة" in a shop — the same vocabulary the sticky CTA and the offering
  // page already use, so one screen no longer says both. It also decides
  // whether a stock count belongs on a card at all (a kitchen has no shelves)
  // and whether the grid may add anything to a basket.
  const storeOffering = resolveOffering({ category, itemKind: "product" });
  const addLabel = isBooking
    ? dict.store.book
    : dict.offering.cta[storeOffering.cta];
  const canAdd = storeOffering.addableToCart;
  const soldOutLabel = dict.offering.soldOut[storeOffering.noun];
  const lowStockOf = (p: { stock?: number | null }) =>
    storeOffering.showsStock && p.stock != null && p.stock > 0 && p.stock <= 5
      ? dict.store.onlyLeft.replace("{n}", String(p.stock))
      : null;

  function setQty(id: string, qty: number) {
    // Never let the cart exceed tracked stock — overselling is also caught
    // server-side, but capping here keeps the UI honest.
    const p = products.find((x) => x.id === id);
    const max = p?.stock != null ? p.stock : Infinity;
    const clamped = Math.min(qty, max);
    setCart((c) => {
      const next = { ...c };
      if (clamped <= 0) delete next[id];
      else next[id] = clamped;
      return next;
    });
  }

  const items = products.filter((p) => (cart[p.id] ?? 0) > 0);
  const total = items.reduce(
    (sum, p) => sum + effectivePrice(p) * cart[p.id],
    0,
  );
  // The basket, in the two shapes a checkout needs: what the customer reads,
  // and what the RPC is sent. Both are derived from the same `items`, so a line
  // cannot appear on the summary and be missing from the order.
  const lines: CheckoutLine[] = items.map((p) => ({
    id: p.id,
    name: p.name,
    quantity: cart[p.id],
    unitPrice: effectivePrice(p),
  }));
  // No variant_id / addon_ids here on purpose: the grid quick-adds only
  // variant-less products (`hasVariants` sends the rest to the product page,
  // which has the picker), so there is nothing to send. The product page fills
  // those in on the same CheckoutItem shape.
  const orderItems: CheckoutItem[] = items.map((p) => ({
    product_id: p.id,
    quantity: cart[p.id],
  }));

  // The WhatsApp fallback on the sticky bar — an order the customer sends the
  // merchant directly instead of placing one here. Uses the pre-discount
  // subtotal because no discount has been chosen at that point.
  const waUrl =
    checkout.whatsapp && items.length
      ? waLink(
          checkout.whatsapp,
          buildOrderMessage({
            greeting: dict.store.waGreeting,
            storeName: checkout.storeName,
            lines: items.map((p) => ({
              name: p.name,
              qty: cart[p.id],
              lineTotal: formatUsd(effectivePrice(p) * cart[p.id]),
            })),
            totalLabel: dict.store.total,
            total: formatUsd(total),
            address: viewer.defaultAddress || null,
          }),
        )
      : null;

  function startCheckout() {
    setAttemptKey(newIdempotencyKey());
    setCheckingOut(true);
  }

  function onPlaced(order: PlacedOrder) {
    setCheckingOut(false);
    setPlaced(order);
    setCart({}); // clears the persisted cart via the storage effect
    router.refresh();
  }

  function Card({ p }: { p: Product }) {
    return p.imageUrl ? (
      <Image
        src={p.imageUrl}
        alt={localized(p.name, p.nameEn, lang)}
        width={isGrid ? 400 : 64}
        height={isGrid ? (isShowcase ? 300 : 200) : 64}
        className={
          isGrid
            ? `${isShowcase ? "h-56" : "h-40"} w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]`
            : "h-16 w-16 shrink-0 rounded-xl object-cover"
        }
        sizes={isGrid ? "(max-width: 640px) 100vw, 50vw" : "64px"}
      />
    ) : (
      <div
        className={`flex items-center justify-center bg-gradient-to-br ${style.cover} ${isGrid ? `${isShowcase ? "h-56" : "h-40"} w-full` : "h-16 w-16 shrink-0 rounded-xl"}`}
      >
        <Icon
          className={
            isGrid ? "h-10 w-10 text-foreground/20" : "h-7 w-7 text-foreground/20"
          }
        />
      </div>
    );
  }

  // Render one arbitrary subset of products (a section's items, or the whole
  // flat catalog). Keeps the per-category grid/list styling; grouping only
  // decides which products land in which call.
  function renderList(list: Product[]) {
    return isGrid ? (
      <div
        className={
          isShowcase
            ? "grid grid-cols-1 gap-5 sm:grid-cols-2"
            : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        }
      >
        {list.map((p) => {
          const qty = cart[p.id] ?? 0;
          return (
            <div
              key={p.id}
              className="sf-card group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              <Card p={p} />
              <div className="flex flex-1 flex-col p-4">
                {/* Stretched link: at 390 the name alone was a 118 × 24 tap
                    target sitting inside a 250px card, so the way into the
                    product was the smallest thing on the card. `after:inset-0`
                    hands the whole card to the name link — image included,
                    which is where a thumb goes anyway — and the action cell
                    below lifts itself back out with `relative z-[1]`. */}
                <Link
                  href={`/${lang}/product/${p.id}`}
                  dir="auto"
                  className="font-bold leading-tight transition-colors after:absolute after:inset-0 after:content-[''] hover:text-primary"
                >
                  {localized(p.name, p.nameEn, lang)}
                </Link>
                {attributeSummary(category, p.attributes, lang) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {attributeSummary(category, p.attributes, lang)}
                  </p>
                )}
                <BundleIncludes
                  p={p}
                  lang={lang}
                  label={dict.store.bundleIncludes}
                />
                <p className="mt-1">
                  <PriceTag p={p} lang={lang} />
                </p>
                {lowStockOf(p) && (
                  <p className="mt-1 text-xs font-bold text-warning">
                    {lowStockOf(p)}
                  </p>
                )}
                {/* z-[1] keeps the action above the stretched link; min-h-11
                    because these measured 102 × 36 at 390 and are the single
                    most-tapped control on a storefront. */}
                <div className="relative z-[1] mt-3 flex justify-end">
                  {p.stock != null && p.stock <= 0 ? (
                    <span className="flex min-h-11 w-full items-center justify-center rounded-lg bg-surface-muted px-3.5 py-2 text-center text-sm font-bold text-muted-foreground">
                      {soldOutLabel}
                    </span>
                  ) : p.hasVariants ? (
                    <Link
                      href={`/${lang}/product/${p.id}`}
                      className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-center text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
                    >
                      {dict.store.chooseOption}
                    </Link>
                  ) : qty > 0 ? (
                    <QuantityStepper
                      product={p}
                      qty={qty}
                      lang={lang}
                      onChange={(next) => setQty(p.id, next)}
                    />
                  ) : (
                    <button
                      onClick={() => canAdd && setQty(p.id, 1)}
                      disabled={!canAdd}
                      className="min-h-11 w-full rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      {addLabel}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {list.map((p) => {
          const qty = cart[p.id] ?? 0;
          return (
            <div
              key={p.id}
              className="sf-card flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              <Card p={p} />
              <div className="min-w-0 flex-1">
                {/* The list layout takes its 44px from the hit box rather than
                    from `min-h-11` the way the grid above does, and on purpose:
                    this row is already the tall-catalogue layout — misk runs to
                    5400px with eleven items — so growing every row by 8px to
                    reach a size the `before` box reaches for free would be paid
                    for in scroll. Name: 24 + 2×10. Action: 36 + 2×4. */}
                <Link
                  href={`/${lang}/product/${p.id}`}
                  dir="auto"
                  className="relative block truncate font-bold transition-colors before:absolute before:-inset-y-2.5 before:content-[''] hover:text-primary"
                >
                  {localized(p.name, p.nameEn, lang)}
                </Link>
                {attributeSummary(category, p.attributes, lang) && (
                  <p className="truncate text-xs text-muted-foreground">
                    {attributeSummary(category, p.attributes, lang)}
                  </p>
                )}
                <BundleIncludes
                  p={p}
                  lang={lang}
                  label={dict.store.bundleIncludes}
                />
                <p className="mt-0.5 text-sm">
                  <PriceTag p={p} lang={lang} />
                  {lowStockOf(p) && (
                    <span className="ms-2 text-xs font-bold text-warning">
                      {lowStockOf(p)}
                    </span>
                  )}
                </p>
              </div>
              {p.stock != null && p.stock <= 0 ? (
                <span className="shrink-0 rounded-lg bg-surface-muted px-3.5 py-2 text-sm font-bold text-muted-foreground">
                  {soldOutLabel}
                </span>
              ) : p.hasVariants ? (
                <Link
                  href={`/${lang}/product/${p.id}`}
                  className="relative shrink-0 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-colors before:absolute before:-inset-y-1 before:content-[''] hover:bg-primary-hover"
                >
                  {dict.store.chooseOption}
                </Link>
              ) : qty > 0 ? (
                <QuantityStepper
                  product={p}
                  qty={qty}
                  lang={lang}
                  onChange={(next) => setQty(p.id, next)}
                />
              ) : (
                <button
                  onClick={() => canAdd && setQty(p.id, 1)}
                  disabled={!canAdd}
                  className="relative shrink-0 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-colors before:absolute before:-inset-y-1 before:content-[''] hover:bg-primary-hover disabled:opacity-50"
                >
                  {addLabel}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const filteredProducts = applyFilters(products, filters);

  // Group for display when the store defined sections; otherwise one flat list
  // (no headers, no regression). Cart/total logic still uses the full `products`.
  const groups = groupBySection(filteredProducts, sections);

  return (
    <div>
      <CatalogueFilters
        lang={lang}
        dict={dict}
        category={category}
        products={products}
        showAttributeFilters={isGrid}
        value={filters}
        onChange={setFilters}
      />

      {filtersActive(filters) && filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {dict.store.noMatches}
        </div>
      ) : sections.length > 0 ? (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.section?.id ?? "__other"}>
              <h3 className="mb-4 text-lg font-bold">
                {g.section
                  ? localized(g.section.name, g.section.nameEn, lang)
                  : dict.store.otherSection}
              </h3>
              {renderList(g.items)}
            </section>
          ))}
        </div>
      ) : (
        renderList(filteredProducts)
      )}

      {placed ? (
        <OrderPlaced
          lang={lang}
          dict={dict}
          order={placed}
          loggedIn={viewer.loggedIn}
          storeName={checkout.storeName}
        />
      ) : (
        items.length > 0 && (
          <>
            {/* Hidden rather than unmounted while the customer is back in the
                cart: an applied coupon, a chosen zone and a typed address are
                answers they already gave, and losing them on "edit order" is
                losing a discount they had earned. */}
            <div
              hidden={!checkingOut}
              className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              {/* Derived from stores.hours, so the only times offered are times
                  this shop is actually open — the picker on the product page is
                  a bare datetime-local that will cheerfully take 3am. Rides to
                  the server inside p_custom_fields, the channel 0194 already
                  reads: no schema, no RPC change, and "order now" stays the
                  default. */}
              <DeliveryWindow
                lang={lang}
                dict={dict}
                hours={hours}
                value={windowPick}
                onChange={setWindowPick}
              />
              <CheckoutForm
                lang={lang}
                dict={dict}
                store={checkout}
                viewer={viewer}
                lines={lines}
                items={orderItems}
                idempotencyKey={attemptKey}
                lbpRate={lbpRate}
                onBack={() => setCheckingOut(false)}
                onPlaced={onPlaced}
                onRemoveLine={(id) => setQty(id, 0)}
                extraCustomFields={
                  scheduledFor ? { scheduled_for: scheduledFor } : undefined
                }
              />
            </div>
            {!checkingOut && (
          /* WHERE THIS BAR SITS, and why the offset is not decoration.
              At `bottom-4` it rendered top=746 bottom=828 in an 844px viewport,
              while the bottom tab bar occupies 787–844 at z-50. This bar
              carried no z-index at all, so its last 41px — most of the checkout
              button — sat UNDER the tab bar and could not be tapped. It is the
              basket: the one control on a storefront that must never be
              covered. `--m-tabbar-h` is the visible bar only, so the safe-area
              inset is added here (bottom-nav pads for it separately), plus the
              house sticky gap. Above `lg` there is no tab bar, so the original
              bottom-4 is restored and desktop is untouched. */
          <div className="sticky bottom-[calc(var(--m-tabbar-h)+env(safe-area-inset-bottom)+var(--m-sticky-gap))] z-30 mt-6 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg lg:bottom-4">
            {/* The bar used to state a total for a list the customer could no
                longer see without committing to checkout. Tapping it now opens
                the cart itself. */}
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative min-h-11 min-w-0 text-start"
            >
              {/* truncate, not wrap: at 320 the button beside it takes what it
                  needs and this line gives way, rather than growing the bar to
                  two rows. */}
              <p
                aria-live="polite"
                className="truncate text-sm text-muted-foreground"
              >
                {dict.store.itemsInCart.replace(
                  "{n}",
                  String(items.reduce((n, p) => n + cart[p.id], 0)),
                )}
              </p>
              {/* Through <Money>: `tabular-nums` alone leaves the "$" a bidi
                  neutral in this RTL row. */}
              <Money
                key={total}
                value={total}
                className="animate-pop block text-lg font-extrabold"
              />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              {waUrl && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "whatsapp" })}
                >
                  <MessageCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {dict.store.orderWhatsapp}
                  </span>
                </a>
              )}
              {/* The amount rides on the button as well as beside it (§24), so
                  the number and the commitment are never separated.
                  The WORDING never drops — an earlier pass hid it below `sm`
                  and, since `sm` is 640px, that meant every phone from 320 to
                  430 got a cart glyph and a price with no verb on it, which
                  reads as "add" at least as easily as "check out". The ICON is
                  what gives way instead: it is the only part of the button
                  carrying no information the label does not already carry. */}
              <button
                onClick={startCheckout}
                className="sf-buy flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-3 font-bold whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary-hover sm:px-6"
              >
                <ShoppingCart className="hidden h-4 w-4 shrink-0 sm:block" />
                {dict.store.checkout}
                <span aria-hidden>·</span>
                <Money value={total} />
              </button>
            </div>
          </div>
            )}
          </>
        )
      )}

      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lang={lang}
        dict={dict}
        lines={items.map((p) => ({ product: p, qty: cart[p.id] }))}
        total={total}
        onSetQty={setQty}
        onCheckout={() => {
          setCartOpen(false);
          startCheckout();
        }}
      />
    </div>
  );
}
