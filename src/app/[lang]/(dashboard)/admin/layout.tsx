import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin-nav";
import type { AdminAccess } from "@/lib/admin-sections";
import { dictSlice } from "@/lib/dict-slice";

// All /admin pages share the platform-admin gate + section nav. Access is
// either "all" (super_admin) or the explicit set of granted sections
// (sub-admin). Entry requires at least one section; the nav then shows only
// what the admin may reach. RLS remains the real enforcement on writes.
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
    .select("role, admin_permissions")
    .eq("id", user.id)
    .maybeSingle();

  const p = profile as
    | { role?: string; admin_permissions?: string[] | null }
    | null;
  const isSuper = p?.role === "super_admin";
  const perms = Array.isArray(p?.admin_permissions) ? p!.admin_permissions! : [];
  if (!isSuper && perms.length === 0) {
    redirect(`/${lang}`);
  }
  const access: AdminAccess = isSuper ? "all" : perms;

  return (
    <>
      <AdminNav lang={lang} dict={dictSlice(dict, ["admin", "demand"])} access={access} />
      {children}
    </>
  );
}
