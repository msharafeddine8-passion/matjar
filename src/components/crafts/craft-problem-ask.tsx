"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { tradeIcon } from "@/lib/trade-icons";
import { craftIntentFromProblem } from "@/lib/pro-market";
import { AREA_BY_SLUG, TRADES } from "@/lib/search-intent";
import type { Locale } from "@/i18n/config";
import type { AreaRef } from "@/lib/data/crafts";

type Suggestion = {
  slug: string;
  name_ar: string;
  name_en: string;
  icon: string | null;
};

// ────────────────────────────────────────────────────────────────────────────
// "شو خربان؟"
//
// The old box asked "شو بدك تصلّح؟" and then made the customer pick a
// PROFESSION — it navigated to a trade page and the job of working out that a
// fridge that stopped cooling is `fridge-repair` and not `appliance-general`
// was handed to the person with the broken fridge. That is the wrong way round:
// a customer knows the symptom, the platform knows the taxonomy.
//
// So this box takes the sentence and keeps it. `search_trades` resolves the
// wording against the trades' synonyms while they type — "كهربجي" is not the
// name of anything in the taxonomy and still lands on `electrician` — and the
// suggestions are OFFERED, not required: the primary button works with the
// trade unset, because "مش متأكد" is a real answer and the request flow can
// carry it.
//
// Phase 4: the box also reads the sentence with the SAME lexicon site search
// uses (lib/search-intent via lib/pro-market), locally and with no round trip.
// «كهربجي طرابلس» is understood as electrician + Tripoli before the RPC has
// answered, the place fills the area picker (until the customer touches it
// themselves), and the understood trade rides into the request flow, where it
// is shown and can be changed. The RPC still runs for the words the lexicon
// does not carry, and its hits are offered after the understood one.
//
// One destination, on purpose. A box with two exits (browse there, ask here)
// makes the customer choose a strategy before they have said what is wrong.
// ────────────────────────────────────────────────────────────────────────────

export function CraftProblemAsk({
  lang,
  areasByRegion,
  regionNames,
  labels,
}: {
  lang: Locale;
  areasByRegion: Record<string, AreaRef[]>;
  regionNames: Record<string, string>;
  labels: {
    placeholder: string;
    where: string;
    anywhere: string;
    submit: string;
    didYouMean: string;
    needProblem: string;
    /** "فهمنا:" — the lead-in for what the lexicon understood. */
    understood?: string;
  };
}) {
  const router = useRouter();
  const ar = lang === "ar";
  const [problem, setProblem] = useState("");
  const [area, setArea] = useState("");
  // Once the customer picks an area themselves, the sentence stops steering it.
  const [areaTouched, setAreaTouched] = useState(false);
  const [trade, setTrade] = useState<Suggestion | null>(null);
  const [hits, setHits] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastQuery = useRef("");

  // Debounced so a fast typist does not fire a query per keystroke. Only the
  // first few words are searched: the taxonomy match lives in the noun, and
  // sending a whole paragraph to a trigram search returns noise.
  //
  // The too-short case returns without touching state. Clearing `hits` here
  // would be a synchronous setState inside an effect, which cascades a render;
  // whether the list is worth showing is derived below from the same
  // condition, so deleting back down to one letter hides the stale suggestions
  // without a second pass.
  const term = problem.trim().split(/\s+/).slice(0, 4).join(" ");
  useEffect(() => {
    if (term.length < 2 || term === lastQuery.current) return;
    const timer = setTimeout(async () => {
      lastQuery.current = term;
      const { data } = await createClient().rpc("search_trades", {
        p_q: term,
        p_limit: 4,
      });
      setHits((data ?? []) as Suggestion[]);
    }, 240);
    return () => clearTimeout(timer);
  }, [term]);

  // What the customer's own words say, from the shared lexicon. Pure and
  // synchronous, so it is derived on every render rather than stored.
  const local = craftIntentFromProblem(problem);
  const localTrade = local.trade ? TRADES.find((t) => t.slug === local.trade) : undefined;
  const localSuggestion: Suggestion | null = localTrade
    ? { slug: localTrade.slug, name_ar: localTrade.ar, name_en: localTrade.en, icon: null }
    : null;
  const localArea = local.area ? AREA_BY_SLUG.get(local.area) : undefined;

  const suggestions =
    term.length >= 2 && !trade
      ? [
          ...(localSuggestion ? [localSuggestion] : []),
          ...hits.filter((h) => h.slug !== localSuggestion?.slug),
        ].slice(0, 4)
      : [];

  function go(pick?: Suggestion | null) {
    const text = problem.trim();
    // An explicit pick wins; otherwise the trade the sentence named. Still
    // optional: with neither, the flow opens on "مش متأكد".
    const chosen = pick ?? trade ?? localSuggestion;
    if (!text && !chosen) {
      setError(labels.needProblem);
      return;
    }
    setBusy(true);
    const params = new URLSearchParams();
    if (text) params.set("problem", text);
    if (chosen) params.set("trade", chosen.slug);
    if (area) params.set("area", area);
    router.push(`/${lang}/crafts/requests?${params}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="min-w-0"
    >
      <label className="sr-only" htmlFor="craft-problem">
        {labels.placeholder}
      </label>
      <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-border-strong bg-surface px-4 py-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
        <Search aria-hidden className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        <textarea
          id="craft-problem"
          rows={2}
          value={problem}
          onChange={(e) => {
            const next = e.target.value;
            setProblem(next);
            setTrade(null);
            setError(null);
            if (!areaTouched) setArea(craftIntentFromProblem(next).area ?? "");
          }}
          placeholder={labels.placeholder}
          // min-w-0 on a flex child that holds text is not decoration: without
          // it the child's automatic minimum size is its content, and the row
          // stops being able to shrink at 360.
          className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Offered, never demanded. Picking one submits — a customer who
          recognises their trade in the list has finished answering. */}
      {suggestions.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {localSuggestion && labels.understood ? labels.understood : labels.didYouMean}
          </span>
          {suggestions.map((h) => {
            const Icon = tradeIcon(h.slug);
            const understood = h.slug === localSuggestion?.slug;
            return (
              <button
                key={h.slug}
                type="button"
                onClick={() => {
                  setTrade(h);
                  go(h);
                }}
                className={`inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary ${
                  understood ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface"
                }`}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{ar ? h.name_ar : h.name_en}</span>
              </button>
            );
          })}
          {/* The place the sentence named, shown where the trade is so the
              customer sees both halves of what was understood. The picker
              below already holds it. */}
          {localArea && area === localArea.slug && (
            <span className="inline-flex min-h-11 min-w-0 items-center gap-1 rounded-xl bg-surface-muted px-3 py-2 text-sm font-semibold text-muted-foreground">
              <MapPin aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{ar ? localArea.ar : localArea.en}</span>
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 sm:max-w-56">
          <MapPin aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
          <select
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setAreaTouched(true);
            }}
            aria-label={labels.where}
            // A <select>'s automatic minimum size is its widest <option>, which
            // is how a location picker takes a phone page sideways. min-w-0
            // lets it shrink; the options stay readable in the native popover.
            className="min-h-11 w-full min-w-0 bg-transparent py-3 text-sm outline-none"
          >
            <option value="">{labels.anywhere}</option>
            {Object.entries(areasByRegion).map(([region, areas]) => (
              <optgroup key={region} label={regionNames[region] ?? region}>
                {areas.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {ar ? a.name_ar : a.name_en}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <Button type="submit" loading={busy} className="shrink-0">
          {labels.submit}
        </Button>
      </div>

      {error && (
        <p className="mt-2 text-sm font-semibold text-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
