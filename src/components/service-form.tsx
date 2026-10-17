"use client";
import { revalidateProduct } from "@/lib/cache-actions";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ImageUpload } from "@/components/image-upload";

type SectionOption = { id: string; name: string; name_en: string | null };

// Dedicated add-service form for booking sectors (clinics, salons, services…).
// Deliberately different from the product form: no stock/variants/channels —
// a service is a name, a price, a duration, and a booking.
export function ServiceForm({
  storeId,
  dict,
  lang,
  sections = [],
}: {
  storeId: string;
  dict: Pick<Dictionary, "auth" | "merchant" | "os">;
  lang: Locale;
  sections?: SectionOption[];
}) {
  const router = useRouter();
  const t = dict.os.serviceForm;
  const p = dict.merchant.products;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setLoading(true);
    setError(null);
    setAdded(false);
    const form = new FormData(formEl);
    const duration = String(form.get("duration") ?? "").trim();
    // Blank means "not recorded", which is not the same as zero: a cost of 0
    // tells the margin report the service is pure profit.
    const costRaw = String(form.get("cost") ?? "").trim();
    const { error: insertError } = await createClient()
      .from("products")
      .insert({
        store_id: storeId,
        name: String(form.get("name")),
        price: Number(form.get("price")) || 0,
        cost: costRaw === "" ? null : Number(costRaw),
        description: String(form.get("description")) || null,
        image_url: imageUrl,
        section_id: sectionId || null,
        attributes: duration ? { duration } : {},
      });
    setLoading(false);
    if (insertError) {
      setError(dict.auth.errorGeneric);
      return;
    }
    formEl.reset();
    setImageUrl(null);
    setSectionId("");
    setAdded(true);
    await revalidateProduct();
    router.refresh();
  }

  const field =
    "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <form
      onSubmit={onSubmit}
      className="h-fit rounded-2xl border border-primary/20 bg-gradient-to-b from-primary-soft to-transparent p-5"
    >
      <h2 className="flex items-center gap-2 font-bold">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <CalendarCheck className="h-5 w-5" />
        </span>
        {t.title}
      </h2>
      <p className="mt-1.5 text-xs text-muted-foreground">{t.subtitle}</p>

      <div className="mt-4 space-y-3">
        <label className="block text-sm font-semibold">
          {t.name}
          <input
            name="name"
            required
            placeholder={t.namePlaceholder}
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            {t.price}
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              required
              className={field}
            />
          </label>
          <label className="block text-sm font-semibold">
            {t.duration}
            <input
              name="duration"
              type="number"
              min="0"
              step="5"
              placeholder={t.durationPlaceholder}
              className={field}
            />
          </label>
        </div>
        {/* Clinics and service pros are the two sectors whose add form is this
            one, and it was the only add path with no cost field — so their
            completeness item "add cost prices" pointed at a number they had no
            way to enter. Optional, and the line under it says what it buys. */}
        <label className="block text-sm font-semibold">
          {p.cost}
          <input
            name="cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            className={field}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {p.costHint}
          </span>
        </label>
        {sections.length > 0 && (
          <label className="block text-sm font-semibold">
            {p.section}
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className={field}
            >
              <option value="">{p.noSection}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {lang === "en" && s.name_en?.trim() ? s.name_en : s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm font-semibold">
          {t.desc}
          <textarea name="description" rows={2} className={field} />
        </label>
        <ImageUpload
          folder={`services/${storeId}`}
          value={imageUrl}
          onChange={setImageUrl}
          label={t.image}
        />
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        {added && (
          <p className="text-sm font-bold text-primary">{t.added}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {loading ? t.adding : t.add}
        </button>
      </div>
    </form>
  );
}
