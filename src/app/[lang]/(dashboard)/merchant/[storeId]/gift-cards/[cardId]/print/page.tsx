import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { PrintButton } from "@/components/ledger/print-button";
import { SITE_URL } from "@/lib/site";
import { formatGiftAmount, formatGiftCode, giftCardPath, type GiftCardRow } from "@/lib/gift-cards";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A printable gift card: shop name and logo, the amount in the card's own
// currency, the spending CODE, and a QR code to the read-only balance page.
// Printed by the browser (Print → paper or PDF): no PDF library, no cost. The
// dashboard chrome is print:hidden, so only the card reaches the paper.
//
// Owner only — the code is the spending credential and gift_cards is readable
// by the owner alone (0310). An unknown id redirects rather than 404s: this
// segment sits under merchant/[storeId]/loading.tsx.
export default async function GiftCardPrintPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string; cardId: string }>;
}) {
  const { lang, storeId, cardId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId) || !UUID_RE.test(cardId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.loyaltyCards.gift;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: storeRow } = await supabase
    .from("stores")
    .select("name, logo_url")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!storeRow) redirect(`/${lang}/merchant`);
  const store = storeRow as { name: string; logo_url: string | null };

  const { data: cardRow } = await supabase
    .from("gift_cards")
    .select("id, code, token, currency, initial_amount, balance, recipient_name, expires_on, status")
    .eq("id", cardId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (!cardRow) redirect(`/${lang}/merchant/${storeId}/gift-cards`);
  const card = cardRow as Pick<
    GiftCardRow,
    "id" | "code" | "token" | "currency" | "initial_amount" | "balance" | "recipient_name" | "expires_on" | "status"
  >;

  const link = `${SITE_URL}${giftCardPath(lang, card.token)}`;
  const qr = await QRCode.toDataURL(link, { width: 280, margin: 1 });
  const expiry = card.expires_on
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${card.expires_on}T00:00:00Z`))
    : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/${lang}/merchant/${storeId}/gift-cards`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>
        <PrintButton label={dict.loyaltyCards.common.print} />
      </div>

      {/* 85.6 × 54 mm is a bank card; this is twice that, so it reads from
          across a counter and still fits two to an A4 page. */}
      <article className="mx-auto flex aspect-[1.586] w-full max-w-[171mm] flex-col justify-between overflow-hidden rounded-3xl border-2 border-primary bg-gradient-to-br from-primary-soft to-surface p-6 text-foreground print:break-inside-avoid print:border-black print:bg-white print:text-black">
        <header className="flex items-center gap-3">
          {store.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- one small logo on a print page; next/image adds an optimizer round trip for nothing
            <img src={store.logo_url} alt="" width={44} height={44} className="h-11 w-11 rounded-xl border border-border object-cover" />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold" dir="auto">
              {store.name}
            </p>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground print:text-black">
              {t.print.heading}
            </p>
          </div>
          <p className="ms-auto text-3xl font-extrabold tabular-nums">
            <bdi dir="ltr">{formatGiftAmount(Number(card.initial_amount), card.currency, lang)}</bdi>
          </p>
        </header>

        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {card.recipient_name && (
              <p className="text-sm font-bold" dir="auto">
                {t.to.replace("{name}", card.recipient_name)}
              </p>
            )}
            <p className="text-xs text-muted-foreground print:text-black">{t.print.code}</p>
            <p dir="ltr" className="font-mono text-2xl font-extrabold tracking-widest">
              {formatGiftCode(card.code)}
            </p>
            <p className="text-xs text-muted-foreground print:text-black">
              {expiry ? t.print.validUntil.replace("{date}", expiry) : t.print.noExpiry}
            </p>
          </div>
          <figure className="shrink-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL */}
            <img src={qr} alt="" width={112} height={112} className="h-28 w-28 rounded-lg bg-white p-1" />
            <figcaption className="mt-1 text-[10px] text-muted-foreground print:text-black">{t.print.scan}</figcaption>
          </figure>
        </div>
      </article>

      <p className="mt-4 text-center text-xs text-muted-foreground print:hidden">{t.print.hint}</p>
    </div>
  );
}
