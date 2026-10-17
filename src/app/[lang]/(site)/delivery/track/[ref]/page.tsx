// Public delivery tracking. The customer gets this link over WhatsApp, so it is
// reachable without an account — and therefore shows only what a forwarded link
// may safely reveal: status, timings, store and courier names. get_delivery_
// tracking() (0213) is what enforces that; this page cannot widen it.
//
// Server-rendered, but deliberately noindex: one page per delivery is not
// something search engines should hold.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Package, Phone, Check } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Tracking = {
  status: string;
  store_name: string;
  courier_name: string;
  courier_phone: string | null;
  requested_at: string;
  picked_up_at: string | null;
  in_transit_at: string | null;
  delivered_at: string | null;
};

const STEPS = ["requested", "picked_up", "in_transit", "delivered"] as const;

export default async function TrackDeliveryPage({
  params,
}: {
  params: Promise<{ lang: string; ref: string }>;
}) {
  const { lang, ref } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.tracking;

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_delivery_tracking", { p_ref: ref });
  const tracking = ((data ?? []) as Tracking[])[0] ?? null;

  if (!tracking) {
    return (
      <div className="py-10 sm:py-16">
        <Container className="max-w-lg">
          <h1 className="text-2xl font-extrabold tracking-tight">{t.title}</h1>
          <p className="mt-3 text-muted-foreground">{t.notFound}</p>
        </Container>
      </div>
    );
  }

  const at = STEPS.indexOf(tracking.status as (typeof STEPS)[number]);
  const stampFor = (step: (typeof STEPS)[number]) =>
    step === "requested"
      ? tracking.requested_at
      : step === "picked_up"
        ? tracking.picked_up_at
        : step === "in_transit"
          ? tracking.in_transit_at
          : tracking.delivered_at;

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
          timeZone: "Asia/Beirut",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(iso))
      : null;

  return (
    <div className="py-12">
      <Container className="max-w-lg">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-extrabold tracking-tight">{t.title}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.subtitle.replace("{ref}", ref.toUpperCase())}
        </p>

        <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm">
            <span className="text-muted-foreground">{t.from}: </span>
            <span className="font-bold">{tracking.store_name}</span>
          </p>
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">{t.courier}: </span>
            <span className="font-bold">{tracking.courier_name}</span>
          </p>

          <ol className="mt-5 space-y-4">
            {STEPS.map((step, i) => {
              const done = i <= at;
              const stamp = fmt(stampFor(step));
              return (
                <li key={step} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      done
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-xs font-bold">{i + 1}</span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold ${
                        done ? "" : "text-muted-foreground"
                      }`}
                    >
                      {t.steps[step]}
                    </span>
                    {stamp && (
                      <span className="block text-xs text-muted-foreground">
                        {stamp}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          {tracking.courier_phone && (
            <a
              href={`tel:${tracking.courier_phone}`}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              <Phone className="h-3.5 w-3.5" />
              {t.callCourier}
            </a>
          )}
        </div>
      </Container>
    </div>
  );
}
