"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { logAdminAction } from "@/lib/audit";
import { revalidateRate } from "@/lib/cache-actions";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function AdminSettingsForm({
  dict,
  initialRate,
}: {
  dict: Pick<Dictionary, "admin" | "common">;
  initialRate: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.platform;
  const [rate, setRate] = useState(initialRate);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !(await confirm({
        message: dict.admin.confirmSaveRate,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
      }))
    )
      return;
    setLoading(true);
    setSaved(false);
    const key = "usd_lbp_rate";
    const value = String(Number(rate) || 0);
    const { error } = await createClient().from("app_settings").upsert(
      {
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    setLoading(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction("updated", "setting", null, { key, value });
    await revalidateRate();
    setSaved(true);
    router.refresh();
  }

  return (
    <Card className="max-w-md">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t.lbpRate} htmlFor="rate" hint={t.lbpRateHint}>
            <Input
              id="rate"
              type="number"
              min="0"
              step="100"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={loading}>
              {loading ? t.saving : t.save}
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-sm font-semibold text-success">
                <Check className="h-4 w-4" />
                {t.saved}
              </span>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
