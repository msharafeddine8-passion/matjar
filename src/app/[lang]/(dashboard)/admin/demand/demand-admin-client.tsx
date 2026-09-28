"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchX, ShieldCheck } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { isCategoryKey, regions } from "@/lib/catalog";
import {
  DEMAND_STATUSES,
  isDemandStatus,
  waDigits,
  type DemandStatus,
} from "@/lib/demand";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";

export type DemandSummaryRow = {
  q_norm: string;
  sample_q: string | null;
  section: string | null;
  region: string | null;
  searches: number;
  requests: number;
  reachable: number;
  last_seen: string | null;
};

export type DemandRequestRow = {
  id: string;
  q: string;
  section: string | null;
  region: string | null;
  area: string | null;
  contact: string | null;
  contact_kind: "phone" | "whatsapp" | "email" | null;
  note: string | null;
  status: string;
  signedIn: boolean;
  created_at: string;
};

const STATUS_VARIANT: Record<DemandStatus, "info" | "warning" | "success" | "neutral"> = {
  new: "info",
  contacted: "warning",
  fulfilled: "success",
  dismissed: "neutral",
};

function num(n: number) {
  return Number(n ?? 0).toLocaleString("en-US");
}

function contactHref(kind: DemandRequestRow["contact_kind"], v: string): string {
  if (kind === "email") return `mailto:${v}`;
  if (kind === "whatsapp") return `https://wa.me/${waDigits(v)}`;
  return `tel:${v}`;
}

export function AdminDemandClient({
  lang,
  dict,
  days,
  summary,
  recent,
  loadFailed,
}: {
  lang: Locale;
  dict: Dictionary;
  days: 30 | 90;
  summary: DemandSummaryRow[];
  recent: DemandRequestRow[];
  loadFailed: boolean;
}) {
  const router = useRouter();
  const t = dict.demand.admin;
  const [busyId, setBusyId] = useState<string | null>(null);
  const dateFmt = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Beirut",
  });

  const regionName = (key: string | null) =>
    regions.find((r) => r.key === key)?.name[lang] ?? "—";
  const sectionName = (key: string | null) => {
    if (!key) return "—";
    if (isCategoryKey(key)) return dict.catalog[key].name;
    return (t.sections as Record<string, string>)[key] ?? key;
  };

  const totals = summary.reduce(
    (acc, r) => ({
      searches: acc.searches + Number(r.searches ?? 0),
      requests: acc.requests + Number(r.requests ?? 0),
      reachable: acc.reachable + Number(r.reachable ?? 0),
    }),
    { searches: 0, requests: 0, reachable: 0 },
  );

  async function setStatus(id: string, status: string) {
    if (!isDemandStatus(status)) return;
    setBusyId(id);
    const { error } = await createClient().rpc("set_demand_status", {
      p_id: id,
      p_status: status,
    });
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  const base = `/${lang}/admin/demand`;

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={SearchX} title={t.title} subtitle={t.subtitle} />

        <nav className="mb-4 flex gap-1.5" aria-label={t.unmetTitle}>
          {([30, 90] as const).map((d) => (
            <Link
              key={d}
              href={d === 30 ? base : `${base}?days=90`}
              aria-current={days === d ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold transition-colors ${
                days === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {d === 30 ? t.range30 : t.range90}
            </Link>
          ))}
        </nav>

        {loadFailed && (
          <p className="mb-4 text-sm font-medium text-danger" role="alert">
            {dict.common.actionFailed}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Stat label={t.statUnmet} value={num(totals.searches)} />
          <Stat label={t.statRequests} value={num(totals.requests)} />
          <Stat label={t.statReachable} value={num(totals.reachable)} />
        </div>

        <section className="mt-8" aria-labelledby="demand-unmet">
          <h2 id="demand-unmet" className="mb-3 text-lg font-extrabold tracking-tight">
            {t.unmetTitle}
          </h2>
          {summary.length === 0 ? (
            <EmptyState icon={SearchX} title={t.emptySummary} />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th scope="col" className="p-3 text-start font-semibold">{t.colTerm}</th>
                      <th scope="col" className="p-3 text-start font-semibold">{t.colSection}</th>
                      <th scope="col" className="p-3 text-start font-semibold">{t.colRegion}</th>
                      <th scope="col" className="p-3 text-end font-semibold">{t.colSearches}</th>
                      <th scope="col" className="p-3 text-end font-semibold">{t.colRequests}</th>
                      <th scope="col" className="p-3 text-end font-semibold">{t.colReachable}</th>
                      <th scope="col" className="p-3 text-end font-semibold">{t.colLastSeen}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.q_norm} className="border-b border-border last:border-0">
                        <th scope="row" className="p-3 text-start font-bold">
                          {r.sample_q ?? r.q_norm}
                        </th>
                        <td className="p-3">{sectionName(r.section)}</td>
                        <td className="p-3">{regionName(r.region)}</td>
                        <td className="p-3 text-end tabular-nums">{num(r.searches)}</td>
                        <td className="p-3 text-end font-bold tabular-nums">{num(r.requests)}</td>
                        <td className="p-3 text-end tabular-nums">{num(r.reachable)}</td>
                        <td className="p-3 text-end text-muted-foreground">
                          {r.last_seen ? dateFmt.format(new Date(r.last_seen)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>

        <section className="mt-8" aria-labelledby="demand-recent">
          <h2 id="demand-recent" className="mb-2 text-lg font-extrabold tracking-tight">
            {t.recentTitle}
          </h2>
          <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t.privacyNote}
          </p>
          {recent.length === 0 ? (
            <EmptyState icon={SearchX} title={t.emptyRecent} />
          ) : (
            <div className="space-y-2">
              {recent.map((r) => {
                const status: DemandStatus = isDemandStatus(r.status) ? r.status : "new";
                return (
                  <Card key={r.id}>
                    <CardBody className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                      <span className="font-bold">{r.q}</span>
                      <Badge variant={STATUS_VARIANT[status]} size="sm">
                        {t.statuses[status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {sectionName(r.section)} · {regionName(r.region)}
                        {r.area ? ` · ${r.area}` : ""}
                      </span>
                      {r.signedIn && (
                        <Badge variant="neutral" size="sm">
                          {t.signedIn}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {dateFmt.format(new Date(r.created_at))}
                      </span>
                      <div className="flex w-full flex-wrap items-center gap-3">
                        {r.contact ? (
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            {r.contact_kind && (
                              <span className="text-muted-foreground">
                                {dict.demand.kinds[r.contact_kind]}:
                              </span>
                            )}
                            <a
                              href={contactHref(r.contact_kind, r.contact)}
                              dir="ltr"
                              className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline"
                              target={r.contact_kind === "whatsapp" ? "_blank" : undefined}
                              rel={r.contact_kind === "whatsapp" ? "noopener noreferrer" : undefined}
                            >
                              {r.contact}
                            </a>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t.noContact}</span>
                        )}
                        {r.note && (
                          <span className="min-w-0 flex-1 text-sm">
                            <span className="text-muted-foreground">{t.colNote}: </span>
                            {r.note}
                          </span>
                        )}
                        <Select
                          aria-label={`${t.statusFor}: ${r.q}`}
                          value={status}
                          disabled={busyId === r.id}
                          onChange={(e) => void setStatus(r.id, e.target.value)}
                          className="ms-auto w-40"
                        >
                          {DEMAND_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t.statuses[s]}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </Container>
    </div>
  );
}
