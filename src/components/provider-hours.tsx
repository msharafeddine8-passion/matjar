"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { fieldClass } from "@/components/ui/field";
import type { Dictionary } from "@/i18n/get-dictionary";
import { beirutYmd } from "@/lib/quick-panel";

export type HourRule = {
  id: string;
  doctor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};
export type HourException = {
  id: string;
  doctor_id: string;
  on_date: string;
  reason: string | null;
};

// Per-provider weekly hours + full-day blocks (migration 0174). No rules for a
// provider = the store's hours apply; once any rule exists, the booking engine
// only offers slots inside these windows and refuses the rest server-side.
export function ProviderHours({
  storeId,
  dict,
  doctors,
  initialRules,
  initialExceptions,
}: {
  storeId: string;
  dict: Dictionary;
  doctors: { id: string; name: string }[];
  initialRules: HourRule[];
  initialExceptions: HourException[];
}) {
  const router = useRouter();
  const t = dict.merchant.providerHours;
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  // Draft week for the selected provider: weekday → {on, from, to}.
  const week = useMemo(() => {
    const w: Record<number, { on: boolean; from: string; to: string }> = {};
    for (let d = 0; d <= 6; d++) w[d] = { on: false, from: "09:00", to: "18:00" };
    for (const r of initialRules.filter((r) => r.doctor_id === doctorId)) {
      w[r.weekday] = {
        on: true,
        from: r.start_time.slice(0, 5),
        to: r.end_time.slice(0, 5),
      };
    }
    return w;
  }, [doctorId, initialRules]);
  const [draft, setDraft] = useState(week);
  // Re-sync the draft when the provider changes.
  const [lastDoctor, setLastDoctor] = useState(doctorId);
  if (doctorId !== lastDoctor) {
    setLastDoctor(doctorId);
    setDraft(week);
  }

  const dayNames: string[] = t.days as unknown as string[];
  const blocks = initialExceptions.filter((x) => x.doctor_id === doctorId);

  async function saveWeek() {
    if (busy || !doctorId) return;
    setBusy(true);
    const supabase = createClient();
    // Replace-all: simplest correct write for a 7-row config.
    const { error: delErr } = await supabase
      .from("provider_availability_rules")
      .delete()
      .eq("doctor_id", doctorId);
    if (!delErr) {
      const rows = Object.entries(draft)
        .filter(([, v]) => v.on && v.from && v.to && v.from < v.to)
        .map(([d, v]) => ({
          store_id: storeId,
          doctor_id: doctorId,
          weekday: Number(d),
          start_time: v.from,
          end_time: v.to,
        }));
      if (rows.length) {
        const { error: insErr } = await supabase
          .from("provider_availability_rules")
          .insert(rows);
        if (insErr) {
          setBusy(false);
          notifyError(dict.common.actionFailed);
          return;
        }
      }
    } else {
      setBusy(false);
      notifyError(dict.common.actionFailed);
      return;
    }
    setBusy(false);
    notifySuccess(t.saved);
    router.refresh();
  }

  async function addBlock() {
    if (busy || !doctorId || !blockDate) return;
    setBusy(true);
    const { error } = await createClient()
      .from("provider_availability_exceptions")
      .insert({
        store_id: storeId,
        doctor_id: doctorId,
        on_date: blockDate,
        kind: "unavailable",
        reason: blockReason.trim() || null,
      });
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setBlockDate("");
    setBlockReason("");
    notifySuccess(t.blockAdded);
    router.refresh();
  }

  async function removeBlock(id: string) {
    if (busy) return;
    setBusy(true);
    const { error } = await createClient()
      .from("provider_availability_exceptions")
      .delete()
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  if (doctors.length === 0) return null;

  return (
    <div className="mt-8 rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <CalendarClock className="h-5 w-5 text-primary" />
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      <select
        value={doctorId}
        onChange={(e) => setDoctorId(e.target.value)}
        className={`${fieldClass} mt-3 sm:max-w-xs`}
        aria-label={t.title}
      >
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <div className="mt-4 space-y-2">
        {Array.from({ length: 7 }, (_, d) => d).map((d) => {
          const row = draft[d];
          return (
            <div key={d} className="flex flex-wrap items-center gap-2">
              <label className="flex w-28 cursor-pointer items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={row.on}
                  onChange={(e) =>
                    setDraft({ ...draft, [d]: { ...row, on: e.target.checked } })
                  }
                  className="h-4 w-4 accent-primary"
                />
                {dayNames[d]}
              </label>
              {row.on ? (
                <span className="flex items-center gap-1.5" dir="ltr">
                  <input
                    type="time"
                    value={row.from}
                    onChange={(e) =>
                      setDraft({ ...draft, [d]: { ...row, from: e.target.value } })
                    }
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    type="time"
                    value={row.to}
                    onChange={(e) =>
                      setDraft({ ...draft, [d]: { ...row, to: e.target.value } })
                    }
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{t.dayOff}</span>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={saveWeek}
        disabled={busy}
        className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {t.save}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{t.hint}</p>

      {/* Full-day blocks (leave / emergency) */}
      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-sm font-bold">{t.blocksTitle}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={blockDate}
            min={beirutYmd(new Date())}
            onChange={(e) => setBlockDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            type="text"
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder={t.blockReason}
            className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={addBlock}
            disabled={busy || !blockDate}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t.blockAdd}
          </button>
        </div>
        {blocks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {blocks.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-xs font-bold text-danger"
              >
                {b.on_date}
                {b.reason ? ` · ${b.reason}` : ""}
                <button
                  type="button"
                  onClick={() => removeBlock(b.id)}
                  aria-label={t.blockRemove}
                  className="transition-opacity hover:opacity-70"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
