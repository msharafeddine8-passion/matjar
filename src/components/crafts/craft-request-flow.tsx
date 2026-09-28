"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, MessageCircle, PenLine, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, ButtonLink, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { GalleryUpload } from "@/components/gallery-upload";
import { ProfessionalCard } from "@/components/professional";
import type { ProfessionalDict } from "@/components/professional";
import { supportWaLink } from "@/lib/support";
import { craftIntentFromProblem } from "@/lib/pro-market";
import { DemandCapture } from "@/components/search/demand-capture";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { ProfessionalProfile } from "@/lib/professional";

// ────────────────────────────────────────────────────────────────────────────
// "بدي حرفي."
//
// THE CONSTRAINT THAT SHAPES THIS WHOLE COMPONENT, stated first because every
// decision below follows from it:
//
//   craft_requests.provider_id is `uuid NOT NULL references craft_providers`.
//   A request is addressed to one tradesman — that is not an oversight, it is
//   what makes the rate limit, the read policy and the review gate work (0239,
//   0279). And craft_providers has zero rows on production today.
//
//   So: a guest CAN file a request — craft_requests_insert is a `{public}`
//   policy whose WITH CHECK explicitly permits `customer_id is null`, and anon
//   holds INSERT on the table (both verified against production, see the
//   report) — but NOBODY can file one at all right now, guest or not, because
//   there is no provider to address it to.
//
// A form that submits into that is a form that fails. So this one does not
// pretend: it collects the brief, looks for who could take it, and only then
// offers a submit — and when nobody matches, which is every time today, it
// says so in those words and hands the same brief to the platform's own
// WhatsApp line, which is a channel that actually exists.
//
// Three steps, and step two is the honest one:
//
//   1. المشكلة   — the description, the trade if they know it, area, timing.
//   2. مين بيجي  — who covers it. Real rows, or the honest dead end.
//   3. التفاصيل  — name, phone, photos. Only reachable with a provider chosen,
//                  so `provider_id` can never be null at the insert.
//
// Phase 4 additions:
//   * The trade and the area are READ from the description with the site
//     search lexicon (lib/pro-market → lib/search-intent) until the customer
//     sets them — "مش متأكد" stays a complete answer, but «البراد ما عم يبرد
//     بالميناء» no longer has to be classified by hand to find a fridge
//     technician in El Mina. What was understood is said under the pickers.
//   * The no-match step can also STORE the brief: the existing demand table
//     (0306, submit_demand) with section 'contractors', the sector every craft
//     trade maps to. craft_requests cannot hold it — provider_id is NOT NULL —
//     and inventing a provider-less request table was out of scope. The
//     admin reads it at /admin/demand; nothing is auto-matched or promised.
//
// What is NOT asked, and why:
//   * A separate urgency chip. `when_pref` already asks اليوم / بكرا /
//     هالأسبوع / ما بيفرق, and in this market "اليوم" IS the urgent answer.
//     0297 rejected a second severity field on craft_requests for exactly this
//     reason and that judgement still holds.
//   * A budget. There is no column for it, and appending it to the customer's
//     own description so it has somewhere to live would be a field pretending
//     to be stored. See the report for the column I would add.
// ────────────────────────────────────────────────────────────────────────────

export type FlowTrade = { slug: string; name: string; group: string };
export type FlowArea = { id: string; slug: string; name: string; region: string };

export type FlowLabels = {
  stepProblem: string;
  stepWho: string;
  stepDetails: string;
  what: string;
  whatPlaceholder: string;
  trade: string;
  tradeAuto: string;
  where: string;
  wherePlaceholder: string;
  when: string;
  whenOptions: Record<string, string>;
  next: string;
  back: string;
  finding: string;
  matchTitle: string;
  matchLead: string;
  choose: string;
  noMatchTitle: string;
  noMatchBody: string;
  waCta: string;
  waMessage: string;
  unknown: string;
  recruitCta: string;
  summary: string;
  edit: string;
  name: string;
  phone: string;
  address: string;
  photos: string;
  photosHint: string;
  photosGuest: string;
  guestNote: string;
  submit: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  needProblem: string;
  /** "من وصفك، هيدي شغلة {trade}." — shown when the trade was read, not picked. */
  inferred?: string;
  /** "ومنطقتك {area}." */
  inferredArea?: string;
  error: string;
  regions: Record<string, string>;
  myRequests: string;
};

type Step = "problem" | "who" | "details";

