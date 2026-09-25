import Link from "next/link";
import { Truck, Store, Wallet, Clock, ShoppingBasket, RotateCcw } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { DeliveryZone } from "@/components/store-products";
import { formatUsd } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import { localized } from "@/lib/i18n-field";

export type CourierOption = { price: number | null; name: string };

// "Can I actually get this, and on what terms" — answered before the customer
// opens the cart instead of inside it. Every fact here is a merchant-set column
// (accepts_delivery / accepts_pickup / min_order / prep_time / payment_note) or
// a row the merchant created (delivery zones, courier partners). Nothing is
// estimated: a store with no zones shows no ETAs, and a store that set no
// minimum shows no minimum. When there is nothing true to say, the section
// returns null and leaves no empty card behind.
export function StoreFulfillment({
  acceptsDelivery,
  acceptsPickup,
  minOrder,
  prepTime,
  paymentNote,
  returnPolicy,
  policiesHref = null,
  zones,
  couriers,
  dict,
  lang,
}: {
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  minOrder: number | null;
  prepTime: string | null;
  paymentNote: string | null;
  returnPolicy: string | null;
  /** Link to the store's public policies page, when the caller has one. */
  policiesHref?: string | null;
  zones: DeliveryZone[];
  couriers: CourierOption[];
  dict: Dictionary;
  lang: Locale;
}) {
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (minOrder != null && minOrder > 0)
    facts.push({
      icon: <ShoppingBasket className="h-4 w-4 text-primary" />,
      label: dict.store.minOrder,
      value: formatUsd(minOrder),
    });
  if (prepTime)
    facts.push({
      icon: <Clock className="h-4 w-4 text-primary" />,
      label: dict.store.prep,
      value: prepTime,
    });
  if (paymentNote)
    facts.push({
      icon: <Wallet className="h-4 w-4 text-primary" />,
      label: dict.store.payment,
      value: paymentNote,
    });
  // The shop's own words, shown only when it has written some. No default and
  // no placeholder: a returns policy nobody wrote is a promise nobody made, and
  // Matjar settles nothing, so it could not stand behind one anyway.
  if (returnPolicy)
    facts.push({
      icon: <RotateCcw className="h-4 w-4 text-primary" />,
      label: dict.store.returnPolicy,
      value: returnPolicy,
    });

  const hasModes = acceptsDelivery || acceptsPickup;
  if (!hasModes && !facts.length && !zones.length && !couriers.length)
    return null;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <Truck className="h-5 w-5 text-primary" />
        {dict.offering.fulfillmentTitle}
      </h2>

      {hasModes && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {acceptsDelivery && (
            <li className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold">
              <Truck className="h-4 w-4 shrink-0 text-primary" />
              {dict.store.delivery}
            </li>
          )}
          {acceptsPickup && (
            <li className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold">
              <Store className="h-4 w-4 shrink-0 text-primary" />
              {dict.store.pickup}
            </li>
          )}
        </ul>
      )}

      {facts.length > 0 && (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {facts.map((f) => (
            <div
              key={f.label}
              className="flex items-start gap-2 rounded-xl bg-surface-muted px-3.5 py-2.5"
            >
              <span className="mt-0.5 shrink-0">{f.icon}</span>
              <div className="min-w-0">
                <dt className="text-xs font-bold text-muted-foreground">
                  {f.label}
                </dt>
                <dd className="text-sm font-semibold">{f.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}

      {/* Zones the merchant actually created. The fee and the free-over
          threshold are the two numbers that change what the customer pays, so
          they lead; the ETA is the merchant's own stated window, never ours. */}
      {zones.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-muted-foreground">
            {dict.merchant.zones.title}
          </h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {zones.map((z) => (
              <li
                key={z.id}
                className="rounded-xl border border-border px-3.5 py-2.5 text-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold">
                    {localized(z.name, z.nameEn, lang)}
                  </span>
                  <span className="shrink-0 font-bold text-primary tabular-nums">
                    {z.fee > 0 ? formatUsd(z.fee) : dict.store.freeDelivery}
                  </span>
                </div>
                {z.minOrder != null && z.minOrder > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dict.store.zoneMinWarn.replace(
                      "{n}",
                      formatUsd(z.minOrder),
                    )}
                  </p>
                )}
                {z.freeOver != null && z.freeOver > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dict.store.freeOverHint.replace(
                      "{n}",
                      formatUsd(z.freeOver),
                    )}
                  </p>
                )}
                {z.etaMin != null && z.etaMax != null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dict.store.zoneEta
                      .replace("{min}", String(z.etaMin))
                      .replace("{max}", String(z.etaMax))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Partner couriers the shop hands orders to. Previously its own card
          directly above this one, saying "delivery" twice in two boxes. */}
      {couriers.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-muted-foreground">
            {dict.store.deliveryOptions}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {couriers.map((c, i) => (
              <li
                key={`${c.name}-${i}`}
                className="flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm"
              >
                <span className="font-semibold">{c.name}</span>
                {c.price != null && (
                  <span className="font-bold text-primary tabular-nums">
                    <Money value={c.price} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The full policies page (/store/<id>/policies) — the address a shop
          gives Google Merchant Center and Meta. Only linked when there is a
          policy to show, so the link never lands on a 404. */}
      {policiesHref && returnPolicy && (
        <Link
          href={policiesHref}
          className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          {dict.googleFeed.storeLink}
        </Link>
      )}
    </section>
  );
}
