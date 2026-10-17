"use client";
import { revalidateProduct } from "@/lib/cache-actions";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { logAdminAction } from "@/lib/audit";
import { notifyError } from "@/lib/notify";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

// One flash/clearance offer, normalized on the server from the products table.
export type DealRow = {
  id: string;
  name: string;
  price: number;
  flashPrice: number | null;
  flashEnd: string | null;
  inClearance: boolean;
  store: string | null;
};

export function AdminDealsClient({
  lang,
  dict,
  rows,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "common">;
  rows: DealRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.dealsAdmin;
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    let flash = 0;
    let clearance = 0;
    for (const r of rows) {
      if (r.flashPrice != null) flash++;
      if (r.inClearance) clearance++;
    }
    return { total: rows.length, flash, clearance };
  }, [rows]);

  async function endFlash(id: string) {
    if (
      !(await confirm({
        message: t.endConfirm,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusyId(id);
    const { error } = await createClient()
      .from("products")
      .update({ flash_price: null, flash_start: null, flash_end: null })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("updated", "product", id, { ended: "flash" });
    await revalidateProduct(id);
    router.refresh();
  }

  async function endClearance(id: string) {
    if (
      !(await confirm({
        message: t.endConfirm,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusyId(id);
    const { error } = await createClient()
      .from("products")
      .update({ in_clearance: false })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("updated", "product", id, { ended: "clearance" });
    await revalidateProduct(id);
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={Zap} title={t.title} subtitle={t.subtitle} />

        <div className="grid grid-cols-3 gap-3">
          <Stat label={t.total} value={counts.total.toLocaleString("en-US")} />
          <Stat label={t.flash} value={counts.flash.toLocaleString("en-US")} />
          <Stat
            label={t.clearance}
            value={counts.clearance.toLocaleString("en-US")}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState className="mt-6" icon={Zap} title={t.empty} />
        ) : (
          <div data-animate className="mt-6 space-y-2">
            {rows.map((r) => (
              <Card key={r.id}>
                <CardBody className="flex flex-wrap items-center gap-4 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{r.name}</span>
                      {r.store && (
                        <Badge variant="neutral" size="sm">
                          {t.store} · {r.store}
                        </Badge>
                      )}
                      {r.flashPrice != null && (
                        <Badge variant="primary" size="sm">
                          {t.flash}
                        </Badge>
                      )}
                      {r.inClearance && (
                        <Badge variant="warning" size="sm">
                          {t.clearance}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {r.flashPrice != null && (
                        <span>
                          {t.flashPrice}: ${r.flashPrice}
                        </span>
                      )}
                      {r.flashEnd && (
                        <span>
                          {t.endsAt}{" "}
                          {new Date(r.flashEnd).toLocaleDateString(lang, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {r.flashPrice != null && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === r.id}
                        onClick={() => endFlash(r.id)}
                        className="!text-danger"
                      >
                        {t.endFlash}
                      </Button>
                    )}
                    {r.inClearance && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === r.id}
                        onClick={() => endClearance(r.id)}
                        className="!text-danger"
                      >
                        {t.clearance}
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
