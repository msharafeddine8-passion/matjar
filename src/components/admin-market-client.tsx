"use client";
import { revalidateListing } from "@/lib/cache-actions";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Star,
  Trash2,
  ExternalLink,
  Tags,
  MapPin,
  Map,
  Flag,
  ImageIcon,
  ShoppingBag,
  ListChecks,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction, softDeleteAsAdmin, type AuditVerb } from "@/lib/audit";
import { notifyError } from "@/lib/notify";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Money } from "@/components/ui/money";

export type AdminListing = {
  id: string;
  title: string;
  price: number;
  city: string | null;
  region: string | null;
  status: "draft" | "pending" | "active" | "sold" | "rejected" | "expired";
  isFeatured: boolean;
  image: string | null;
  storeName: string | null;
  views: number;
  createdAt: string;
};

const STATUS_TABS = [
  "all",
  "pending",
  "active",
  "rejected",
  "featured",
  "sold",
  "expired",
  "draft",
] as const;
type Tab = (typeof STATUS_TABS)[number];

const statusVariant: Record<
  AdminListing["status"],
  "neutral" | "primary" | "success" | "warning" | "danger" | "info"
> = {
  draft: "neutral",
  pending: "warning",
  active: "success",
  sold: "info",
  rejected: "danger",
  expired: "warning",
};

