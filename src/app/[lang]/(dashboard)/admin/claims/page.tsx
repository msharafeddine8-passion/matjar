import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileQuestion, MessageCircle, Phone } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { FETCH_BOUNDS, warnIfTruncated } from "@/lib/data/bounds";
import { formatBeirutDateTime } from "@/lib/datetime";
import { waLink } from "@/lib/phone";
import { dictSlice } from "@/lib/dict-slice";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminClaimActions } from "@/components/admin-claim-actions";

type ClaimKind = "claim" | "correct" | "remove";
type ClaimStatus = "pending" | "approved" | "rejected" | "done";

type ClaimRow = {
  id: string;
  store_id: string;
  kind: ClaimKind;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
  status: ClaimStatus;
  admin_note: string | null;
  created_at: string;
  stores: { name: string } | null;
};

const kindVariant: Record<ClaimKind, "primary" | "warning" | "danger"> = {
  claim: "primary",
  correct: "warning",
  remove: "danger",
};

const statusVariant: Record<ClaimStatus, "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
  done: "success",
};

export default async function AdminClaimsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  // store_claim_requests is readable under the stores section (0338 RLS), and
  // admin_resolve_store_claim checks the same grant.
  await requireAdminSection("stores", lang);
  const dict = await getDictionary(lang);
  const t = dict.adminClaims;
  const { tab } = await searchParams;
  const resolved = tab === "resolved";

  const supabase = await createClient();
  const base = supabase
    .from("store_claim_requests")
    .select(
      "id, store_id, kind, name, phone, email, note, status, admin_note, created_at, stores(name)",
    );
  // Oldest open request first: someone has been waiting longest for that one.
  const { data, error } = await (resolved
    ? base.neq("status", "pending").order("resolved_at", { ascending: false })
    : base.eq("status", "pending").order("created_at", { ascending: true })
  ).limit(FETCH_BOUNDS.adminClaimRequests);
  warnIfTruncated(data, FETCH_BOUNDS.adminClaimRequests, "store_claim_requests (admin queue)");
  const rows = (data ?? []) as unknown as ClaimRow[];

  const tabClass = (active: boolean) =>
    `inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-surface hover:border-primary/40"
    }`;

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={FileQuestion} title={t.title} subtitle={t.subtitle} />

        <div className="flex flex-wrap gap-2">
          <Link href={`/${lang}/admin/claims`} className={tabClass(!resolved)}>
            {t.tabPending}
          </Link>
          <Link href={`/${lang}/admin/claims?tab=resolved`} className={tabClass(resolved)}>
            {t.tabResolved}
          </Link>
        </div>

        {error ? (
          <p role="alert" className="mt-6 text-sm font-semibold text-danger">
            {t.errors.generic}
          </p>
        ) : rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={FileQuestion} title={t.empty} description={t.emptyBody} />
          </div>
        ) : (
          <div data-animate className="mt-6 space-y-3">
            {rows.map((r) => {
              const whatsapp = waLink(r.phone);
              return (
                <Card key={r.id}>
                  <CardBody>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={kindVariant[r.kind]} size="sm">
                        {t.kinds[r.kind]}
                      </Badge>
                      {resolved && (
                        <Badge variant={statusVariant[r.status]} size="sm">
                          {t.statuses[r.status]}
                        </Badge>
                      )}
                      <Link
                        href={`/${lang}/store/${r.store_id}`}
                        target="_blank"
                        className="inline-flex min-h-10 items-center gap-1.5 font-bold hover:text-primary lg:min-h-0"
                      >
                        <bdi dir="auto">{r.stores?.name ?? r.store_id}</bdi>
                        <ExternalLink aria-label={t.viewStore} className="h-3.5 w-3.5 text-muted-foreground" />
                      </Link>
                      <time dateTime={r.created_at} className="ms-auto text-xs text-muted-foreground">
                        {formatBeirutDateTime(r.created_at, lang)}
                      </time>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-semibold" dir="auto">{r.name}</span>
                      <a
                        href={`tel:${r.phone}`}
                        className="inline-flex min-h-10 items-center gap-1.5 font-medium text-primary hover:underline lg:min-h-0"
                      >
                        <Phone aria-hidden className="h-3.5 w-3.5" />
                        <bdi dir="ltr" className="tabular-nums">{r.phone}</bdi>
                      </a>
                      {whatsapp && (
                        <a
                          href={whatsapp}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-10 items-center gap-1.5 font-medium text-primary hover:underline lg:min-h-0"
                        >
                          <MessageCircle aria-hidden className="h-3.5 w-3.5" />
                          {t.whatsapp}
                        </a>
                      )}
                      {r.email && (
                        <a
                          href={`mailto:${r.email}`}
                          className="inline-flex min-h-10 items-center font-medium text-primary hover:underline lg:min-h-0"
                        >
                          <bdi dir="ltr">{r.email}</bdi>
                        </a>
                      )}
                    </div>

                    {r.note && (
                      <p className="mt-2 whitespace-pre-line rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm leading-relaxed">
                        <span className="font-semibold text-muted-foreground">{t.noteLabel}: </span>
                        <span dir="auto">{r.note}</span>
                      </p>
                    )}
                    {r.admin_note && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        <span className="font-semibold">{t.adminNoteLabel}: </span>
                        <span dir="auto">{r.admin_note}</span>
                      </p>
                    )}

                    {r.status === "pending" && (
                      <AdminClaimActions
                        requestId={r.id}
                        storeId={r.store_id}
                        kind={r.kind}
                        suggestedEmail={r.email}
                        dict={dictSlice(dict, ["adminClaims", "common"])}
                      />
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </Container>
    </div>
  );
}
