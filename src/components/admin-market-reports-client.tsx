"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Flag } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { notifyError } from "@/lib/notify";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export type AdminReport = {
  id: string;
  listingId: string;
  listingTitle: string;
  reason: string;
  status: "open" | "reviewed";
  createdAt: string;
};

export function AdminMarketReportsClient({
  lang,
  dict,
  reports,
}: {
  lang: Locale;
  dict: Dictionary;
  reports: AdminReport[];
}) {
  const router = useRouter();
  const t = dict.admin.market;
  const reasons = dict.market.reasons as Record<string, string>;
  const [busyId, setBusyId] = useState<string | null>(null);

  async function markReviewed(id: string, listingId?: string) {
    setBusyId(id);
    // .select("id") so a write RLS filtered out (0 rows, no error) is reported
    // instead of logged as done.
    const { data, error } = await createClient()
      .from("listing_reports")
      .update({ status: "reviewed" })
      .eq("id", id)
      .select("id");
    setBusyId(null);
    if (error || !data?.length) {
      notifyError(error ? dict.common.actionFailed : dict.moderation.noRowChanged);
      return;
    }
    void logAdminAction("updated", "listing", listingId ?? id, {
      reviewed: true,
    });
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={Flag}
          title={t.reportsTitle}
          subtitle={t.reportsSubtitle}
        />

        {reports.length === 0 ? (
          <EmptyState icon={Flag} title={t.noReports} />
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <Card
                key={r.id}
                className={r.status === "open" ? "border-warning/40" : ""}
              >
                <CardBody className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{r.listingTitle}</span>
                      <Badge variant="danger" size="sm">
                        {reasons[r.reason] ?? r.reason}
                      </Badge>
                      <Badge
                        variant={r.status === "open" ? "warning" : "success"}
                        size="sm"
                      >
                        {r.status === "open" ? "●" : "✓"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ButtonLink
                      href={`/${lang}/market/${r.listingId}`}
                      target="_blank"
                      variant="secondary"
                      size="sm"
                      leftIcon={<ExternalLink className="h-4 w-4" />}
                    >
                      {t.viewListing}
                    </ButtonLink>
                    {r.status === "open" && (
                      <Button
                        size="sm"
                        disabled={busyId === r.id}
                        onClick={() => markReviewed(r.id, r.listingId)}
                        leftIcon={<Check className="h-4 w-4" />}
                      >
                        {t.markReviewed}
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
