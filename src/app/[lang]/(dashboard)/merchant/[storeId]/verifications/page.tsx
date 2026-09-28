import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { docUrlFor, resolveDocUrls } from "@/lib/verification-docs";
import { Container } from "@/components/ui/container";
import { VerificationsManager, type Verification } from "@/components/verifications-manager";
import { ChevronPrev } from "@/components/ui/directional-icon";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreVerificationsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);
  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const { data: rowsData } = await supabase
    .from("store_verifications")
    .select(
      "id, kind, title, issuer, number, issued_on, expires_on, verify_url, status, store_verification_docs(doc_url)",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  // PostgREST types an embed as an array even where the foreign key is the
  // child's primary key and only one row can ever match, and it returns an
  // object in that case. Normalise both shapes to one nullable object.
  const normalised = ((rowsData ?? []) as unknown as Record<string, unknown>[]).map(
    (r) => {
      const embed = r.store_verification_docs;
      return {
        ...r,
        store_verification_docs: (Array.isArray(embed) ? embed[0] : embed) ?? null,
      };
    },
  ) as unknown as Verification[];
  // Private scans (0314) are signed here, under the merchant's own session —
  // the bucket policy decides — and live for minutes, not forever.
  const docUrls = await resolveDocUrls(
    supabase,
    normalised.map((v) => v.store_verification_docs?.doc_url),
  );
  const verifications: Verification[] = normalised.map((v) => ({
    ...v,
    doc_view_url: docUrlFor(docUrls, v.store_verification_docs?.doc_url),
  }));

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {dict.verifications.title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {dict.verifications.subtitle}
        </p>
        <div className="mt-6">
          <VerificationsManager
            storeId={storeId}
            lang={lang}
            dict={dict}
            verifications={verifications}
          />
        </div>
      </Container>
    </div>
  );
}
