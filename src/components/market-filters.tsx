"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, BellPlus, Check } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { regions as catalogRegions } from "@/lib/catalog";
import type {
  MarketCategory,
  MarketCity,
  MarketRegion,
} from "@/lib/data/market";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type MarketFilterValues = {
  q: string;
  category: string;
  region: string;
  city: string;
  priceMin: string;
  priceMax: string;
  datePosted: string;
  sort: string;
};

export function MarketFilters({
  lang,
  dict,
  categories,
  cities,
  regions,
  initial,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "common" | "market">;
  categories: MarketCategory[];
  cities: MarketCity[];
  regions?: MarketRegion[];
  initial: MarketFilterValues;
}) {
  const regionList: MarketRegion[] =
    regions && regions.length
      ? regions
      : catalogRegions.map((r) => ({ key: r.key, name: r.name[lang] }));
  const router = useRouter();
  const t = dict.market;
  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [region, setRegion] = useState(initial.region);
  const [city, setCity] = useState(initial.city);
  const [priceMin, setPriceMin] = useState(initial.priceMin);
  const [priceMax, setPriceMax] = useState(initial.priceMax);
  const [datePosted, setDatePosted] = useState(initial.datePosted);
  const [sort, setSort] = useState(initial.sort);
  const [saved, setSaved] = useState(false);

  const hasCriteria =
    !!q.trim() || category !== "all" || region !== "all" || !!city.trim();

  async function saveSearch() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login`);
      return;
    }
    const { error } = await supabase.from("saved_searches").insert({
      user_id: user.id,
      q: q.trim() || null,
      category: category !== "all" ? category : null,
      region: region !== "all" ? region : null,
      city: city.trim() || null,
    });
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function navigate(overrides: Partial<MarketFilterValues> = {}) {
    const s = { q, category, region, city, priceMin, priceMax, datePosted, sort, ...overrides };
    const p = new URLSearchParams();
    if (s.q.trim()) p.set("q", s.q.trim());
    if (s.category !== "all") p.set("category", s.category);
    if (s.region !== "all") p.set("region", s.region);
    if (s.city.trim()) p.set("city", s.city.trim());
    if (s.priceMin) p.set("min", s.priceMin);
    if (s.priceMax) p.set("max", s.priceMax);
    if (s.datePosted !== "any") p.set("date", s.datePosted);
    if (s.sort !== "newest") p.set("sort", s.sort);
    const qs = p.toString();
    router.push(`/${lang}/market${qs ? `?${qs}` : ""}`);
  }

  function chip(active: boolean) {
    return active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-surface text-foreground border-border hover:border-primary/40";
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate();
        }}
        className="flex items-center gap-2"
      >
        {/* Every control carries an aria-label: a placeholder is not an
            accessible name (it vanishes on input, and <select> has none at all). */}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.search}
          aria-label={t.search}
          className="flex-1"
        />
        <Button type="submit" size="sm">
          {t.search.replace("…", "")}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setCategory("all");
            navigate({ category: "all" });
          }}
          className={`inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${chip(category === "all")}`}
        >
          {t.allCategories}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCategory(c.slug);
              navigate({ category: c.slug });
            }}
            className={`inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${chip(category === c.slug)}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-muted/40 p-3">
        <SlidersHorizontal className="h-4 w-4 self-center text-muted-foreground" />
        <Select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          aria-label={t.filterRegion}
          className="w-40"
        >
          <option value="all">{t.allRegions}</option>
          {regionList.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
        <div className="w-28">
          <Input value={city} onChange={(e) => setCity(e.target.value)} list="market-filter-cities" placeholder={t.city} aria-label={t.city} />
        </div>
        <datalist id="market-filter-cities">
          {cities
            .filter((c) => region === "all" || c.region === region)
            .map((c) => (
              <option key={c.id} value={c.name} />
            ))}
        </datalist>
        <div className="w-24">
          <Input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} type="number" min="0" placeholder={t.priceMin} aria-label={t.priceMin} />
        </div>
        <div className="w-24">
          <Input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} type="number" min="0" placeholder={t.priceMax} aria-label={t.priceMax} />
        </div>
        <Select
          value={datePosted}
          onChange={(e) => setDatePosted(e.target.value)}
          aria-label={t.filterDate}
          className="w-32"
        >
          <option value="any">{t.dateAny}</option>
          <option value="24h">{t.date24h}</option>
          <option value="7d">{t.date7d}</option>
          <option value="30d">{t.date30d}</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t.sort} className="w-40">
          <option value="newest">{t.sortNewest}</option>
          <option value="oldest">{t.sortOldest}</option>
          <option value="cheapest">{t.sortCheapest}</option>
          <option value="expensive">{t.sortExpensive}</option>
        </Select>
        <Button size="sm" onClick={() => navigate()}>
          {t.sort}
        </Button>
      </div>

      {hasCriteria && (
        <Button
          variant="outline"
          size="sm"
          onClick={saveSearch}
          disabled={saved}
          leftIcon={
            saved ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <BellPlus className="h-4 w-4" />
            )
          }
        >
          {saved ? t.searchSaved : t.saveSearch}
        </Button>
      )}
    </div>
  );
}
