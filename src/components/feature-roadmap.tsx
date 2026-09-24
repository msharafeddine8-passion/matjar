import { CircleDashed, Hourglass } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Badge } from "@/components/ui/badge";
import { ROADMAP, featureCopy, featureStatus } from "@/lib/feature-availability";

// The half of the truth marketing pages normally leave out.
//
// Anything the availability config does not mark `live` is barred from the plan
// matrix, the price cards and the sector grid — and a feature that is merely
// deleted from those lists is a feature a merchant discovers is missing after
// they have paid. So the same config renders it here instead: named, dated by
// its state, and visibly not a tick in a table. A dashed border and a muted
// heading do the work no footnote does.
//
// Rendered on /pricing and /merchants from one component so the two pages
// cannot disagree about what is not built.
export function FeatureRoadmap({ dict }: { dict: Dictionary }) {
  const t = dict.pricing;

  return (
    <section className="rounded-3xl border border-dashed border-border bg-surface-muted/30 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
        <Hourglass className="h-5 w-5 shrink-0 text-muted-foreground" />
        {t.roadmapTitle}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {t.roadmapSub}
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {ROADMAP.map((id) => {
          // The badge word is the registry's canonical status label
          // (features.status.*), the same one the footer and the storefront
          // print — not a second vocabulary kept under pricing.states.
          const { status } = featureStatus(id);
          const beta = status === "beta";
          return (
            <li
              key={id}
              className="rounded-2xl border border-dashed border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="flex items-start gap-2 font-bold text-muted-foreground">
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0" />
                  {t.features[id]}
                </h3>
                <Badge variant={beta ? "info" : "neutral"}>
                  {featureCopy(status, dict)}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t.featureNotes[id]}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
