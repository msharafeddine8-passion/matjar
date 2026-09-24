import Link from "next/link";
import {
  Circle,
  Sparkles,
  PartyPopper,
  ExternalLink,
  AlertTriangle,
  CircleCheck,
  Hourglass,
} from "lucide-react";
import { ChevronNext } from "@/components/ui/directional-icon";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { Completeness, CompletenessItem } from "@/lib/completeness";
import type { QualityResult } from "@/lib/data-quality";
import { publishStage, isFirstRun } from "@/lib/store-onboarding";
import { SITE_URL } from "@/lib/site";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShareButton } from "@/components/share-button";
import { CardListUl } from "@/components/ui/card";

// Onboarding nudge shown on the OS home. While the store is being set up it
// reports one weighted number and ONE next action; once everything is done it
// flips into a "your store is ready — share it" card, because the merchant's
// next job (and the platform's) is to get that link in front of customers.
//
// It used to render eight equal ticks and a percentage derived from counting
// them. Two things changed, both decided in src/lib/completeness.ts:
//
//   • The percentage is weighted, so it only moves when something that costs
//     the merchant money moves. A number that changes for a brand colour is a
//     number merchants learn to ignore.
//   • Publishing and completeness are separate questions, so the blockers are
//     drawn apart from the polish rather than sitting in the same flat list.
//
// Two more, decided in src/lib/store-onboarding.ts:
//
//   • A merchant on their FIRST run — nothing required done yet — is shown one
//     instruction and nothing else. The full list is correct and it is also the
//     screen people close the tab on; it comes back the moment they finish one
//     thing, which is the point at which a list reads as progress.
//   • "Complete" and "published" were being conflated. Everything done on a
//     store still in review is not the same state as a live page, and the
//     ready-card used to hand out a public link that 404s until an admin
//     approves the store. The stage now comes from `stores.status` as well as
//     from the completeness module. Nothing here changes who may publish.
//
// This component computes nothing. It draws what those modules already decided.
export function StoreChecklist({
  lang,
  dict,
  storeId,
  storeName,
  storeSlug,
  status,
  completeness,
  quality,
}: {
  lang: Locale;
  dict: Dictionary;
  storeId: string;
  storeName: string;
  storeSlug: string | null;
  /** `stores.status` — admin-controlled. Read here, never written. */
  status: string;
  completeness: Completeness;
  /** The public data quality gate's verdict (lib/data-quality.ts). Distinct
   *  from completeness: that is the merchant's own to-do list, this is what
   *  the platform checks before ranking the page. Optional so callers that
   *  have not computed it render the checklist exactly as before. */
  quality?: QualityResult;
}) {
  const t = dict.merchant.checklist;
  const base = `/${lang}/merchant/${storeId}`;

  // The gate's notes, drawn under every branch below. `blocked` is the one
  // state a merchant must hear about in plain words: the page exists and
  // answers its URL, but it is not in explore or search until this is fixed.
  const qualityNotes =
    quality && quality.issues.length > 0 ? (
      <div
        className={`mt-4 rounded-xl border p-3 ${
          quality.level === "blocked"
            ? "border-danger/30 bg-danger-soft/30"
            : "border-border bg-surface"
        }`}
      >
        <p className="text-sm font-bold">{dict.dataQuality.merchantHeading}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {quality.level === "blocked"
            ? dict.dataQuality.merchantBlocked
            : dict.dataQuality.merchantIncomplete}
        </p>
        <ul className="mt-2 space-y-1">
          {quality.issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.field}`}
              className="flex items-center gap-2 text-xs font-semibold sm:text-sm"
            >
              <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
              {dict.dataQuality.issues[issue.code]}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  // Labels are mapped explicitly rather than by indexing the dictionary with a
  // loose string: a new completeness item then cannot ship without its copy —
  // TypeScript refuses the object, instead of the merchant seeing a raw key.
  const labels: Record<string, string> = {
    logo: t.logo,
    cover: t.cover,
    description: t.description,
    hours: t.hours,
    whatsapp: t.whatsapp,
    mapPin: t.mapPin,
    products: t.products,
    units: t.units,
    tickets: t.tickets,
    team: t.team,
    costPrices: t.costPrices,
    brandColor: t.brandColor,
    customLink: t.customLink,
  };
  const labelOf = (item: CompletenessItem) => labels[item.key] ?? item.key;
  // `href` is a path segment under the store, or "" for the store root.
  const hrefOf = (item: CompletenessItem) =>
    item.href ? `${base}/${item.href}` : base;

  const storePath = `/${lang}/${storeSlug ?? `store/${storeId}`}`;
  const storeUrl = `${SITE_URL}${storePath}`;
  const displayUrl = `matjarlb.com/${storeSlug ?? `store/${storeId}`}`;

  const stage = publishStage(status, completeness.readyToPublish);

  // Finished, and waiting on the review that is not the merchant's to do. This
  // is the moment the old screen had no words for: the checklist simply went
  // quiet and the merchant was left guessing whether that meant anything.
  if (stage === "review") {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary-soft/40 p-5">
        <div className="flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-primary" />
          <h2 className="font-extrabold">{t.reviewTitle}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t.reviewSubtitle}</p>
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-warning sm:text-sm">
          <Hourglass className="h-4 w-4 shrink-0" />
          {t.reviewMeanwhile}
        </p>
        <Link
          href={`${base}/items`}
          className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary lg:min-h-0"
        >
          {t.addItems}
          <ChevronNext className="h-4 w-4" />
        </Link>
        {qualityNotes}
      </div>
    );
  }

  // Live AND fully set up → celebrate + push the shareable link. Gated on the
  // status too, because `stores_select` only exposes active rows: this card
  // used to print a public URL for a store that had no public page at all.
  if (stage === "live" && !completeness.next) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary-soft/40 p-5">
        <div className="flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-primary" />
          <h2 className="font-extrabold">{t.readyTitle}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t.readySubtitle}</p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span
            dir="ltr"
            className="min-w-0 truncate rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-primary"
          >
            {displayUrl}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton title={storeName} dict={dict} url={storeUrl} />
            <Link
              href={storePath}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary lg:min-h-0"
            >
              {t.viewPage}
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
        {qualityNotes}
      </div>
    );
  }

  const next = completeness.next;
  // Everything else still open, blockers first then by what it costs to skip.
  // The heaviest item is already the headline, so it is not repeated here.
  const rest = completeness.items
    .filter((i) => !i.done && i.key !== next?.key)
    .sort(
      (a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight,
    );
  const blockers = completeness.missingRequired.length;

  // A store nobody has started: one instruction, no list. The list is not
  // wrong, it is just the wrong thing to hand somebody who has done none of it.
  const firstRun = stage === "setup" && isFirstRun(completeness.items);
  const requiredTotal = completeness.items.filter((i) => i.required).length;
  // Only counted for the blockers, and only when the next thing IS one: a step
  // counter that includes optional polish would never reach its own total.
  const stepNumber = requiredTotal - blockers + 1;
  const showStep =
    stage === "setup" && blockers > 0 && !!next?.required && requiredTotal > 0;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary-soft/40 p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-extrabold">
            {firstRun ? t.firstRunTitle : t.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            {firstRun ? t.firstRunSubtitle : t.subtitle}
          </p>
        </div>
        {/* The number is the headline. A merchant who reads 72% asks what the
            other 28% is; a column of ticks never provoked that question. */}
        <div className="shrink-0 text-end">
          <div className="text-3xl font-extrabold leading-none tabular-nums text-primary sm:text-4xl">
            {completeness.score}%
          </div>
          <div className="mt-1 text-xs font-semibold text-muted-foreground">
            {t.scoreLabel}
          </div>
        </div>
      </div>

      <Progress value={completeness.score} label={t.title} className="mt-4" />

      {/* Publish readiness is a different question from completeness, so it is
          stated in its own words instead of being inferred from the bar. A
          suspended or rejected store is told nothing here: the reason its page
          is down is not a missing cover photo, and its own notice says so. */}
      {stage === "live" ? (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-success sm:text-sm">
          <CircleCheck className="h-4 w-4 shrink-0" />
          {t.publishLive}
        </p>
      ) : stage === "setup" ? (
        blockers > 0 ? (
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-warning sm:text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t.blockedHint.replace("{n}", String(blockers))}
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-success sm:text-sm">
            <CircleCheck className="h-4 w-4 shrink-0" />
            {t.publishReady}
          </p>
        )
      ) : null}

      {/* One instruction. A merchant told eight things is told nothing. */}
      {next && (
        <div className="mt-4">
          <p className="text-xs font-bold text-muted-foreground">
            {showStep
              ? t.stepOf
                  .replace("{n}", String(Math.min(stepNumber, requiredTotal)))
                  .replace("{total}", String(requiredTotal))
              : t.nextLabel}
          </p>
          <Link
            href={hrefOf(next)}
            className="mt-1.5 flex min-h-[44px] items-center gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground transition-opacity hover:opacity-90 lg:min-h-0"
          >
            <span className="min-w-0 flex-1 text-sm font-bold">
              {labelOf(next)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold">
              {t.fix}
              <ChevronNext className="h-4 w-4" />
            </span>
          </Link>
        </div>
      )}

      {!firstRun && rest.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-muted-foreground">
            {t.moreLabel}
          </p>
          {/* Was one bordered box per outstanding task, stacked. Eight boxes on
              a tinted panel is a wall; one card ruled into rows reads as the
              single "what's left" list it is. */}
          <CardListUl className="mt-2">
            {rest.map((item) => (
              <li key={item.key}>
                <Link
                  href={hrefOf(item)}
                  className="flex min-h-[44px] items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-muted lg:min-h-0"
                >
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-xs font-semibold sm:text-sm">
                    {labelOf(item)}
                  </span>
                  {/* Required and recommended are not the same request: one
                      keeps the storefront off the marketplace, the other just
                      makes it nicer. Drawn the same, both get ignored. */}
                  <Badge variant={item.required ? "warning" : "neutral"}>
                    {item.required ? t.requiredBadge : t.recommendedBadge}
                  </Badge>
                </Link>
              </li>
            ))}
          </CardListUl>
        </div>
      )}
    </div>
  );
}
