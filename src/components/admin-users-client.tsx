"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Ban, Play, Users, ShieldCheck, Check, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { ADMIN_SECTIONS } from "@/lib/admin-sections";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type AdminUser = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: "customer" | "merchant" | "super_admin" | "driver";
  is_active: boolean;
  created_at: string;
  admin_permissions: string[] | null;
};

const roleVariant: Record<
  AdminUser["role"],
  "neutral" | "primary" | "info" | "warning"
> = {
  super_admin: "primary",
  merchant: "info",
  customer: "neutral",
  driver: "warning",
};

export function AdminUsersClient({
  lang,
  dict,
  users,
  currentUserId,
  viewerIsSuper,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "auth" | "common">;
  users: AdminUser[];
  currentUserId: string;
  viewerIsSuper: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.usersAdmin;
  const navLabels = dict.admin.nav as Record<string, string>;
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openPerms, setOpenPerms] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);

  async function toggle(id: string, next: boolean) {
    if (
      !next &&
      !(await confirm({
        message: dict.admin.confirmSuspendUser,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(id);
    const { error } = await createClient()
      .from("profiles")
      .update({ is_active: next })
      .eq("id", id);
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction(next ? "reactivated" : "suspended", "user", id);
    router.refresh();
  }

  function openEditor(u: AdminUser) {
    setOpenPerms(u.id);
    setDraft(Array.isArray(u.admin_permissions) ? u.admin_permissions : []);
  }

  function toggleSection(key: string) {
    setDraft((d) =>
      d.includes(key) ? d.filter((k) => k !== key) : [...d, key],
    );
  }

  async function savePerms(id: string) {
    if (
      !(await confirm({
        message: dict.admin.confirmSavePerms,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
      }))
    )
      return;
    setBusy(id);
    const { error } = await createClient()
      .from("profiles")
      .update({ admin_permissions: draft })
      .eq("id", id);
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    void logAdminAction("access_changed", "user", id, { sections: draft.length });
    setOpenPerms(null);
    router.refresh();
  }

  const filtered = users.filter((u) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (u.full_name ?? "").toLowerCase().includes(q) ||
      (u.phone ?? "").toLowerCase().includes(q)
    );
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const initial = (name: string | null) =>
    (name ?? "").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={Users} title={t.title} subtitle={t.subtitle} />

        <div className="relative mb-6 sm:max-w-md">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            className="ps-10"
          />
        </div>

        {filtered.length ? (
          <Card>
            <div data-animate className="divide-y divide-border">
              {filtered.map((u) => {
                const isSelf = u.id === currentUserId;
                const permCount = Array.isArray(u.admin_permissions)
                  ? u.admin_permissions.length
                  : 0;
                const canManagePerms =
                  viewerIsSuper && !isSelf && u.role !== "super_admin";
                const editing = openPerms === u.id;
                return (
                  <div key={u.id} className="transition-colors hover:bg-surface-muted">
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-extrabold text-primary">
                          {initial(u.full_name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">
                              {u.full_name ?? "—"}
                              {isSelf && (
                                <span className="ms-1 text-xs font-normal text-muted-foreground">
                                  ({t.you})
                                </span>
                              )}
                            </span>
                            <Badge variant={roleVariant[u.role]} size="sm">
                              {t.roles[u.role]}
                            </Badge>
                            {u.role !== "super_admin" && permCount > 0 && (
                              <Badge variant="primary" size="sm">
                                <ShieldCheck className="h-3 w-3" />
                                {t.adminBadge} · {permCount}
                              </Badge>
                            )}
                            {!u.is_active && (
                              <Badge variant="danger" size="sm">
                                {t.suspended}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {u.phone ? (
                              <>
                                <span dir="ltr">{u.phone}</span>
                                {" · "}
                              </>
                            ) : null}
                            {t.joined} {fmtDate(u.created_at)}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {canManagePerms && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              editing ? setOpenPerms(null) : openEditor(u)
                            }
                            leftIcon={<ShieldCheck className="h-4 w-4" />}
                          >
                            {t.grantAccess}
                          </Button>
                        )}
                        {!isSelf && u.role !== "super_admin" && (
                          <Button
                            size="sm"
                            variant={u.is_active ? "secondary" : "primary"}
                            disabled={busy === u.id}
                            onClick={() => toggle(u.id, !u.is_active)}
                            leftIcon={
                              u.is_active ? (
                                <Ban className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )
                            }
                            className={
                              u.is_active ? "!text-danger" : ""
                            }
                          >
                            {u.is_active ? t.suspend : t.reactivate}
                          </Button>
                        )}
                      </div>
                    </div>

                    {editing && (
                      <div className="border-t border-border bg-surface-muted/40 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                          <ShieldCheck className="h-4 w-4 text-primary" />
                          {t.manageAccess}
                        </div>
                        <p className="mb-3 text-xs text-muted-foreground">
                          {t.accessHint}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                          {ADMIN_SECTIONS.map((key) => {
                            const on = draft.includes(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => toggleSection(key)}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm font-semibold transition-colors ${
                                  on
                                    ? "border-primary bg-primary-soft text-primary"
                                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                }`}
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    on
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border"
                                  }`}
                                >
                                  {on && <Check className="h-3 w-3" />}
                                </span>
                                {navLabels[key] ?? key}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={busy === u.id}
                            onClick={() => savePerms(u.id)}
                            leftIcon={<Check className="h-4 w-4" />}
                          >
                            {t.save}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setOpenPerms(null)}
                            leftIcon={<X className="h-4 w-4" />}
                          >
                            {t.cancel}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : (
          <EmptyState icon={Users} title={t.empty} />
        )}
      </Container>
    </div>
  );
}
