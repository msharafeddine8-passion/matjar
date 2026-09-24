"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Sparkles, TrendingUp, Tag, Camera, MessageSquare, HeartHandshake, Share2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import {
  ACADEMY_CATEGORIES,
  CATEGORY_STYLE,
  CATEGORY_ICON,
  RECOMMEND_TOPICS,
  RECOMMEND_MAP,
  academyCategoryStatus,
  type AcademyCategory,
  type GuideLevel,
  type RecommendTopic,
} from "@/content/academy";
import { featureCopy } from "@/lib/feature-availability";

export type LightGuide = {
  slug: string;
  title: string;
  titleEn: string;
  excerpt: string;
  readMin: number;
  category: AcademyCategory;
  level: GuideLevel;
};

const TOPIC_ICON: Record<RecommendTopic, LucideIcon> = {
  sales: TrendingUp,
  pricing: Tag,
  photos: Camera,
  whatsapp: MessageSquare,
  service: HeartHandshake,
  instagram: Share2,
};

// Unified academy browser: clickable category cards (with live counts) + the
// "what to improve today?" topic pills. Both filter the same guide grid. The
// featured guide (shown above the fold) is dropped from the DEFAULT grid to
// avoid duplication, but reappears when a filter that matches it is active.
export function AcademyExplorer({
  guides,
  featuredSlug,
  dict,
  lang,
}: {
  guides: LightGuide[];
  featuredSlug: string;
  dict: Dictionary;
  lang: Locale;
}) {
  const a = dict.hub.academy;
  const en = lang === "en";
  const [cat, setCat] = useState<AcademyCategory | null>(null);
  const [topic, setTopic] = useState<RecommendTopic | null>(null);

  const count = (c: AcademyCategory) => guides.filter((g) => g.category === c).length;

  const shown = topic
    ? guides.filter((g) => RECOMMEND_MAP[topic].includes(g.slug))
    : cat
      ? guides.filter((g) => g.category === cat)
      : guides.filter((g) => g.slug !== featuredSlug);

  const active = cat !== null || topic !== null;
  const reset = () => {
    setCat(null);
    setTopic(null);
  };

  return (
    <div className="mt-16">
      {/* Categories */}
      <h2 id="topics" className="scroll-mt-24 text-xl font-extrabold tracking-tight">
        {en ? "Categories" : "التصنيفات"}
      </h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ACADEMY_CATEGORIES.map((c) => {
          const n = count(c);
          const s = CATEGORY_STYLE[c];
          const Icon = CATEGORY_ICON[c];
          const on = cat === c;
          const status = academyCategoryStatus(n);
          const empty = status !== "available";
          // The pending word is the registry's (features.status.coming_soon),
          // not the academy's own — one spelling of "not yet" across the site.
          const label = empty
            ? featureCopy(status, dict)
            : n === 1
              ? a.oneGuide
              : a.nGuides.replace("{n}", String(n));
          return (
            <button
              key={c}
              type="button"
              disabled={empty}
              onClick={() => {
                setTopic(null);
                setCat(on ? null : c);
              }}
              className={`rounded-2xl border p-4 text-start shadow-sm transition-all duration-200 ${
                empty
                  ? "cursor-default border-dashed border-border bg-surface-muted/30"
                  : on
                    ? "-translate-y-0.5 border-primary/50 bg-primary-soft/50 shadow-md"
                    : "border-border bg-surface hover:-translate-y-0.5 hover:border-primary/40"
              }`}
            >
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${s.tint}`}><Icon className="h-5 w-5" /></span>
              <h3 className="mt-3 flex items-center gap-1.5 font-bold">
                {a.categories[c]}
                {empty && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary">{a.new}</span>}
              </h3>
              <p className={`mt-2 text-xs font-bold ${empty ? "text-muted-foreground" : s.text}`}>{label}</p>
            </button>
          );
        })}
      </div>

      {/* Recommend pills */}
      <div className="mt-8 rounded-3xl border border-border bg-surface-muted/40 p-5 sm:p-6">
        <p className="flex items-center gap-2 font-extrabold">
          <Sparkles className="h-5 w-5 text-primary" />
          {a.recommendTitle}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {RECOMMEND_TOPICS.map((t) => {
            const Icon = TOPIC_ICON[t];
            const on = topic === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setCat(null);
                  setTopic(on ? null : t);
                }}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  on ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-foreground hover:border-primary/40"
                }`}
              >
                <Icon className="h-4 w-4" />
                {a.topics[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active-filter reset */}
      {active && (
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
          {a.allCategories}
        </button>
      )}

      {/* Article grid */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((g) => {
          const s = CATEGORY_STYLE[g.category];
          const Icon = CATEGORY_ICON[g.category];
          return (
            <Link
              key={g.slug}
              href={`/${lang}/hub/academy/${g.slug}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className={`relative h-20 border-b border-border/60 bg-gradient-to-bl ${s.grad} to-transparent`}>
                <span className={`absolute bottom-[-18px] end-4 grid h-11 w-11 place-items-center rounded-xl shadow-sm ${s.tint}`}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
              <div className="flex flex-1 flex-col p-5 pt-6">
                <div className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
                  <span className={s.text}>{a.categories[g.category]}</span>
                  <span>·</span>
                  <span>{a.levels[g.level]}</span>
                </div>
                <h3 className="mt-2 font-bold leading-snug transition-colors group-hover:text-primary">
                  {en ? g.titleEn : g.title}
                </h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{g.excerpt}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {a.readMin.replace("{n}", String(g.readMin))}
                  </span>
                  <span className="text-xs font-bold text-primary">{a.readArticle}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {a.noResults}
        </p>
      )}
    </div>
  );
}
