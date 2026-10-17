"use client";

import { useState } from "react";
import { phoneIssue } from "@/lib/phone";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Sparkles,
  LayoutGrid,
  Rows3,
  GalleryThumbnails,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { revalidateStores } from "@/lib/cache-actions";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ImageUpload } from "@/components/image-upload";
import { HoursEditor } from "@/components/hours-editor";
import { fieldClass as uiFieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { parseHours } from "@/lib/hours";
import { accentStyle } from "@/lib/color";
import { THEME_KEYS, THEMES, isStorefrontTheme } from "@/lib/themes";

type Option = { value: string; label: string };

// Leaflet touches `window` at import — load the picker on the client only.
const LocationPicker = dynamic(
  () => import("@/components/location-picker").then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-2xl border border-border bg-surface-muted" />
    ),
  },
);

type Initial = {
  name: string;
  slug: string | null;
  description: string | null;
  announcement: string | null;
  storefront_theme: string | null;
  business_type_id: string | null;
  region: string | null;
  area: string | null;
  phone: string | null;
  whatsapp: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cover_position: number | null;
  hours: unknown;
  booking_slot_minutes: number | null;
  instagram: string | null;
  facebook: string | null;
  website: string | null;
  accent_color: string | null;
  storefront_layout: string | null;
  lat: number | null;
  lng: number | null;
};

// A few tasteful brand presets the merchant can pick with one tap.
const ACCENT_PRESETS = [
  "#1556c2", "#0f766e", "#b8842a", "#b83280",
  "#7c3aed", "#dc2626", "#059669", "#0891b2",
];

// Shared control styling from the UI library, plus the label gap this form uses.
const fieldClass = `${uiFieldClass} mt-1.5`;
const labelClass = "text-sm font-semibold";

// ===== Where the 3:1 banner is cut out of a taller photo =====
// Three anchors, because there are three answers. What was here was a
// HORIZONTAL `input type=range` driving a VERTICAL crop: the wrong axis, kept
// from reversing in Arabic only by pinning `dir="ltr"` on it, and offering
// twenty-one steps of precision to a merchant dragging with a thumb on a phone.
// `cover_position` stays a 0-100 number in the DB — the storefront and the
// search card both read it as `50% N%` — so nothing downstream changes.
const COVER_ANCHORS = [
  { value: 0, key: "coverPosTop" },
  { value: 50, key: "coverPosMiddle" },
  { value: 100, key: "coverPosBottom" },
] as const;

/** Existing stores hold any value the old slider produced. Band it, so a store
 *  saved at 35 lights up "middle" instead of lighting up nothing — and stays at
 *  35 until the merchant actually picks something. */
const coverBand = (n: number) => (n <= 33 ? 0 : n < 67 ? 50 : 100);

