import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { regions, categoryGroup, toCategoryKey } from "@/lib/catalog";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { StoreForm } from "@/components/store-form";
import { dictSlice } from "@/lib/dict-slice";

type BusinessTypeRow = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
};

export default async function NewStorePage({
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

  const { data: types } = await supabase
    .from("business_types")
    .select("id, slug, name_ar, name_en")
    .order("sort_order");

  const businessTypes = ((types ?? []) as BusinessTypeRow[]).map((t) => {
    // The sector key the form branches on, so it can ask a restaurant and a
    // clinic different questions, and the group the picker files the option
    // under. Each used to hand-roll its own fallback — one an `in sectorConfig`
    // test, one a `?? "shopping"` on a widened lookup — which is two chances to
    // disagree with the rest of the codebase about what an unknown slug means.
    // Narrowed once now, by the shared helper: unknown lands on retail, whose
    // group is shopping, exactly what the two fallbacks produced between them,
    // and the slug gets named in a warning instead of being absorbed twice.
    const category = toCategoryKey(t.slug, `business type ${t.id}`);
    return {
      value: t.id,
      label: lang === "ar" ? t.name_ar : t.name_en,
      group: categoryGroup[category],
      category,
    };
  });
  const regionOptions = regions.map((r) => ({
    value: r.key,
    label: r.name[lang as Locale],
  }));

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {dict.merchant.createTitle}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {dict.merchant.createSubtitle}
        </p>

        {/* ISS-021's remaining half. /merchants carries these four lines under
            both of its "open your store" buttons, but this is the page where
            the merchant is actually deciding — the form is directly below, and
            the questions it raises (does this cost me anything, do they want my
            bank details, who holds the money) are the ones that stop a Lebanese
            shopkeeper signing up. Reused from merchantsPage.entryReassure
            verbatim rather than written again: two copies of a promise about
            money is two things to keep true. */}
        <ul className="mt-5 space-y-2 rounded-2xl border border-border bg-surface-muted/50 p-4">
          {dict.merchantsPage.entryReassure.map((line) => (
            <li
              key={line}
              className="flex items-start gap-2 text-sm text-muted-foreground"
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-success"
                aria-hidden
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <StoreForm
            lang={lang}
            dict={dictSlice(dict, ["groups", "merchant", "store"])}
            businessTypes={businessTypes}
            regions={regionOptions}
          />
        </div>
      </Container>
    </div>
  );
}
