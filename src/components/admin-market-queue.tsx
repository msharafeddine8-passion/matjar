"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, X, ExternalLink, ImageIcon, ListChecks, ShieldAlert } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { notifyError } from "@/lib/notify";
import { revalidateListing } from "@/lib/cache-actions";
import {
  REJECT_REASONS,
  type ModerationSignal,
  type RejectReason,
  type SellerFacts,
} from "@/lib/market-moderation";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";

export type QueueRow = {
  id: string;
  title: string;
  price: number | null;
  image: string | null;
  status: string;
  createdAt: string;
  storeName: string | null;
  isMerchant: boolean;
  categoryName: string | null;
  categoryMedian: number | null;
  signals: ModerationSignal[];
  reports: number;
  score: number;
  duplicateTitles: string[];
  expiresInDays: number | null;
  seller: SellerFacts | null;
};

// Signals a person raised (a report) or an admin decided (suspension) read as
// danger; the heuristics read as warning; the mild ones as neutral.
const SIGNAL_TONE: Record<ModerationSignal, "danger" | "warning" | "neutral"> = {
  reported: "danger",
  sellerSuspended: "danger",
  duplicate: "warning",
  priceLow: "warning",
  priceHigh: "warning",
  contactInText: "warning",
  sellerRejections: "warning",
  noCategory: "neutral",
  newSeller: "neutral",
  noImages: "neutral",
  priceMissing: "neutral",
};

export function AdminMarketQueue({
  lang,
  dict,
  items,
  sellerHistoryAvailable,
}: {
  lang: Locale;
  dict: Dictionary;
  items: QueueRow[];
  /** false until migration 0313 (market_seller_facts + moderation_note). */
  sellerHistoryAvailable: boolean;
}) {
  const router = useRouter();
  const t = dict.moderation;
  const statusLabels = dict.admin.market.statusLabels as Record<string, string>;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, RejectReason>>({});

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
      timeZone: "Asia/Beirut",
      dateStyle: "medium",
    }).format(new Date(iso));
  const fmtUsd = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const pending = items.filter((i) => i.status === "pending").length;
  const flagged = items.length - pending;

  async function decide(item: QueueRow, status: "active" | "rejected") {
    setBusyId(item.id);
    const reason = reasons[item.id] ?? "other";
    // moderation_note only exists once 0313 is applied — the same migration
    // that makes seller history available, so that flag says whether to send it.
    const values: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === "rejected" && sellerHistoryAvailable) values.moderation_note = reason;
    const { data, error } = await createClient()
      .from("listings")
      .update(values)
      .eq("id", item.id)
      .select("id");
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    if (!data?.length) {
      notifyError(t.noRowChanged);
      return;
    }
    void logAdminAction(status === "active" ? "approved" : "rejected", "listing", item.id, {
      signals: item.signals,
      ...(status === "rejected" ? { reason } : {}),
    });
    await revalidateListing(item.id);
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={ListChecks}
          title={t.queueTitle}
          subtitle={t.queueSubtitle}
          actions={
            <ButtonLink href={`/${lang}/admin/market`} variant="secondary" size="sm">
              {dict.admin.market.title}
            </ButtonLink>
          }
        />

        <p className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t.humanOnly}</span>
        </p>

        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Badge variant="warning">{t.pendingCount.replace("{n}", String(pending))}</Badge>
          <Badge variant="neutral">{t.flaggedCount.replace("{n}", String(flagged))}</Badge>
          {!sellerHistoryAvailable && (
            <Badge variant="info">{t.seller.unavailable}</Badge>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState icon={ListChecks} title={t.empty} />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id} className={item.reports > 0 ? "border-danger/40" : ""}>
                <CardBody className="flex flex-col gap-3 p-4 sm:flex-row">
                  {item.image ? (
                    <Image
                      src={item.image}
                      alt={item.title}
                      width={80}
                      height={80}
                      sizes="80px"
                      className="h-20 w-20 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                      <ImageIcon className="h-6 w-6" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{item.title}</span>
                      <Badge size="sm" variant={item.status === "pending" ? "warning" : "success"}>
                        {statusLabels[item.status] ?? item.status}
                      </Badge>
                      {item.price != null && (
                        <span className="text-sm font-bold text-primary">
                          <Money value={item.price} />
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {[
                        item.isMerchant
                          ? `${t.seller.merchant}: ${item.storeName ?? "—"}`
                          : t.seller.individual,
                        item.categoryName,
                        fmtDate(item.createdAt),
                        item.expiresInDays != null
                          ? t.expiresIn.replace("{n}", String(item.expiresInDays))
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>

                    {item.signals.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.signals.map((s) => (
                          <Badge key={s} size="sm" variant={SIGNAL_TONE[s]}>
                            {t.signals[s]}
                            {s === "reported" && item.reports > 1 ? ` ×${item.reports}` : ""}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {item.categoryMedian != null &&
                      (item.signals.includes("priceLow") || item.signals.includes("priceHigh")) && (
                        <p className="text-xs text-muted-foreground">
                          {t.categoryMedian.replace("{price}", fmtUsd(item.categoryMedian))}
                        </p>
                      )}

                    {item.duplicateTitles.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t.duplicateOf}: <bdi>{item.duplicateTitles.join("، ")}</bdi>
                      </p>
                    )}

                    {item.seller && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold">{t.seller.title}: </span>
                        {[
                          item.seller.memberSince
                            ? t.seller.memberSince.replace("{date}", fmtDate(item.seller.memberSince))
                            : null,
                          t.seller.listings.replace("{n}", String(item.seller.listingsTotal)),
                          t.seller.live.replace("{n}", String(item.seller.listingsLive)),
                          item.seller.listingsRejected
                            ? t.seller.rejected.replace("{n}", String(item.seller.listingsRejected))
                            : null,
                          item.seller.listingsRemoved
                            ? t.seller.removed.replace("{n}", String(item.seller.listingsRemoved))
                            : null,
                          item.seller.reportsOpen
                            ? t.seller.reports.replace("{n}", String(item.seller.reportsOpen))
                            : null,
                          item.seller.isActive ? null : t.seller.suspended,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:w-56">
                    <ButtonLink
                      href={`/${lang}/market/${item.id}`}
                      target="_blank"
                      variant="secondary"
                      size="sm"
                      leftIcon={<ExternalLink className="h-4 w-4" />}
                    >
                      {dict.admin.market.viewListing}
                    </ButtonLink>
                    {item.status === "pending" && (
                      <Button
                        size="sm"
                        disabled={busyId === item.id}
                        onClick={() => decide(item, "active")}
                        leftIcon={<Check className="h-4 w-4" />}
                      >
                        {t.approve}
                      </Button>
                    )}
                    <label className="sr-only" htmlFor={`reason-${item.id}`}>
                      {t.rejectWith}
                    </label>
                    <select
                      id={`reason-${item.id}`}
                      value={reasons[item.id] ?? "other"}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [item.id]: e.target.value as RejectReason }))
                      }
                      className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
                    >
                      {REJECT_REASONS.map((k) => (
                        <option key={k} value={k}>
                          {t.rejectReasons[k]}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busyId === item.id}
                      onClick={() => decide(item, "rejected")}
                      leftIcon={<X className="h-4 w-4" />}
                    >
                      {t.reject}
                    </Button>
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
