import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { ClassesManager, type ClassRow } from "@/components/classes-manager";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { requireModuleAccess } from "@/lib/staff-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StoreClassesPage({
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
  await requireModuleAccess(supabase, storeId, "classes", lang);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const { data: rowsData } = await supabase
    .from("store_classes")
    .select(
      "id, name, name_en, description, day_of_week, start_time, capacity, price, active",
    )
    .eq("store_id", storeId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true })
    .order("sort_order", { ascending: true });
  const classes = (rowsData ?? []) as ClassRow[];

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
          {dict.classes.title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {dict.classes.subtitle}
        </p>
        <div className="mt-6">
          <ClassesManager
            storeId={storeId}
            lang={lang}
            dict={dict}
            classes={classes}
          />
        </div>
      </Container>
    </div>
  );
}
