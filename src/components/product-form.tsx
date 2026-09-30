"use client";
import { revalidateProduct, revalidateStore } from "@/lib/cache-actions";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { CategoryKey } from "@/lib/catalog";
import { attrEntryFields } from "@/lib/attributes";
import { sectorHasTeam } from "@/lib/sectors";
import { planCopy } from "@/lib/plan-copy";
import { ImageUpload } from "@/components/image-upload";
import { DigitalFileUpload, type DigitalFile } from "@/components/digital-file-upload";
import { fieldClass, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { UnitPricingFields } from "@/components/unit-pricing-fields";
import { buildCrossPostListing } from "@/lib/market-crosspost";
import {
  unitPricingColumns,
  PIECE_PRICED,
  type UnitPricingValue,
} from "@/lib/unit-pricing";
import { ServicePriceOptions } from "@/components/service-price-options";
import {
  VariantMatrix,
  variantsFromGroups,
  type ColorGroup,
} from "@/components/variant-matrix";

// Shared control styling from the UI library, plus the label gap this form uses.
const field = `${fieldClass} mt-1.5`;
const label = "text-sm font-semibold";

// duration: a SERVICE option's own length in minutes (0321), "" = the service's.
type VariantRow = { label: string; price: string; stock: string; duration?: string };
type OptionRow = { name: string; price: string };
export type SectionOption = { id: string; name: string; name_en: string | null };

export function ProductForm({
  storeId,
  lang,
  category,
  dict,
  addKey = "add",
  simplified = false,
  sections = [],
}: {
  storeId: string;
  lang: Locale;
  category: CategoryKey;
  dict: Dictionary;
  addKey?: "add" | "addMenuItem" | "addService" | "addListing";
  simplified?: boolean;
  sections?: SectionOption[];
}) {
  const router = useRouter();
  const p = dict.merchant.products;
  const addLabel = p[addKey] ?? p.add;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [adderKey, setAdderKey] = useState(0);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  // Apparel (retail) gets the color→size builder; other sectors keep the flat
  // variant list. Both persist to product_variants.
  const useMatrix = category === "retail";
  const [colorGroups, setColorGroups] = useState<ColorGroup[]>([]);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [sectionId, setSectionId] = useState<string>("");
  // Booking engine v2 (0174): how this service is delivered.
  const [bookMode, setBookMode] = useState<string>("");
  // Sold by the piece unless the merchant says otherwise (0299). The price
  // input stays uncontrolled and is only OBSERVED, so the unit control can show
  // what the price works out to per kilo while it is still being typed.
  const [unitPricing, setUnitPricing] = useState<UnitPricingValue>(PIECE_PRICED);
  const [priceInput, setPriceInput] = useState("");
  const [inOffers, setInOffers] = useState(false);
  const [inClearance, setInClearance] = useState(false);
  const [inMarket, setInMarket] = useState(false);
  // The Sunday Market category for the cross-post (P2-MARKET-CROSSPOST). Asked,
  // never guessed: market categories are item types and a store's sector is
  // not (src/lib/market-crosspost.ts). Loaded the first time the box is ticked.
  const [marketCategoryId, setMarketCategoryId] = useState("");
  const [marketCategories, setMarketCategories] = useState<
    { id: string; name: string }[] | null
  >(null);
  useEffect(() => {
    if (!inMarket || marketCategories !== null) return;
    let live = true;
    createClient()
      .from("market_categories")
      .select("id, name_ar, name_en")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!live) return;
        const rows = (data ?? []) as { id: string; name_ar: string; name_en: string }[];
        setMarketCategories(
          rows.map((c) => ({ id: c.id, name: lang === "ar" ? c.name_ar : c.name_en || c.name_ar })),
        );
      });
    return () => {
      live = false;
    };
  }, [inMarket, marketCategories, lang]);
  // Entry fields only. A retired field (see AttrField.legacy) still renders on
  // the storefront from stored values, but a new product must never be able to
  // start filling it — that is how the clinic ended up with two durations.
  const attrFields = attrEntryFields(category);
  // The sector picks the DEFAULT, not the ceiling.
  //
  // A booking store can also sell goods (a vet selling pet food, a salon
  // selling hair products) — that already worked. What did not: a shop in any
  // other sector could never add a service, because `isService` was gated on
  // `bookable` as well as the toggle, and the toggle only rendered for booking
  // sectors. A boutique offering alterations, a phone shop offering repairs and
  // a bakery taking cake orders all had nowhere to put them.
  //
  // The storefront was already built for this: the product page derives its
  // booking CTA from `product.itemKind === "service"`, explicitly "decided by
  // the ITEM, not the sector". Only this form disagreed.
  const bookable =
    sectorHasTeam(category) || category === "services" || category === "healthcare";
  const [itemKind, setItemKind] = useState<"product" | "service" | "digital">(
    bookable ? "service" : "product",
  );
  const isService = itemKind === "service";
  const isDigital = itemKind === "digital";
  const [digitalFile, setDigitalFile] = useState<DigitalFile | null>(null);
  // Only a service gets the trimmed form; a product needs the full field set
  // (stock, variants, offers) even inside a booking-sector store.
  const simple = simplified && isService;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setLoading(true);
    setError(null);
    const form = new FormData(formEl);
    // A digital product with no file is a customer paying for nothing, and the
    // failure would only surface after the sale — refuse it here instead.
    if (isDigital && !digitalFile) {
      setError(p.digitalFileNeeded);
      setLoading(false);
      return;
    }
    // Checked BEFORE the product is written, so a missing market category
    // never leaves a product saved without the listing the merchant asked for.
    if (inMarket && !marketCategoryId) {
      setError(p.marketCategoryNeeded);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const attributes: Record<string, string> = {};
    attrFields.forEach((f) => {
      const v = String(form.get(`attr_${f.key}`) ?? "").trim();
      if (v) attributes[f.key] = v;
    });
    const stockRaw = String(form.get("stock") ?? "").trim();

    const { data: product, error: insertError } = await supabase
      .from("products")
      .insert({
        store_id: storeId,
        name: String(form.get("name")),
        name_en: String(form.get("name_en") ?? "").trim() || null,
        brand: String(form.get("brand") ?? "").trim() || null,
        item_kind: itemKind,
        digital_path: isDigital ? (digitalFile?.path ?? null) : null,
        digital_name: isDigital ? (digitalFile?.name ?? null) : null,
        digital_size: isDigital ? (digitalFile?.size ?? null) : null,
        booking_allocation_mode: isService ? bookMode || null : null,
        duration_minutes:
          isService && Number(form.get("duration_minutes")) > 0
            ? Number(form.get("duration_minutes"))
            : null,
        buffer_minutes:
          isService && Number(form.get("buffer_minutes")) > 0
            ? Number(form.get("buffer_minutes"))
            : 0,
        capacity_per_slot:
          isService && bookMode === "capacity_based" &&
          Number(form.get("capacity_per_slot")) > 0
            ? Number(form.get("capacity_per_slot"))
            : null,
        price: Number(form.get("price")) || 0,
        discount_price: Number(form.get("discount_price")) || null,
        // Empty stays NULL rather than becoming 0: store_margin_report()
        // distinguishes "no cost recorded" from "cost is zero" to compute its
        // coverage figure, and a 0 would silently report 100% margin.
        cost:
          String(form.get("cost") ?? "").trim() === ""
            ? null
            : Number(form.get("cost")),
        description: String(form.get("description")) || null,
        description_en: String(form.get("description_en") ?? "").trim() || null,
        image_url: imageUrl,
        gallery,
        // A file does not run out. Forcing NULL keeps a digital item from
        // ever rendering as sold out because someone typed a number once.
        stock: isDigital || stockRaw === "" ? null : Number(stockRaw),
        attributes,
        section_id: sectionId || null,
        in_offers: inOffers,
        in_clearance: inClearance,
        // A service or a file is not weighed, so those never carry a unit — the
        // control is not rendered for them and this makes sure nothing leaks
        // through if it ever is.
        ...unitPricingColumns(isService || isDigital ? PIECE_PRICED : unitPricing),
      })
      .select("id")
      .single();

    if (insertError || !product) {
      // Server trigger blocks free stores past the product limit.
      setError(
        insertError?.message?.includes("free_product_limit")
          ? planCopy(dict.os.pro.productLimitBody)
          : dict.auth.errorGeneric,
      );
      setLoading(false);
      return;
    }

    const sourceVariants: (VariantRow & { color?: string | null; size?: string | null })[] =
      isService ? variants : useMatrix ? variantsFromGroups(colorGroups) : variants;
    const cleanVariants = sourceVariants
      .filter((v) => v.label.trim())
      .map((v, i) => ({
        product_id: product.id,
        label: v.label.trim(),
        color: "color" in v ? (v.color ?? null) : null,
        size: "size" in v ? (v.size ?? null) : null,
        price: v.price.trim() === "" ? null : Number(v.price),
        stock: isService || v.stock.trim() === "" ? null : Number(v.stock),
        // 0321: an option may take longer than the service.
        duration_minutes:
          isService && (v.duration ?? "").trim() !== "" && Number(v.duration) > 0
            ? Math.min(480, Math.max(5, Math.round(Number(v.duration))))
            : null,
        sort_order: i,
      }));
    if (cleanVariants.length) {
      const { error: variantsError } = await supabase
        .from("product_variants")
        .insert(cleanVariants);
      if (variantsError) {
        setError(dict.auth.errorGeneric);
        setLoading(false);
        return;
      }
    }

    const cleanOptions = options
      .filter((o) => o.name.trim())
      .map((o, i) => ({
        product_id: product.id,
        name: o.name.trim(),
        price: o.price.trim() === "" ? 0 : Number(o.price),
        sort_order: i,
      }));
    if (cleanOptions.length) {
      const { error: optionsError } = await supabase
        .from("product_options")
        .insert(cleanOptions);
      if (optionsError) {
        setError(dict.auth.errorGeneric);
        setLoading(false);
        return;
      }
    }

    // Cross-post to سوق الأحد if selected (a pending listing derived from the
    // product; the merchant can refine it later from "My listings").
    if (inMarket) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const built = user
        ? buildCrossPostListing({
            sellerId: user.id,
            storeId,
            categoryId: marketCategoryId,
            title: String(form.get("name") ?? ""),
            description: String(form.get("description") ?? ""),
            price: Number(form.get("price")) || 0,
            discountPrice: Number(form.get("discount_price")) || null,
            images: [imageUrl, ...gallery],
          })
        : null;
      if (built?.ok) {
        await supabase.from("listings").insert(built.listing);
      }
    }

    formEl.reset();
    setImageUrl(null);
    setGallery([]);
    setVariants([]);
    setOptions([]);
    setSectionId("");
    // formEl.reset() clears the price input's DOM value; these two are React
    // state and have to be put back by hand, or the next product starts with
    // the last one's unit and a stale per-kilo readout.
    setUnitPricing(PIECE_PRICED);
    setPriceInput("");
    setInOffers(false);
    setInClearance(false);
    setInMarket(false);
    setMarketCategoryId("");
    setLoading(false);
    await revalidateProduct();
    await revalidateStore(storeId);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-5"
    >
      <h3 className="font-bold">{bookable ? p.addItem : addLabel}</h3>

      {/* Shown for every sector. The sector decides which side is preselected,
          not which sides exist — a boutique that also does alterations, or a
          phone shop that also does repairs, has to be able to say so. */}
      {(
        <div>
          <span className={label}>{p.itemKindLabel}</span>
          <div className="mt-1.5 flex gap-2">
            {(["service", "product", "digital"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setItemKind(k)}
                aria-pressed={itemKind === k}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
                  itemKind === k
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground hover:border-primary/40"
                }`}
              >
                {k === "service"
                  ? p.kindService
                  : k === "product"
                    ? p.kindProduct
                    : p.kindDigital}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {itemKind === "service"
              ? p.kindServiceHint
              : itemKind === "product"
                ? p.kindProductHint
                : p.kindDigitalHint}
          </p>
        </div>
      )}

      {isDigital && (
        <DigitalFileUpload
          storeId={storeId}
          value={digitalFile}
          onChange={setDigitalFile}
          label={p.digitalFile}
          hint={p.digitalFileHint}
          uploadingLabel={p.digitalUploading}
          replaceLabel={p.digitalReplace}
          tooLargeLabel={p.digitalTooLarge}
          failedLabel={dict.auth.errorGeneric}
        />
      )}

      <div aria-hidden className="flex items-center gap-3 pt-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {p.secPhotos}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <ImageUpload
        folder={storeId}
        value={imageUrl}
        onChange={setImageUrl}
        label={p.image}
      />

      {/* Gallery */}
      <div>
        <span className={label}>{p.gallery}</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {gallery.map((url, i) => (
            <div
              key={url}
              className="relative h-20 w-20 overflow-hidden rounded-xl border border-border"
            >
              <Image src={url} alt="" fill className="object-cover" sizes="80px" />
              <button
                type="button"
                onClick={() => setGallery(gallery.filter((_, j) => j !== i))}
                aria-label="remove"
                className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="w-20">
            <ImageUpload
              key={adderKey}
              folder={storeId}
              value={null}
              label=""
              onChange={(url) => {
                if (url) {
                  setGallery((g) => [...g, url]);
                  setAdderKey((k) => k + 1);
                }
              }}
            />
          </div>
        </div>
      </div>

      <div aria-hidden className="flex items-center gap-3 pt-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {p.secBasics}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div>
        <label className={label} htmlFor="name">
          {p.name}
        </label>
        <input id="name" name="name" type="text" required placeholder={p.namePlaceholder} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="brand">
          {p.brand}
        </label>
        <input
          id="brand"
          name="brand"
          type="text"
          placeholder={p.brandPlaceholder}
          className={field}
        />
      </div>
      {sections.length > 0 && (
        <div>
          <label className={label} htmlFor="section_id">
            {p.section}
          </label>
          <select
            id="section_id"
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
        </div>
      )}
      <div aria-hidden className="flex items-center gap-3 pt-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {p.secPricing}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className={`grid gap-4 ${simple ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <div>
          <label className={label} htmlFor="price">
            {p.price}
          </label>
          <input id="price" name="price" type="number" min="0" step="0.01" required placeholder="0" className={field} onInput={(e) => setPriceInput(e.currentTarget.value)} />
        </div>
        <div>
          <label className={label} htmlFor="discount_price">
            {p.discountPrice}
          </label>
          <input id="discount_price" name="discount_price" type="number" min="0" step="0.01" placeholder="0" className={field} />
        </div>
        {/* Cost of goods. 0210 added products.cost and snapshots it onto each
            sale as cost_at_sale, and store_margin_report() has been reporting
            coverage against it — but nothing ever wrote the column, so every
            product read 0 of 38 and "profit" was really just revenue. The
            snapshot is taken at sale time, so a day sold without a cost is a
            day whose margin can never be reconstructed; this needs to exist
            before the catalogue grows, not after. */}
        <div>
          <label className={label} htmlFor="cost">
            {p.cost}
          </label>
          <input id="cost" name="cost" type="number" min="0" step="0.01" placeholder="0" className={field} />
          <p className="mt-1 text-xs text-muted-foreground">{p.costHint}</p>
        </div>
        {!simple && (
          <div>
            <label className={label} htmlFor="stock">
              {p.stock}
            </label>
            <input id="stock" name="stock" type="number" min="0" step="1" placeholder="∞" className={field} />
          </div>
        )}
      </div>
      {/* Sits directly under the price, because it is a statement ABOUT the
          price: it says what the number above is the price OF. Goods only — a
          haircut and a PDF are not weighed. */}
      {!isService && !isDigital && (
        <UnitPricingFields
          dict={dict}
          lang={lang}
          value={unitPricing}
          onChange={setUnitPricing}
          priceInput={priceInput}
        />
      )}
      {/* 0321: a service with several prices. Shown in every store — the
          trimmed booking form included — because this is the one variant
          question a service has. Goods keep the size/colour variants below. */}
      {isService && (
        <ServicePriceOptions rows={variants} onChange={setVariants} dict={dict} />
      )}
      <div>
        <label className={label} htmlFor="description">
          {p.description}
        </label>
        <textarea id="description" name="description" rows={2} placeholder={p.descriptionPlaceholder} className={field} />
      </div>

      <div aria-hidden className="flex items-center gap-3 pt-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {p.secAdvanced}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {/* Optional English overrides — shown to customers browsing in English. */}
      <div className="rounded-xl border border-border/70 p-4">
        <span className={label}>{p.englishOptional}</span>
        <div className="mt-3 space-y-3">
          <div>
            <label className={label} htmlFor="name_en">
              {p.nameEn}
            </label>
            <input id="name_en" name="name_en" type="text" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="description_en">
              {p.descriptionEn}
            </label>
            <textarea id="description_en" name="description_en" rows={2} className={field} />
          </div>
        </div>
      </div>

      {attrFields.length > 0 && (
        <div className="rounded-xl border border-border/70 p-4">
          <span className={label}>{p.attributesTitle}</span>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {attrFields.map((f) => (
            <div key={f.key}>
              <label className={label} htmlFor={`attr_${f.key}`}>
                {lang === "ar" ? f.ar : f.en}
              </label>
              {f.type === "select" ? (
                <select id={`attr_${f.key}`} name={`attr_${f.key}`} className={field} defaultValue="">
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {lang === "ar" ? o.ar : o.en}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={`attr_${f.key}`} name={`attr_${f.key}`} type={f.type} className={field} />
              )}
            </div>
          ))}
          </div>
        </div>
      )}

      {!simple && (
      <>
      {/* Variants — goods only; a service's are the price options above. */}
      {isService ? null : useMatrix ? (
        <div className="rounded-xl border border-border/70 p-4">
          <VariantMatrix
            dict={dict}
            groups={colorGroups}
            onChange={setColorGroups}
          />
        </div>
      ) : (
      <div className="rounded-xl border border-border/70 p-4">
        <div className="flex items-center justify-between">
          <span className={label}>{p.variantsTitle}</span>
          <button
            type="button"
            onClick={() =>
              setVariants([...variants, { label: "", price: "", stock: "" }])
            }
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            {p.addVariant}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="flex flex-wrap items-stretch gap-2">
              <input
                value={v.label}
                onChange={(e) =>
                  setVariants(variants.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
                placeholder={p.variantLabelPlaceholder}
                className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1"
              />
              <input
                value={v.price}
                onChange={(e) =>
                  setVariants(variants.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                }
                type="number"
                min="0"
                step="0.01"
                placeholder={p.variantPrice}
                className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={v.stock}
                onChange={(e) =>
                  setVariants(variants.map((x, j) => (j === i ? { ...x, stock: e.target.value } : x)))
                }
                type="number"
                min="0"
                step="1"
                placeholder={p.variantStock}
                className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                aria-label={p.remove}
                className="flex w-11 shrink-0 items-center justify-center self-stretch rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Add-ons */}
      <div className="rounded-xl border border-border/70 p-4">
        <div className="flex items-center justify-between">
          <span className={label}>{p.addonsTitle}</span>
          <button
            type="button"
            onClick={() => setOptions([...options, { name: "", price: "" }])}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            {p.addAddon}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex flex-wrap items-stretch gap-2">
              <input
                value={o.name}
                onChange={(e) =>
                  setOptions(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                placeholder={p.addonNamePlaceholder}
                className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1"
              />
              <input
                value={o.price}
                onChange={(e) =>
                  setOptions(options.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                }
                type="number"
                min="0"
                step="0.01"
                placeholder={p.addonPrice}
                className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                aria-label={p.remove}
                className="flex w-11 shrink-0 items-center justify-center self-stretch rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
      </>
      )}

      {/* عرض في (distribution channels) */}
      <div className="rounded-xl border border-border/70 p-4">
        <span className={label}>{p.showIn}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-primary bg-primary-soft px-3 py-1.5 text-sm font-bold text-primary">
            <input type="checkbox" checked disabled className="h-4 w-4 accent-primary" />
            {p.channelStore}
          </span>
          {[
            { on: inMarket, set: setInMarket, txt: p.channelMarket },
            { on: inOffers, set: setInOffers, txt: p.channelOffers },
            { on: inClearance, set: setInClearance, txt: p.channelClearance },
          ].map((c) => (
            <label
              key={c.txt}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold transition-colors ${
                c.on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
              }`}
            >
              <input type="checkbox" checked={c.on} onChange={(e) => c.set(e.target.checked)} className="h-4 w-4 accent-primary" />
              {c.txt}
            </label>
          ))}
        </div>
        {inMarket && (
          <div className="mt-3">
            <label className={label} htmlFor="market_category">
              {p.marketCategory}
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">{p.marketCategoryHint}</p>
            <Select
              id="market_category"
              className="mt-1.5"
              value={marketCategoryId}
              onChange={(e) => setMarketCategoryId(e.target.value)}
              required
              disabled={marketCategories === null}
            >
              <option value="">{p.marketCategoryPick}</option>
              {(marketCategories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button
        type="submit"
        full
        loading={loading}
        leftIcon={<Plus className="h-4 w-4" />}
      >
        {loading ? p.saving : p.save}
      </Button>
    </form>
  );
}