export function AdminMarketClient({
  lang,
  dict,
  listings,
  openReports,
}: {
  lang: Locale;
  dict: Dictionary;
  listings: AdminListing[];
  openReports: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.market;
  const [tab, setTab] = useState<Tab>("pending");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = {
      all: listings.length,
      pending: 0,
      active: 0,
      rejected: 0,
      featured: 0,
      sold: 0,
      expired: 0,
      draft: 0,
    };
    for (const l of listings) {
      if (l.status in c) c[l.status as Tab]++;
      if (l.isFeatured) c.featured++;
    }
    return c;
  }, [listings]);

  const totalViews = useMemo(
    () => listings.reduce((sum, l) => sum + (l.views || 0), 0),
    [listings],
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return listings.filter((l) => {
      const matchTab =
        tab === "all"
          ? true
          : tab === "featured"
            ? l.isFeatured
            : l.status === tab;
      const matchQ = !query || l.title.toLowerCase().includes(query);
      return matchTab && matchQ;
    });
  }, [listings, tab, q]);

  async function patch(id: string, values: Partial<Record<string, unknown>>) {
    setBusyId(id);
    // .select("id"): an UPDATE that RLS filters out returns no error and no
    // row. Before 0313 that is exactly what a market sub-admin's approve did —
    // and the audit log below still recorded "approved". Zero rows is a
    // failure, said out loud, and nothing is logged for it.
    const { data, error } = await createClient()
      .from("listings")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    if (!data?.length) {
      notifyError(dict.moderation.noRowChanged);
      return;
    }
    let verb: AuditVerb | null = null;
    if (values.status === "active") verb = "approved";
    else if (values.status === "rejected") verb = "rejected";
    else if ("is_featured" in values)
      verb = values.is_featured ? "featured" : "unfeatured";
    if (verb) void logAdminAction(verb, "listing", id, values);
    await revalidateListing(id);
    router.refresh();
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        message: t.delete + "?",
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusyId(id);
    // Soft delete + audit row in one transaction (0294): the listing leaves
    // every public read path, but a seller's work is recoverable and the
    // removal cannot happen without a record of who did it.
    const ok = await softDeleteAsAdmin("listing", id);
    setBusyId(null);
    if (!ok) {
      notifyError(dict.common.actionFailed);
      return;
    }
    await revalidateListing(id);
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={ShoppingBag}
          title={t.title}
          subtitle={t.subtitle}
          actions={
            <div className="flex flex-wrap gap-2">
              <ButtonLink
                href={`/${lang}/admin/market/categories`}
                variant="secondary"
                size="sm"
                leftIcon={<Tags className="h-4 w-4" />}
              >
                {t.categoriesLink}
              </ButtonLink>
              <ButtonLink
                href={`/${lang}/admin/market/cities`}
                variant="secondary"
                size="sm"
                leftIcon={<MapPin className="h-4 w-4" />}
              >
                {t.citiesLink}
              </ButtonLink>
              <ButtonLink
                href={`/${lang}/admin/market/regions`}
                variant="secondary"
                size="sm"
                leftIcon={<Map className="h-4 w-4" />}
              >
                {t.regionsLink}
              </ButtonLink>
              <ButtonLink
                href={`/${lang}/admin/market/reports`}
                variant="secondary"
                size="sm"
                leftIcon={<Flag className="h-4 w-4" />}
              >
                {t.reportsLink}
              </ButtonLink>
              <ButtonLink
                href={`/${lang}/admin/market/queue`}
                size="sm"
                leftIcon={<ListChecks className="h-4 w-4" />}
              >
                {dict.moderation.queueLink}
              </ButtonLink>
            </div>
          }
        />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t.allStatuses} value={counts.all.toLocaleString("en-US")} />
          <Stat
            label={t.statusLabels.active}
            value={counts.active.toLocaleString("en-US")}
          />
          <Stat
            label={t.statusLabels.pending}
            value={counts.pending.toLocaleString("en-US")}
          />
          <Stat
            label={t.featuredBadge}
            value={counts.featured.toLocaleString("en-US")}
          />
          <Stat
            label={t.statViews}
            value={totalViews.toLocaleString("en-US")}
          />
          <Stat
            label={t.statReports}
            value={openReports.toLocaleString("en-US")}
          />
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-1.5">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all"
                ? t.allStatuses
                : s === "featured"
                  ? t.featuredBadge
                  : t.statusLabels[s as AdminListing["status"]]}
              <span className="ms-1.5 opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>

        <div className="relative mt-4 max-w-sm">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState className="mt-6" icon={ShoppingBag} title={t.empty} />
        ) : (
          <div data-animate className="mt-6 space-y-2">
            {filtered.map((l) => (
              <Card key={l.id}>
                <CardBody className="flex flex-wrap items-center gap-4 p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                    {l.image ? (
                      <Image
                        src={l.image}
                        alt=""
                        width={64}
                        height={64}
                        className="h-16 w-16 object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-foreground/10" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{l.title}</span>
                      <Badge variant={statusVariant[l.status]} size="sm">
                        {t.statusLabels[l.status]}
                      </Badge>
                      {l.isFeatured && (
                        <Badge variant="warning" size="sm">
                          <Star className="h-3 w-3 fill-current" />
                          {t.featuredBadge}
                        </Badge>
                      )}
                      <Badge variant="neutral" size="sm">
                        {l.storeName
                          ? `${t.merchant} · ${l.storeName}`
                          : t.user}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span className="font-bold text-primary tabular-nums">
                        <Money value={l.price} />
                      </span>
                      {(l.city || l.region) && (
                        <span>
                          {[l.city, l.region].filter(Boolean).join("، ")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <ButtonLink
                      href={`/${lang}/market/${l.id}`}
                      target="_blank"
                      variant="secondary"
                      size="sm"
                      aria-label={t.viewListing}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </ButtonLink>
                    {l.status !== "active" && (
                      <Button
                        size="sm"
                        disabled={busyId === l.id}
                        onClick={() => patch(l.id, { status: "active" })}
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                      >
                        {t.approve}
                      </Button>
                    )}
                    {l.status !== "rejected" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === l.id}
                        onClick={() => patch(l.id, { status: "rejected" })}
                        leftIcon={<X className="h-3.5 w-3.5" />}
                        className="!text-danger"
                      >
                        {t.reject}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === l.id}
                      onClick={() => patch(l.id, { is_featured: !l.isFeatured })}
                      leftIcon={<Star className="h-3.5 w-3.5" />}
                      className={l.isFeatured ? "!text-warning" : ""}
                    >
                      {l.isFeatured ? t.unfeature : t.feature}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === l.id}
                      onClick={() => remove(l.id)}
                      aria-label={t.delete}
                      className="!text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
