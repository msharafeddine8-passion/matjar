"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Field, Input, fieldClass } from "@/components/ui/field";
import {
  LEDGER_CURRENCIES,
  isLedgerCurrency,
  parseAmountInput,
  type LedgerCurrency,
} from "@/lib/ledger";
import type { Dictionary } from "@/i18n/get-dictionary";
import { compressPhoto } from "./compress-photo";
import { LedgerSheet } from "./ledger-sheet";

type T = Dictionary["ledger"];
export type EntryKind = "charge" | "payment";

// The quick entry. Built around the 10-second budget: the sheet opens with the
// kind already chosen (the merchant tapped «أعطيت» or «استلمت»), the amount
// field is focused with a numeric keypad, the currency is whatever this device
// used last, the date is today. Everything else is optional and skippable.

const CURRENCY_KEY = "matjar.ledger.currency";

// The shared field look, one size up: the amount is the whole point of the form.
const AMOUNT_CLASS = fieldClass.replace("h-11 ", "h-14 ").replace("text-sm ", "");

function readLastCurrency(): LedgerCurrency {
  try {
    const v = window.localStorage.getItem(CURRENCY_KEY);
    return isLedgerCurrency(v) ? v : "USD";
  } catch {
    return "USD";
  }
}

function rememberCurrency(c: LedgerCurrency) {
  try {
    window.localStorage.setItem(CURRENCY_KEY, c);
  } catch {
    // Private mode / blocked storage: the default stays USD, nothing breaks.
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function LedgerEntryForm({
  open,
  initialKind,
  onClose,
  onSaved,
  t,
  storeId,
  customerId,
  today,
}: {
  open: boolean;
  initialKind: EntryKind;
  onClose: () => void;
  onSaved: () => void;
  t: T;
  storeId: string;
  customerId: string;
  today: string;
}) {
  // The parent mounts this only while the sheet is open, so every opening
  // starts from these initial values: the tapped kind, the currency this device
  // used last, today.
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<LedgerCurrency>(readLastCurrency);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Cursor in the amount field, after the sheet has painted.
  useEffect(() => {
    const id = window.setTimeout(() => amountRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, []);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function pickCurrency(c: LedgerCurrency) {
    setCurrency(c);
    rememberCurrency(c);
  }

  function reset() {
    setAmount("");
    setNote("");
    setPhoto(null);
    setError(null);
  }

  async function save() {
    const value = parseAmountInput(amount);
    if (value == null) {
      setError(t.amountInvalid);
      amountRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    let path: string | null = null;
    if (photo) {
      const blob = await compressPhoto(photo);
      if (!blob) {
        setBusy(false);
        notifyError(t.photoFailed);
        return;
      }
      // <store_id>/<customer_id>/<random>.jpg — the first segment is what the
      // bucket policy and the column CHECK both key on.
      path = `${storeId}/${customerId}/${newId()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("ledger-attachments")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) {
        setBusy(false);
        notifyError(t.photoFailed);
        return;
      }
    }

    const { error: rpcErr } = await supabase.rpc("record_customer_transaction", {
      p_customer_id: customerId,
      p_kind: kind,
      p_amount: value,
      p_label: note.trim() || null,
      p_happened_on: date || null,
      p_currency: currency,
      p_attachment_path: path,
    });

    if (rpcErr) {
      // Do not leave an orphan photo behind a line that was never written.
      if (path) await supabase.storage.from("ledger-attachments").remove([path]);
      setBusy(false);
      notifyError(t.saveFailed);
      return;
    }

    setBusy(false);
    notifySuccess(t.saved);
    reset();
    onSaved();
  }

  const title = kind === "charge" ? t.gave : t.received;

  return (
    <LedgerSheet
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      closeLabel={t.close}
      footer={
        <Button
          full
          size="lg"
          loading={busy}
          onClick={save}
        >
          {t.save}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {/* Kind — pre-selected from the button that opened the sheet, still
            switchable if the wrong one was tapped. */}
        <div role="radiogroup" aria-label={t.entries} className="grid grid-cols-2 gap-2">
          {(["charge", "payment"] as const).map((k) => {
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(k)}
                className={`h-12 rounded-xl border text-base font-extrabold transition-colors ${
                  active
                    ? k === "charge"
                      ? "border-danger bg-danger-soft text-danger"
                      : "border-success bg-success-soft text-success"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {k === "charge" ? t.gave : t.received}
              </button>
            );
          })}
        </div>

        <Field label={t.amount} htmlFor="ledger-amount" error={error ?? undefined}>
          <div className="flex items-stretch gap-2">
            {/* A raw <input> because the amount needs a ref for focus, which
                the shared <Input> deliberately does not forward. */}
            <input
              id="ledger-amount"
              ref={amountRef}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              dir="ltr"
              placeholder="0"
              aria-invalid={error ? true : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${AMOUNT_CLASS} min-w-0 flex-1 text-2xl font-extrabold tabular-nums`}
            />
            <div
              role="radiogroup"
              aria-label={t.currency}
              className="flex shrink-0 overflow-hidden rounded-xl border border-border-strong"
            >
              {LEDGER_CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={currency === c}
                  onClick={() => pickCurrency(c)}
                  className={`min-w-14 px-3 text-sm font-bold transition-colors ${
                    currency === c
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface text-muted-foreground"
                  }`}
                >
                  {c === "USD" ? t.usd : t.lbp}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.date} htmlFor="ledger-date">
            <Input
              id="ledger-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={t.photo} group>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                setPhoto(f);
              }}
            />
            {preview ? (
              <div className="flex h-11 items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never a remote image */}
                <img src={preview} alt="" className="h-11 w-11 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  aria-label={t.photoRemove}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                full
                leftIcon={<Camera className="h-4 w-4" />}
                onClick={() => fileRef.current?.click()}
              >
                {t.photoAdd}
              </Button>
            )}
          </Field>
        </div>

        <Field label={t.note} htmlFor="ledger-note">
          <Input
            id="ledger-note"
            maxLength={500}
            placeholder={t.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {/* Lets the keypad's "done"/Enter submit from any field. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </LedgerSheet>
  );
}
