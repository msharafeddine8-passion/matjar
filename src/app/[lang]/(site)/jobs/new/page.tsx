import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Briefcase, Store } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { JobPostForm } from "@/components/job-post-form";
import { dictSlice } from "@/lib/dict-slice";

export default async function NewJobPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  // Prefill the company name from the user's store, if any.
  const { data: store } = await supabase
    .from("stores")
    .select("name")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const defaultCompany = (store as { name: string } | null)?.name ?? "";

  return (
    <div className="py-10">
      <Container className="max-w-xl">
        <Link
          href={`/${lang}/jobs`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.jobs.title}
        </Link>
        <PageHeader className="mt-3" title={dict.jobs.postJob} icon={Briefcase} />

        {store ? (
          <div className="mt-2">
            <JobPostForm lang={lang} dict={dictSlice(dict, ["auth", "jobs"])} defaultCompany={defaultCompany} />
          </div>
        ) : (
          // Job posting is merchants-only: no store → upsell, not the form.
          // RLS (0157) is the real gate; this is the friendly UI.
          <Card className="mt-4">
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Store className="h-7 w-7" />
              </span>
              <h2 className="text-lg font-extrabold">
                {dict.jobs.merchantOnlyTitle}
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                {dict.jobs.merchantOnlyNote}
              </p>
              <ButtonLink
                href={`/${lang}/merchant`}
                className="mt-2"
                leftIcon={<Store className="h-4 w-4" />}
              >
                {dict.common.openStore}
              </ButtonLink>
            </CardBody>
          </Card>
        )}
      </Container>
    </div>
  );
}
