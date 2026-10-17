import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import { AdminUsersClient, type AdminUser } from "@/components/admin-users-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("users", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data }, { data: me }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active, created_at, admin_permissions")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user?.id ?? "")
      .maybeSingle(),
  ]);
  const users = (data ?? []) as AdminUser[];
  const viewerIsSuper = (me as { role?: string } | null)?.role === "super_admin";

  return (
    <AdminUsersClient
      lang={lang}
      dict={dictSlice(dict, ["admin", "auth", "common"])}
      users={users}
      currentUserId={user?.id ?? ""}
      viewerIsSuper={viewerIsSuper}
    />
  );
}
