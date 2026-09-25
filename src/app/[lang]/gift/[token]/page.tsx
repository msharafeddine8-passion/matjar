import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gift } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createPublicClient } from "@/lib/supabase/public-client";
import { isCardToken } from "@/lib/loyalty";
import { formatGiftAmount, type GiftCurrency } from "@/lib/gift-cards";

// ===== Public gift-card balance — /[lang]/gift/[token] =====
//
// The link on a printed card's QR code and in the «ابعت عواتساب» message.
// Read-only, no login, server-rendered, no client JavaScript.
//
// It shows the BALANCE, never the code: the token here is a viewing
// credential, the code is the spending one (0310 keeps them separate, and
// get_gift_card() does not return the code). Unknown token -> NULL -> a real
// 404. NO loading.tsx over this segment (the soft-404 trap).

export const dynamic = "force-dynamic";

type GiftView = {
  store: { name: string; logo_url: string | null };
  currency: GiftCurrency;
  initial_amount: number | string;
  balance: number | string;
  expires_on: string | null;
  status: "active" | "void" | "expired";
  recipient_name: string | null;
  issued_on: string;
  movements: { at: string; kind: "redeem" | "refund"; amount: number | string }[];
  generated_at: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const title = isLocale(lang) ? (await getDictionary(lang)).loyaltyCards.giftPage.metaTitle : "Gift card";
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function GiftCardPublicPage({
  params,
}: {
  params: Promise<{ lang: string; token: string }>;
}) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  if (!isCardToken(token)) notFound();

  const { data, error } = await createPublicClient().rpc("get_gift_card", { p_token: token });
  if (error || !data) notFound();
  const g = data as GiftView;
  const currency: GiftCurrency = g.currency === "LBP" ? "LBP" : "USD";

  const dict = await getDictionary(lang);
  const t = dict.loyaltyCards.giftPage;
  const balance = Number(g.balance);
  const locale = lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB";
  const fmtDay = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Asia/Beirut" });
  const asOf = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Beirut",
  }).format(new Date(g.generated_at));
  const expiry = g.expires_on
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${g.expires_on}T00:00:00Z`),
      )
    : null;
  const state: "void" | "expired" | "spent" | null =
    g.status === "void" ? "void" : g.status === "expired" ? "expired" : balance <= 0 ? "spent" : null;

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-background px-4 py-6 text-foreground sm:py-10">
      <header className="flex items-center gap-3">
        {g.store.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- one small logo; next/image would add client JS and an optimizer round trip
          <img
            src={g.store.logo_url}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold" dir="auto">
            {g.store.name}
          </p>
          <p className="text-xs text-muted-foreground">{t.asOf.replace("{date}", asOf)}</p>
        </div>
      </header>

      <section className="mt-6 rounded-3xl bg-gradient-to-br from-primary to-primary-hover p-5 text-primary-foreground shadow-md">
        <p className="flex items-center gap-2 text-sm font-bold opacity-90">
          <Gift className="h-4 w-4" />
          {t.heading}
        </p>
        {g.recipient_name && (
          <p className="mt-1 text-lg font-extrabold" dir="auto">
            {t.to.replace("{name}", g.recipient_name)}
          </p>
        )}
        <p className="mt-4 text-xs font-bold uppercase tracking-wider opacity-90">{t.balance}</p>
        <p className="text-4xl font-extrabold tabular-nums">
          <bdi dir="ltr">{formatGiftAmount(balance, currency, lang)}</bdi>
        </p>
        <p className="text-sm opacity-90">
          {t.of.replace("{initial}", formatGiftAmount(Number(g.initial_amount), currency, lang))}
        </p>
        {expiry && <p className="mt-3 text-xs font-semibold opacity-90">{t.expires.replace("{date}", expiry)}</p>}
      </section>

      {state ? (
        <p className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{t.status[state]}</p>
      ) : (
        <p className="mt-4 rounded-2xl bg-surface-muted px-4 py-3 text-sm">{t.howTo}</p>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-bold">{t.movements}</h2>
        {g.movements.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.noMovements}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-surface">
            {g.movements.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>
                  <span className="font-semibold">{t.kinds[m.kind] ?? m.kind}</span>
                  <span className="ms-2 text-xs text-muted-foreground tabular-nums">{fmtDay.format(new Date(m.at))}</span>
                </span>
                <span className="font-bold tabular-nums">
                  <bdi dir="ltr">
                    {m.kind === "redeem" ? "−" : "+"}
                    {formatGiftAmount(Number(m.amount), currency, lang)}
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 text-xs text-muted-foreground">
        <p>{t.privacy}</p>
      </footer>
    </main>
  );
}
