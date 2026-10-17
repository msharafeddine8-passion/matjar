"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, User, Building2, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import type { Dictionary } from "@/i18n/get-dictionary";

export type JoinTrade = {
  id: string;
  name_ar: string;
  name_en: string;
  icon: string | null;
  group_slug: string;
};
export type JoinGroup = {
  slug: string;
  name_ar: string;
  name_en: string;
  icon: string | null;
};
export type JoinArea = {
  id: string;
  slug: string;
  region: string;
  name_ar: string;
  name_en: string;
};

const field = `${fieldClass} mt-1.5`;
const label = "text-sm font-semibold";

// "List your trade" — the whole point of the standalone provider model.
//
// One screen, because the alternative is a wizard and a wizard loses the
// person this section exists for. Everything asked here is something a
// tradesman can answer from memory standing in a van; anything needing thought
// (bio, photo, prices) is optional and can be added later from the dashboard.
//
// The two required-beyond-the-obvious answers are trade and coverage, because
// without them the profile exists and is unfindable — which is worse than not
// registering, since it looks done.
export function CraftJoinForm({
  userId,
  lang,
  dict,
  groups,
  trades,
  areas,
}: {
  userId: string;
  lang: string;
  dict: Pick<Dictionary, "auth" | "crafts" | "upload">;
  groups: JoinGroup[];
  trades: JoinTrade[];
  areas: JoinArea[];
}) {
  const router = useRouter();
  const t = dict.crafts;
  const ar = lang === "ar";

  const [kind, setKind] = useState<"individual" | "business">("individual");
  const [photo, setPhoto] = useState<string | null>(null);
  const [pickedTrades, setPickedTrades] = useState<Set<string>>(new Set());
  const [pickedAreas, setPickedAreas] = useState<Set<string>>(new Set());
  const [baseArea, setBaseArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byRegion = areas.reduce<Record<string, JoinArea[]>>((acc, a) => {
    (acc[a.region] ??= []).push(a);
    return acc;
  }, {});
  const regionNames = t.regionNames as unknown as Record<string, string>;

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (pickedTrades.size === 0) {
      setError(t.joinNeedTrade);
      return;
    }
    if (pickedAreas.size === 0) {
      setError(t.joinNeedArea);
      return;
    }

    setBusy(true);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const base = areas.find((a) => a.id === baseArea);

    const { data: provider, error: insertError } = await supabase
      .from("craft_providers")
      .insert({
        user_id: userId,
        kind,
        name: String(form.get("name") ?? "").trim(),
        headline: String(form.get("headline") ?? "").trim() || null,
        bio: String(form.get("bio") ?? "").trim() || null,
        photo_url: photo,
        phone: String(form.get("phone") ?? "").trim(),
        whatsapp: String(form.get("whatsapp") ?? "").trim() || null,
        years_experience: Number(form.get("years")) || null,
        area_id: baseArea || null,
        // Region comes from the chosen area rather than being asked twice.
        region: base?.region ?? null,
      })
      .select("id")
      .single();

    if (insertError || !provider) {
      setBusy(false);
      // The unique constraint on user_id is the only expected failure: this
      // account already has a provider profile.
      setError(
        insertError?.code === "23505" ? t.joinAlready : dict.auth.errorGeneric,
      );
      return;
    }

    const providerId = (provider as { id: string }).id;
    await Promise.all([
      supabase.from("craft_provider_trades").insert(
        [...pickedTrades].map((trade_id) => ({ provider_id: providerId, trade_id })),
      ),
      supabase.from("craft_provider_areas").insert(
        [...pickedAreas].map((area_id) => ({ provider_id: providerId, area_id })),
      ),
    ]);

    router.push(`/${lang}/crafts/me`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Individual or company — asked first because it changes how the rest
          of the profile reads, and it is the one thing that cannot be inferred
          from anything else. */}
      <div>
        <span className={label}>{t.joinKind}</span>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {(
            [
              ["individual", t.kindIndividual, User],
              ["business", t.kindBusiness, Building2],
            ] as const
          ).map(([k, text, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
                kind === k
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface hover:border-primary/40"
              }`}
            >
              <Icon className="h-4 w-4" />
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">
            {kind === "business" ? t.joinCompanyName : t.joinName}
          </label>
          <input id="name" name="name" required className={field} />
        </div>
        <div>
          <label className={label} htmlFor="headline">
            {t.joinHeadline}
          </label>
          <input
            id="headline"
            name="headline"
            placeholder={t.joinHeadlinePlaceholder}
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="phone">
            {t.joinPhone}
          </label>
          <input id="phone" name="phone" type="tel" required dir="ltr" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="whatsapp">
            {t.joinWhatsapp}
          </label>
          <input id="whatsapp" name="whatsapp" type="tel" dir="ltr" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="years">
            {t.joinYears}
          </label>
          <input id="years" name="years" type="number" min="0" max="70" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="base">
            {t.joinBaseArea}
          </label>
          <select
            id="base"
            value={baseArea}
            onChange={(e) => setBaseArea(e.target.value)}
            className={field}
          >
            <option value="">—</option>
            {Object.entries(byRegion).map(([region, list]) => (
              <optgroup key={region} label={regionNames[region] ?? region}>
                {list.map((a) => (
                  <option key={a.id} value={a.id}>
                    {ar ? a.name_ar : a.name_en}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="bio">
          {t.joinBio}
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          placeholder={t.joinBioPlaceholder}
          className={field}
        />
      </div>

      <ImageUpload
        folder={`crafts/${userId}`}
        value={photo}
        onChange={setPhoto}
        label={t.joinPhoto}
        hint={t.joinPhotoHint}
        dict={dict}
      />

      {/* Trade and coverage: the two answers that decide whether anyone can
          find this person. Required for that reason, and said so plainly. */}
      <div>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Wrench className="h-4 w-4 text-primary" />
          {t.joinTrades}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{t.joinTradesHint}</p>
        <div className="mt-2 space-y-3">
          {groups.map((g) => {
            const list = trades.filter((tr) => tr.group_slug === g.slug);
            if (!list.length) return null;
            return (
              <div key={g.slug}>
                <p className="text-xs font-bold text-muted-foreground">
                  {g.icon} {ar ? g.name_ar : g.name_en}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {list.map((tr) => {
                    const on = pickedTrades.has(tr.id);
                    return (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => toggle(pickedTrades, tr.id, setPickedTrades)}
                        aria-pressed={on}
                        className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-surface hover:border-primary/40"
                        }`}
                      >
                        <span aria-hidden className="me-1">
                          {tr.icon}
                        </span>
                        {ar ? tr.name_ar : tr.name_en}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-primary" />
          {t.joinAreas}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{t.joinAreasHint}</p>
        <div className="mt-2 space-y-3">
          {Object.entries(byRegion).map(([region, list]) => (
            <div key={region}>
              <p className="text-xs font-bold text-muted-foreground">
                {regionNames[region] ?? region}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {list.map((a) => {
                  const on = pickedAreas.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggle(pickedAreas, a.id, setPickedAreas)}
                      aria-pressed={on}
                      className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface hover:border-primary/40"
                      }`}
                    >
                      {ar ? a.name_ar : a.name_en}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {/* Said before they submit, not after: the profile goes to review, it
          does not go live. */}
      <p className="text-sm text-muted-foreground">{t.joinReviewNote}</p>

      <Button type="submit" loading={busy} className="w-full sm:w-auto">
        {t.joinSubmit}
      </Button>
    </form>
  );
}
