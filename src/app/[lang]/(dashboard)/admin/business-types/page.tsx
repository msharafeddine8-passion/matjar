import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { categoryGroup, type CategoryKey } from "@/lib/catalog";
import { AlertTriangle } from "lucide-react";
import { Container } from "@/components/ui/container";
import {
  BusinessTypeManager,
  type BusinessType,
} from "@/components/business-type-manager";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminBusinessTypesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("types", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("business_types")
    .select("id, slug, name_ar, name_en, icon, sort_order, is_active")
    .order("sort_order", { ascending: true });
  const types = (data ?? []) as BusinessType[];

  // ISS-031. The signup picker maps each business_types.slug onto a top-level
  // group and falls back to "shopping" when the slug is not in categoryGroup.
  // The fallback itself is right — a slug nobody mapped must not crash the form
  // or drop the option. What was wrong is that it was the ONLY consequence: the
  // row was silently filed under Shopping, the merchant saw a plausible screen,
  // and nothing anywhere ever said a mapping was missing. A default that is
  // never reported is indistinguishable from a decision, and it stays wrong for
  // as long as nobody happens to notice.
  //
  // This page is where that becomes visible, because this is where the slugs are
  // created and it is the only screen whose reader can act on it. The check is a
  // set difference against the compiled registry, so it cannot drift from what
  // the picker actually does.
  //
  // Not fixed here: the fallback at the call site in merchant/new/page.tsx, and
  // the stores already sitting in the wrong group because of it. Both are
  // outside this surface; this reports the gap rather than repairing its damage.
  const known = new Set<string>(Object.keys(categoryGroup) as CategoryKey[]);
  const unmapped = types.filter((t) => !known.has(t.slug));
  if (unmapped.length) {
    // The server log gets it too — an admin has to open this page to see the
    // banner, and the whole failure mode here is that nobody opens anything.
    console.warn(
      `[matjar:sectors] ${unmapped.length} business_types slug(s) have no entry in categoryGroup ` +
        `and are silently grouped under "shopping": ${unmapped.map((t) => t.slug).join(", ")}. ` +
        `Add them to categoryGroup in src/lib/catalog.ts, or rename the slug to a known sector.`,
    );
  }

  const t = dict.admin.types;

  return (
    <>
      {unmapped.length > 0 && (
        <div className="pt-10">
          <Container>
            <div
              role="status"
              className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft/40 p-4"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div className="min-w-0 text-sm">
                <p className="font-bold">{t.unmappedTitle}</p>
                <p className="mt-1">
                  {t.unmappedBody.replace("{n}", String(unmapped.length))}
                </p>
                {/* Slugs are ASCII identifiers; dir="ltr" keeps a
                    comma-separated list from being reordered inside the RTL
                    paragraph that introduces it. */}
                <p
                  dir="ltr"
                  className="mt-2 break-words font-mono text-xs text-start"
                >
                  {unmapped.map((u) => u.slug).join(", ")}
                </p>
                <p className="mt-2 text-muted-foreground">{t.unmappedFix}</p>
              </div>
            </div>
          </Container>
        </div>
      )}
      <BusinessTypeManager lang={lang} dict={dictSlice(dict, ["admin", "auth", "common"])} types={types} />
    </>
  );
}
