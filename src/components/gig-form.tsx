"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";
import { GIG_CATEGORIES } from "@/lib/gigs";
import { ImageUpload } from "@/components/image-upload";
import { GalleryUpload } from "@/components/gallery-upload";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function GigForm({
  lang,
  dict,
  freelancerName,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "account" | "auth" | "freelance">;
  freelancerName: string;
}) {
  const router = useRouter();
  const t = dict.freelance;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Work samples are the single biggest decision driver for a service listing —
  // one cover image can't sell a design/writing gig.
  const [gallery, setGallery] = useState<string[]>([]);

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
    const priceRaw = String(form.get("price") ?? "").trim();
    const daysRaw = String(form.get("delivery_days") ?? "").trim();
    const revisionsRaw = String(form.get("revisions") ?? "").trim();
    // "What's included" is captured as up to 3 short bullets, stored as an array.
    const includes = [1, 2, 3]
      .map((i) => String(form.get(`include_${i}`) ?? "").trim())
      .filter(Boolean);
    const link = String(form.get("portfolio_link") ?? "").trim();
    const { data, error: insErr } = await supabase
      .from("gigs")
      .insert({
        freelancer_id: user.id,
        freelancer_name: freelancerName || null,
        title: String(form.get("title")),
        description: String(form.get("description")),
        category: String(form.get("category")) || null,
        price: priceRaw === "" ? null : Number(priceRaw),
        delivery_days: daysRaw === "" ? null : Number(daysRaw),
        region: String(form.get("region")) || null,
        image_url: imageUrl ?? gallery[0] ?? null,
        gallery: gallery.length ? gallery : null,
        includes: includes.length ? includes : null,
        revisions: revisionsRaw === "" ? null : Number(revisionsRaw),
        portfolio_link: link || null,
        available_until: String(form.get("available_until") ?? "") || null,
      })
      .select("id")
      .single();
    if (insErr || !data) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    router.push(`/${lang}/freelance/${data.id}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <ImageUpload folder="gigs" value={imageUrl} onChange={setImageUrl} label={t.sample} />

      <Field label={t.gigTitle} htmlFor="title" required>
        <Input id="title" name="title" type="text" required placeholder={t.gigTitlePlaceholder} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.category} htmlFor="category">
          <Select id="category" name="category" defaultValue="">
            <option value="">{t.selectCategory}</option>
            {GIG_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t.categories[c]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t.region} htmlFor="region">
          <Select id="region" name="region" defaultValue="">
            <option value="">{t.selectRegion}</option>
            {regions.map((r) => (
              <option key={r.key} value={r.key}>{r.name[lang]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t.startingPrice} htmlFor="price">
          <Input id="price" name="price" type="number" min="0" step="0.01" placeholder="$" />
        </Field>
        <Field label={t.deliveryDays} htmlFor="delivery_days">
          <Input id="delivery_days" name="delivery_days" type="number" min="1" step="1" />
        </Field>
        {/* Dated on purpose. "Available now" set once and forgotten becomes a
            lie within a week, and a badge nobody believes costs more than no
            badge — so it lapses instead of needing to be withdrawn. */}
        <Field label={t.availableUntil} htmlFor="available_until">
          <Input id="available_until" name="available_until" type="date" />
        </Field>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">{t.availableUntilHint}</p>
      <Field label={t.description} htmlFor="description" required>
        <Textarea id="description" name="description" rows={5} required placeholder={t.descriptionPlaceholder} />
      </Field>

      {/* Work samples — what actually sells the service. */}
      <GalleryUpload
        folder="gigs"
        value={gallery}
        onChange={setGallery}
        label={t.workSamples}
        max={6}
      />
      <p className="-mt-2 text-xs text-muted-foreground">{t.workSamplesHint}</p>

      {/* The two questions every buyer asks before contacting. */}
      <div>
        <span className="text-sm font-semibold">{t.includesLabel}</span>
        <div className="mt-2 space-y-2">
          {[1, 2, 3].map((i) => (
            <Input
              key={i}
              name={`include_${i}`}
              type="text"
              placeholder={t.includesPlaceholder.replace("{n}", String(i))}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.revisions} htmlFor="revisions">
          <Input id="revisions" name="revisions" type="number" min="0" step="1" />
        </Field>
        <Field label={t.portfolioLink} htmlFor="portfolio_link">
          <Input
            id="portfolio_link"
            name="portfolio_link"
            type="url"
            dir="ltr"
            placeholder="https://…"
          />
        </Field>
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={loading}>
        {loading ? dict.account.saving : t.publish}
      </Button>
    </form>
  );
}
