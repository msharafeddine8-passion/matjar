import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { ArrowNext } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { BusinessOs } from "@/components/business-os";
import { FeatureRoadmap } from "@/components/feature-roadmap";
import { categoryKeys, type CategoryKey } from "@/lib/catalog";
import { sectorConfig } from "@/lib/sectors";
import { leadKinds, sectorCapabilities } from "@/lib/feature-availability";
import { fillPlanCopy, planCopyVars } from "@/lib/plan-copy";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  const m = dict.merchantsPage;
  return { title: m.metaTitle, description: m.metaDesc, alternates: localeAlternates(lang, "/merchants") };
}

// ISS-021. The four reassurances the WhatsApp-heavy shop owner is actually
// weighing — free, no card, cash on delivery, share on WhatsApp — sat eight
// sections below the fold in a "why merchants trust us" grid, which is a page
// nobody scrolls to before deciding whether to tap the button. They belong at
// the button. Rendered under BOTH store-creation CTAs on this page, because the
// second one is where the reader who scrolled the whole page ends up.
//
// It names the free product cap, not "free", because the free plan is capped and
// a merchant who finds that out after uploading their catalogue has been sold
// something. The number is the {freeProducts} placeholder, filled from
// planProductLimit("free") by lib/plan-copy — never typed into the dictionary.
function Reassurance({ items, center = false }: { items: readonly string[]; center?: boolean }) {
  return (
    <ul
      className={`mt-6 flex flex-wrap gap-x-5 gap-y-2 ${center ? "justify-center" : ""}`}
    >
      {items.map((line) => (
        <li
          key={line}
          className="flex items-start gap-1.5 text-start text-sm font-semibold text-muted-foreground"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          {line}
        </li>
      ))}
    </ul>
  );
}

export default async function MerchantsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const m = dict.merchantsPage;
  const base = `/${lang}`;
  const moduleLabels = dict.os.modules.labels;
  const copyVars = planCopyVars();
  const reassure = m.entryReassure.map((line) => fillPlanCopy(line, copyVars));

  // The inquiry kinds a listing sector's lead form really offers. The one place
  // this page names something narrower than a module — "request a viewing",
  // "request a test drive" — and it comes from leadKinds(), the same function
  // the storefront form is built from.
  const inquiryLine = (category: CategoryKey): string | null => {
    const kinds = leadKinds(category);
    if (kinds.length < 2) return null;
    return kinds.map((k) => dict.leadForm.kinds[k as keyof typeof dict.leadForm.kinds]).join(" · ");
  };

  return (
    <div className="pb-16">
      {/* Hero */}
      <div className="border-b border-border bg-surface-muted/30">
        <Container className="py-10 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{m.heroKicker}</span>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.14] tracking-tight sm:text-5xl">{m.heroTitle}</h1>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground sm:text-lg">{m.heroSub}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href={`${base}/merchant/new`} className="inline-flex h-12 items-center rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
                {dict.common.openStore}
              </Link>
              <Link href={`${base}/pricing`} className="inline-flex h-12 items-center rounded-xl border border-border bg-surface px-6 text-sm font-bold transition-colors hover:border-primary/40">
                {m.seePricing}
              </Link>
            </div>
            <Reassurance items={reassure} />
          </div>
        </Container>
      </div>

      <Container>
        {/* Problem */}
        <div className="mx-auto mt-14 max-w-2xl rounded-3xl border border-border bg-surface p-7 text-center shadow-sm sm:p-9">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-foreground"><AlertCircle className="h-6 w-6" /></span>
          <h2 className="mt-4 text-xl font-extrabold sm:text-2xl">{m.problemTitle}</h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">{m.problemBody}</p>
        </div>
      </Container>

      {/* OS grid (reused band) */}
      <div className="mt-14">
        <BusinessOs lang={lang} dict={dict} />
      </div>

      <Container>
        {/* How it works */}
        <div className="mt-16">
          <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">{m.howTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {m.steps.map((s, i) => (
              <div key={i} className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-sm font-extrabold text-primary-foreground">{i + 1}</span>
                <h3 className="mt-4 font-bold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── What each sector actually gets ────────────────────────────────
            This page used to say "add your products or services" and list six
            sector NAMES, which told a restaurant owner nothing a generic website
            builder would not also claim. Every card below is computed by
            sectorCapabilities(): the sector's own module bundle from the
            registry, narrowed to what the storefront resolver really renders and
            to what the availability config marks live. So a clinic's card says
            appointments and doctors, a restaurant's says menu and table
            reservations, and neither can outrun the product — a screen that goes
            away takes its claim with it. */}
        <section className="mt-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{m.sectorsTitle}</h2>
            <p className="mt-3 text-muted-foreground">{m.sectorsSub}</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categoryKeys.map((key) => {
              const { Icon, iconTint } = sectorConfig[key];
              const caps = sectorCapabilities(key);
              const inquiries = caps.includes("leads") ? inquiryLine(key) : null;
              return (
                <article
                  key={key}
                  className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconTint}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-bold leading-tight">{dict.catalog[key].name}</h3>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {dict.catalog[key].desc}
                      </p>
                    </div>
                  </div>

                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {caps.map((cap) => (
                      <li
                        key={cap}
                        className="rounded-lg border border-border bg-surface-muted/60 px-2.5 py-1 text-xs font-semibold"
                      >
                        {moduleLabels[cap]}
                      </li>
                    ))}
                  </ul>

                  {inquiries && (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {inquiries}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">{m.sectorsNote}</p>
          <div className="mt-5 flex justify-center">
            <Link
              href={`${base}/pricing`}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-bold transition-colors hover:border-primary/40"
            >
              {m.sectorsCta}
              <ArrowNext className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {/* Trust */}
        <div className="mt-16">
          <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">{m.trustTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {m.trust.map((tr, i) => (
              <div key={i} className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><Check className="h-5 w-5" /></span>
                <h3 className="mt-3 font-bold">{tr.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{tr.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* What is not built. Same component as /pricing, so the two pages
            cannot end up disagreeing about it. */}
        <div className="mt-16">
          <FeatureRoadmap dict={dict} />
        </div>

        {/* Final CTA */}
        <div className="mt-16 overflow-hidden rounded-3xl border border-border bg-surface-muted/40 p-8 text-center sm:p-12">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{m.finalTitle}</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">{m.finalSub}</p>
          <Link href={`${base}/merchant/new`} className="mt-6 inline-flex h-12 items-center rounded-xl bg-primary px-8 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
            {dict.common.openStore}
          </Link>
          <Reassurance items={reassure} center />
        </div>
      </Container>
    </div>
  );
}
