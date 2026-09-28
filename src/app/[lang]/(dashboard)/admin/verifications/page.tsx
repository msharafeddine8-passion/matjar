import { notFound } from "next/navigation";
import { BadgeCheck, ExternalLink, FileText } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { docUrlFor, resolveDocUrls } from "@/lib/verification-docs";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminVerificationActions } from "@/components/admin-verification-actions";

type VerificationRow = {
  id: string;
  kind: string;
  title: string;
  issuer: string | null;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  store_verification_docs: { doc_url: string } | null;
  verify_url: string | null;
  created_at: string;
  stores: { name: string } | null;
};

export default async function AdminVerificationsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("verifications", lang);
  const dict = await getDictionary(lang);
  const t = dict.verifications;

  const supabase = await createClient();
  const { data } = await supabase
    .from("store_verifications")
    .select(
      "id, kind, title, issuer, number, issued_on, expires_on, verify_url, created_at, stores(name), store_verification_docs(doc_url)",
    )
    .eq("status", "submitted")
    .order("created_at", { ascending: true });

  // Same normalisation as the merchant page: PostgREST types a one-to-one embed
  // as an array, so accept either shape and settle on one nullable object.
  const normalised = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const embed = r.store_verification_docs;
    return {
      ...r,
      store_verification_docs: (Array.isArray(embed) ? embed[0] : embed) ?? null,
    };
  }) as unknown as VerificationRow[];
  // The scan lives in the private verification-docs bucket (0314). Sign every
  // path once, under this admin's session (admin_can('verifications') is what
  // the bucket policy checks); a legacy public URL passes through unchanged.
  const docUrls = await resolveDocUrls(
    supabase,
    normalised.map((r) => r.store_verification_docs?.doc_url),
  );
  const rows = normalised.map((r) => ({
    ...r,
    doc_view_url: docUrlFor(docUrls, r.store_verification_docs?.doc_url),
  }));
  const kindLabel = (kind: string) =>
    t.kinds[kind as keyof typeof t.kinds] ?? kind;

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={BadgeCheck}
          title={t.adminTitle}
          subtitle={t.adminSubtitle}
        />

        <p className="mb-6 text-sm text-muted-foreground">{t.reviewNote}</p>

        {rows.length === 0 ? (
          <EmptyState icon={BadgeCheck} title={t.noneToReview} />
        ) : (
          <Card data-animate>
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-start justify-between gap-4 p-4 transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="neutral" size="sm">
                        {kindLabel(r.kind)}
                      </Badge>
                      <span className="font-semibold">
                        {r.stores?.name ?? "—"}
                      </span>
                    </div>

                    <p className="font-medium">{r.title}</p>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {r.issuer && (
                        <span>
                          {t.issuer}: {r.issuer}
                        </span>
                      )}
                      {r.number && (
                        <span>
                          {t.number}: {r.number}
                        </span>
                      )}
                      {r.issued_on && (
                        <span>
                          {t.issuedOn}: {r.issued_on}
                        </span>
                      )}
                      {r.expires_on && (
                        <span>
                          {t.expiresOn}: {r.expires_on}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      {r.doc_view_url && (
                        <a
                          href={r.doc_view_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                          <FileText className="h-4 w-4" />
                          {t.doc}
                        </a>
                      )}
                      {r.verify_url && (
                        <a
                          href={r.verify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {t.verifyUrl}
                        </a>
                      )}
                    </div>
                  </div>

                  <AdminVerificationActions id={r.id} dict={dict} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </Container>
    </div>
  );
}
