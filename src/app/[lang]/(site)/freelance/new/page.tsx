import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { GigForm } from "@/components/gig-form";
import { dictSlice } from "@/lib/dict-slice";

export default async function NewGigPage({
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const freelancerName =
    (profile as { full_name: string | null } | null)?.full_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    "";

  return (
    <div className="py-10">
      <Container className="max-w-xl">
        <Link
          href={`/${lang}/freelance`}
          className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.freelance.title}
        </Link>
        <PageHeader
          className="mt-3"
          title={dict.freelance.offerService}
          icon={Sparkles}
        />
        <div className="mt-2">
          <GigForm lang={lang} dict={dictSlice(dict, ["account", "auth", "freelance"])} freelancerName={freelancerName} />
        </div>
      </Container>
    </div>
  );
}
