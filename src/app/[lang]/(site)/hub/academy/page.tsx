import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, GraduationCap } from "lucide-react";
import { ArrowNext, ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { AcademyExplorer, type LightGuide } from "@/components/hub/academy-explorer";
import { CATEGORY_STYLE, LEARNING_PATHS } from "@/content/academy";
import { getAcademyGuides } from "@/lib/data/academy";
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
    title: dict.hub.academy.title,
    description: dict.hub.academy.subtitle,
    alternates: localeAlternates(lang, "/hub/academy"),
  };
}

export default async function AcademyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const a = dict.hub.academy;
  const en = lang === "en";
  const guides = await getAcademyGuides();
  const featured = guides[0];
  const fs = CATEGORY_STYLE[featured.category];
  const light: LightGuide[] = guides.map((g) => ({
    slug: g.slug,
    title: g.title,
    titleEn: g.titleEn,
    excerpt: g.excerpt,
    readMin: g.readMin,
    category: g.category,
    level: g.level,
  }));

  return (
    <div className="pb-16">
      <Container className="pt-10 sm:pt-14">
        <Link href={`/${lang}/hub`} className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ChevronPrev className="h-4 w-4" />
          {dict.hub.backToHub}
        </Link>

        {/* Hero */}
        <div className="mt-5">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            <GraduationCap className="h-4 w-4" />
            {a.eyebrow}
          </span>
          <h1 className="mt-4 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">{a.title}</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground sm:text-lg">{a.subtitle}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/${lang}/hub/academy/${featured.slug}`} className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">{a.startFirst}</Link>
            <a href="#topics" className="inline-flex h-11 items-center rounded-xl border border-border bg-surface px-5 text-sm font-bold transition-colors hover:border-primary/40">{a.browseTopics}</a>
          </div>
        </div>

        {/* Featured */}
        <div className="mt-10 grid overflow-hidden rounded-3xl border border-border shadow-sm md:grid-cols-[1.2fr_1fr]">
          <div className="p-7 sm:p-9">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${fs.tint}`}>{a.categories[featured.category]}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {a.readMin.replace("{n}", String(featured.readMin))}</span>
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">{en ? featured.titleEn : featured.title}</h2>
            <p className="mt-4 max-w-lg text-muted-foreground">{featured.excerpt}</p>
            <Link href={`/${lang}/hub/academy/${featured.slug}`} className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
              {a.read}
              <ArrowNext className="h-4 w-4" />
            </Link>
          </div>
          <div className={`grid place-items-center border-t border-border bg-gradient-to-bl ${fs.grad} to-transparent p-6 md:border-s md:border-t-0`}>
            {/* pricing viz (featured guide is the pricing guide) */}
            <div className="w-full max-w-[240px] rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex justify-between border-b border-dashed border-border py-2 text-sm text-muted-foreground"><span>التكلفة</span><span className="num">١٠٫٠٠</span></div>
              <div className="flex justify-between border-b border-dashed border-border py-2 text-sm text-muted-foreground"><span>الهامش ٣٣٪</span><span className="num">+٥٫٠٠</span></div>
              <div className="flex justify-between border-b border-dashed border-border py-2 text-sm text-muted-foreground"><span>الضريبة</span><span className="num">+١٫٦٥</span></div>
              <div className="mt-1 flex justify-between border-t-2 border-foreground pt-2 text-base font-extrabold"><span>السعر المقترح</span><span className="num text-primary">١٦٫٦٥</span></div>
            </div>
          </div>
        </div>

        {/* Categories + recommend + article grid (client, interactive filters) */}
        <AcademyExplorer guides={light} featuredSlug={featured.slug} dict={dictSlice(dict, ["features", "hub"])} lang={lang} />

        {/* Learning paths */}
        <div className="mt-16">
          <h2 className="text-xl font-extrabold tracking-tight">{a.pathsTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{a.pathsSub}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {LEARNING_PATHS.map((p) => {
              const s = CATEGORY_STYLE[p.category];
              const Icon = p.Icon;
              return (
                <div key={p.slug} className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-11 w-11 place-items-center rounded-xl ${s.tint}`}><Icon className="h-5 w-5" /></span>
                    <div>
                      <h3 className="font-bold">{en ? p.titleEn : p.title}</h3>
                      <span className="text-xs font-semibold text-muted-foreground">{a.lessonsN.replace("{n}", String(p.lessons.length))}</span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2.5">
                    {p.lessons.map((l, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold ${s.tint}`}>{i + 1}</span>
                        {en ? l.en : l.ar}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Merchant CTA */}
        <div className="mt-16 overflow-hidden rounded-3xl border border-border bg-gradient-to-bl from-primary/10 to-transparent p-8 text-center sm:p-12">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{a.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{a.ctaNote}</p>
          <Link href={`/${lang}/merchant`} className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
            {a.ctaButton}
            <ArrowNext className="h-4 w-4" />
          </Link>
        </div>
      </Container>
    </div>
  );
}
