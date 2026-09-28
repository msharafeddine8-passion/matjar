import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Gift } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createPublicClient } from "@/lib/supabase/public-client";
import {
  cardProgress,
  isCardToken,
  programFromRow,
  rewardCost,
  rewardLabel,
  type LoyaltyKind,
} from "@/lib/loyalty";

// ===== Public loyalty card — /[lang]/loyalty/[token] =====
//
// What a customer opens from the «أرسل بطاقة الولاء» WhatsApp link and keeps
// bookmarked. Read-only, no login, server-rendered, no client JavaScript.
//
// Lives outside (site) for the same reason as /statement/[token]: a customer on
// a weak connection needs one card, not the marketplace shell. The [lang] root
// layout still supplies <html lang dir>, fonts and theme.
//
// Privacy is decided in the database: get_loyalty_card() (0310) returns the
// store's name and logo, the program, the member's NAME (never the phone),
// balances and the last 20 movements — no ids, no staff identity. An unknown
// token returns NULL, which becomes a real 404 below.
//
// NO loading.tsx may be added over this segment: a Suspense boundary above the
// page lets Next flush a 200 before notFound() runs (the soft-404 trap).

export const dynamic = "force-dynamic";

type Card = {
  store: { name: string; logo_url: string | null };
  member: { name: string | null };
  program: {
    kind: LoyaltyKind;
    is_active: boolean;
    stamps_required: number;
    points_per_usd: number;
    redeem_threshold: number;
    reward_label: string | null;
    reward_label_en: string | null;
  } | null;
  stamps: number;
  points: number;
  events: { at: string; kind: LoyaltyKind; delta: number; reason: "order" | "pos" | "adjust" | "reward" | "reversal" }[];
  generated_at: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const title = isLocale(lang) ? (await getDictionary(lang)).loyaltyCards.card.metaTitle : "Loyalty card";
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
    // The token is the credential; keep it out of any Referer header.
    referrer: "no-referrer",
  };
}

export default async function LoyaltyCardPage({
  params,
}: {
  params: Promise<{ lang: string; token: string }>;
}) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  if (!isCardToken(token)) notFound();

  const { data, error } = await createPublicClient().rpc("get_loyalty_card", { p_token: token });
  if (error || !data) notFound();
  const c = data as Card;

  const dict = await getDictionary(lang);
  const t = dict.loyaltyCards.card;
  const program = programFromRow(c.program);
  const kind: LoyaltyKind = program?.kind ?? (c.points > 0 && c.stamps === 0 ? "points" : "stamps");
  const balance = Math.max(0, kind === "stamps" ? Number(c.stamps) : Number(c.points));
  const progress = program ? cardProgress(balance, rewardCost(program)) : null;
  const reward = program ? rewardLabel(program, lang) : null;

  const locale = lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB";
  const fmtDay = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Asia/Beirut" });
  const asOf = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Beirut",
  }).format(new Date(c.generated_at));

  let status: string | null = null;
  if (!program) status = t.noProgram;
  else if (!program.isActive) status = t.paused;
  else if (progress && progress.rewardsReady === 1) status = t.readyOne;
  else if (progress && progress.rewardsReady > 1) status = t.readyMany.replace("{n}", String(progress.rewardsReady));
  else if (progress && kind === "stamps")
    status = progress.toNext === 1 ? t.toNextOne : t.toNextStamps.replace("{n}", String(progress.toNext));
  else if (progress) status = t.toNextPoints.replace("{n}", progress.toNext.toLocaleString("en-US"));
  const ready = !!progress && progress.rewardsReady > 0 && !!program?.isActive;

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-background px-4 py-6 text-foreground sm:py-10">
      <header className="flex items-center gap-3">
        {c.store.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- one small logo; next/image would add client JS and an optimizer round trip
          <img
            src={c.store.logo_url}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold" dir="auto">
            {c.store.name}
          </p>
          <p className="text-xs text-muted-foreground">{t.asOf.replace("{date}", asOf)}</p>
        </div>
      </header>

      <section className="mt-6 rounded-3xl bg-gradient-to-br from-primary to-primary-hover p-5 text-primary-foreground shadow-md">
        <p className="text-sm font-bold opacity-90">{t.heading}</p>
        {c.member.name && (
          <p className="mt-1 text-xl font-extrabold" dir="auto">
            {t.hello.replace("{name}", c.member.name)}
          </p>
        )}

        {kind === "stamps" && program ? (
          <>
            <ol
              className="mt-4 grid grid-cols-5 gap-2"
              aria-label={t.stampsOf
                .replace("{n}", String(progress?.current ?? 0))
                .replace("{total}", String(program.stampsRequired))}
            >
              {Array.from({ length: program.stampsRequired }, (_, i) => {
                const filled = i < (progress?.current ?? 0);
                return (
                  <li
                    key={i}
                    className={`flex aspect-square items-center justify-center rounded-full border-2 ${
                      filled ? "border-white bg-white text-primary" : "border-white/50"
                    }`}
                  >
                    {filled ? <Check className="h-5 w-5" strokeWidth={3} /> : null}
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-sm font-bold tabular-nums">
              {t.stampsOf
                .replace("{n}", String(progress?.current ?? 0))
                .replace("{total}", String(program.stampsRequired))}
            </p>
          </>
        ) : (
          <>
            <p className="mt-4 text-5xl font-extrabold tabular-nums">{balance.toLocaleString("en-US")}</p>
            <p className="text-sm opacity-90">{t.pointsUnit}</p>
            {progress && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/25" aria-hidden>
                <div className="h-full rounded-full bg-white" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
              </div>
            )}
          </>
        )}

        {reward && (
          <p className="mt-4 flex items-center gap-2 text-sm font-bold">
            <Gift className="h-4 w-4 shrink-0" />
            <span dir="auto">{t.rewardIs.replace("{reward}", reward)}</span>
          </p>
        )}
      </section>

      {status && (
        <p
          className={`mt-4 rounded-2xl px-4 py-3 text-sm font-bold ${
            ready ? "bg-success-soft text-success" : "bg-surface-muted text-foreground"
          }`}
        >
          {status}
        </p>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-bold">{t.history}</h2>
        {c.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.noHistory}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-surface">
            {c.events.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{t.reasons[e.reason] ?? e.reason}</span>
                  <span className="ms-2 text-xs text-muted-foreground tabular-nums">{fmtDay.format(new Date(e.at))}</span>
                </span>
                <span className={`font-bold tabular-nums ${e.delta >= 0 ? "text-primary" : "text-muted-foreground"}`}>
                  <bdi dir="ltr">
                    {e.delta > 0 ? "+" : "−"}
                    {Math.abs(e.delta).toLocaleString("en-US")}
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 space-y-1 text-xs text-muted-foreground">
        <p>{t.bookmark}</p>
        <p>{t.privacy}</p>
        <p>{t.poweredBy}</p>
      </footer>
    </main>
  );
}
