import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { IssueInvoiceButton } from "@/components/issue-invoice-button";
import { PrintInvoiceButton } from "@/components/print-invoice-button";
import { formatUsd } from "@/lib/currency";
import { ChevronPrev } from "@/components/ui/directional-icon";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(n: number) {
  return formatUsd(n, { cents: true });
}

// Print-friendly order invoice for the merchant (print → Save as PDF).
export default async function OrderInvoicePage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string; orderId: string }>;
}) {
  const { lang, storeId, orderId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId) || !UUID_RE.test(orderId))
    redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.invoice;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const [{ data: store }, { data: orderData }] = await Promise.all([
    supabase
      .from("stores")
      // The legal identity printed below comes from the issued invoice's own
      // frozen copy (store_invoices), never from the live store row — and the
      // store's legal columns are not client-readable after 0314 anyway.
      .select("id, name, logo_url, phone, area")
      .eq("id", storeId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select(
        "id, status, subtotal, discount, total, fulfillment, address, phone, customer_name, created_at, order_items(name, unit_price, quantity)",
      )
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle(),
  ]);
  if (!store || !orderData) redirect(`/${lang}/merchant/${storeId}/orders`);

  // The issued, numbered document — if one exists. Everything on it is frozen
  // at issue time on purpose: a legal invoice must not silently change when the
  // store later edits its address or a product price (0248).
  const { data: invoiceRow } = await supabase
    .from("store_invoices")
    .select(
      "number, legal_name, tax_no, commercial_reg_no, legal_address, customer_name, customer_phone, customer_address, subtotal, discount, delivery_fee, vat_inclusive, tax_rate, tax_amount, total, lines, issued_at",
    )
    .eq("order_id", orderId)
    .is("voided_at", null)
    .maybeSingle();
  const inv = invoiceRow as unknown as {
    number: string;
    legal_name: string | null;
    tax_no: string | null;
    commercial_reg_no: string | null;
    legal_address: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    subtotal: number;
    discount: number | null;
    delivery_fee: number | null;
    vat_inclusive: boolean;
    tax_rate: number;
    tax_amount: number;
    total: number;
    lines: { name: string; qty: number; unit_price: number; line_total: number }[];
    issued_at: string;
  } | null;

  const s = store as unknown as {
    name: string;
    logo_url: string | null;
    phone: string | null;
    area: string | null;
  };
  const order = orderData as unknown as {
    id: string;
    status: string;
    subtotal: number;
    discount: number | null;
    total: number;
    fulfillment: string;
    address: string | null;
    phone: string | null;
    customer_name: string | null;
    created_at: string;
    order_items: { name: string; unit_price: number; quantity: number }[];
  };

  const fmtDate = new Date(order.created_at).toLocaleString(
    lang === "ar" ? "ar" : "en",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div className="py-8 print:py-0">
      <Container className="max-w-2xl">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link
            href={`/${lang}/merchant/${storeId}/orders`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronPrev className="h-4 w-4" />
            {dict.merchant.ordersTitle}
          </Link>
          <span className="flex items-center gap-2">
            {!inv && (
              <IssueInvoiceButton
                orderId={orderId}
                settingsHref={`/${lang}/merchant/${storeId}/settings`}
                labels={{
                  issue: t.issue,
                  issuing: t.issuing,
                  needsLegalName: t.needsLegalName,
                  goToSettings: t.goToSettings,
                  error: dict.common.actionFailed,
                }}
              />
            )}
            <PrintInvoiceButton label={dict.orders.print} />
          </span>
        </div>

        {/* The receipt itself — clean, black-on-white, PDF-ready. */}
        <div className="mt-4 rounded-2xl border border-border bg-surface p-6 print:mt-0 print:rounded-none print:border-0 print:p-0 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
            <div className="flex items-center gap-3">
              {s.logo_url && (
                <Image
                  src={s.logo_url}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-xl object-cover"
                />
              )}
              <div>
                <h1 className="text-xl font-extrabold">
                  {inv?.legal_name ?? s.name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {[inv?.legal_address ?? s.area, s.phone]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {inv?.tax_no && (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {t.taxNo}: {inv.tax_no}
                  </p>
                )}
                {inv?.commercial_reg_no && (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {t.crNo}: {inv.commercial_reg_no}
                  </p>
                )}
              </div>
            </div>
            <div className="text-end">
              <p className="text-lg font-extrabold">
                {inv ? t.legalTitle : t.title}
              </p>
              <p className="text-sm text-muted-foreground" dir="ltr">
                {inv ? inv.number : `#${order.id.slice(0, 8)}`}
              </p>
              {/* Until it is issued this is a receipt, not a فاتورة — saying so
                  is cheaper than a merchant finding out from an inspector. */}
              {!inv && (
                <p className="mt-1 text-xs font-semibold text-warning print:hidden">
                  {t.notIssued}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-b border-border py-4 text-sm">
            <div>
              <p className="font-bold">{t.customer}</p>
              <p className="text-muted-foreground">
                {order.customer_name ?? "—"}
              </p>
              {order.phone && (
                <p className="text-muted-foreground" dir="ltr">
                  <span dir="ltr">{order.phone}</span>
                </p>
              )}
              {order.address && (
                <p className="text-muted-foreground">{order.address}</p>
              )}
            </div>
            <div className="text-end">
              <p className="font-bold">{t.date}</p>
              <p className="text-muted-foreground">{fmtDate}</p>
              <p className="mt-1 text-muted-foreground">
                {order.fulfillment === "delivery"
                  ? dict.store.delivery
                  : dict.store.pickup}{" "}
                · {t.cod}
              </p>
            </div>
          </div>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-xs font-bold uppercase text-muted-foreground">
                <th className="pb-2 text-start">{t.item}</th>
                <th className="pb-2 text-center">{t.qty}</th>
                <th className="pb-2 text-end">{t.unitPrice}</th>
                <th className="pb-2 text-end">{t.lineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {order.order_items.map((it, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="py-2.5 font-semibold">{it.name}</td>
                  <td className="py-2.5 text-center tabular-nums">
                    {it.quantity}
                  </td>
                  <td className="py-2.5 text-end tabular-nums">
                    {money(it.unit_price)}
                  </td>
                  <td className="py-2.5 text-end font-bold tabular-nums">
                    {money(it.unit_price * it.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ms-auto mt-4 max-w-56 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t.subtotal}</span>
              <span className="tabular-nums">{money(order.subtotal)}</span>
            </div>
            {Number(order.discount) > 0 && (
              <div className="flex justify-between text-danger">
                <span>{t.discount}</span>
                <span className="tabular-nums">
                  -{money(Number(order.discount))}
                </span>
              </div>
            )}
            {inv && Number(inv.tax_amount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>
                  {t.vat} {Number(inv.tax_rate)}%
                  {inv.vat_inclusive ? ` (${t.vatIncludedShort})` : ""}
                </span>
                <span className="tabular-nums">
                  {money(Number(inv.tax_amount))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-base font-extrabold">
              <span>{t.total}</span>
              <span className="tabular-nums">
                {money(inv ? Number(inv.total) : order.total)}
              </span>
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-4 text-center text-sm text-muted-foreground">
            <p className="font-semibold">{t.thanks}</p>
            <p className="mt-1 text-xs">{t.poweredBy}</p>
          </div>
        </div>
      </Container>
    </div>
  );
}
