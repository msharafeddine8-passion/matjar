import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MapPin, Phone, StickyNote, Store as StoreIcon, Download } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Money } from "@/components/ui/money";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OrderCancelButton } from "@/components/order-cancel-button";
import { ReorderButton } from "@/components/reorder-button";
import { PrintInvoiceButton } from "@/components/print-invoice-button";
import { ReviewForm } from "@/components/review-form";
import { OrderTimeline, type OrderEvent } from "@/components/order-timeline";
import { OrderStickyActions } from "@/components/order-sticky-actions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data } = await supabase
    .from("orders")
    .select(
      "id, status, subtotal, discount, total, delivery_fee, fulfillment, address, phone, customer_note, custom_fields, created_at, customer_id, store_id, stores(name, phone, whatsapp), order_items(id, name, unit_price, quantity, product_id, products(item_kind))",
    )
    .eq("id", id)
    .maybeSingle();

  const order = data as unknown as {
    id: string;
    status: string;
    subtotal: number;
    discount: number | null;
    delivery_fee: number | null;
    total: number;
    fulfillment: string;
    address: string | null;
    phone: string | null;
    customer_note: string | null;
    custom_fields: Record<string, string> | null;
    created_at: string;
    customer_id: string;
    store_id: string;
    stores: { name: string; phone: string | null; whatsapp: string | null } | null;
    order_items: {
      id: string;
      name: string;
      unit_price: number;
      quantity: number;
      product_id: string | null;
      products: { item_kind: string | null } | null;
    }[];
  } | null;

  // Only the owner may view their order detail.
  if (!order || order.customer_id !== user.id) notFound();

  // Nudge a review once the order is completed and not yet reviewed.
  let showReviewPrompt = false;
  if (order.status === "completed") {
    // Through my_store_review (0319): since 0320 a signed-in user cannot read,
    // or filter on, reviews.customer_id — not even their own.
    const { data: existing } = await supabase.rpc("my_store_review", {
      p_store_id: order.store_id,
    });
    showReviewPrompt = ((existing ?? []) as unknown[]).length === 0;
  }
  const customerName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "";

  // Real transition timestamps (0173) — RLS lets the order's customer read.
  const { data: evData } = await supabase
    .from("order_status_events")
    .select("to_status, created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });
  const events = (evData ?? []) as OrderEvent[];

  // Money given back. A refund is recorded against the order rather than by
  // unwinding it (0246/0247), so this is the only place the customer would
  // ever learn it happened — without it the total on screen still reads as if
  // they paid in full. RLS lets the order's customer read these rows.
  const { data: refundRows } = await supabase
    .from("order_payments")
    .select("amount, created_at")
    .eq("order_id", order.id)
    .eq("kind", "refund");
  const refunded = (refundRows ?? []).reduce(
    (sum, r) => sum + Number((r as { amount: number }).amount),
    0,
  );

  // A finished order has no next step, so the bar does not appear at all
  // rather than pinning a dead action to every screen.
  const isLive = !["completed", "cancelled", "rejected"].includes(order.status);

  // Only stated where the platform genuinely knows what comes next. Silence
  // beats a reassuring guess on someone's money.
  const nextSteps: Record<string, string | undefined> = {
    pending: dict.orders.nextPending,
    accepted: dict.orders.nextAccepted,
    preparing: dict.orders.nextPreparing,
    ready: dict.orders.nextReady,
    out_for_delivery: dict.orders.nextOnTheWay,
  };
  const nextStep = nextSteps[order.status];

  const t = dict.orders;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Breadcrumbs
          items={[
            { label: t.title, href: `/${lang}/orders` },
            { label: `#${order.id.slice(0, 8)}` },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {t.order} #{order.id.slice(0, 8)}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <StoreIcon className="h-4 w-4" />
              {order.stores?.name ?? "—"} · {t.placedOn} {fmtDate(order.created_at)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 print:hidden">
            {order.status === "pending" && (
              <OrderCancelButton id={order.id} kind="order" dict={dict} />
            )}
            <ReorderButton
              orderId={order.id}
              storeId={order.store_id}
              storeName={order.stores?.name ?? ""}
              lang={lang}
              label={dict.orders.reorder}
              closeLabel={dict.common.close}
              copy={dict.activityCenter}
            />
            <PrintInvoiceButton label={t.print} />
          </div>
        </div>

        {/* Status timeline with real timestamps */}
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-xs">
          <OrderTimeline
            events={events}
            status={order.status}
            fulfillment={order.fulfillment}
            labels={t.status as unknown as Record<string, string>}
            lang={lang}
          />
        </div>

        {/* Review prompt (completed + not yet reviewed) */}
        {showReviewPrompt && order.stores && (
          <div className="mt-6 rounded-2xl border border-primary/30 bg-primary-soft/40 p-5 print:hidden">
            <p className="mb-3 font-bold">
              {dict.reviews.ratePrompt.replace("{store}", order.stores.name)}
            </p>
            <ReviewForm
              storeId={order.store_id}
              dict={dict}
              customerName={customerName}
            />
          </div>
        )}

        {/* Items */}
        <Card className="mt-6 p-5">
          <h2 className="mb-3 font-bold">{t.items}</h2>
          <div className="space-y-2">
            {order.order_items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  {it.name}{" "}
                  <span className="text-muted-foreground">×{it.quantity}</span>
                  {/* A digital item has nothing to deliver by hand, so its
                      delivery IS this link. It points at the download route,
                      which re-checks the buyer and the order state server-side
                      before signing anything — the button appearing is not the
                      permission, only the way to ask. Hidden while the order is
                      pending, because the merchant releases it by accepting. */}
                  {it.products?.item_kind === "digital" &&
                    order.status !== "pending" &&
                    order.status !== "cancelled" &&
                    order.status !== "rejected" && (
                      <a
                        href={`/${lang}/download/${it.id}`}
                        className="ms-2 inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary-hover print:hidden"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t.download}
                      </a>
                    )}
                </span>
                <Money
                  value={it.unit_price * it.quantity}
                  className="shrink-0 font-semibold"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t.subtotal}</span>
              <Money value={order.subtotal} />
            </div>
            {order.discount ? (
              <div className="flex justify-between text-success">
                <span>{t.discount}</span>
                <Money value={order.discount} prefix="−" />
              </div>
            ) : null}
            {order.delivery_fee && Number(order.delivery_fee) > 0 ? (
              <div className="flex justify-between text-muted-foreground">
                <span>{t.deliveryFeeLabel}</span>
                <Money value={Number(order.delivery_fee)} prefix="+" />
              </div>
            ) : null}
            <div className="flex justify-between text-base font-extrabold">
              <span>{t.total}</span>
              <Money value={order.total} className="text-primary" />
            </div>
            {refunded > 0 && (
              <>
                <div className="flex justify-between font-bold text-danger">
                  <span>{t.refunded}</span>
                  <Money value={refunded} prefix="−" />
                </div>
                <div className="flex justify-between text-sm font-semibold text-muted-foreground">
                  <span>{t.netPaid}</span>
                  <Money value={Math.max(0, order.total - refunded)} />
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Fulfillment */}
        <Card className="mt-6 space-y-2 p-5 text-sm">
          {order.address && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {order.address}
            </p>
          )}
          {order.phone && (
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-primary" />
              <span dir="ltr">{order.phone}</span>
            </p>
          )}
          {order.customer_note && (
            <p className="flex items-start gap-2">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {order.customer_note}
            </p>
          )}
          {order.custom_fields &&
            Object.entries(order.custom_fields).map(([k, v]) => (
              <p key={k} className="flex items-start gap-2">
                <span className="font-semibold text-muted-foreground">{k}:</span>
                {v}
              </p>
            ))}
        </Card>

        {/* The arrow was a literal "←". "Back" in an Arabic document points
            RIGHT, so on this app's primary locale it aimed at the wrong side
            of the screen. ChevronPrev resolves direction from the document's
            own `dir` (see ui/directional-icon.tsx), and the link clears 44px
            while it is at it. */}
        <Link
          href={`/${lang}/orders`}
          className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground print:hidden"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.backToOrders}
        </Link>

        {/* Room for the sticky bar plus the tab bar beneath it, so the last
            link on the page is never trapped under either. */}
        {isLive && (
          <div
            aria-hidden
            className="h-[calc(3.5rem+env(safe-area-inset-bottom))] lg:hidden"
          />
        )}
      </Container>

      {isLive && (
        <OrderStickyActions
          statusLabel={
            (t.status as unknown as Record<string, string>)[order.status] ??
            order.status
          }
          nextStep={nextStep}
          whatsapp={order.stores?.whatsapp ?? null}
          phone={order.stores?.phone ?? null}
          labels={{ contact: t.contactStore, call: t.callStore }}
        />
      )}
    </div>
  );
}
