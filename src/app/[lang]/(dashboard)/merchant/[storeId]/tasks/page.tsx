import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { isPro } from "@/lib/plan";
import { getStorePlan } from "@/lib/plan-server";
import { ProGate } from "@/components/pro-gate";
import { Container } from "@/components/ui/container";
import { LoadError } from "@/components/ui/load-error";
import { TasksManager, type TaskRow } from "@/components/tasks-manager";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { requireModuleAccess } from "@/lib/staff-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tasks & reminders module of the Business OS (sector-neutral).
export default async function StoreTasksPage({
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
  await requireModuleAccess(supabase, storeId, "tasks", lang);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  // Pro-only module: free stores see the upsell instead.
  if (!isPro(await getStorePlan(storeId))) {
    return <ProGate lang={lang} dict={dict} storeId={storeId} />;
  }

  const { data, error: loadErr } = await supabase
    .from("store_tasks")
    .select("id, title, due_on, priority, status")
    .eq("store_id", storeId)
    .order("status", { ascending: true })
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const tasks = (data ?? []) as TaskRow[];
  if (loadErr) console.error("[tasks] read failed", loadErr);

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
          {dict.os.tasks.title}
        </h1>

        {loadErr ? (
          <LoadError message={dict.common.loadError} className="mt-6" />
        ) : (
          <div className="mt-6">
            <TasksManager
              storeId={storeId}
              lang={lang as Locale}
              dict={dict}
              tasks={tasks}
            />
          </div>
        )}
      </Container>
    </div>
  );
}
