import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users, Phone, Gem, BookOpen } from "lucide-react";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/staff-access";
import { Container } from "@/components/ui/container";
import { NextStepEmpty } from "@/components/os-dashboard/next-step-empty";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Membership = {
  id: string;
  customer_name: string | null;
  phone: string | null;
  ends_on: string | null;
  status: string;
  store_membership_plans: { name: string } | null;
};
type Enrollment = {
  id: string;
  customer_name: string | null;
  phone: string | null;
  status: string;
  store_courses: { name: string } | null;
};

export default async function StoreMembersPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.os.members;

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
    .select("name")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  // Staff: the module's own permission (owner-only modules: the owner).
  await requireModuleAccess(supabase, storeId, "members", lang);

  const [{ data: mem }, { data: enr }] = await Promise.all([
    supabase
      .from("store_memberships")
      .select(
        "id, customer_name, phone, ends_on, status, store_membership_plans(name)",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("course_enrollments")
      .select("id, customer_name, phone, status, store_courses(name)")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
  ]);
  const memberships = (mem ?? []) as unknown as Membership[];
  const enrollments = (enr ?? []) as unknown as Enrollment[];

  const Row = ({
    name,
    phone,
    tag,
    extra,
  }: {
    name: string | null;
    phone: string | null;
    tag: string | null;
    extra?: string;
  }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{name || "—"}</span>
          {tag && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
              {tag}
            </span>
          )}
        </div>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Phone className="h-3.5 w-3.5" />
            <span dir="ltr">{phone}</span>
          </a>
        )}
      </div>
      {extra && (
        <span className="text-xs text-muted-foreground">{extra}</span>
      )}
    </div>
  );

  const empty = memberships.length === 0 && enrollments.length === 0;

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Users className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        {empty ? (
          <NextStepEmpty
            lang={lang}
            dict={dict}
            storeId={storeId}
            module="members"
            title={t.empty}
            className="mt-8"
          />
        ) : (
          <div className="mt-8 space-y-8">
            {memberships.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold">
                  <Gem className="h-5 w-5 text-primary" />
                  {t.membershipsTitle}
                </h2>
                <div className="space-y-2">
                  {memberships.map((m) => (
                    <Row
                      key={m.id}
                      name={m.customer_name}
                      phone={m.phone}
                      tag={m.store_membership_plans?.name ?? null}
                      extra={
                        m.ends_on
                          ? `${t.expires} ${new Date(m.ends_on).toLocaleDateString(lang === "ar" ? "ar" : "en")}`
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            )}
            {enrollments.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold">
                  <BookOpen className="h-5 w-5 text-primary" />
                  {t.coursesTitle}
                </h2>
                <div className="space-y-2">
                  {enrollments.map((e) => (
                    <Row
                      key={e.id}
                      name={e.customer_name}
                      phone={e.phone}
                      tag={e.store_courses?.name ?? null}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}
