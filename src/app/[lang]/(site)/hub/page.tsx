import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  GraduationCap,
  Crown,
  LayoutGrid,
  Store,
  TrendingUp,
  Tag,
  MessageSquare,
  Users,
  ClipboardList,
  Package,
  BarChart3,
  Ticket,
  Check,
  MapPin,
  Blocks,
  UtensilsCrossed,
  Scissors,
  Stethoscope,
  Wrench,
  Building2,
} from "lucide-react";
import { ArrowNext, ChevronNext } from "@/components/ui/directional-icon";
import type { LucideIcon } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { getAcademyGuides } from "@/lib/data/academy";
import { createClient } from "@/lib/supabase/server";
import { featureCopy } from "@/lib/feature-availability";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.hub.title,
    description: dict.hub.subtitle,
    alternates: localeAlternates(lang, "/hub"),
  };
}

const STRIP_ICONS: LucideIcon[] = [Tag, MessageSquare, Crown, Store, LayoutGrid];
const GROWTH_ICONS: LucideIcon[] = [GraduationCap, Check, Crown, Store, TrendingUp];
const KIT_ICONS: LucideIcon[] = [ClipboardList, Users, Package, BarChart3, Ticket];
const SEG_ICONS: LucideIcon[] = [UtensilsCrossed, Store, Scissors, Stethoscope, Wrench, Building2];
const WHY_ICONS: LucideIcon[] = [Check, MapPin, Users, Blocks];