export function CraftRequestFlow({
  lang,
  dict,
  trades,
  areas,
  userId,
  defaultName,
  defaultPhone,
  initial,
  labels,
  demandDict,
}: {
  lang: Locale;
  /** Only the `professional` slice — ProfessionalCard is the sole consumer,
   *  and the whole dictionary across a client boundary is ~175KB of script. */
  dict: ProfessionalDict;
  trades: FlowTrade[];
  areas: FlowArea[];
  userId: string | null;
  defaultName: string;
  defaultPhone: string;
  initial: { problem: string; trade: string; area: string };
  labels: FlowLabels;
  /** The demand form's copy, crafts wording laid over it. Absent → no form. */
  demandDict?: Pick<Dictionary, "demand">;
}) {
  const [step, setStep] = useState<Step>("problem");
  const [problem, setProblem] = useState(initial.problem);
  const [pickedTrade, setTrade] = useState(initial.trade);
  const [pickedArea, setAreaSlug] = useState(initial.area);
  // A value that arrived in the URL, or was chosen here, is the customer's;
  // until then the description decides.
  const [tradeTouched, setTradeTouched] = useState(Boolean(initial.trade));
  const [areaTouched, setAreaTouched] = useState(Boolean(initial.area));
  const [when, setWhen] = useState("flexible");

  const [matches, setMatches] = useState<ProfessionalProfile[] | null>(null);
  const [picked, setPicked] = useState<ProfessionalProfile | null>(null);

  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Read from the words, and only ever a slug that exists in the lists this
  // page was rendered with — a lexicon entry for a trade the taxonomy retired
  // resolves to nothing rather than to a broken select.
  const read = craftIntentFromProblem(problem);
  const readTrade =
    !tradeTouched && read.trade && trades.some((t) => t.slug === read.trade) ? read.trade : "";
  const readArea =
    !areaTouched && read.area && areas.some((a) => a.slug === read.area) ? read.area : "";
  const trade = tradeTouched ? pickedTrade : readTrade;
  const areaSlug = areaTouched ? pickedArea : readArea;

  const tradeRow = trades.find((t) => t.slug === trade) ?? null;
  const areaRow = areas.find((a) => a.slug === areaSlug) ?? null;

  const byRegion = areas.reduce<Record<string, FlowArea[]>>((acc, a) => {
    (acc[a.region] ??= []).push(a);
    return acc;
  }, {});
  const byGroup = trades.reduce<Record<string, FlowTrade[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

  /** The brief, as one message. Used for the WhatsApp hand-off — the same four
   *  answers the tradesman would otherwise phone back for. */
  const waText = labels.waMessage
    .replace("{problem}", problem.trim() || labels.unknown)
    .replace("{trade}", tradeRow?.name ?? labels.unknown)
    .replace("{area}", areaRow?.name ?? labels.unknown)
    .replace("{when}", labels.whenOptions[when] ?? labels.unknown);

  async function findWhoCovers() {
    if (!problem.trim() && !trade) {
      setError(labels.needProblem);
      return;
    }
    setError(null);
    setBusy(true);
    setStep("who");
    // The same RPC the directory browses through, so "who covers this" and
    // "who is listed" can never disagree.
    const { data } = await createClient().rpc("browse_crafts", {
      p_trade: trade || null,
      p_area: areaSlug || null,
      p_region: null,
      p_q: null,
      p_sort: "rating",
      p_limit: 12,
    });
    const rows = (data ?? []) as {
      id: string;
      name: string;
      headline: string | null;
      photo_url: string | null;
      region: string | null;
      years_experience: number | null;
      rating_avg: number | null;
      rating_count: number | null;
      verified: boolean;
      trades: { name_ar: string; name_en: string }[];
      service_areas: { name_ar: string; name_en: string }[];
    }[];
    const ar = lang === "ar";
    setMatches(
      rows.map((p) => ({
        kind: "craft" as const,
        id: p.id,
        name: p.name,
        headline: p.headline,
        photoUrl: p.photo_url,
        specialties: (p.trades ?? []).map((t) => (ar ? t.name_ar : t.name_en)),
        skills: [],
        languages: [],
        yearsExperience:
          p.years_experience && p.years_experience > 0 ? p.years_experience : null,
        trust: p.verified ? { identityVerified: true } : {},
        area: {
          region: p.region,
          areas: (p.service_areas ?? []).map((a) => (ar ? a.name_ar : a.name_en)),
          ...((p.service_areas ?? []).length > 0 ? { onSite: true } : {}),
        },
        services: [],
        portfolio: [],
        reviews: [],
        ratingAvg: (p.rating_count ?? 0) > 0 ? p.rating_avg : null,
        ratingCount: p.rating_count ?? 0,
      })),
    );
    setBusy(false);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);

    const { error: insertError } = await createClient()
      .from("craft_requests")
      .insert({
        provider_id: picked.id,
        // Null for a guest. The insert policy permits exactly that and nothing
        // else, so a request can never be filed under someone else's account.
        customer_id: userId,
        customer_name: String(form.get("name") ?? "").trim() || null,
        phone: String(form.get("phone") ?? "").trim(),
        description: problem.trim(),
        area_id: areaRow?.id ?? null,
        address: String(form.get("address") ?? "").trim() || null,
        when_pref: when,
        // Guests never have any: the store-assets insert policy is
        // `to authenticated`, so this is [] for them — the column's own default.
        photos,
      });

    setBusy(false);
    if (insertError) {
      setError(labels.error);
      return;
    }
    setSent(true);
  }

  if (sent && picked) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success-soft p-6 text-center">
        <CheckCircle2 aria-hidden className="mx-auto h-10 w-10 text-success" />
        <p className="mt-3 text-lg font-extrabold">{labels.sentTitle}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {labels.sentBody.replace("{name}", picked.name)}
        </p>
        {userId && (
          <ButtonLink
            href={`/${lang}/crafts/requests`}
            variant="secondary"
            className="mt-4"
          >
            {labels.myRequests}
          </ButtonLink>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <Steps
        current={step}
        labels={[labels.stepProblem, labels.stepWho, labels.stepDetails]}
      />

      {step === "problem" && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void findWhoCovers();
          }}
        >
          <Field label={labels.what} htmlFor="flow-what" required>
            <Textarea
              id="flow-what"
              rows={4}
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder={labels.whatPlaceholder}
            />
          </Field>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label={labels.trade} htmlFor="flow-trade">
              {/* "مش متأكد" is the default and a complete answer. The customer
                  described a symptom; making them classify it is the job this
                  page exists to take off them. */}
              <Select
                id="flow-trade"
                value={trade}
                onChange={(e) => {
                  setTrade(e.target.value);
                  setTradeTouched(true);
                }}
              >
                <option value="">{labels.tradeAuto}</option>
                {Object.entries(byGroup).map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>

            <Field label={labels.where} htmlFor="flow-area">
              <Select
                id="flow-area"
                value={areaSlug}
                onChange={(e) => {
                  setAreaSlug(e.target.value);
                  setAreaTouched(true);
                }}
              >
                <option value="">{labels.wherePlaceholder}</option>
                {Object.entries(byRegion).map(([region, list]) => (
                  <optgroup key={region} label={labels.regions[region] ?? region}>
                    {list.map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          </div>

          {/* Said, not silently applied: what the description was read as. */}
          {(readTrade || readArea) && labels.inferred && (
            <p className="-mt-1 text-xs font-semibold text-primary" aria-live="polite">
              {readTrade && tradeRow ? labels.inferred.replace("{trade}", tradeRow.name) : null}
              {readArea && areaRow && labels.inferredArea
                ? `${readTrade && tradeRow ? " " : ""}${labels.inferredArea.replace("{area}", areaRow.name)}`
                : null}
            </p>
          )}

          <Field label={labels.when} htmlFor="flow-when">
            <Select
              id="flow-when"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            >
              {Object.entries(labels.whenOptions).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>

          {error && (
            <p className="text-sm font-semibold text-danger" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" loading={busy} full className="sm:w-auto">
            {labels.next}
          </Button>
          <p className="text-xs text-muted-foreground">{labels.guestNote}</p>
        </form>
      )}

      {step === "who" && (
        <div className="mt-5 min-w-0">
          <Summary
            problem={problem}
            trade={tradeRow?.name ?? labels.unknown}
            area={areaRow?.name ?? labels.unknown}
            when={labels.whenOptions[when] ?? labels.unknown}
            title={labels.summary}
            editLabel={labels.edit}
            onEdit={() => setStep("problem")}
          />

          {busy || matches === null ? (
            <p className="mt-5 text-sm text-muted-foreground">{labels.finding}</p>
          ) : matches.length > 0 ? (
            <div className="mt-5 min-w-0">
              <h2 className="font-extrabold">{labels.matchTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {labels.matchLead}
              </p>
              <ul className="mt-3 grid min-w-0 grid-cols-1 gap-3">
                {matches.map((m) => (
                  <li key={m.id} className="min-w-0">
                    <ProfessionalCard
                      profile={m}
                      href={`/${lang}/crafts/p/${m.id}`}
                      dict={dict}
                      lang={lang}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      full
                      className="mt-2"
                      onClick={() => {
                        setPicked(m);
                        setStep("details");
                      }}
                    >
                      {labels.choose}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            /* The honest dead end. Not an error and not an apology: a statement
               of what the platform can and cannot do with this request today,
               and the one channel that does work. */
            <div className="mt-5 min-w-0 rounded-2xl border border-border bg-surface p-5">
              <h2 className="flex items-center gap-2 font-extrabold">
                <PenLine aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                {labels.noMatchTitle}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {labels.noMatchBody}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={supportWaLink(waText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "whatsapp" })}
                >
                  <MessageCircle aria-hidden className="h-4 w-4" />
                  {labels.waCta}
                </a>
                <Link
                  href={`/${lang}/crafts/join`}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  <UserPlus aria-hidden className="h-4 w-4" />
                  {labels.recruitCta}
                </Link>
              </div>
              {/* For the customer who will not open WhatsApp: the same brief,
                  stored where the team reads unmet demand. Collapsed to one
                  line until opened, contact optional. */}
              {demandDict && (problem.trim() || tradeRow?.name || "").length >= 2 && (
                <div className="mt-4 border-t border-border pt-3">
                  <DemandCapture
                    lang={lang}
                    q={(problem.trim() || tradeRow?.name || "").slice(0, 120)}
                    section="contractors"
                    region={areaRow?.region ?? null}
                    dict={demandDict}
                  />
                </div>
              )}
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            className="mt-4"
            leftIcon={<ChevronPrev className="h-4 w-4" />}
            onClick={() => setStep("problem")}
          >
            {labels.back}
          </Button>
        </div>
      )}

      {step === "details" && picked && (
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <Summary
            problem={problem}
            trade={tradeRow?.name ?? labels.unknown}
            area={areaRow?.name ?? labels.unknown}
            when={labels.whenOptions[when] ?? labels.unknown}
            title={labels.summary}
            editLabel={labels.edit}
            onEdit={() => setStep("problem")}
          />

          {/* Right after the brief, because it is the same answer in another
              medium — "here, look". Signed-in only: `store-assets` accepts
              inserts from `authenticated` alone, and widening a public bucket
              to anonymous writers is not a trade worth making for a
              convenience. A guest is told once and can still send. */}
          {userId ? (
            <div>
              <GalleryUpload
                folder={`crafts/${userId}/requests`}
                value={photos}
                onChange={setPhotos}
                label={labels.photos}
                max={3}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {labels.photosHint}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{labels.photosGuest}</p>
          )}

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label={labels.name} htmlFor="flow-name">
              <Input id="flow-name" name="name" defaultValue={defaultName} />
            </Field>
            <Field label={labels.phone} htmlFor="flow-phone" required>
              <Input
                id="flow-phone"
                name="phone"
                type="tel"
                dir="ltr"
                defaultValue={defaultPhone}
              />
            </Field>
          </div>

          <Field label={labels.address} htmlFor="flow-address">
            <Input id="flow-address" name="address" />
          </Field>

          {error && (
            <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {busy ? labels.sending : labels.submit}
            </Button>
            <Button
              type="button"
              variant="ghost"
              leftIcon={<ChevronPrev className="h-4 w-4" />}
              onClick={() => setStep("who")}
            >
              {labels.back}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Three dots and three words. Not a progress bar — there is no percentage to
 *  be honest about, only which of three questions is on screen. */
function Steps({ current, labels }: { current: Step; labels: string[] }) {
  const order: Step[] = ["problem", "who", "details"];
  const at = order.indexOf(current);
  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
      {labels.map((label, i) => (
        <li key={label} className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums ${
              i <= at
                ? "bg-primary text-primary-foreground"
                : "bg-surface-muted text-muted-foreground"
            }`}
            dir="ltr"
          >
            {i + 1}
          </span>
          <span className={i === at ? "text-foreground" : "text-muted-foreground"}>
            {label}
          </span>
          {i < labels.length - 1 && (
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** What they already said, so nothing has to be re-read or retyped. */
function Summary({
  problem,
  trade,
  area,
  when,
  title,
  editLabel,
  onEdit,
}: {
  problem: string;
  trade: string;
  area: string;
  when: string;
  title: string;
  editLabel: string;
  onEdit: () => void;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface-muted/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-extrabold text-muted-foreground">{title}</p>
        <button
          type="button"
          onClick={onEdit}
          // A 28px-tall text button is a 28px target; the transparent
          // ::before takes the hit area to 44 without moving the layout.
          className="relative text-xs font-bold text-primary before:absolute before:inset-x-0 before:-inset-y-3 before:content-['']"
        >
          {editLabel}
        </button>
      </div>
      <p className="mt-1.5 whitespace-pre-line break-words text-sm">{problem}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {[trade, area, when].join(" · ")}
      </p>
    </div>
  );
}
