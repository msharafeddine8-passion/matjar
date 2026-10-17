import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Inbox, ShieldCheck, Star } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { ArrowNext } from "@/components/ui/directional-icon";
import {
  CraftJoinForm,
  type JoinArea,
  type JoinGroup,
  type JoinTrade,
} from "@/components/crafts/craft-join-form";
import { countActiveProviders } from "@/lib/data/crafts";
import { localeAlternates } from "@/lib/site";
import { dictSlice } from "@/lib/dict-slice";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.crafts.joinTitle,
    description: dict.crafts.joinSubtitle,
    // In the sitemap (seo-rules ALWAYS_INDEXED_PATHS) — so it states its own
    // canonical and the ar/en pair like every other listed page.
    alternates: localeAlternates(lang, "/crafts/join"),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Registering as a tradesman.
//
// With zero providers on the platform, this page matters more than the browse
// path does: a marketplace with demand and no supply is fixed here, and a
// marketplace with supply and no demand is at least a directory. So it stopped
// being a login wall.
//
// It used to `redirect(/login)` before rendering a single word, which meant the
// recruitment page could not recruit: a tradesman arriving from a WhatsApp
// forward saw a sign-in form and no reason to sign in. Now the argument comes
// first and the account comes when it is actually needed — the `craft_providers`
// insert policy is `to authenticated` and the row carries `user_id NOT NULL`,
// so an account is genuinely required to finish, just not to read.
//
// The pitch is three claims, and each one is a fact about how this platform is
// built rather than a promise about outcomes:
//   * the request arrives structured, because craft_requests carries the
//     problem, the area, the timing and photos;
//   * a rating can only come from a completed job, because craft_reviews_write
//     requires a request in status 'completed' belonging to the reviewer;
//   * their address is never published, because craft_providers has no address
//     column and coverage lives in a separate join table (§36).
// And then the fourth thing, which is the one that earns the other three: an
// honest statement that the section is empty and what that means for them.
// ────────────────────────────────────────────────────────────────────────────
export default async function CraftJoinPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.crafts;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // One provider profile per account. Someone who already has one is here by
  // accident — send them to it rather than letting them hit a unique violation.
  if (user) {
    const { data: existing } = await supabase
      .from("craft_providers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) redirect(`/${lang}/crafts/me`);
  }

  const [{ data: groups }, { data: trades }, { data: areas }, providerCount] =
    await Promise.all([
      supabase
        .from("trade_groups")
        .select("slug, name_ar, name_en, icon")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("trades")
        .select("id, name_ar, name_en, icon, group_slug")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("lb_areas")
        .select("id, slug, region, name_ar, name_en")
        .order("sort_order"),
      countActiveProviders(),
    ]);

  const reasons = [
    { Icon: Inbox, title: t.joinWhy1Title, body: t.joinWhy1Body },
    { Icon: Star, title: t.joinWhy2Title, body: t.joinWhy2Body },
    { Icon: ShieldCheck, title: t.joinWhy3Title, body: t.joinWhy3Body },
  ];
  const steps = [t.joinStep1, t.joinStep2, t.joinStep3];

  return (
    <div className="py-8 sm:py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/crafts`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.title}
        </Link>

        <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {t.joinLeadTitle}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.joinLeadBody}</p>

        {/* The honest panel, above the pitch rather than buried under it.
            A tradesman who is told the section is empty and signs up anyway is
            a tradesman who will still be here in three months. */}
        <section className="mt-6 rounded-2xl border border-border bg-primary-soft/60 p-5">
          <h2 className="font-extrabold">{t.joinHonestTitle}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t.joinHonestBody}
          </p>
          {providerCount === 0 && (
            <p className="mt-2 text-xs font-semibold text-primary">
              {t.emptyHeadline}
            </p>
          )}
        </section>

        {/* Three reasons, each one a fact about the schema rather than a
            promise about earnings. */}
        <ul className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          {reasons.map(({ Icon, title, body }) => (
            <li
              key={title}
              className="min-w-0 rounded-2xl border border-border bg-surface p-4"
            >
              <Icon aria-hidden className="h-5 w-5 text-primary" />
              <p className="mt-2 font-bold">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>

        <section className="mt-6">
          <h2 className="font-extrabold">{t.joinStepsTitle}</h2>
          <ol className="mt-2 space-y-2">
            {steps.map((s, i) => (
              <li key={s} className="flex min-w-0 items-start gap-3">
                <span
                  dir="ltr"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-extrabold tabular-nums text-primary"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 text-sm text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </section>

        {user ? (
          <div className="mt-8">
            <h2 className="text-lg font-extrabold">{t.joinTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.joinSubtitle}</p>
            <div className="mt-4">
              <CraftJoinForm
                userId={user.id}
                lang={lang}
                dict={dictSlice(dict, ["auth", "crafts", "upload"])}
                groups={(groups ?? []) as JoinGroup[]}
                trades={(trades ?? []) as JoinTrade[]}
                areas={(areas ?? []) as JoinArea[]}
              />
            </div>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-extrabold">{t.joinTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.joinSignInNote}
            </p>
            {/* Comes back HERE afterwards, rather than dumping them on the
                homepage having lost the intent that brought them. */}
            <ButtonLink
              href={`/${lang}/login?next=/${lang}/crafts/join`}
              className="mt-4"
              rightIcon={<ArrowNext className="h-4 w-4" />}
            >
              {t.joinSignInCta}
            </ButtonLink>
            <p className="mt-3 text-xs text-muted-foreground">
              {t.joinReviewNote}
            </p>
          </div>
        )}

        {/* The person who followed a "سجّل حرفتك" link by mistake and actually
            has a broken boiler. One line, at the bottom, out of the way. */}
        <section className="mt-6 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border p-4">
          <div className="min-w-0">
            <p className="font-bold">{t.joinCustomerTitle}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t.joinCustomerBody}
            </p>
          </div>
          <ButtonLink
            href={`/${lang}/crafts/requests`}
            variant="secondary"
            className="shrink-0"
          >
            {t.emptyPrimary}
          </ButtonLink>
        </section>
      </Container>
    </div>
  );
}
