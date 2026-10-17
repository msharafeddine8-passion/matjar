"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Send } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { SubDict } from "@/lib/dict-slice";
import { createClient } from "@/lib/supabase/client";
import { Button, ButtonLink } from "@/components/ui/button";
import { GalleryUpload } from "@/components/gallery-upload";
import { notifyError, notifySuccess } from "@/lib/notify";
import { resolveIntake, type IntakeConfig } from "@/lib/request-intake";
import { useConfirm } from "@/components/ui/confirm-dialog";

// Three chips rather than a select: the answer is one tap and every option is
// readable without opening anything. min-h-11 is the 44px thumb target, and
// the padding here keeps it there rather than relying on the class alone.
const chipClass =
  "min-h-11 flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors";
const selectClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

type MyRequest = {
  id: string;
  status: string;
  description: string;
  quote_amount: number | null;
  quote_note: string | null;
  counter_amount: number | null;
  counter_note: string | null;
};

function money(n: number) {
  return n >= 1000 ? `$${Number(n).toLocaleString("en-US")}` : `$${n}`;
}

// Customer-facing quote request for service/clinic stores. Self-contained: it
// resolves the signed-in user and their existing requests to THIS store on the
// client, so the server store page doesn't need to change.
export function ServiceRequestForm({
  storeId,
  lang,
  dict,
  examples = [],
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common"> & SubDict<"os", "requestForm" | "requests">;
  /** The store own service names — the placeholder example is built from these
   *  so a marketing agency never shows an electrical-wiring example. */
  examples?: string[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.os.requestForm;
  const rt = dict.os.requests;
  const [ready, setReady] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mine, setMine] = useState<MyRequest[]>([]);
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  // The extra answers. All optional, all nullable — the request sends without
  // any of them exactly as it does today.
  const [photos, setPhotos] = useState<string[]>([]);
  const [urgency, setUrgency] = useState("");
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");
  // Which of them this store asks for: sector default, overridden by whatever
  // the merchant switched off. Null until the store row lands, so nothing
  // flashes in and out.
  const [intake, setIntake] = useState<IntakeConfig | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // The store's own intake settings. Public read (both `stores` and
      // `business_types` are readable by anon — verified against production),
      // so this resolves for a signed-out visitor too and the form does not
      // have to grow a prop on the server store page.
      supabase
        .from("stores")
        .select("request_intake, business_types(slug)")
        .eq("id", storeId)
        .maybeSingle()
        .then(({ data }) => {
          const row = data as {
            request_intake: unknown;
            business_types: { slug: string } | null;
          } | null;
          setIntake(
            resolveIntake(row?.business_types?.slug ?? null, row?.request_intake),
          );
        });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUid(user.id);
        setName(
          (user.user_metadata?.full_name as string | undefined) ??
            user.email ??
            "",
        );
        const { data } = await supabase
          .from("service_requests")
          .select("id, status, description, quote_amount, quote_note, counter_amount, counter_note")
          .eq("store_id", storeId)
          .eq("customer_id", user.id)
          .order("created_at", { ascending: false });
        setMine((data ?? []) as MyRequest[]);
      }
      setReady(true);
    })();
  }, [storeId]);

  async function submit() {
    if (!description.trim() || phone.trim().length < 4 || busy || !uid) return;
    setBusy(true);
    const desc = description.trim();
    // Return the real row so the optimistic entry carries its DB id (needed for
    // an immediate cancel — a fabricated id would miss on the RPC).
    const { data: created, error } = await createClient()
      .from("service_requests")
      .insert({
        store_id: storeId,
        customer_id: uid,
        customer_name: name.trim() || null,
        phone: phone.trim(),
        address: address.trim() || null,
        description: desc,
        // Only send what this store actually asked for. A merchant who turned
        // budget off should not receive a budget because the state survived a
        // settings change while the form was open.
        photos: intake?.photos ? photos : [],
        urgency: (intake?.urgency && urgency) || null,
        budget_range: (intake?.budget && budget) || null,
        timeline: (intake?.timeline && timeline) || null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !created) {
      notifyError(dict.common.actionFailed);
      return;
    }
    notifySuccess(t.sent);
    setDescription("");
    setAddress("");
    setPhotos([]);
    setUrgency("");
    setBudget("");
    setTimeline("");
    router.refresh();
    // Reflect the new request locally with its real id.
    setMine((m) => [
      {
        id: (created as { id: string }).id,
        status: "pending",
        description: desc,
        quote_amount: null,
        counter_amount: null,
        counter_note: null,
        quote_note: null,
      },
      ...m,
    ]);
  }

  // Which request has the counter-offer form open, and its draft values.
  const [countering, setCountering] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNote, setCounterNote] = useState("");

  async function act(
    id: string,
    action: "accept" | "cancel" | "counter",
    amount?: number | null,
    note?: string | null,
  ) {
    if (action === "cancel" && !(await confirm({ message: t.confirmCancel, confirmLabel: dict.common.confirm, cancelLabel: dict.common.cancel, danger: true }))) return;
    const { error } = await createClient().rpc("manage_service_request", {
      p_id: id,
      p_action: action,
      p_amount: amount ?? null,
      p_note: note ?? null,
    });
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
    setMine((m) =>
      m.map((r) =>
        r.id === id
          ? {
              ...r,
              status:
                action === "accept"
                  ? "accepted"
                  : action === "counter"
                    ? "countered"
                    : "cancelled",
              ...(action === "counter"
                ? { counter_amount: amount ?? null, counter_note: note ?? null }
                : {}),
            }
          : r,
      ),
    );
  }

  if (!ready) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-5">
      <h3 className="flex items-center gap-2 text-lg font-extrabold">
        <FileText className="h-5 w-5 text-primary" />
        {t.title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      {uid ? (
        <>
          <div className="mt-4 grid gap-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                examples.length
                  ? `${t.describePrefix} ${examples.slice(0, 2).join("، ")}…`
                  : t.describeHintGeneric
              }
              rows={2}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t.address}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t.phone}
                inputMode="tel"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* MJ-016. The one question a field-service provider triages on
                before anything else. Nothing is preselected: a default here
                would be the customer's answer without the customer. */}
            {intake?.urgency && (
              <fieldset>
                <legend className="text-sm font-semibold">{t.urgency}</legend>
                <div className="mt-1.5 flex gap-2">
                  {(
                    Object.entries(t.urgencyOptions) as [string, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={urgency === k}
                      onClick={() => setUrgency(urgency === k ? "" : k)}
                      className={`${chipClass} ${
                        urgency === k
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface hover:border-primary/50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* MJ-016. Uploads land under crafts/<uid>/requests/, the only
                identity-scoped prefix can_write_store_asset (0283) grants a
                plain customer — and the storage insert policy is
                `to authenticated`, so a signed-out visitor is told rather than
                shown a picker that would fail. */}
            {intake?.photos && (
              <div>
                <GalleryUpload
                  folder={`crafts/${uid}/requests`}
                  value={photos}
                  onChange={setPhotos}
                  label={t.photos}
                  max={3}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.photosHint}
                </p>
              </div>
            )}

            {/* MJ-017. A range, and skippable — a client who will not name a
                number still gets to send the brief. */}
            {intake?.budget && (
              <div>
                <label className="text-sm font-semibold" htmlFor="sr-budget">
                  {t.budget}
                </label>
                <select
                  id="sr-budget"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className={selectClass}
                >
                  <option value="">{t.budgetAny}</option>
                  {(Object.entries(t.budgetOptions) as [string, string][]).map(
                    ([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </div>
            )}

            {intake?.timeline && (
              <div>
                <label className="text-sm font-semibold" htmlFor="sr-timeline">
                  {t.timeline}
                </label>
                <select
                  id="sr-timeline"
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  className={selectClass}
                >
                  <option value="">{t.timelineAny}</option>
                  {(
                    Object.entries(t.timelineOptions) as [string, string][]
                  ).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Button
              onClick={submit}
              loading={busy}
              disabled={!description.trim() || phone.trim().length < 4}
              leftIcon={<Send className="h-4 w-4" />}
            >
              {t.send}
            </Button>
          </div>

          {mine.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-sm font-bold">{t.myRequests}</p>
              <ul className="space-y-2">
                {mine.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-border bg-surface p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {r.description}
                      </span>
                      <span className="shrink-0 text-xs font-bold">
                        {rt.status[r.status as keyof typeof rt.status]}
                      </span>
                    </div>
                    {r.quote_amount != null && (
                      <p className="mt-1 font-bold text-info">
                        {rt.quotedAt}: {money(Number(r.quote_amount))}
                        {r.quote_note ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {r.quote_note}
                          </span>
                        ) : null}
                      </p>
                    )}
                    {r.counter_amount != null || r.counter_note ? (
                      <p className="mt-1 text-sm font-semibold text-warning">
                        {t.yourCounter}
                        {r.counter_amount != null
                          ? `: ${money(Number(r.counter_amount))}`
                          : ""}
                        {r.counter_note ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {r.counter_note}
                          </span>
                        ) : null}
                      </p>
                    ) : null}

                    {(r.status === "quoted" ||
                      r.status === "countered" ||
                      r.status === "pending" ||
                      r.status === "accepted") && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(r.status === "quoted" ||
                          r.status === "countered") && (
                          <button
                            onClick={() => act(r.id, "accept")}
                            className="rounded-lg bg-success-strong px-3 py-1 text-xs font-bold text-success-strong-foreground hover:opacity-90"
                          >
                            {t.accept}
                          </button>
                        )}
                        {/* Accept-or-walk was the whole choice before. In this
                            market the normal next move is to reply with a
                            number or a question, so offer that too. */}
                        {(r.status === "quoted" ||
                          r.status === "countered") && (
                          <button
                            onClick={() => {
                              setCountering(countering === r.id ? null : r.id);
                              setCounterAmount("");
                              setCounterNote("");
                            }}
                            className="rounded-lg border border-border px-3 py-1 text-xs font-bold text-foreground hover:border-primary hover:text-primary"
                          >
                            {t.negotiate}
                          </button>
                        )}
                        <button
                          onClick={() => act(r.id, "cancel")}
                          className="rounded-lg px-3 py-1 text-xs font-semibold text-danger hover:bg-danger-soft"
                        >
                          {t.cancel}
                        </button>
                      </div>
                    )}

                    {countering === r.id && (
                      <div className="mt-2 rounded-xl border border-border bg-surface p-3">
                        <p className="text-xs text-muted-foreground">
                          {t.negotiateHint}
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[7rem_1fr]">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={counterAmount}
                            onChange={(e) => setCounterAmount(e.target.value)}
                            placeholder={t.counterAmount}
                            aria-label={t.counterAmount}
                            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                          <input
                            type="text"
                            value={counterNote}
                            onChange={(e) => setCounterNote(e.target.value)}
                            placeholder={t.counterNote}
                            aria-label={t.counterNote}
                            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={async () => {
                              const amt = Number(counterAmount);
                              await act(
                                r.id,
                                "counter",
                                amt > 0 ? amt : null,
                                counterNote.trim() || null,
                              );
                              setCountering(null);
                            }}
                            disabled={
                              !(Number(counterAmount) > 0) && !counterNote.trim()
                            }
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                          >
                            {t.sendCounter}
                          </button>
                          <button
                            onClick={() => setCountering(null)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                          >
                            {dict.common.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <ButtonLink href={`/${lang}/login`} className="mt-4">
          {t.loginToRequest}
        </ButtonLink>
      )}
    </div>
  );
}
