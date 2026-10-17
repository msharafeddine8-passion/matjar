"use client";

import { useState } from "react";
import { Crown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";

export type UpgradeOption = {
  tier: "basic" | "pro" | "business";
  /** Display name, e.g. "Matjar Business". */
  name: string;
  monthly: number;
  yearly: number;
  /** Already-resolved feature lines for this tier. */
  features: string[];
};

// The owner asks to move THEIR store up to a chosen tier (payment is manual).
// Captures a phone so the admin can call back; the request_pro_upgrade RPC
// notifies every super admin — no need to re-create a store.
//
// It used to request Pro and nothing else, and only rendered for a store below
// Pro, so a Basic store could not ask for Business and a Pro store had no path
// up at all. The page now hands over every tier above the current one.
//
// The requested tier travels as p_requested_plan (0331), which the RPC checks
// is a real plan above the store's current one and puts in the admin's
// notification and push.
export function RequestProButton({
  storeId,
  options,
  defaultTier,
  defaultPhone,
  labels,
}: {
  storeId: string;
  options: UpgradeOption[];
  defaultTier: UpgradeOption["tier"];
  defaultPhone?: string | null;
  labels: {
    tierLabel: string;
    /** "{plan}" is replaced with the chosen option's name. */
    request: string;
    sent: string;
    phonePlaceholder: string;
    perMonth: string;
    perYear: string;
    failed: string;
    notAllowed: string;
  };
}) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [tier, setTier] = useState<UpgradeOption["tier"]>(
    options.some((o) => o.tier === defaultTier) ? defaultTier : options[0].tier,
  );
  const chosen = options.find((o) => o.tier === tier) ?? options[0];

  async function request() {
    if (state !== "idle") return;
    setState("busy");
    const supabase = createClient();
    const typed = phone.trim() || null;
    const { error } = await supabase.rpc("request_pro_upgrade", {
      p_store_id: storeId,
      p_phone: typed,
      p_requested_plan: chosen.tier,
    });
    if (error) {
      console.error("[request-upgrade] request_pro_upgrade failed", error);
      setState("idle");
      notifyError(
        /not_authorized/.test(error.message ?? "") ? labels.notAllowed : labels.failed,
      );
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <p className="mt-4 flex items-center gap-1.5 text-sm font-bold text-success">
        <Check className="h-4 w-4" />
        {labels.sent.replace("{plan}", chosen.name)}
      </p>
    );
  }

  return (
    <div className="mt-4">
      {options.length > 1 && (
        <fieldset>
          <legend className="text-sm font-bold">{labels.tierLabel}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {options.map((o) => {
              const on = o.tier === tier;
              return (
                <label
                  key={o.tier}
                  className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors ${
                    on
                      ? "border-accent bg-surface"
                      : "border-warning/30 bg-surface/60 hover:border-accent/60"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="upgrade-tier"
                      value={o.tier}
                      checked={on}
                      onChange={() => setTier(o.tier)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="font-extrabold">{o.name}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums" dir="ltr">
                    ${o.monthly}
                    {labels.perMonth} · ${o.yearly}
                    {labels.perYear}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <ul className="mt-3 grid gap-1.5">
        {chosen.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm font-medium text-warning">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={labels.phonePlaceholder}
          aria-label={labels.phonePlaceholder}
          inputMode="tel"
          dir="ltr"
          className="h-11 flex-1 rounded-xl border border-warning/30 bg-surface px-3.5 text-sm outline-none transition-colors focus:border-accent"
        />
        <button
          onClick={request}
          disabled={state === "busy"}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent-strong px-5 text-sm font-bold text-accent-strong-foreground transition-colors hover:bg-accent-strong-hover disabled:opacity-60"
        >
          <Crown className="h-4 w-4" />
          {labels.request.replace("{plan}", chosen.name)}
        </button>
      </div>
    </div>
  );
}
