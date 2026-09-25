"use client";

import type { Dictionary } from "@/i18n/get-dictionary";
import {
  WA_LOCALES,
  formatWaEta,
  formatWaTotal,
  orderLinkPath,
  orderNumber,
  orderStatusWords,
  reviewLinkPath,
  type WaLocale,
  type WaValues,
} from "@/lib/wa-templates";
import { WaActionButton, WaLocaleToggle } from "./wa-action-button";

export type OrderWaData = {
  id: string;
  status: string;
  phone: string | null;
  customerName: string | null;
  /** Placed from a customer account (orders.customer_id is set). Decides which
   *  page the message links to, and whether a review form exists at all. */
  hasAccount: boolean;
  total: number;
  items: { name: string; quantity: number }[];
  scheduledFor: string | null;
  /** The delivery zone's ETA, when the order has a zone that states one. */
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
};

export type OrderWaTemplates = {
  order_confirmation: Record<WaLocale, string>;
  order_status: Record<WaLocale, string>;
  review_request: Record<WaLocale, string>;
};

/** Statuses a confirmation still makes sense for. */
const CONFIRMABLE = new Set(["pending", "accepted", "preparing", "ready", "out_for_delivery"]);

/**
 * The WhatsApp row on an order card: «تأكيد الطلب», «تحديث الحالة», and on a
 * completed order «اطلب تقييم». Every value comes from the order itself — an
 * ETA only when the order is scheduled or its delivery zone states one, a link
 * only to a page that exists for this order.
 */
export function OrderWaActions({
  uiLang,
  storeId,
  storeName,
  order,
  rate,
  templates,
  lastSent,
  t,
}: {
  uiLang: string;
  storeId: string;
  storeName: string;
  order: OrderWaData;
  /** Live USD→LBP rate; 0 hides the LBP amount. */
  rate: number;
  templates: OrderWaTemplates;
  /** "orderId:key" → ISO time of the latest tap. */
  lastSent: Record<string, string>;
  t: Dictionary["waActions"];
}) {
  const values = {} as Record<WaLocale, WaValues>;
  const trackPath = {} as Record<WaLocale, string | null>;
  const reviewPath = {} as Record<WaLocale, string | null>;
  for (const l of WA_LOCALES) {
    values[l] = {
      customer_name: order.customerName,
      store_name: storeName,
      order_number: orderNumber(order.id),
      total: formatWaTotal(order.total, rate, l),
      eta: formatWaEta(
        {
          scheduledFor: order.scheduledFor,
          etaMinMinutes: order.etaMinMinutes,
          etaMaxMinutes: order.etaMaxMinutes,
        },
        l,
      ),
      status: orderStatusWords(order.status, l),
    };
    trackPath[l] = orderLinkPath(l, order.id, order.hasAccount);
    reviewPath[l] = reviewLinkPath(l, order.id, order.hasAccount);
  }

  const labels = {
    noPhone: t.noPhone,
    lastSent: t.lastSent,
    ago: t.ago,
    truncated: t.truncated,
  };
  const common = {
    uiLang,
    storeId,
    targetType: "order" as const,
    targetId: order.id,
    phone: order.phone,
    labels,
  };
  const at = (key: string) => lastSent[`${order.id}:${key}`] ?? null;

  return (
    <section className="mt-3 border-t border-border pt-3" aria-label={t.sectionTitle}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-muted-foreground">{t.sectionTitle}</h3>
        <WaLocaleToggle uiLang={uiLang} labels={t} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CONFIRMABLE.has(order.status) && (
          <WaActionButton
            {...common}
            variant="whatsapp"
            full
            templateKey="order_confirmation"
            label={t.keys.order_confirmation}
            bodies={templates.order_confirmation}
            values={values}
            linkPath={trackPath}
            items={order.items}
            lastSentAt={at("order_confirmation")}
          />
        )}
        <WaActionButton
          {...common}
          full
          templateKey="order_status"
          label={t.keys.order_status}
          bodies={templates.order_status}
          values={values}
          linkPath={trackPath}
          lastSentAt={at("order_status")}
        />
        {order.status === "completed" && (
          <WaActionButton
            {...common}
            variant="whatsapp"
            full
            templateKey="review_request"
            label={t.keys.review_request}
            bodies={templates.review_request}
            values={values}
            linkPath={reviewPath}
            lastSentAt={at("review_request")}
            disabledReason={order.hasAccount ? null : t.reviewNeedsAccount}
          />
        )}
      </div>
    </section>
  );
}
