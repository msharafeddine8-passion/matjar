import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createPublicClient } from "@/lib/supabase/public-client";
import {
  formatLedgerAmount,
  isLedgerCurrency,
  withRunningBalance,
  type LedgerEntry,
} from "@/lib/ledger";
import { PrintButton } from "@/components/ledger/print-button";

// ===== Public ledger statement — /[lang]/statement/[token] =====
//
// What a customer opens from the WhatsApp reminder. Read-only, no login.
//
// WHY IT LIVES OUTSIDE (site): the storefront chrome — header search, cart,
// bottom nav, the app shell's client bundle — is the wrong thing to send to a
// customer on a weak connection who only needs to read one table. The [lang]
// root layout still supplies <html lang dir>, the fonts and the theme, so the
// page is RTL-correct without any of the marketplace's JavaScript. The only
// client component is the print button.
//
// Privacy is decided in the database, not here: get_ledger_statement()
// (migration 0307) returns the shop's name and logo, the customer's NAME (never
// the phone), each line's date / kind / amount / currency / note, and the
// per-currency balance — no attachment, no staff identity, no ids. An unknown
// or revoked token returns NULL, which becomes a real 404 below.
//
// NO loading.tsx may be added over this segment: a Suspense boundary above the
// page lets Next flush a 200 before notFound() runs, which is how this repo
// once served soft-404s (see [lang]/not-found.tsx).

export const dynamic = "force-dynamic";

type Statement = {
  store: { name: string; logo_url: string | null };
  customer: { name: string };
  entries: {
    date: string;
    kind: LedgerEntry["kind"];
    amount: number | string;
    currency: string;
    label: string | null;
  }[];
  balances: { currency: string; balance: number | string }[];
  generated_at: string;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const title = isLocale(lang)
    ? (await getDictionary(lang)).ledger.public.metaTitle
    : "Statement";
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
    // The token is the credential; keep it out of any Referer header.
    referrer: "no-referrer",
  };
}

export default async function StatementPage({
  params,
}: {
  params: Promise<{ lang: string; token: string }>;
}) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  if (!TOKEN_RE.test(token)) notFound();

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_ledger_statement", {
    p_token: token,
  });
  if (error || !data) notFound();
  const s = data as Statement;

  const dict = await getDictionary(lang);
  const t = dict.ledger.public;

  const entries: LedgerEntry[] = s.entries
    .filter((e) => isLedgerCurrency(e.currency))
    .map((e, i) => ({
      id: String(i).padStart(6, "0"),
      kind: e.kind,
      amount: Number(e.amount),
      currency: e.currency as LedgerEntry["currency"],
      happened_on: e.date,
      // Already in chronological order from the database; the index keeps it.
      created_at: String(i).padStart(6, "0"),
      label: e.label,
    }));
  const rows = withRunningBalance(entries);
  const balances = s.balances
    .filter((b) => isLedgerCurrency(b.currency))
    .map((b) => ({
      currency: b.currency as LedgerEntry["currency"],
      balance: Number(b.balance),
    }))
    .filter((b) => b.balance !== 0);

  const dateFmt = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const fmtDay = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
  const asOf = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Beirut",
  }).format(new Date(s.generated_at));

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background px-4 py-6 text-foreground sm:py-10 print:max-w-none print:bg-white print:p-0 print:text-black">
      <header className="flex items-center gap-3">
        {s.store.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a single small logo; next/image would add client JS and an optimizer round trip for no gain here
          <img
            src={s.store.logo_url}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold">{s.store.name}</p>
          <p className="text-xs text-muted-foreground print:text-black">
            {t.asOf.replace("{date}", asOf)}
          </p>
        </div>
        <div className="ms-auto">
          <PrintButton label={t.print} />
        </div>
      </header>

      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">{t.heading}</h1>
      <p className="mt-1 text-sm font-semibold">{t.customer.replace("{name}", s.customer.name)}</p>

      <section className="mt-5 rounded-2xl border border-border bg-surface p-4 print:border-black print:bg-white">
        <p className="text-xs font-bold text-muted-foreground print:text-black">{t.balance}</p>
        {balances.length === 0 ? (
          <p className="mt-1 text-xl font-extrabold">{t.nothingDue}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {balances.map((b) => (
              <li key={b.currency} className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold tabular-nums">
                  <bdi dir="ltr">{formatLedgerAmount(b.balance, b.currency, lang)}</bdi>
                </span>
                {b.balance < 0 && (
                  <span className="text-xs font-bold text-muted-foreground">{t.credit}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t.noEntries}</p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted-foreground print:border-black print:text-black">
              <th scope="col" className="py-2 pe-2 text-start font-bold">{t.date}</th>
              <th scope="col" className="py-2 pe-2 text-start font-bold">{t.detail}</th>
              <th scope="col" className="py-2 pe-2 text-end font-bold">{t.amount}</th>
              <th scope="col" className="py-2 text-end font-bold">{t.running}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-border align-top print:border-black/30">
                <td className="py-2 pe-2 whitespace-nowrap tabular-nums">{fmtDay(e.happened_on)}</td>
                <td className="py-2 pe-2">
                  <span className="font-semibold">{t.kinds[e.kind]}</span>
                  {e.label && <span className="block text-xs text-muted-foreground print:text-black">{e.label}</span>}
                </td>
                <td className="py-2 pe-2 text-end whitespace-nowrap font-bold tabular-nums">
                  <bdi dir="ltr">
                    {e.kind === "payment" ? "−" : "+"}
                    {formatLedgerAmount(e.amount, e.currency, lang)}
                  </bdi>
                </td>
                <td className="py-2 text-end whitespace-nowrap tabular-nums">
                  <bdi dir="ltr">
                    {e.running < 0 ? "−" : ""}
                    {formatLedgerAmount(e.running, e.currency, lang)}
                  </bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="mt-8 text-xs text-muted-foreground print:text-black">
        <p>{t.footer}</p>
        <p className="mt-1">{t.poweredBy}</p>
      </footer>
    </main>
  );
}
