"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus,
  LogIn,
  LogOut,
  Wallet,
  Calculator,
  CheckCircle2,
  Pencil,
  Smartphone,
  Link2,
  AlertTriangle,
  Copy,
  MessageCircle,
} from "lucide-react";
import { waLink } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { beirutYmd } from "@/lib/quick-panel";

export type Employee = {
  id: string;
  name: string;
  phone: string | null;
  job_title: string | null;
  pay_basis: "monthly" | "daily" | "hourly";
  pay_rate: number;
  pay_currency: "USD" | "LBP";
  id_number: string | null;
  residency_expires_on: string | null;
  status: string;
  on_shift: boolean;
  devices?: { id: string; label: string | null; last_used_at: string | null }[];
};

export type PayrollLine = {
  employee_name: string;
  pay_basis: string;
  currency: string;
  days_worked: number;
  minutes_worked: number;
  gross: number;
  advances: number;
  net: number;
};

export type PayrollRun = {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_usd: number;
  total_lbp: number;
  lines: PayrollLine[];
};

type L = Record<string, string>;

function money(n: number, c: string) {
  return c === "LBP"
    ? `${Math.round(n).toLocaleString("en-US")} ل.ل`
    : `$${Number(n).toFixed(2)}`;
}

// People, hours and pay for a shop that runs on six workers and a notebook.
//
// Deliberately one screen. A separate module each for employees, attendance,
// advances and payroll would be tidier to build and useless to a butcher at
// 6am: the whole job is "who is here, who took money, what do I owe".
export function HrManager({
  storeId,
  clockLink,
  storeHasPin,
  clockConfigured,
  clockRadius,
  residencyCutoff,
  employees,
  runs,
  labels,
}: {
  storeId: string;
  /** Public link the employee opens on their own phone. */
  clockLink: string;
  storeHasPin: boolean;
  /** Whether the server holds the key the clock routes need to answer at all. */
  clockConfigured: boolean;
  clockRadius: number;
  /** ISO date 30 days out, computed on the server — reading the clock during
   *  render is impure and React rightly refuses it. */
  residencyCutoff: string;
  employees: Employee[];
  runs: PayrollRun[];
  labels: L;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  // The six digits are shown once and not stored anywhere readable, so they live
  // in component state until the owner has read them out.
  const [enrolCode, setEnrolCode] = useState<{ id: string; code: string } | null>(
    null,
  );
  // Inline, not window.prompt: a browser dialog has no currency, no context and
  // no cancel-safe styling — it reads as a broken page, and money deserves a
  // labelled field.
  const [advanceFor, setAdvanceFor] = useState<string | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceNote, setAdvanceNote] = useState("");
  const [radius, setRadius] = useState(String(clockRadius));
  const [form, setForm] = useState({
    name: "",
    phone: "",
    job_title: "",
    pay_basis: "monthly",
    pay_rate: "",
    pay_currency: "USD",
  });

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const [from, setFrom] = useState(iso(monthStart));
  const [to, setTo] = useState(iso(monthEnd));

  async function addEmployee() {
    if (!form.name.trim()) {
      notifyError(labels.needName);
      return;
    }
    setBusy("add");
    const { error } = await createClient().from("store_employees").insert({
      store_id: storeId,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      job_title: form.job_title.trim() || null,
      pay_basis: form.pay_basis,
      pay_rate: Number(form.pay_rate) || 0,
      pay_currency: form.pay_currency,
    });
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    setForm({
      name: "",
      phone: "",
      job_title: "",
      pay_basis: "monthly",
      pay_rate: "",
      pay_currency: "USD",
    });
    setAdding(false);
    router.refresh();
  }

  async function unlinkDevice(deviceId: string, name: string) {
    const ok = await confirm({
      message: labels.unlinkConfirm.replace("{n}", name),
      confirmLabel: labels.unlink,
      cancelLabel: labels.postNo,
      danger: true,
    });
    if (!ok) return;
    setBusy(deviceId);
    const { error } = await createClient()
      .from("employee_devices")
      .delete()
      .eq("id", deviceId);
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    notifySuccess(labels.unlinked);
    router.refresh();
  }

  async function saveRadius() {
    setBusy("radius");
    const { error } = await createClient()
      .from("stores")
      .update({ clock_radius_m: Math.max(20, Math.min(2000, Number(radius) || 150)) })
      .eq("id", storeId);
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    notifySuccess(labels.radiusSaved);
    router.refresh();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(clockLink);
      notifySuccess(labels.copied);
    } catch {
      // Clipboard is blocked on insecure origins and in some in-app browsers.
      // The link is printed above in full, so this is a convenience failing,
      // not the task failing.
      notifyError(labels.copyFailed);
    }
  }

  // The link is the same for everyone; what is per-employee is having it land
  // in the right person's chat. WhatsApp is where a shop already talks to its
  // staff, so the message is prefilled rather than left to be retyped.
  //
  // Deliberately NOT the enrolment code: that is read out face to face, and
  // sending it would hand over the one thing standing in for a password.
  function sendLink(phone: string) {
    const url = waLink(phone, labels.sendLinkMsg.replace("{u}", clockLink));
    if (!url) {
      notifyError(labels.badPhone);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // One phone, one person. The code is single-use and dies in ten minutes, so
  // the owner reads it out while the person is standing there rather than
  // sending it ahead.
  async function makeEnrolCode(employeeId: string) {
    setBusy(employeeId);
    const { data, error } = await createClient().rpc("create_enrolment_code", {
      p_employee_id: employeeId,
    });
    setBusy(null);
    if (error || !data) {
      notifyError(labels.error);
      return;
    }
    setEnrolCode({ id: employeeId, code: String(data) });
  }

  // Everything about a person changes: rates go up, papers get renewed, people
  // leave. Shipping an add-only screen would have meant a rate could never be
  // corrected and the residency warning could never fire, because nothing could
  // set the date it reads.
  async function saveEmployee(e: Employee) {
    setBusy(e.id);
    const { error } = await createClient()
      .from("store_employees")
      .update({
        name: e.name.trim(),
        phone: e.phone?.trim() || null,
        job_title: e.job_title?.trim() || null,
        pay_basis: e.pay_basis,
        pay_rate: Number(e.pay_rate) || 0,
        pay_currency: e.pay_currency,
        id_number: e.id_number?.trim() || null,
        residency_expires_on: e.residency_expires_on || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", e.id);
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  // Ending employment, not deleting a person: the payroll they appear on and
  // the hours they worked have to survive them leaving.
  async function endEmployment(e: Employee) {
    const ok = await confirm({
      message: labels.endConfirm.replace("{n}", e.name),
      confirmLabel: labels.endYes,
      cancelLabel: labels.postNo,
      danger: true,
    });
    if (!ok) return;
    setBusy(e.id);
    const { error } = await createClient()
      .from("store_employees")
      .update({
        status: "ended",
        ended_on: beirutYmd(new Date()),
      })
      .eq("id", e.id);
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  // No PIN typed here: a manager pressing this is recorded as a manager punch,
  // which is exactly what it is.
  async function clock(employeeId: string) {
    setBusy(employeeId);
    const { error } = await createClient().rpc("employee_clock", {
      p_store_id: storeId,
      p_employee_id: employeeId,
      p_pin: null,
      p_lat: null,
      p_lng: null,
    });
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    router.refresh();
  }

  async function addAdvance(employeeId: string, currency: string) {
    const amount = Number(advanceAmount);
    if (!amount || amount <= 0) return;
    setBusy(employeeId);
    const { error } = await createClient().from("employee_advances").insert({
      store_id: storeId,
      employee_id: employeeId,
      amount,
      currency,
      note: advanceNote.trim() || null,
    });
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    notifySuccess(labels.advanceSaved);
    setAdvanceFor(null);
    setAdvanceAmount("");
    setAdvanceNote("");
    router.refresh();
  }

  async function buildPayroll() {
    setBusy("payroll");
    const { error } = await createClient().rpc("build_payroll", {
      p_store_id: storeId,
      p_from: from,
      p_to: to,
    });
    setBusy(null);
    if (error) {
      notifyError(
        (error.message ?? "").includes("period_already_posted")
          ? labels.alreadyPosted
          : labels.error,
      );
      return;
    }
    router.refresh();
  }

  async function postPayroll(runId: string) {
    const ok = await confirm({
      message: labels.postConfirm,
      confirmLabel: labels.postYes,
      cancelLabel: labels.postNo,
      danger: true,
    });
    if (!ok) return;
    setBusy(runId);
    const { error } = await createClient().rpc("post_payroll", {
      p_run_id: runId,
    });
    setBusy(null);
    if (error) {
      notifyError(labels.error);
      return;
    }
    notifySuccess(labels.postDone);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* ===== People ===== */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{labels.peopleTitle}</h2>
          <span className="flex items-center gap-2">
            {/* The tablet by the door. Only useful once someone has a PIN, so it
                is a quiet link rather than a headline button. */}
            <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
              <UserPlus className="h-4 w-4" />
              {labels.addEmployee}
            </Button>
          </span>
        </div>

        {/* The link that makes any of this reachable. Without a pin on the map
            the punch is refused server-side, so say that here rather than let
            the owner discover it from a confused employee. */}
        <div className="mt-3 rounded-xl border border-border bg-surface-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold">
            <Link2 className="h-3.5 w-3.5 text-primary" />
            {labels.linkTitle}
          </p>
          <p className="mt-1 break-all font-mono text-sm text-primary" dir="ltr">
            {clockLink}
          </p>
          {/* One link for the whole shop, not one per person — so it is copied
              from here, and only the sending is per-employee (see the row
              button). Reading eight characters off a screen and retyping them
              is how a link arrives wrong. */}
          <Button size="sm" variant="outline" className="mt-2" onClick={copyLink}>
            <Copy className="h-4 w-4" />
            {labels.copyLink}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">{labels.linkHint}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label
                className="text-xs font-semibold text-muted-foreground"
                htmlFor="hr-clock-radius"
              >
                {labels.radius}
              </label>
              <input
                id="hr-clock-radius"
                type="number"
                min="20"
                max="2000"
                step="10"
                value={radius}
                onChange={(ev) => setRadius(ev.target.value)}
                className={`${fieldClass} mt-1 max-w-28`}
                dir="ltr"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={saveRadius}
              loading={busy === "radius"}
            >
              {labels.save}
            </Button>
            <span className="pb-2 text-xs text-muted-foreground">
              {labels.radiusHint}
            </span>
          </div>

          {/* Stated first and in the strongest colour on the screen, because
              nothing else on this page works without it and every downstream
              symptom points at the employee instead. */}
          {!clockConfigured && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {labels.notConfigured}
            </p>
          )}

          {!storeHasPin && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {labels.needStorePin}
            </p>
          )}
        </div>

        {adding && (
          <div className="mt-4 grid gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={labels.fName}
              className={fieldClass}
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder={labels.fPhone}
              className={fieldClass}
              dir="ltr"
            />
            <input
              value={form.job_title}
              onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              placeholder={labels.fJob}
              className={fieldClass}
            />
            <select
              value={form.pay_basis}
              onChange={(e) => setForm({ ...form, pay_basis: e.target.value })}
              className={fieldClass}
            >
              <option value="monthly">{labels.basisMonthly}</option>
              <option value="daily">{labels.basisDaily}</option>
              <option value="hourly">{labels.basisHourly}</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.pay_rate}
              onChange={(e) => setForm({ ...form, pay_rate: e.target.value })}
              placeholder={labels.fRate}
              className={fieldClass}
            />
            <select
              value={form.pay_currency}
              onChange={(e) =>
                setForm({ ...form, pay_currency: e.target.value })
              }
              className={fieldClass}
            >
              <option value="USD">USD</option>
              <option value="LBP">LBP</option>
            </select>
            <div className="sm:col-span-2">
              <Button onClick={addEmployee} loading={busy === "add"}>
                {labels.save}
              </Button>
            </div>
          </div>
        )}

        {employees.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{labels.noPeople}</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {employees.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-40 flex-1">
                  <p className="font-bold">
                    {e.name}
                    {e.on_shift && (
                      <span className="ms-2 rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
                        {labels.onShift}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      e.job_title,
                      `${money(Number(e.pay_rate), e.pay_currency)} / ${
                        labels[
                          e.pay_basis === "monthly"
                            ? "perMonth"
                            : e.pay_basis === "daily"
                              ? "perDay"
                              : "perHour"
                        ]
                      }`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {/* A lapsed permit is the shop's problem, not just the
                      worker's, so it is said out loud rather than filed away. */}
                  {e.residency_expires_on &&
                    e.residency_expires_on <= residencyCutoff && (
                      <p className="mt-0.5 text-xs font-bold text-warning">
                        {labels.residencySoon.replace(
                          "{d}",
                          e.residency_expires_on,
                        )}
                      </p>
                    )}
                </div>
                <Button
                  size="sm"
                  variant={e.on_shift ? "outline" : "primary"}
                  disabled={busy === e.id}
                  onClick={() => clock(e.id)}
                >
                  {e.on_shift ? (
                    <LogOut className="h-4 w-4" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {e.on_shift ? labels.clockOut : labels.clockIn}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === e.id}
                  onClick={() => {
                    setAdvanceFor(advanceFor === e.id ? null : e.id);
                    setAdvanceAmount("");
                    setAdvanceNote("");
                  }}
                >
                  <Wallet className="h-4 w-4" />
                  {labels.advance}
                </Button>
                {/* Only where there is a number to send to. A button that opens
                    an empty WhatsApp is a button that looks broken. */}
                {e.phone && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendLink(e.phone!)}
                  >
                    <MessageCircle className="h-4 w-4" />
                    {labels.sendLink}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === e.id}
                  onClick={() => makeEnrolCode(e.id)}
                >
                  <Smartphone className="h-4 w-4" />
                  {(e.devices?.length ?? 0) > 0
                    ? labels.linkAnother
                    : labels.linkPhone}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === e.id}
                  onClick={() =>
                    setEditing(editing?.id === e.id ? null : { ...e })
                  }
                >
                  <Pencil className="h-4 w-4" />
                  {labels.edit}
                </Button>

                {/* A lost phone has to be removable, or a stolen one clocks in
                    forever. Ending employment already blocks the punch; this is
                    for the phone that goes missing while someone still works
                    here. */}
                {(e.devices?.length ?? 0) > 0 && (
                  <ul className="mt-1 w-full space-y-1">
                    {e.devices!.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted/50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="truncate text-muted-foreground">
                          <Smartphone className="me-1 inline h-3 w-3" />
                          {d.label?.slice(0, 40) ?? labels.aPhone}
                          {d.last_used_at && (
                            <span className="ms-1">
                              · {d.last_used_at.slice(0, 10)}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => unlinkDevice(d.id, e.name)}
                          className="shrink-0 font-bold text-danger hover:underline"
                        >
                          {labels.unlink}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {advanceFor === e.id && (
                  <div className="mt-2 flex w-full flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-muted/40 p-3">
                    <div>
                      {/* Static ids are safe: only one advance form is open at
                          a time (advanceFor is a single id). */}
                      <label
                        className="text-xs font-semibold text-muted-foreground"
                        htmlFor="hr-advance-amount"
                      >
                        {labels.advanceAmount.replace("{c}", e.pay_currency)}
                      </label>
                      <input
                        id="hr-advance-amount"
                        type="number"
                        min="1"
                        step="0.01"
                        value={advanceAmount}
                        onChange={(ev) => setAdvanceAmount(ev.target.value)}
                        className={`${fieldClass} mt-1 max-w-32`}
                        dir="ltr"
                        autoFocus
                      />
                    </div>
                    <div className="min-w-32 flex-1">
                      <label
                        className="text-xs font-semibold text-muted-foreground"
                        htmlFor="hr-advance-note"
                      >
                        {labels.advanceNote}
                      </label>
                      <input
                        id="hr-advance-note"
                        value={advanceNote}
                        onChange={(ev) => setAdvanceNote(ev.target.value)}
                        placeholder={labels.advanceNotePlaceholder}
                        className={`${fieldClass} mt-1`}
                      />
                    </div>
                    <Button
                      size="sm"
                      loading={busy === e.id}
                      disabled={!(Number(advanceAmount) > 0)}
                      onClick={() => addAdvance(e.id, e.pay_currency)}
                    >
                      {labels.save}
                    </Button>
                  </div>
                )}

                {enrolCode?.id === e.id && (
                  <div className="mt-2 w-full rounded-xl border border-primary/30 bg-primary-soft p-3 text-center">
                    <p className="text-xs font-semibold text-primary">
                      {labels.codeFor.replace("{n}", e.name)}
                    </p>
                    <p
                      className="mt-1 text-3xl font-extrabold tracking-[0.3em] text-primary"
                      dir="ltr"
                    >
                      {enrolCode.code}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {labels.codeHint}
                    </p>
                  </div>
                )}

                {editing?.id === e.id && (
                  <div className="mt-2 grid w-full gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 sm:grid-cols-2">
                    <input
                      value={editing.name}
                      onChange={(ev) =>
                        setEditing({ ...editing, name: ev.target.value })
                      }
                      placeholder={labels.fName}
                      className={fieldClass}
                    />
                    <input
                      value={editing.phone ?? ""}
                      onChange={(ev) =>
                        setEditing({ ...editing, phone: ev.target.value })
                      }
                      placeholder={labels.fPhone}
                      className={fieldClass}
                      dir="ltr"
                    />
                    <input
                      value={editing.job_title ?? ""}
                      onChange={(ev) =>
                        setEditing({ ...editing, job_title: ev.target.value })
                      }
                      placeholder={labels.fJob}
                      className={fieldClass}
                    />
                    <select
                      value={editing.pay_basis}
                      onChange={(ev) =>
                        setEditing({
                          ...editing,
                          pay_basis: ev.target.value as Employee["pay_basis"],
                        })
                      }
                      className={fieldClass}
                    >
                      <option value="monthly">{labels.basisMonthly}</option>
                      <option value="daily">{labels.basisDaily}</option>
                      <option value="hourly">{labels.basisHourly}</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(editing.pay_rate)}
                      onChange={(ev) =>
                        setEditing({
                          ...editing,
                          pay_rate: Number(ev.target.value),
                        })
                      }
                      placeholder={labels.fRate}
                      className={fieldClass}
                    />
                    <select
                      value={editing.pay_currency}
                      onChange={(ev) =>
                        setEditing({
                          ...editing,
                          pay_currency: ev.target
                            .value as Employee["pay_currency"],
                        })
                      }
                      className={fieldClass}
                    >
                      <option value="USD">USD</option>
                      <option value="LBP">LBP</option>
                    </select>
                    <input
                      value={editing.id_number ?? ""}
                      onChange={(ev) =>
                        setEditing({ ...editing, id_number: ev.target.value })
                      }
                      placeholder={labels.fIdNumber}
                      className={fieldClass}
                      dir="ltr"
                    />
                    <div>
                      <label
                        className="text-xs font-semibold text-muted-foreground"
                        htmlFor="hr-residency-expiry"
                      >
                        {labels.fResidency}
                      </label>
                      <input
                        id="hr-residency-expiry"
                        type="date"
                        value={editing.residency_expires_on ?? ""}
                        onChange={(ev) =>
                          setEditing({
                            ...editing,
                            residency_expires_on: ev.target.value,
                          })
                        }
                        className={fieldClass}
                        dir="ltr"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button
                        onClick={() => saveEmployee(editing)}
                        loading={busy === e.id}
                      >
                        {labels.save}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => endEmployment(editing)}
                        disabled={busy === e.id}
                      >
                        {labels.endEmployment}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Payroll ===== */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-bold">{labels.payrollTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{labels.payrollBody}</p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={`${fieldClass} max-w-44`}
            dir="ltr"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={`${fieldClass} max-w-44`}
            dir="ltr"
          />
          <Button
            variant="outline"
            onClick={buildPayroll}
            loading={busy === "payroll"}
          >
            <Calculator className="h-4 w-4" />
            {labels.calculate}
          </Button>
        </div>

        {runs.map((run) => (
          <div
            key={run.id}
            className="mt-4 rounded-xl border border-border bg-surface-muted/30 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold" dir="ltr">
                {run.period_start} → {run.period_end}
              </span>
              {run.status === "posted" ? (
                <span className="flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {labels.posted}
                </span>
              ) : (
                <Button
                  size="sm"
                  disabled={busy === run.id}
                  onClick={() => postPayroll(run.id)}
                >
                  {labels.post}
                </Button>
              )}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-md text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-bold text-muted-foreground">
                    <th className="pb-2 text-start">{labels.colName}</th>
                    <th className="pb-2 text-center">{labels.colDays}</th>
                    <th className="pb-2 text-center">{labels.colHours}</th>
                    <th className="pb-2 text-end">{labels.colGross}</th>
                    <th className="pb-2 text-end">{labels.colAdvances}</th>
                    <th className="pb-2 text-end">{labels.colNet}</th>
                  </tr>
                </thead>
                <tbody>
                  {run.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 font-semibold">{l.employee_name}</td>
                      <td className="py-2 text-center tabular-nums">
                        {l.days_worked}
                      </td>
                      <td className="py-2 text-center tabular-nums">
                        {(l.minutes_worked / 60).toFixed(1)}
                      </td>
                      <td className="py-2 text-end tabular-nums">
                        {money(Number(l.gross), l.currency)}
                      </td>
                      <td className="py-2 text-end tabular-nums text-danger">
                        {Number(l.advances) > 0
                          ? `-${money(Number(l.advances), l.currency)}`
                          : "—"}
                      </td>
                      <td className="py-2 text-end font-bold tabular-nums">
                        {money(Number(l.net), l.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-sm font-bold">
              {labels.total}: {money(Number(run.total_usd), "USD")}
              {Number(run.total_lbp) > 0 && (
                <span className="ms-2">
                  + {money(Number(run.total_lbp), "LBP")}
                </span>
              )}
            </p>
            {/* Only dollars reach the expense ledger, because expenses carry one
                amount and no currency. Saying so beats a total that quietly
                misses part of the wage bill. */}
            {Number(run.total_lbp) > 0 && (
              <p className="mt-1 text-xs text-warning">{labels.lbpNote}</p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
