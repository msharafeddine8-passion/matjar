"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";

export function HeroSearch({
  lang,
  dict,
  browse,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "hero">;
  /** The browse chips under the field (server-rendered, see hero.tsx). An
   *  element, not data: which sectors have supply is a server read. */
  browse?: ReactNode;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("all");

  function go(term?: string) {
    const query = (term ?? q).trim();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (region !== "all") params.set("region", region);
    const qs = params.toString();
    // A search term goes to the unified results page (stores + products +
    // listings); a bare region browse stays on explore.
    const dest = query ? "search" : "explore";
    router.push(`/${lang}/${dest}${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-2 shadow-lg transition-all duration-300 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 sm:flex-row sm:items-center sm:gap-0 sm:rounded-full"
      >
        <div className="flex items-center gap-2 px-3 text-sm sm:h-14 sm:border-e sm:border-border">
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            aria-label={dict.hero.locationAll}
            className="cursor-pointer whitespace-nowrap bg-transparent py-2.5 font-semibold outline-none"
          >
            <option value="all">{dict.hero.locationAll}</option>
            {regions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name[lang]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 items-center gap-2 px-3 sm:h-14">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={dict.hero.searchPlaceholder}
            aria-label={dict.hero.searchButton}
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-xl bg-primary px-7 text-sm font-bold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary-hover hover:shadow-md active:scale-[0.97] sm:rounded-full"
        >
          {dict.hero.searchButton}
        </button>
      </form>

      {browse}
    </div>
  );
}
