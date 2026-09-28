"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Navigation,
  Loader2,
  Landmark,
  ShieldCheck,
  ChevronDown,
  FileText,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { revalidateStores } from "@/lib/cache-actions";
import { getCurrentPosition } from "@/lib/native";
import type { Dictionary } from "@/i18n/get-dictionary";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";
const labelClass = "text-sm font-semibold";

export type StoreSettings = {
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  min_order: string;
  prep_time: string;
  payment_note: string;
  booking_cancel_hours: string;
  return_policy: string;
  specialties: string;
  insurance: string;
  lat: string;
  lng: string;
  commercial_reg_no: string;
  commercial_reg_verified: boolean;
  /** False when the legal fields below could not be read (they come from
   *  store_private_fields(), 0314). The save then leaves them untouched
   *  instead of overwriting the real values with the blanks shown. */
  legal_loaded: boolean;
  legal_name: string;
  tax_no: string;
  legal_address: string;
  invoice_prefix: string;
  vat_rate: string;
  vat_inclusive: boolean;
};

export function StoreSettingsForm({
  storeId,
  dict,
  initial,
  isHealthcare = false,
}: {
  storeId: string;
  dict: Dictionary;
  initial: StoreSettings;
  isHealthcare?: boolean;
}) {
  const router = useRouter();
  const t = dict.merchant.settings;
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState(initial.accepts_delivery);
  const [pickup, setPickup] = useState(initial.accepts_pickup);
  const [lat, setLat] = useState(initial.lat);
  const [lng, setLng] = useState(initial.lng);
  const [locating, setLocating] = useState(false);
  // VAT is charged on top by default; some shops quote prices with it already in.
  const [vatInclusive, setVatInclusive] = useState(initial.vat_inclusive);
  const [geoError, setGeoError] = useState<string | null>(null);

  async function useMyLocation() {
    setLocating(true);
    setGeoError(null);
    try {
      const { lat: la, lng: ln } = await getCurrentPosition();
      setLat(la.toFixed(6));
      setLng(ln.toFixed(6));
    } catch {
      setGeoError(t.locationError);
    } finally {
      setLocating(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);
    const form = new FormData(e.currentTarget);
    const minRaw = String(form.get("min_order") ?? "").trim();
    // Legal identity. issue_invoice() refuses to number an invoice without
    // legal_name, and until now there was no field anywhere in the app that
    // could set it — which is why zero invoices had ever been issued despite
    // the whole engine being built (0248). Sent only when it was loaded.
    const legalPatch = initial.legal_loaded
      ? {
          commercial_reg_no: String(form.get("commercial_reg_no") ?? "").trim() || null,
          legal_name: String(form.get("legal_name") ?? "").trim() || null,
          tax_no: String(form.get("tax_no") ?? "").trim() || null,
          legal_address: String(form.get("legal_address") ?? "").trim() || null,
          invoice_prefix:
            String(form.get("invoice_prefix") ?? "").trim().toUpperCase() || null,
        }
      : {};
    const { error: saveError } = await createClient()
      .from("stores")
      .update({
        accepts_delivery: delivery,
        accepts_pickup: pickup,
        min_order: minRaw === "" ? null : Number(minRaw),
        prep_time: String(form.get("prep_time")) || null,
        payment_note: String(form.get("payment_note")) || null,
        booking_cancel_hours:
          Math.max(0, Number(form.get("booking_cancel_hours")) || 0),
        return_policy: String(form.get("return_policy") ?? "").trim() || null,
        ...legalPatch,
        vat_rate: Math.min(100, Math.max(0, Number(form.get("vat_rate")) || 0)),
        vat_inclusive: vatInclusive,
        specialties: String(form.get("specialties") ?? "") || null,
        insurance: String(form.get("insurance") ?? "") || null,
        lat: lat.trim() === "" ? null : Number(lat),
        lng: lng.trim() === "" ? null : Number(lng),
        updated_at: new Date().toISOString(),
      })
      .eq("id", storeId);
    if (saveError) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    setLoading(false);
    await revalidateStores();
    setSaved(true);
    router.refresh();
  }

  const toggle = (on: boolean) =>
    `flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
      on
        ? "border-primary bg-primary-soft text-primary"
        : "border-border text-muted-foreground"
    }`;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <div>
        <span className={labelClass}>{t.fulfillment}</span>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <label className={toggle(delivery)}>
            <input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t.delivery}
          </label>
          <label className={toggle(pickup)}>
            <input type="checkbox" checked={pickup} onChange={(e) => setPickup(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t.pickup}
          </label>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="min_order">{t.minOrder}</label>
        <input id="min_order" name="min_order" type="number" min="0" step="0.01" defaultValue={initial.min_order} placeholder="0" className={fieldClass} />
        <p className="mt-1 text-xs text-muted-foreground">{t.minOrderHint}</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="prep_time">{t.prepTime}</label>
        <input id="prep_time" name="prep_time" type="text" defaultValue={initial.prep_time} placeholder={t.prepTimePlaceholder} className={fieldClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="payment_note">{t.paymentNote}</label>
        <input id="payment_note" name="payment_note" type="text" defaultValue={initial.payment_note} placeholder={t.paymentNotePlaceholder} className={fieldClass} />
      </div>

      {/* Free text on purpose: Matjar takes no payment and settles nothing, so a


          structured return window would read as a platform guarantee it cannot


          make. The shop states what it does; the shop honours it. */}


      <div>
        <label className={labelClass} htmlFor="return_policy">
          {t.returnPolicy}
        </label>
        <textarea
          id="return_policy"
          name="return_policy"
          rows={2}
          defaultValue={initial.return_policy}
          placeholder={t.returnPolicyPlaceholder}
          className={fieldClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t.returnPolicyHint}</p>


      </div>


      


      <div>
        <label className={labelClass} htmlFor="booking_cancel_hours">
          {t.cancelHours}
        </label>
        <input
          id="booking_cancel_hours"
          name="booking_cancel_hours"
          type="number"
          min="0"
          step="1"
          defaultValue={initial.booking_cancel_hours}
          placeholder="0"
          className={fieldClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t.cancelHoursHint}</p>
      </div>

      <div className="rounded-xl border border-border bg-surface-muted/30 p-4">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" />
          <span className={labelClass}>{t.commercialReg}</span>
          {initial.commercial_reg_verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
              <ShieldCheck className="h-3 w-3" />
              {t.regVerified}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t.commercialRegHint}</p>
        <input
          id="commercial_reg_no"
          name="commercial_reg_no"
          type="text"
          defaultValue={initial.commercial_reg_no}
          placeholder={t.commercialRegPlaceholder}
          className={fieldClass}
          dir="ltr"
        />
        {initial.commercial_reg_no && !initial.commercial_reg_verified && (
          <p className="mt-1.5 text-xs font-semibold text-warning">
            {t.regPending}
          </p>
        )}
      </div>

      {/* Everything a فاتورة نظامية has to carry. The invoice engine has always
          known how to print these — sequential numbering, VAT inclusive or on
          top, the customer's copy frozen at issue — but no screen could fill
          them in, so it refused every invoice and merchants printed a receipt
          with no number on it instead. */}
      <div className="rounded-xl border border-border bg-surface-muted/30 p-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className={labelClass}>{t.invoicing}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t.invoicingHint}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="legal_name">
              {t.legalName}
            </label>
            <input
              id="legal_name"
              name="legal_name"
              type="text"
              defaultValue={initial.legal_name}
              placeholder={t.legalNamePlaceholder}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="tax_no">
              {t.taxNo}
            </label>
            <input
              id="tax_no"
              name="tax_no"
              type="text"
              defaultValue={initial.tax_no}
              placeholder={t.taxNoPlaceholder}
              className={fieldClass}
              dir="ltr"
            />
          </div>
        </div>

        <label className={`${labelClass} mt-3 block`} htmlFor="legal_address">
          {t.legalAddress}
        </label>
        <input
          id="legal_address"
          name="legal_address"
          type="text"
          defaultValue={initial.legal_address}
          placeholder={t.legalAddressPlaceholder}
          className={fieldClass}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="vat_rate">
              {t.vatRate}
            </label>
            <input
              id="vat_rate"
              name="vat_rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={initial.vat_rate}
              placeholder="11"
              className={fieldClass}
              dir="ltr"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t.vatRateHint}</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="invoice_prefix">
              {t.invoicePrefix}
            </label>
            <input
              id="invoice_prefix"
              name="invoice_prefix"
              type="text"
              maxLength={8}
              defaultValue={initial.invoice_prefix}
              placeholder="INV"
              className={fieldClass}
              dir="ltr"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t.invoicePrefixHint}
            </p>
          </div>
        </div>

        {/* Which way the rate is applied changes what the customer owes, so it
            is a visible choice rather than a checkbox in a hint. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setVatInclusive(false)}
            className={toggle(!vatInclusive)}
          >
            {t.vatOnTop}
          </button>
          <button
            type="button"
            onClick={() => setVatInclusive(true)}
            className={toggle(vatInclusive)}
          >
            {t.vatIncluded}
          </button>
        </div>
      </div>

      {isHealthcare && (
        <>
          <div>
            <label className={labelClass} htmlFor="specialties">{t.specialties}</label>
            <input id="specialties" name="specialties" type="text" defaultValue={initial.specialties} placeholder={t.specialtiesPlaceholder} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="insurance">{t.insurance}</label>
            <input id="insurance" name="insurance" type="text" defaultValue={initial.insurance} placeholder={t.insurancePlaceholder} className={fieldClass} />
          </div>
        </>
      )}

      <div>
        <span className={labelClass}>{t.location}</span>
        <p className="text-xs text-muted-foreground">{t.locationHint}</p>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          {locating ? t.locating : t.useMyLocation}
        </button>
        {geoError && (
          <p className="mt-1 text-sm font-medium text-danger">{geoError}</p>
        )}
        {lat && lng && !geoError && (
          <p className="mt-1 text-sm font-semibold text-primary">
            {t.locationSet}
          </p>
        )}
        <details className="mt-2 group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown className="h-4 w-4 -rotate-90 transition-transform group-open:rotate-0 rtl:rotate-90 rtl:group-open:rotate-0" />
            {t.coordsAdvanced}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="lat">
                {t.lat}
              </label>
              <input id="lat" type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} className={fieldClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="lng">
                {t.lng}
              </label>
              <input id="lng" type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} className={fieldClass} />
            </div>
          </div>
        </details>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? dict.account.saving : dict.account.save}
        </button>
        {saved && (
          <span className="text-sm font-semibold text-primary">{dict.account.saved}</span>
        )}
        {error && (
          <span className="text-sm font-semibold text-danger">{error}</span>
        )}
      </div>
    </form>
  );
}
