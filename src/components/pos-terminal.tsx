"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Search,
  Package,
  Plus,
  Minus,
  Trash2,
  ReceiptText,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatUsd } from "@/lib/currency";
import {
  PosExtrasFields,
  PosExtrasResult,
  applyPosExtras,
  type PosExtrasConfig,
  type PosExtrasLine,
  type PosExtrasValue,
} from "@/components/loyalty/pos-extras";

export type PosProduct = {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  stock: number | null;
};

export type PosCustomer = { id: string; name: string };

export type PosLocation = {
  id: string;
  name: string | null;
  area: string | null;
};

type CartLine = { product: PosProduct; qty: number };

function eff(p: PosProduct) {
  return p.discount_price ?? p.price;
}

function fmt(n: number) {
  return formatUsd(n, { cents: true });
}

// Point-of-sale terminal: tap products into a ticket, apply a discount, pick a
// book customer, record the cash sale. Prices are re-read server-side by the
// pos_record_sale RPC — the cart here is a preview, not the source of truth.
export function PosTerminal({
  storeId,
  dict,
  products,
  customers,
  locations = [],
  extras,
}: {
  storeId: string;
  dict: Dictionary;
  products: PosProduct[];
  customers: PosCustomer[];
  locations?: PosLocation[];
  /** Loyalty phone + gift-card code (0310). Omitted = the till as before. */
  extras?: PosExtrasConfig;
}) {
  const router = useRouter();
  const t = dict.os.pos;
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [customerId, setCustomerId] = useState("");
  // Locations arrive ordered by is_primary desc, so the primary is the default.
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [extrasValue, setExtrasValue] = useState<PosExtrasValue>({ phone: "", giftCode: "" });
  const [extrasResult, setExtrasResult] = useState<PosExtrasLine[]>([]);

  const q = query.trim().toLowerCase();
  const filtered = products.filter(
    (p) => !q || p.name.toLowerCase().includes(q),
  );

  function addToCart(p: PosProduct) {
    setSuccess(false);
    setCart((c) => {
      const line = c.find((l) => l.product.id === p.id);
      if (line)
        return c.map((l) =>
          l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l,
        );
      return [...c, { product: p, qty: 1 }];
    });
  }

  function setQty(id: string, qty: number) {
    setCart((c) =>
      qty <= 0
        ? c.filter((l) => l.product.id !== id)
        : c.map((l) => (l.product.id === id ? { ...l, qty } : l)),
    );
  }

  const subtotal = cart.reduce((s, l) => s + eff(l.product) * l.qty, 0);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - disc;

  async function charge() {
    if (!cart.length) return;
    setBusy(true);
    setExtrasResult([]);
    const { data: saleId, error } = await createClient().rpc("pos_record_sale", {
      p_store_id: storeId,
      p_items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty })),
      p_discount: disc,
      p_customer: customerId || null,
      p_note: null,
      p_location_id: locationId || null,
    });
    // The sale is recorded; loyalty and a gift card are applied to it after.
    const extrasLines =
      !error && saleId && extras
        ? await applyPosExtras({ saleId: saleId as string, value: extrasValue, config: extras, dict })
        : [];
    setBusy(false);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    setExtrasResult(extrasLines);
    setExtrasValue({ phone: "", giftCode: "" });
    setCart([]);
    setDiscount("");
    setCustomerId("");
    setSuccess(true);
    router.refresh();
  }

  return (
    <>
      {/* Branch picker: only when the store actually has several branches. */}
      {locations.length > 1 && (
        <label className="mb-4 block text-sm sm:max-w-xs">
          <span className="font-semibold text-muted-foreground">
            {dict.os.branches.branchLabel}
          </span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.area || dict.os.branches.branchLabel}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Product picker */}
        <div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {products.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
              {t.noProducts}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
              {t.noResults}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {filtered.map((p) => {
                const out = p.stock != null && p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => !out && addToCart(p)}
                    disabled={out}
                    className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface text-start transition-all ${
                      out
                        ? "opacity-50"
                        : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:translate-y-0"
                    }`}
                  >
                    {p.image_url ? (
                      <Image
                        src={p.image_url}
                        alt=""
                        width={200}
                        height={112}
                        className="h-24 w-full object-cover"
                        sizes="(max-width: 640px) 50vw, 200px"
                      />
                    ) : (
                      <span className="flex h-24 w-full items-center justify-center bg-surface-muted text-muted-foreground">
                        <Package className="h-7 w-7" />
                      </span>
                    )}
                    <span className="flex flex-1 flex-col p-2.5">
                      <span className="line-clamp-2 text-sm font-bold leading-tight">
                        {p.name}
                      </span>
                      <span className="mt-1 text-sm font-extrabold text-primary">
                        {fmt(eff(p))}
                      </span>
                    </span>
                    {out && (
                      <span className="absolute end-2 top-2 rounded-full bg-danger-strong px-2 py-0.5 text-[10px] font-bold text-danger-strong-foreground">
                        {t.out}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Ticket */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold">
              <ReceiptText className="h-5 w-5 text-primary" />
              {t.cart}
            </h2>

            {success && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-success-soft p-3 text-sm font-bold text-success">
                <CheckCircle2 className="h-5 w-5" />
                {t.success}
              </div>
            )}
            {success && <PosExtrasResult lines={extrasResult} dict={dict} />}

            {cart.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                {t.emptyCart}
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {cart.map((l) => (
                  <div key={l.product.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {l.product.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmt(eff(l.product))} × {l.qty}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQty(l.product.id, l.qty - 1)}
                        aria-label="-"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border transition-colors hover:bg-surface-muted"
                      >
                        {l.qty === 1 ? (
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        ) : (
                          <Minus className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <span className="w-7 text-center text-sm font-extrabold tabular-nums">
                        {l.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty(l.product.id, l.qty + 1)}
                        aria-label="+"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border transition-colors hover:bg-surface-muted"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="w-16 shrink-0 text-end text-sm font-extrabold tabular-nums">
                      {fmt(eff(l.product) * l.qty)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {cart.length > 0 && (
              <>
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <label className="block text-sm">
                    <span className="font-semibold text-muted-foreground">
                      {t.discount}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </label>
                  {customers.length > 0 && (
                    <label className="block text-sm">
                      <span className="font-semibold text-muted-foreground">
                        {t.customer}
                      </span>
                      <select
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                      >
                        <option value="">{t.walkIn}</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {extras && (
                    <PosExtrasFields
                      config={extras}
                      value={extrasValue}
                      onChange={setExtrasValue}
                      dict={dict}
                      storeId={storeId}
                    />
                  )}
                </div>

                <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t.subtotal}</span>
                    <span className="tabular-nums">{fmt(subtotal)}</span>
                  </div>
                  {disc > 0 && (
                    <div className="flex justify-between text-danger">
                      <span>{t.discount}</span>
                      <span className="tabular-nums">-{fmt(disc)}</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="font-bold">{t.total}</span>
                    <span className="text-2xl font-extrabold tabular-nums text-primary">
                      {fmt(total)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={charge}
                  disabled={busy}
                  className="mt-4 w-full rounded-xl bg-primary py-3 text-base font-extrabold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                >
                  {busy ? t.charging : `${t.charge} · ${fmt(total)}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