export function EditStoreForm({
  storeId,
  lang,
  dict,
  businessTypes,
  regions,
  initial,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "merchant" | "os" | "store" | "upload">;
  businessTypes: Option[];
  regions: Option[];
  initial: Initial;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Four of the eleven phone numbers on live stores could not be turned into a
  // working WhatsApp link. phone.ts now reads all of those shapes correctly,
  // but reading is the second line of defence — nothing stopped them being
  // typed that way, so nothing stops a fifth shape arriving. Warn, never block:
  // a merchant should not be stopped by a field they can fix later, and the
  // platform should not refuse a number because its own button cannot use it.
  // Checked on blur, because a half-typed number is not a wrong number.
  const [phoneWarn, setPhoneWarn] = useState<Record<string, boolean>>({});
  const checkPhone = (key: string) => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value.trim();
    setPhoneWarn((w) => ({ ...w, [key]: !!v && phoneIssue(v) === "notDialable" }));
  };
  const [logo, setLogo] = useState<string | null>(initial.logo_url);
  const [cover, setCover] = useState<string | null>(initial.cover_url);
  // Vertical focal point of the banner, 0-100 (0245).
  const [coverPos, setCoverPos] = useState(initial.cover_position ?? 50);
  // Vanity handle: matjarlb.com/<slug>. Sanitised to a-z0-9- as the user types;
  // the DB (migration 0115) is the final authority on format/reserved/uniqueness.
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [copied, setCopied] = useState(false);
  // Brand color: drives the storefront's --primary. "" = platform default.
  const [accent, setAccent] = useState(initial.accent_color ?? "");
  // Storefront layout template. "" = auto by sector.
  const [layout, setLayout] = useState(initial.storefront_layout ?? "");
  // Storefront theme (0168): a full design system. "" = classic (default).
  // The brand color + layout below always OVERRIDE the theme's own defaults.
  const [theme, setTheme] = useState(initial.storefront_theme ?? "");
  // Precise coordinates set by dragging the map pin (not just the typed area).
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial.lat != null && initial.lng != null
      ? { lat: initial.lat, lng: initial.lng }
      : null,
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://matjarlb.com/${slug.trim()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (rare); the link is visible for manual copy anyway.
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase
      .from("stores")
      .update({
        name: String(form.get("name")),
        slug: slug.trim().toLowerCase() || null,
        description: String(form.get("description")) || null,
        announcement: String(form.get("announcement") ?? "").trim() || null,
        business_type_id: String(form.get("business_type_id")) || null,
        region: String(form.get("region")) || null,
        area: String(form.get("area")) || null,
        phone: String(form.get("phone")) || null,
        whatsapp: String(form.get("whatsapp")) || null,
        logo_url: logo,
        cover_url: cover,
        cover_position: coverPos,
        hours: JSON.parse(String(form.get("hours_json") || "{}")),
        booking_slot_minutes:
          Number(form.get("booking_slot_minutes")) || 30,
        instagram: String(form.get("instagram")) || null,
        facebook: String(form.get("facebook")) || null,
        website: String(form.get("website")) || null,
        accent_color: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null,
        storefront_theme: isStorefrontTheme(theme) ? theme : null,
        storefront_layout:
          layout === "grid" || layout === "menu" || layout === "showcase"
            ? layout
            : null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      })
      .eq("id", storeId);
    if (error) {
      const msg = error.message ?? "";
      setError(
        error.code === "23505" || msg.includes("stores_slug_unique")
          ? dict.merchant.customLinkTaken
          : msg.includes("slug_reserved")
            ? dict.merchant.customLinkReserved
            : msg.includes("slug_invalid")
              ? dict.merchant.customLinkInvalid
              : dict.auth.errorGeneric,
      );
      setLoading(false);
      return;
    }
    await revalidateStores();
    router.push(`/${lang}/merchant/${storeId}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <ImageUpload folder={storeId} value={logo} onChange={setLogo} label={dict.merchant.logo} />
        {/* 3:1 and the merchant's own crop — the same shape and the same cut
            the store page and the search card use, so this box is a preview,
            not a guess. */}
        <div>
          <ImageUpload
            folder={storeId}
            value={cover}
            onChange={setCover}
            label={dict.merchant.cover}
            hint={dict.merchant.coverHint}
            aspect="aspect-[3/1]"
            objectPosition={`50% ${coverPos}%`}
            dict={dict}
          />
          {/* Only worth showing once there is something to reposition. Most
              uploads are 16:9 or 4:3, so most of them lose a band top and
              bottom; this decides which band. */}
          {cover && (
            /* role=group + aria-labelledby, not <label>: a label can only name
               a single form control, and this names a button group (MP-058). */
            <div
              role="group"
              aria-labelledby="cover-position-label"
              className="mt-2"
            >
              <span
                id="cover-position-label"
                className="text-xs font-semibold text-muted-foreground"
              >
                {dict.merchant.coverPosition}
              </span>
              {/* aria-pressed, not role=tab: this narrows one preview, it does
                  not switch between panels. The 3:1 box directly above is the
                  preview — it re-crops on tap, at the exact shape the store
                  page and the search card will render. */}
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {COVER_ANCHORS.map(({ value, key }) => {
                  const on = coverBand(coverPos) === value;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCoverPos(value)}
                      aria-pressed={on}
                      className={`min-h-11 rounded-xl border px-2 py-2 text-xs font-semibold leading-snug transition-colors ${
                        on
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {dict.merchant[key]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Storefront theme: a full design system in one tap. The brand color
          and layout pickers below it OVERRIDE whatever the theme defaults. */}
      {/* role=group + aria-labelledby, not <label>: a label can only name a
          form control, and these name button groups (MP-058). */}
      <div role="group" aria-labelledby="store-theme-label">
        <span id="store-theme-label" className={labelClass}>
          {dict.merchant.theme}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.merchant.themeHint}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {THEME_KEYS.map((k) => {
            const tn = (dict.merchant.themes as Record<string, { name: string; desc: string }>)[k];
            const on = (theme || "classic") === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTheme(k === "classic" ? "" : k)}
                className={`rounded-xl border p-3 text-start transition-colors ${
                  on
                    ? "border-primary bg-primary-soft"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <span className="flex gap-1">
                  {THEMES[k].swatches.map((c) => (
                    <span
                      key={c}
                      className="h-3 w-3 rounded-full border border-black/10"
                      style={{ background: c }}
                    />
                  ))}
                </span>
                <span className={`mt-2 block text-sm font-bold ${on ? "text-primary" : ""}`}>
                  {tn?.name ?? k}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {tn?.desc ?? ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div role="group" aria-labelledby="store-brandcolor-label">
        <span id="store-brandcolor-label" className={labelClass}>
          {dict.merchant.brandColor}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.merchant.brandColorHint}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setAccent(c)}
              aria-label={c}
              className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                accent.toLowerCase() === c.toLowerCase()
                  ? "border-foreground"
                  : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <label
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-dashed border-border"
            title={dict.merchant.brandColorCustom}
          >
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#1556c2"}
              onChange={(e) => setAccent(e.target.value)}
              className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          {accent && (
            <button
              type="button"
              onClick={() => setAccent("")}
              className="text-xs font-semibold text-muted-foreground underline"
            >
              {dict.merchant.brandColorReset}
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {dict.merchant.brandColorPreview}
          </span>
          {(() => {
            const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#1556c2";
            const fg = accentStyle(hex)?.["--primary-foreground"] ?? "#ffffff";
            return (
              <span
                className="rounded-lg px-3 py-1.5 text-xs font-bold"
                style={{ backgroundColor: hex, color: fg }}
              >
                {initial.name}
              </span>
            );
          })()}
        </div>
      </div>

      <div role="group" aria-labelledby="store-layout-label">
        <span id="store-layout-label" className={labelClass}>
          {dict.merchant.layout}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.merchant.layoutHint}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { value: "", Icon: Sparkles, label: dict.merchant.layoutAuto },
              { value: "grid", Icon: LayoutGrid, label: dict.merchant.layoutGrid },
              { value: "menu", Icon: Rows3, label: dict.merchant.layoutMenu },
              {
                value: "showcase",
                Icon: GalleryThumbnails,
                label: dict.merchant.layoutShowcase,
              },
            ] as const
          ).map((opt) => {
            const active = layout === opt.value;
            return (
              <button
                key={opt.value || "auto"}
                type="button"
                onClick={() => setLayout(opt.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-xs font-semibold transition-colors ${
                  active
                    ? "border-primary bg-primary-soft/40 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:border-primary/40"
                }`}
              >
                <opt.Icon className="h-5 w-5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="name">
          {dict.merchant.storeName}
        </label>
        <input id="name" name="name" type="text" required defaultValue={initial.name} className={fieldClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="slug">
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
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="passion"
            maxLength={30}
            className="w-full bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.merchant.customLinkHint}
        </p>
        {slug.trim().length >= 3 && (
          <button
            type="button"
            onClick={copyLink}
            dir="ltr"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:text-primary"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            matjarlb.com/{slug.trim()}
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="business_type_id">
            {dict.merchant.businessType}
          </label>
          <select id="business_type_id" name="business_type_id" required defaultValue={initial.business_type_id ?? ""} className={fieldClass}>
            <option value="" disabled>
              {dict.merchant.selectType}
            </option>
            {businessTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="region">
            {dict.merchant.region}
          </label>
          <select id="region" name="region" defaultValue={initial.region ?? ""} className={fieldClass}>
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
      </div>

      <div>
        <label className={labelClass} htmlFor="area">
          {dict.merchant.area}
        </label>
        <input id="area" name="area" type="text" defaultValue={initial.area ?? ""} placeholder={dict.merchant.areaPlaceholder} className={fieldClass} />
      </div>

      <div role="group" aria-labelledby="store-maploc-label">
        <span id="store-maploc-label" className={labelClass}>
          {dict.merchant.mapLocation}
        </span>
        <div className="mt-1.5">
          <LocationPicker
            value={coords}
            onChange={setCoords}
            hint={dict.merchant.mapHint}
            locateLabel={dict.merchant.locateMe}
            pinLabel={dict.merchant.mapPinLabel}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="phone">
            {dict.merchant.phone}
          </label>
          <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={initial.phone ?? ""} placeholder="+961 …" className={fieldClass} onBlur={checkPhone("phone")} aria-describedby={phoneWarn.phone ? "phone-note" : undefined} />
          {phoneWarn.phone && (
            <p id="phone-note" aria-live="polite" className="mt-1 text-xs text-warning">
              {dict.store.phoneNotLebanese}
            </p>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="whatsapp">
            {dict.merchant.whatsapp}
          </label>
          <input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" defaultValue={initial.whatsapp ?? ""} placeholder="+961 …" className={fieldClass} onBlur={checkPhone("whatsapp")} aria-describedby={phoneWarn.whatsapp ? "whatsapp-note" : undefined} />
          {phoneWarn.whatsapp && (
            <p id="whatsapp-note" aria-live="polite" className="mt-1 text-xs text-warning">
              {dict.store.phoneNotLebanese}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="description">
          {dict.merchant.description}
        </label>
        <textarea id="description" name="description" rows={3} defaultValue={initial.description ?? ""} placeholder={dict.merchant.descriptionPlaceholder} className={fieldClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="announcement">
          {dict.merchant.announcement}
        </label>
        <input
          id="announcement"
          name="announcement"
          type="text"
          maxLength={140}
          defaultValue={initial.announcement ?? ""}
          placeholder={dict.merchant.announcementPlaceholder}
          className={fieldClass}
        />
      </div>

      <HoursEditor
        dict={dict}
        initial={parseHours(initial.hours)}
        initialSlot={initial.booking_slot_minutes ?? 30}
      />

      {/* There used to be a free-text "ساعات العمل" box sitting right under the
          grid above, asking the same question a second time. Eight merchants
          answered both, three of them differently — and the open/closed badge
          follows the grid, so the sentence was quietly contradicting the badge
          next to it. One question, one answer. (0244) */}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="instagram">
            {dict.merchant.instagram}
          </label>
          <input id="instagram" name="instagram" type="url" defaultValue={initial.instagram ?? ""} placeholder="https://instagram.com/…" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="facebook">
            {dict.merchant.facebook}
          </label>
          <input id="facebook" name="facebook" type="url" defaultValue={initial.facebook ?? ""} placeholder="https://facebook.com/…" className={fieldClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="website">
          {dict.merchant.website}
        </label>
        <input id="website" name="website" type="url" defaultValue={initial.website ?? ""} placeholder="https://…" className={fieldClass} />
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <Button type="submit" full loading={loading}>
        {loading ? dict.merchant.saving : dict.merchant.save}
      </Button>
    </form>
  );
}
