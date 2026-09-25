"use client";

import { useState } from "react";
import { ShieldCheck, ShoppingCart } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import {
  WA_LOCALES,
  formatWaTotal,
  storeLinkPath,
  type CartLine,
  type WaLocale,
  type WaValues,
} from "@/lib/wa-templates";
import { WaActionButton, WaLocaleToggle } from "./wa-action-button";
import { formatSince, useMinuteNow } from "./wa-client";

export type AbandonedCart = {
  id: string;
  phone: string;
  customerName: string | null;
  lines: CartLine[];
  itemCount: number;
  /** From CURRENT prices, over the lines that still have a product. */
  totalEstimate: number;
  unpriced: number;
  updatedAt: string;
  lastWaAt: string | null;
};

export function AbandonedCartsList({
  uiLang,
  storeId,
  storeName,
  storeSlug,
  carts,
  coupons,
  rate,
  bodies,
  fallback,
  loadFailed,
  t,
}: {
  uiLang: string;
  storeId: string;
  storeName: string;
  storeSlug: string | null;
  carts: AbandonedCart[];
  /** Codes of the store's coupons that can be redeemed right now. */
  coupons: string[];
  rate: number;
  bodies: Record<WaLocale, string>;
  fallback: boolean;
  loadFailed: boolean;
  t: Dictionary["waActions"];
}) {
  const now = useMinuteNow();
  const [couponFor, setCouponFor] = useState<Record<string, string>>({});
  const c = t.carts;

  // A cart lives in the customer's own browser; no link can reopen it, so the
  // honest destination is the store page (see storeLinkPath).
  const linkPath = {} as Record<WaLocale, string | null>;
  for (const l of WA_LOCALES) linkPath[l] = storeLinkPath(l, storeId, storeSlug);

  return (
    <>
      <div className="mt-4 space-y-2 rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>{c.privacy}</span>
        </p>
        <p>{c.linkNote}</p>
        {fallback && !loadFailed && <p>{c.fallback}</p>}
      </div>

      {loadFailed ? (
        <p className="mt-6 rounded-xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          {c.loadFailed}
        </p>
      ) : carts.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={c.empty} description={c.emptyHint} className="mt-6" />
      ) : (
        <>
          <div className="mt-6">
            <WaLocaleToggle uiLang={uiLang} labels={t} />
          </div>
          <ul className="mt-3 space-y-3">
            {carts.map((cart) => {
              const coupon = couponFor[cart.id] ?? "";
              const values = {} as Record<WaLocale, WaValues>;
              for (const l of WA_LOCALES) {
                values[l] = {
                  customer_name: cart.customerName,
                  store_name: storeName,
                  // An estimate at today's prices — the template says
                  // "approximate". No total at all when nothing is priced.
                  total:
                    cart.totalEstimate > 0 ? formatWaTotal(cart.totalEstimate, rate, l) : null,
                  coupon: coupon || null,
                };
              }
              const attempted = formatSince(cart.updatedAt, now, t.ago, uiLang);
              return (
                <li key={cart.id} className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-bold">{cart.customerName || c.guest}</p>
                    <bdi dir="ltr" className="text-sm text-muted-foreground">
                      {cart.phone}
                    </bdi>
                  </div>
                  {attempted && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.attempted.split("{when}").join(attempted)}
                    </p>
                  )}

                  <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                    {cart.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className={l.product_id ? "" : "text-muted-foreground line-through"}>
                          <bdi>{uiLang === "en" && l.name_en ? l.name_en : l.name}</bdi>{" "}
                          <span dir="ltr" className="text-muted-foreground">
                            ×{l.quantity}
                          </span>
                        </span>
                        {l.unit_price != null && (
                          <Money value={l.unit_price * l.quantity} className="shrink-0 text-muted-foreground" />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {c.items.split("{n}").join(String(cart.itemCount))}
                    </span>
                    {cart.totalEstimate > 0 && (
                      <span className="font-bold">
                        {c.estimate.split("{total}").join("")}
                        <Money value={cart.totalEstimate} cents />{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({c.estimateNote})
                        </span>
                      </span>
                    )}
                  </div>
                  {cart.unpriced > 0 && (
                    <p className="mt-1 text-xs text-warning">
                      {c.unpriced.split("{n}").join(String(cart.unpriced))}
                    </p>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-start">
                    {coupons.length > 0 && (
                      <label className="block text-xs font-semibold text-muted-foreground">
                        {c.coupon}
                        <select
                          value={coupon}
                          onChange={(e) =>
                            setCouponFor((m) => ({ ...m, [cart.id]: e.target.value }))
                          }
                          className="mt-1 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground"
                        >
                          <option value="">{c.noCoupon}</option>
                          {coupons.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className={coupons.length > 0 ? "sm:pt-5" : "sm:col-span-2"}>
                      <WaActionButton
                        uiLang={uiLang}
                        storeId={storeId}
                        templateKey="abandoned_cart"
                        targetType="cart"
                        targetId={cart.id}
                        phone={cart.phone}
                        label={t.keys.abandoned_cart}
                        bodies={bodies}
                        values={values}
                        linkPath={linkPath}
                        items={cart.lines.map((l) => ({ name: l.name, quantity: l.quantity }))}
                        lastSentAt={cart.lastWaAt}
                        labels={{
                          noPhone: t.noPhone,
                          lastSent: t.lastSent,
                          ago: t.ago,
                          truncated: t.truncated,
                        }}
                        variant="whatsapp"
                        full
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
