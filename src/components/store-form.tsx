"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { groupKeys, type CategoryKey, type GroupKey } from "@/lib/catalog";
import { resolveStoreModules } from "@/lib/sectors";
import { storeIntakeFields } from "@/lib/store-onboarding";
import { phoneIssue } from "@/lib/phone";
import { storeCreateErrorKey } from "@/lib/store-create-errors";

type Option = { value: string; label: string };
type BizOption = {
  value: string;
  label: string;
  group: GroupKey;
  category: CategoryKey;
};

// Shared control styling from the UI library, plus the label gap this form uses.
const field = `${fieldClass} mt-1.5`;
const label = "text-sm font-semibold";

// A URL-friendly slug from the store name (latin/digits only). Arabic-only names
// yield "" — and the form then SAYS so, under the link field, with an example
// («ملحمة البركة» used to leave the field silently empty, and the merchant never
// learnt they could have had matjarlb.com/<name>). Kept in sync with the DB
// format rule in migration 0115 (a-z0-9-, trimmed).
function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

// ===== Open a store =====
//
// This form used to ask eight questions of everybody, enforce two of them, and
// then hand the merchant back to the store LIST — a screen with no next action
// on it. Measured on the live platform, 16 of 36 stores hold zero products: the
// eight answers were collected and the ninth thing, the one that makes a page
// worth opening, never happened.
//
// Two changes, no new screens:
//
//   • The sector is asked FIRST and decides the rest (see store-onboarding.ts).
//     Every question maps to a real `stores` column, and a question is only
//     asked where the module that consumes the answer is switched on — so a
//     clinic is not asked whether it delivers and a tutor is not asked which
//     street they are on. Phone came out: WhatsApp is the channel the order
//     path actually uses and the one the checklist counts, and asking for both
//     at minute one bought a second number nobody reads.
//
//   • Creating lands the merchant INSIDE the new store, on its OS home, where
//     the checklist is already waiting with the single next thing to do.
export function StoreForm({
  lang,
  dict,
  businessTypes,
  regions,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "groups" | "merchant" | "store">;
  businessTypes: BizOption[];
  regions: Option[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waWarn, setWaWarn] = useState(false);
  // Vanity handle, auto-suggested from the name until the merchant edits it.
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  // The typed name, only to notice when it produced no suggestion (Arabic).
  const [nameValue, setNameValue] = useState("");
  const noSuggestedSlug =
    nameValue.trim() !== "" && slugify(nameValue) === "" && slug === "";
  // The chosen sector, held in state because the rest of the form depends on it.
  const [typeId, setTypeId] = useState("");
  // Fulfilment (goods sectors only). Both default on: that is what the column
  // defaults to, so an untouched form writes what the DB would have written.
  const [delivery, setDelivery] = useState(true);
  const [pickup, setPickup] = useState(true);

  const chosen = businessTypes.find((t) => t.value === typeId) ?? null;
  const ask = useMemo(() => {
    if (!chosen) return new Set<string>();
    return new Set<string>(
      storeIntakeFields(chosen.category, resolveStoreModules(chosen.category)),
    );
  }, [chosen]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/${lang}/login`);
      return;
    }
    // Field-level checks with clear messages so the merchant knows exactly what
    // to fix (not just a browser tooltip).
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setError(dict.merchant.storeNameRequired);
      setLoading(false);
      return;
    }
    if (!typeId) {
      setError(dict.merchant.businessTypeRequired);
      setLoading(false);
      return;
    }
    const text = (key: string) => String(form.get(key) ?? "").trim() || null;
    // WhatsApp is required here (see the field below for why). Missing or too
    // short to be a number blocks; a number that is merely not Lebanese still
    // only warns, as before — it may well be a real foreign number.
    const waIssue = phoneIssue(text("whatsapp"));
    if (waIssue === "missing" || waIssue === "tooShort") {
      setError(
        waIssue === "missing"
          ? dict.merchant.whatsappRequired
          : dict.merchant.whatsappTooShort,
      );
      setLoading(false);
      document.getElementById("whatsapp")?.focus();
      return;
    }
    const { data: created, error } = await supabase
      .from("stores")
      .insert({
        owner_id: user.id,
        name,
        slug: slug.trim().toLowerCase() || null,
        business_type_id: typeId,
        whatsapp: text("whatsapp"),
        description: text("description"),
        // Only what this sector was actually asked. Writing a column the form
        // never showed would be inventing an answer on the merchant's behalf.
        ...(ask.has("region") ? { region: text("region") } : {}),
        ...(ask.has("area") ? { area: text("area") } : {}),
        ...(ask.has("fulfillment")
          ? { accepts_delivery: delivery, accepts_pickup: pickup }
          : {}),
        ...(ask.has("specialties") ? { specialties: text("specialties") } : {}),
      })
      .select("id")
      .single();
    if (error || !created?.id) {
      // Each known failure gets its own sentence (lib/store-create-errors.ts);
      // anything else gets the generic one. The raw Postgres text goes to the
      // console for whoever debugs it — never into the Arabic screen.
      console.error("[store-form] store insert failed", error);
      setError(dict.merchant[storeCreateErrorKey(error)]);
      setLoading(false);
      return;
    }
    // Into the store, not back to a list of them. The OS home is where the
    // checklist lives, and the checklist is the rest of the setup.
    router.push(`/${lang}/merchant/${created.id}`);
    router.refresh();
  }

  const toggle = (on: boolean) =>
    `flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors lg:min-h-0 ${
      on
        ? "border-primary bg-primary-soft text-primary"
        : "border-border text-muted-foreground"
    }`;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      {/* The sector comes first because everything below it depends on the
          answer — and because it is the one question a merchant can answer
          without thinking. */}
      <div>
        <label className={label} htmlFor="business_type_id">
          {dict.merchant.businessType}
        </label>
        <select
          id="business_type_id"
          name="business_type_id"
          required
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className={field}
        >
          <option value="" disabled>
            {dict.merchant.selectType}
          </option>
          {groupKeys.map((g) => {
            const opts = businessTypes.filter((t) => t.group === g);
            if (!opts.length) return null;
            return (
              <optgroup key={g} label={dict.groups[g].name}>
                {opts.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.merchant.intakeTypeHint}
        </p>
      </div>

      <div>
        <label className={label} htmlFor="name">
          {dict.merchant.storeName}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder={dict.merchant.storeNamePlaceholder}
          className={field}
          onChange={(e) => {
            setNameValue(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </div>

      <div>
        <label className={label} htmlFor="slug">
          {dict.merchant.customLink}
        </label>
        <div className="mt-1.5 flex items-stretch overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <span
            dir="ltr"
            className="flex select-none items-center whitespace-nowrap border-e border-border bg-surface-muted px-3 text-sm text-muted-foreground"
          >
            matjarlb.com/
          </span>
          <input
            id="slug"
            dir="ltr"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            placeholder="passion"
            maxLength={30}
            aria-describedby={noSuggestedSlug ? "slug-arabic-note" : "slug-hint"}
            className="w-full bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {/* An Arabic name slugifies to nothing. Said out loud, with an example,
            instead of leaving an empty box the merchant reads as "no link". */}
        {noSuggestedSlug ? (
          <p
            id="slug-arabic-note"
            aria-live="polite"
            className="mt-1 text-xs font-semibold text-warning"
          >
            {dict.merchant.customLinkArabicName}
          </p>
        ) : (
          <p id="slug-hint" className="mt-1 text-xs text-muted-foreground">
            {dict.merchant.customLinkHint}
          </p>
        )}
      </div>

      {/* ---- Sector-specific, in the order store-onboarding.ts decided ---- */}

      {(ask.has("region") || ask.has("area")) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {ask.has("region") && (
            <div>
              <label className={label} htmlFor="region">
                {dict.merchant.region}
              </label>
              <select id="region" name="region" defaultValue="" className={field}>
                <option value="" disabled>
                  {dict.merchant.selectRegion}
                </option>
                {regions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {ask.has("area") && (
            <div>
              <label className={label} htmlFor="area">
                {dict.merchant.area}
              </label>
              <input
                id="area"
                name="area"
                type="text"
                placeholder={dict.merchant.areaPlaceholder}
                className={field}
              />
            </div>
          )}
        </div>
      )}

      <div>
        {/* Required. It is the store's main channel: the storefront's wa.me
            order button and its contact button are both built from this one
            number, and a store created without it opened with neither. Nothing
            downstream needs it to be null-able at creation — the column stays
            nullable and the edit form can still change it — so asking for it
            here costs a merchant ten seconds and stops a dead storefront. */}
        <label className={label} htmlFor="whatsapp">
          {dict.merchant.whatsapp}
          <span aria-hidden className="ms-0.5 text-danger">
            *
          </span>
        </label>
        <input
          id="whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          dir="ltr"
          aria-required="true"
          placeholder="+961 …"
          className={field}
          onBlur={(e) => {
            const v = e.target.value.trim();
            setWaWarn(!!v && phoneIssue(v) === "notDialable");
          }}
          aria-describedby={waWarn ? "whatsapp-hint whatsapp-note" : "whatsapp-hint"}
        />
        <p id="whatsapp-hint" className="mt-1 text-xs text-muted-foreground">
          {dict.merchant.whatsappCreateHint}
        </p>
        {/* This is the number a customer taps on the storefront, and here is
            the first time it is ever typed. Four of the eleven stored on live
            stores could not be turned into a working link, so the warning
            belongs where the person can still fix it — not discovered later,
            when a customer cannot reach them. It never blocks: nobody should
            be stopped from opening a shop over a field they can correct. */}
        {waWarn && (
          <p
            id="whatsapp-note"
            aria-live="polite"
            className="mt-1 text-xs text-warning"
          >
            {dict.store.phoneNotLebanese}
          </p>
        )}
      </div>

      {ask.has("fulfillment") && (
        <div>
          <span className={label}>{dict.merchant.settings.fulfillment}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <label className={toggle(delivery)}>
              <input
                type="checkbox"
                checked={delivery}
                onChange={(e) => setDelivery(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {dict.merchant.settings.delivery}
            </label>
            <label className={toggle(pickup)}>
              <input
                type="checkbox"
                checked={pickup}
                onChange={(e) => setPickup(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {dict.merchant.settings.pickup}
            </label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {dict.merchant.intakeFulfillmentHint}
          </p>
        </div>
      )}

      {ask.has("specialties") && (
        <div>
          <label className={label} htmlFor="specialties">
            {dict.merchant.intakeSpecialties}
          </label>
          <input
            id="specialties"
            name="specialties"
            type="text"
            placeholder={dict.merchant.settings.specialtiesPlaceholder}
            className={field}
          />
        </div>
      )}

      <div>
        <label className={label} htmlFor="description">
          {dict.merchant.description}
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder={dict.merchant.descriptionPlaceholder}
          className={field}
        />
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <Button type="submit" full loading={loading}>
        {loading ? dict.merchant.creating : dict.merchant.create}
      </Button>
    </form>
  );
}
