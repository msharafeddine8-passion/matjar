import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Boxes, Store } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { WholesaleForm } from "@/components/wholesale-form";
import { dictSlice } from "@/lib/dict-slice";

export default async function NewWholesalePage({
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

  const { data: store } = await supabase
    .from("stores")
    .select("name")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const sellerName = (store as { name: string } | null)?.name ?? "";

  return (
    <div className="py-10">
      <Container className="max-w-xl">
        <Link
          href={`/${lang}/wholesale`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.wholesale.title}
        </Link>
        <PageHeader
          className="mt-3"
          title={dict.wholesale.listProduct}
          icon={Boxes}
        />

        {store ? (
          <div className="mt-2">
            <WholesaleForm lang={lang} dict={dictSlice(dict, ["account", "auth", "wholesale"])} sellerName={sellerName} />
          </div>
        ) : (
          // Wholesale posting is merchants-only: no store → show an upsell, not
          // the form. RLS (0156) is the real gate; this is the friendly UI.
          <Card className="mt-4">
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Store className="h-7 w-7" />
              </span>
              <h2 className="text-lg font-extrabold">
                {dict.wholesale.merchantOnlyTitle}
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                {dict.wholesale.merchantOnlyNote}
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