export default async function HubPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const h = dict.hub;
  const m = h.home;
  const base = `/${lang}`;
  const guideCount = (await getAcademyGuides()).length;

  // The leaders card in the hero cluster said "Soon" unconditionally — a
  // fixed badge string that would have kept saying it after the first profile
  // was published. Same predicate /hub/leaders renders its directory from
  // (`published = true`), so the two pages cannot disagree about whether the
  // directory exists; the pending word is the registry's canonical one.
  const supabase = await createClient();
  const { count: leaderCount } = await supabase
    .from("business_leaders")
    .select("id", { count: "exact", head: true })
    .eq("published", true);
  const leadersLine =
    (leaderCount ?? 0) > 0 ? h.leaders.heroBrowse : featureCopy("coming_soon", dict);

  return (
    <div className="pb-16">
      {/* ===== HERO ===== */}
      <div className="border-b border-border bg-surface-muted/30">
        <Container className="py-12 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{m.heroKicker}</span>
              <h1 className="mt-4 text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-5xl">
                {m.heroTitle}
              </h1>
              <p className="mt-4 max-w-md text-muted-foreground sm:text-lg">{m.heroSub}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href={`${base}/hub/academy`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
                  <GraduationCap className="h-4 w-4" />
                  {h.enterAcademy}
                </Link>
                <Link href={`${base}/hub/leaders`} className="inline-flex h-11 items-center rounded-xl border border-border bg-surface px-5 text-sm font-bold transition-colors hover:border-primary/40">
                  {m.submitProfile}
                </Link>
                <Link href={`${base}/merchant/new`} className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-bold text-primary transition-colors hover:bg-primary-soft">
                  {dict.common.openStore}
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {m.trust.map((t) => (
                  <span key={t} className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground">{t}</span>
                ))}
              </div>
            </div>

            {/* dashboard cluster over faint grid. overflow-x-clip because the
                grid below is -inset-6 and this block sits at the viewport edge
                on a phone: 24px of decoration was reaching 4px past the right
                edge and giving the whole page a horizontal scroll. clip, not
                hidden — it makes no scroll container and leaves the vertical
                bleed alone. */}
            <div className="relative overflow-x-clip">
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-6 -z-10 opacity-60"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(128,128,128,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(128,128,128,.16) 1px,transparent 1px)",
                  backgroundSize: "34px 34px",
                  WebkitMaskImage: "radial-gradient(70% 70% at 70% 30%,#000,transparent 75%)",
                  maskImage: "radial-gradient(70% 70% at 70% 30%,#000,transparent 75%)",
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="row-span-2 flex flex-col justify-between rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div>
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><GraduationCap className="h-5 w-5" /></span>
                    <h3 className="mt-3 text-sm font-extrabold">{h.academyTitle}</h3>
                    <p className="text-xs text-muted-foreground">{guideCount} أدلّة عمليّة</p>
                  </div>
                  <div className="mt-4 flex h-12 items-end gap-1.5">
                    {[40, 62, 50, 86, 70].map((v, i) => (
                      <span key={i} className={`flex-1 rounded-t ${i === 3 ? "bg-primary" : "bg-primary-soft"}`} style={{ height: `${v}%` }} />
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-primary"><TrendingUp className="h-5 w-5" /></span>
                  <h3 className="mt-3 text-sm font-extrabold">النموّ</h3>
                  <p className="text-xs text-muted-foreground">تابع أداءك ونموّك</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent-foreground"><Crown className="h-5 w-5" /></span>
                  <h3 className="mt-3 text-sm font-extrabold">{h.leadersTitle}</h3>
                  <p className="text-xs text-muted-foreground">{leadersLine}</p>
                </div>
                <div className="col-span-2 rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><LayoutGrid className="h-5 w-5" /></span>
                    <div>
                      <h3 className="text-sm font-extrabold">{m.toolsCardTitle}</h3>
                      <p className="text-xs text-muted-foreground">إدارة الطلبات · الزبائن · المخزون</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>

      <Container className="mt-14">
        {/* ===== 4 SECTION CARDS ===== */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SectionCard href={`${base}/hub/academy`} Icon={GraduationCap} title={h.academyTitle} note={h.academyNote} cta={h.enterAcademy} />
          <SectionCard href={`${base}/hub/leaders`} Icon={Crown} gold title={h.leadersTitle} note={h.leadersNote} cta={h.enterLeaders} />
          <SectionCard href={`${base}/pricing`} Icon={LayoutGrid} title={m.toolsCardTitle} note={m.toolsCardNote} cta={m.toolsCardCta} pro />
          <SectionCard href={`${base}/merchant/new`} Icon={Store} title={m.storeCardTitle} note={m.storeCardNote} cta={m.storeCardCta} accent />
        </div>

        {/* ===== FEATURE STRIP ===== */}
        <h2 className="mt-16 text-xl font-extrabold tracking-tight">{m.stripTitle}</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {m.strip.map((t, i) => {
            const Icon = STRIP_ICONS[i] ?? Check;
            return (
              <div key={i} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="h-5 w-5" /></span>
                <p className="mt-3 text-sm font-semibold leading-snug">{t}</p>
              </div>
            );
          })}
        </div>

        {/* ===== GROWTH MAP ===== */}
        <h2 className="mt-16 text-xl font-extrabold tracking-tight">{m.growthTitle}</h2>
        <div className="mt-5 flex items-stretch gap-1 overflow-x-auto pb-2">
          {m.growth.map((t, i) => {
            const Icon = GROWTH_ICONS[i] ?? Check;
            const last = i === m.growth.length - 1;
            return (
              <div key={i} className="flex min-w-[150px] flex-1 items-center gap-1">
                <div className={`flex-1 rounded-2xl border p-4 shadow-sm ${last ? "border-primary/40 bg-primary-soft" : "border-border bg-surface"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-primary num">{String(i + 1).padStart(2, "0")}</span>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="mt-2 text-sm font-bold">{t}</h3>
                </div>
                {!last && <ChevronNext className="h-5 w-5 shrink-0 text-muted-foreground/50" />}
              </div>
            );
          })}
        </div>

        {/* ===== TOOLKIT PREVIEW ===== */}
        <div className="mt-16 flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-extrabold tracking-tight">{m.kitTitle}</h2>
          <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-bold text-primary">Pro</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {m.kit.map((t, i) => {
            const Icon = KIT_ICONS[i] ?? Check;
            return (
              <div key={i} className="rounded-2xl border border-border bg-surface-muted/40 p-4 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-surface text-primary shadow-sm"><Icon className="h-5 w-5" /></span>
                <p className="mt-2.5 text-sm font-semibold">{t}</p>
              </div>
            );
          })}
        </div>

        {/* ===== FOR EVERY MERCHANT + WHY ===== */}
        <div className="mt-16 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">{m.everyTitle}</h2>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {m.every.map((t, i) => {
                const Icon = SEG_ICONS[i] ?? Store;
                return (
                  <span key={i} className="inline-flex items-center gap-2.5 rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold shadow-sm">
                    <Icon className="h-4 w-4 text-primary" /> {t}
                  </span>
                );
              })}
            </div>
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">{m.whyTitle}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {m.why.map((w, i) => {
                const Icon = WHY_ICONS[i] ?? Check;
                return (
                  <div key={i} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="h-5 w-5" /></span>
                    <h3 className="mt-3 text-sm font-bold">{w.t}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{w.d}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ===== CTA BAND ===== */}
        <div className="mt-16 overflow-hidden rounded-3xl border border-border bg-gradient-to-bl from-primary/10 to-transparent p-8 text-center sm:p-12">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{m.bandTitle}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{m.bandNote}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={`${base}/merchant/new`} className="inline-flex h-11 items-center rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">{dict.common.openStore}</Link>
            <Link href={`${base}/hub/leaders`} className="inline-flex h-11 items-center rounded-xl border border-border bg-surface px-6 text-sm font-bold transition-colors hover:border-primary/40">{m.submitProfile}</Link>
          </div>
        </div>
      </Container>
    </div>
  );
}

function SectionCard({
  href,
  Icon,
  title,
  note,
  cta,
  gold,
  pro,
  accent,
}: {
  href: string;
  Icon: LucideIcon;
  title: string;
  note: string;
  cta: string;
  gold?: boolean;
  pro?: boolean;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
        accent ? "border-primary/30 bg-gradient-to-b from-primary-soft to-transparent" : "border-border bg-surface hover:border-primary/40"
      }`}
    >
      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${gold ? "bg-accent-soft text-accent-foreground" : "bg-primary-soft text-primary"}`}>
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="mt-4 flex items-center gap-2 font-bold transition-colors group-hover:text-primary">
        {title}
        {pro && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">Pro</span>}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{note}</p>
      <span className={`mt-4 inline-flex items-center gap-1.5 text-sm font-bold ${gold ? "text-accent-foreground" : "text-primary"}`}>
        {cta}
        <ArrowNext className="h-4 w-4 transition-transform ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
      </span>
    </Link>
  );
}
