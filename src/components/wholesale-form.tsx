"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";
import { WHOLESALE_CATEGORIES } from "@/lib/wholesale";
import { ImageUpload } from "@/components/image-upload";
import { GalleryUpload } from "@/components/gallery-upload";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type TierRow = { qty: string; price: string };

export function WholesaleForm({
  lang,
  dict,
  sellerName,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "account" | "auth" | "wholesale">;
  sellerName: string;
}) {
  const router = useRouter();
  const t = dict.wholesale;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [tiers, setTiers] = useState<TierRow[]>([]);

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
    const moqRaw = String(form.get("moq") ?? "").trim();
    const cleanTiers = tiers
      .filter((x) => x.qty.trim() && x.price.trim())
      .map((x) => ({ qty: Number(x.qty), price: Number(x.price) }));
    const { data, error: insErr } = await supabase
      .from("wholesale_products")
      .insert({
        seller_id: user.id,
        seller_name: sellerName || null,
        title: String(form.get("title")),
        description: String(form.get("description")),
        category: String(form.get("category")) || null,
        unit: String(form.get("unit")) || null,
        moq: moqRaw === "" ? null : Number(moqRaw),
        price: priceRaw === "" ? null : Number(priceRaw),
        tiers: cleanTiers,
        region: String(form.get("region")) || null,
        image_url: imageUrl ?? gallery[0] ?? null,
        gallery: gallery.length ? gallery : null,
      })
      .select("id")
      .single();
    if (insErr || !data) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    router.push(`/${lang}/wholesale/${data.id}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <ImageUpload folder="wholesale" value={imageUrl} onChange={setImageUrl} label={t.image} />
      <GalleryUpload
        folder="wholesale"
        value={gallery}
        onChange={setGallery}
        label={t.gallery}
        max={6}
      />

      <Field label={t.productTitle} htmlFor="title" required>
        <Input id="title" name="title" type="text" required placeholder={t.productTitlePlaceholder} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.category} htmlFor="category">
          <Select id="category" name="category" defaultValue="">
            <option value="">{t.selectCategory}</option>
            {WHOLESALE_CATEGORIES.map((c) => (
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
        <Field label={t.unit} htmlFor="unit">
          <Input id="unit" name="unit" type="text" placeholder={t.unitPlaceholder} />
        </Field>
        <Field label={t.moq} htmlFor="moq">
          <Input id="moq" name="moq" type="number" min="1" step="1" />
        </Field>
        <Field label={t.basePrice} htmlFor="price">
          <Input id="price" name="price" type="number" min="0" step="0.01" placeholder="$" />
        </Field>
      </div>

      {/* Tiered pricing */}
      <div className="rounded-xl border border-border/70 p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold">{t.tiers}</span>
            <p className="text-xs text-muted-foreground">{t.tiersHint}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setTiers([...tiers, { qty: "", price: "" }])}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            {t.addTier}
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {tiers.map((row, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={row.qty}
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                type="number" min="1" step="1" placeholder={t.tierQty}
                className="flex-1"
              />
              <div className="w-28 shrink-0">
                <Input
                  value={row.price}
                  onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  type="number" min="0" step="0.01" placeholder={t.tierPrice}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                aria-label={t.remove}
                className="w-11 shrink-0 px-0 text-danger hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Field label={t.description} htmlFor="description" required>
        <Textarea id="description" name="description" rows={4} required placeholder={t.descriptionPlaceholder} />
      </Field>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={loading}>
        {loading ? dict.account.saving : t.publish}
      </Button>
    </form>
  );
}
