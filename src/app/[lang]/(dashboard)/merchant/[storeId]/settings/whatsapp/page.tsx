import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { loadWaTemplates } from "@/lib/wa-actions-server";
import { WaTemplateEditor } from "@/components/wa-actions/wa-template-editor";

// The wording of every WhatsApp button (every plan). Owner-only, like the rest
// of store settings — and the same rule the database enforces: only the store
// owner may write public.store_wa_templates (0309); staff read it so their
// buttons use the shop's wording.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WhatsAppTemplatesPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.waActions;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  const storeName = (store as { name: string }).name;

  const { templates, ready } = await loadWaTemplates(supabase, storeId);

  return (
    <div className="py-6 sm:py-10">
      <Container className="max-w-xl">
        <Link
          href={`/${lang}/merchant/${storeId}/settings`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.merchant.settings.title}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t.editor.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t.editor.subtitle}</p>
        <div className="mt-6">
          <WaTemplateEditor
            storeId={storeId}
            storeName={storeName}
            uiLang={lang}
            initial={templates}
            ready={ready}
            cancelLabel={dict.common.cancel}
            t={t}
          />
        </div>
      </Container>
    </div>
  );
}
