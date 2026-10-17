"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Truck, Eye, EyeOff, Pencil, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { notifyError } from "@/lib/notify";
import { logAdminAction } from "@/lib/audit";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";

export type DeliveryCompany = {
  id: string;
  name: string;
  coverage: string | null;
  phone: string | null;
  whatsapp: string | null;
  pricing_note: string | null;
  is_active: boolean;
};

export function AdminDeliveryClient({
  dict,
  companies,
}: {
  dict: Pick<Dictionary, "admin" | "common">;
  companies: DeliveryCompany[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.delivery;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DeliveryCompany | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const form = new FormData(el);
    const name = String(form.get("name") ?? "").trim();
    if (!name || busy) return;
    const values = {
      name,
      coverage: String(form.get("coverage") ?? "").trim() || null,
      phone: String(form.get("phone") ?? "").trim() || null,
      whatsapp: String(form.get("whatsapp") ?? "").trim() || null,
      pricing_note: String(form.get("pricing_note") ?? "").trim() || null,
    };
    setBusy(true);
    if (editing) {
      const id = editing.id;
      const { error } = await createClient()
        .from("delivery_companies")
        .update(values)
        .eq("id", id);
      setBusy(false);
      if (error) {
        notifyError(dict.common.actionFailed);
        return;
      }
      void logAdminAction("updated", "delivery_company", id);
      setEditing(null);
      router.refresh();
      return;
    }
    const { error } = await createClient()
      .from("delivery_companies")
      .insert(values);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("created", "delivery_company", null, { name });
    el.reset();
    router.refresh();
  }

  async function patch(id: string, p: Record<string, unknown>) {
    setBusy(true);
    const { error } = await createClient()
      .from("delivery_companies")
      .update(p)
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("updated", "delivery_company", id, {
      is_active: p.is_active,
    });
    router.refresh();
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        message: t.confirmDelete,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const { error } = await createClient()
      .from("delivery_companies")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("deleted", "delivery_company", id);
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <PageHeader icon={Truck} title={t.title} subtitle={t.subtitle} />

        <div data-animate className="space-y-6">
          <Card>
            <CardBody>
              <form key={editing?.id ?? "new"} onSubmit={save}>
                <h2 className="font-bold">
                  {editing ? editing.name : t.addCompany}
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Input
                    name="name"
                    type="text"
                    required
                    placeholder={t.name}
                    defaultValue={editing?.name ?? ""}
                  />
                  <Input
                    name="coverage"
                    type="text"
                    placeholder={t.coverage}
                    defaultValue={editing?.coverage ?? ""}
                  />
                  <Input
                    name="phone"
                    type="tel"
                    placeholder={t.phone}
                    defaultValue={editing?.phone ?? ""}
                  />
                  <Input
                    name="whatsapp"
                    type="tel"
                    placeholder={t.whatsapp}
                    defaultValue={editing?.whatsapp ?? ""}
                  />
                  <Input
                    name="pricing_note"
                    type="text"
                    placeholder={t.pricingNote}
                    className="sm:col-span-2"
                    defaultValue={editing?.pricing_note ?? ""}
                  />
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    type="submit"
                    disabled={busy}
                    leftIcon={
                      editing ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )
                    }
                  >
                    {t.add}
                  </Button>
                  {editing ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                      leftIcon={<X className="h-4 w-4" />}
                    >
                      {dict.common.back}
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardBody>
          </Card>

          {companies.length ? (
            <div className="space-y-3">
              {companies.map((c) => (
                <Card key={c.id} className={c.is_active ? "" : "opacity-60"}>
                  <CardBody className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">{c.name}</p>
                        <Badge
                          variant={c.is_active ? "success" : "neutral"}
                          size="sm"
                        >
                          {c.is_active ? t.show : t.hide}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[c.coverage, c.pricing_note]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p
                        className="mt-0.5 text-sm text-muted-foreground"
                        dir="ltr"
                      >
                        {[c.phone, c.whatsapp].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setEditing(c)}
                        aria-label="تعديل"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => patch(c.id, { is_active: !c.is_active })}
                        leftIcon={
                          c.is_active ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )
                        }
                      >
                        {c.is_active ? t.hide : t.show}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => remove(c.id)}
                        aria-label={t.delete}
                        className="!text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={Truck} title={t.empty} />
          )}
        </div>
      </Container>
    </div>
  );
}
