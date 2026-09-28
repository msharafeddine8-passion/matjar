"use client";
import { revalidateProduct, revalidateStore } from "@/lib/cache-actions";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Save, X, Trash2, Plus, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { CategoryKey } from "@/lib/catalog";
import { attrEntryFields, attrLegacyFields } from "@/lib/attributes";
import { sectorHasTeam } from "@/lib/sectors";
import { beirutYmd } from "@/lib/quick-panel";
import { ImageUpload } from "@/components/image-upload";
import { fieldClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { UnitPricingFields } from "@/components/unit-pricing-fields";
import {
  unitPricingColumns,
  PIECE_PRICED,
  type UnitPricingValue,
} from "@/lib/unit-pricing";
import {
  VariantMatrix,
  groupsFromVariants,
  variantsFromGroups,
  type ColorGroup,
} from "@/components/variant-matrix";

// Shared control styling from the UI library, plus the label gap this form uses.
const field = `${fieldClass} mt-1.5`;
const label = "text-sm font-semibold";

// ISO timestamp → a datetime-local input value in the browser's local time.
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type VariantRow = {
  label: string;
  price: string;
  stock: string;
  color?: string | null;
  size?: string | null;
};
type OptionRow = { name: string; price: string };
type ModifierGroupRow = {
  name: string;
  nameEn: string;
  required: boolean;
  minSelect: string;
  maxSelect: string;
  options: OptionRow[];
};
export type SectionOption = { id: string; name: string; name_en: string | null };

export type ProductInitial = {
  name: string;
  brand: string;
  /** What this item is. Not editable here — set when it was created. */
  itemKind: "product" | "service";
  bookingMode: string;
  durationMinutes: string;
  bufferMinutes: string;
  capacityPerSlot: string;
  nameEn: string;
  price: string;
  discountPrice: string;
  /** Cost of goods (`products.cost`). "" = never recorded. */
  cost: string;
  /** How this item is sold (0299). Piece-priced when the three columns are
   *  null, which is every product created before they existed. */
  unitPricing: UnitPricingValue;
  description: string;
  descriptionEn: string;
  imageUrl: string | null;
  gallery: string[];
  stock: string;
  sectionId: string;
  dealToday: boolean;
  flashPrice: string;
  flashStart: string; // datetime-local value ("YYYY-MM-DDTHH:MM") or ""
  flashEnd: string;
  attributes: Record<string, string>;
  variants: VariantRow[];
  options: OptionRow[];
  modGroups?: ModifierGroupRow[];
};

export function ProductEditForm({
  storeId,
  productId,
  lang,
  category,
  dict,
  simplified = false,
  initial,
  sections = [],
}: {
  storeId: string;
  productId: string;
  lang: Locale;
  category: CategoryKey;
  dict: Dictionary;
  simplified?: boolean;
  initial: ProductInitial;
  sections?: SectionOption[];
}) {
  const router = useRouter();
  const p = dict.merchant.products;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(initial.imageUrl);
  const [gallery, setGallery] = useState<string[]>(initial.gallery);
  const [adderKey, setAdderKey] = useState(0);
  const [variants, setVariants] = useState<VariantRow[]>(initial.variants);
  // Stock as it was when this page loaded, by label. Saving must not push a
  // number back that the merchant never touched: between opening the editor and
  // pressing save, a customer may have bought one, and re-writing the value from
  // the form would undo that sale. Compared against on save so only a stock the
  // merchant actually edited is written.
  const initialStockByLabel = useRef(
    new Map(initial.variants.map((v) => [v.label.trim(), v.stock])),
  );
  // Apparel (retail) uses the color→size builder; reconstruct its grid from the
  // stored variant rows so an existing product edits cleanly.
  const useMatrix = category === "retail";
  const [colorGroups, setColorGroups] = useState<ColorGroup[]>(() =>
    groupsFromVariants(
      initial.variants.map((v) => ({
        color: v.color ?? null,
        size: v.size ?? null,
        label: v.label,
        price: v.price,
        stock: v.stock,
      })),
    ),
  );
  const [options, setOptions] = useState<OptionRow[]>(initial.options);
  const [modGroups, setModGroups] = useState<ModifierGroupRow[]>(
    initial.modGroups ?? [],
  );
  const [dealToday, setDealToday] = useState(initial.dealToday);
  const [sectionId, setSectionId] = useState<string>(initial.sectionId);
  const [bookMode, setBookMode] = useState<string>(initial.bookingMode);
  // 0299. The price input stays uncontrolled (defaultValue) — it is only
  // OBSERVED here, so the unit control can show what the price works out to per
  // kilo as the merchant edits it. Seeded from the stored price so the readout
  // is right before anything is typed.
  const [unitPricing, setUnitPricing] = useState<UnitPricingValue>(
    initial.unitPricing,
  );
  const [priceInput, setPriceInput] = useState(initial.price);
  const attrFields = attrEntryFields(category);
  const legacyAttrFields = attrLegacyFields(category);
  // Booking settings follow the ITEM, not just the sector. A service can now be
  // created in any sector (a boutique's alterations, a phone shop's repairs),
  // and it still needs its duration and slot rules — gating this on the sector
  // alone left those items uneditable, with the fields simply absent.
  const bookable =
    sectorHasTeam(category) ||
    category === "services" ||
    category === "healthcare" ||
    initial.itemKind === "service";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    // `attributes` is rebuilt from the fields this form rendered, so a key it
    // does not render is erased on save. Retired fields are therefore carried
    // across from what was stored: a clinic editing a service's price must not
    // silently lose the duration it typed before the field was retired.
    const attributes: Record<string, string> = {};
    legacyAttrFields.forEach((f) => {
      const v = (initial.attributes[f.key] ?? "").trim();
      if (v) attributes[f.key] = v;
    });
    attrFields.forEach((f) => {
      const v = String(form.get(`attr_${f.key}`) ?? "").trim();
      if (v) attributes[f.key] = v;
    });
    const stockRaw = String(form.get("stock") ?? "").trim();
    // Blank means "not recorded", which is not the same as zero: a cost of 0
    // would tell the margin report this item is pure profit.
    const costRaw = String(form.get("cost") ?? "").trim();

    // Flash sale: all three fields required together, else it's cleared.
    const flashPriceRaw = String(form.get("flash_price") ?? "").trim();
    const flashStartRaw = String(form.get("flash_start") ?? "").trim();
    const flashEndRaw = String(form.get("flash_end") ?? "").trim();
    const hasFlash =
      flashPriceRaw !== "" && flashStartRaw !== "" && flashEndRaw !== "";
    if (hasFlash && new Date(flashEndRaw) <= new Date(flashStartRaw)) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({
        brand: String(form.get("brand") ?? "").trim() || null,
        booking_allocation_mode: bookable ? bookMode || null : null,
        duration_minutes:
          bookable && Number(form.get("duration_minutes")) > 0
            ? Number(form.get("duration_minutes"))
            : null,
        buffer_minutes:
          bookable && Number(form.get("buffer_minutes")) > 0
            ? Number(form.get("buffer_minutes"))
            : 0,
        capacity_per_slot:
          bookable && bookMode === "capacity_based" &&
          Number(form.get("capacity_per_slot")) > 0
            ? Number(form.get("capacity_per_slot"))
            : null,
        name: String(form.get("name")),
        name_en: String(form.get("name_en") ?? "").trim() || null,
        price: Number(form.get("price")) || 0,
        discount_price: Number(form.get("discount_price")) || null,
        cost: costRaw === "" ? null : Number(costRaw),
        description: String(form.get("description")) || null,
        description_en: String(form.get("description_en") ?? "").trim() || null,
        image_url: imageUrl,
        gallery,
        stock: stockRaw === "" ? null : Number(stockRaw),
        section_id: sectionId || null,
        deal_date: dealToday ? beirutYmd(new Date()) : null,
        flash_price: hasFlash ? Number(flashPriceRaw) : null,
        flash_start: hasFlash ? new Date(flashStartRaw).toISOString() : null,
        flash_end: hasFlash ? new Date(flashEndRaw).toISOString() : null,
        attributes,
        // Always all three columns, so switching an item back to piece pricing
        // CLEARS them rather than leaving a stale measure behind on a row whose
        // sold_by is null — which the 0299 check constraint refuses anyway, and
        // which would surface here as a save that mysteriously fails.
        ...unitPricingColumns(
          initial.itemKind === "service" ? PIECE_PRICED : unitPricing,
        ),
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId);

    if (updateError) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }

    if (!simplified) {
      // Variants are reconciled by label, NOT replaced wholesale.
      //
      // The old code deleted every row and re-inserted. The comment beside it
      // said order_items snapshot name and price so nothing references these
      // rows — true when it was written, and no longer: order_items.variant_id
      // is a foreign key with ON DELETE SET NULL. So editing a product while an
      // order was in flight quietly nulled that order's variant_id, and
      // restore_stock_on_cancel keys off exactly that column — cancelling the
      // order afterwards put the goods back on products.stock instead of the
      // variant they actually came from.
      //
      // Re-inserting also wrote the stock held in this form since page load,
      // reverting anything sold in between. Both are avoided by touching only
      // what changed.
      const sourceVariants = useMatrix
        ? variantsFromGroups(colorGroups)
        : variants;
      const cleanVariants = sourceVariants
        .filter((v) => v.label.trim())
        .map((v, i) => ({
          product_id: productId,
          label: v.label.trim(),
          color: v.color ?? null,
          size: v.size ?? null,
          price: v.price.trim() === "" ? null : Number(v.price),
          stock: v.stock.trim() === "" ? null : Number(v.stock),
          sort_order: i,
        }));

      // Labels whose stock the merchant actually changed in this session.
      const stockEdited = new Set(
        sourceVariants
          .filter(
            (v) =>
              v.label.trim() &&
              v.stock !== (initialStockByLabel.current.get(v.label.trim()) ?? ""),
          )
          .map((v) => v.label.trim()),
      );

      const { data: existingRows } = await supabase
        .from("product_variants")
        .select("id, label")
        .eq("product_id", productId);
      const existingByLabel = new Map(
        ((existingRows ?? []) as { id: string; label: string }[]).map((r) => [
          r.label,
          r.id,
        ]),
      );

      // Only the ones the merchant actually removed.
      const keptLabels = new Set(cleanVariants.map((v) => v.label));
      const goneIds = ((existingRows ?? []) as { id: string; label: string }[])
        .filter((r) => !keptLabels.has(r.label))
        .map((r) => r.id);
      if (goneIds.length) {
        await supabase.from("product_variants").delete().in("id", goneIds);
      }

      const toInsert = cleanVariants.filter((v) => !existingByLabel.has(v.label));
      for (const v of cleanVariants) {
        const id = existingByLabel.get(v.label);
        if (!id) continue;
        const patch: Record<string, unknown> = {
          color: v.color,
          size: v.size,
          price: v.price,
          sort_order: v.sort_order,
        };
        if (stockEdited.has(v.label)) patch.stock = v.stock;
        await supabase.from("product_variants").update(patch).eq("id", id);
      }

      if (toInsert.length) {
        const { error: variantsError } = await supabase
          .from("product_variants")
          .insert(toInsert);
        if (variantsError) {
          setError(dict.auth.errorGeneric);
          setLoading(false);
          return;
        }
      }

      // Options + modifier groups are replaced wholesale (order_items snapshot
      // name/price, so nothing references these rows). Delete options first
      // (they FK the groups), then groups; re-insert groups to get their ids,
      // then insert both grouped and ungrouped (flat) options.
      await supabase.from("product_options").delete().eq("product_id", productId);
      await supabase
        .from("product_modifier_groups")
        .delete()
        .eq("product_id", productId);

      let optSort = 0;
      const optionRows: {
        product_id: string;
        name: string;
        price: number;
        sort_order: number;
        group_id: string | null;
      }[] = [];

      const cleanGroups = modGroups
        .map((g) => ({
          ...g,
          options: g.options.filter((o) => o.name.trim()),
        }))
        .filter((g) => g.name.trim() && g.options.length > 0);

      for (let gi = 0; gi < cleanGroups.length; gi++) {
        const g = cleanGroups[gi];
        const max = g.maxSelect.trim() === "" ? null : Number(g.maxSelect);
        const min = g.minSelect.trim() === "" ? 0 : Number(g.minSelect);
        const { data: grpRow, error: grpErr } = await supabase
          .from("product_modifier_groups")
          .insert({
            product_id: productId,
            name: g.name.trim(),
            name_en: g.nameEn.trim() || null,
            required: g.required,
            min_select: Number.isFinite(min) && min > 0 ? Math.floor(min) : 0,
            max_select: max != null && Number.isFinite(max) && max >= 1 ? Math.floor(max) : null,
            sort_order: gi,
          })
          .select("id")
          .single();
        if (grpErr || !grpRow) {
          setError(dict.auth.errorGeneric);
          setLoading(false);
          return;
        }
        for (const o of g.options) {
          optionRows.push({
            product_id: productId,
            name: o.name.trim(),
            price: o.price.trim() === "" ? 0 : Number(o.price),
            sort_order: optSort++,
            group_id: grpRow.id as string,
          });
        }
      }

      for (const o of options.filter((o) => o.name.trim())) {
        optionRows.push({
          product_id: productId,
          name: o.name.trim(),
          price: o.price.trim() === "" ? 0 : Number(o.price),
          sort_order: optSort++,
          group_id: null,
        });
      }

      if (optionRows.length) {
        const { error: optionsError } = await supabase
          .from("product_options")
          .insert(optionRows);
        if (optionsError) {
          setError(dict.auth.errorGeneric);
          setLoading(false);
          return;
        }
      }
    }

    await revalidateProduct(productId);
    await revalidateStore(storeId);
    router.push(`/${lang}/merchant/${storeId}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-5"
    >
      <h2 className="text-lg font-bold">{p.editTitle}</h2>
      <ImageUpload folder={storeId} value={imageUrl} onChange={setImageUrl} label={p.image} />

      <div>
        <span className={label}>{p.gallery}</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {gallery.map((url, i) => (
            <div key={url} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border">
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

      <div>
        <label className={label} htmlFor="name">{p.name}</label>
        <input id="name" name="name" type="text" required defaultValue={initial.name} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="brand">{p.brand}</label>
        <input id="brand" name="brand" type="text" defaultValue={initial.brand} placeholder={p.brandPlaceholder} className={field} />
      </div>
      {sections.length > 0 && (
        <div>
          <label className={label} htmlFor="section_id">{p.section}</label>
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
      <div className={`grid gap-4 ${simplified ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <div>
          <label className={label} htmlFor="price">{p.price}</label>
          <input id="price" name="price" type="number" min="0" step="0.01" required defaultValue={initial.price} className={field} onInput={(e) => setPriceInput(e.currentTarget.value)} />
        </div>
        <div>
          <label className={label} htmlFor="discount_price">{p.discountPrice}</label>
          <input id="discount_price" name="discount_price" type="number" min="0" step="0.01" defaultValue={initial.discountPrice} className={field} />
        </div>
        {/* Cost of goods. The create form has asked for this since 0210 and the
            editor never did, so the only chance to record it was the thirty
            seconds a product was first typed in — and across the live platform
            not one of 60 products carries one, which is why the profit report
            computes zero for everybody. Optional on purpose: a merchant who
            genuinely does not track margins is not blocked, they are told in
            one line what the number buys them. */}
        <div>
          <label className={label} htmlFor="cost">{p.cost}</label>
          <input id="cost" name="cost" type="number" min="0" step="0.01" defaultValue={initial.cost} placeholder="0" className={field} />
          <p className="mt-1 text-xs text-muted-foreground">{p.costHint}</p>
        </div>
        {!simplified && (
          <div>
            <label className={label} htmlFor="stock">{p.stock}</label>
            <input id="stock" name="stock" type="number" min="0" step="1" defaultValue={initial.stock} placeholder="∞" className={field} />
          </div>
        )}
      </div>
      {/* Directly under the price, because it says what the number above is the
          price OF. This is the screen ملحمة البركة would actually use: ten items
          already priced per kilo, each one two taps from saying so. */}
      {initial.itemKind !== "service" && (
        <UnitPricingFields
          dict={dict}
          lang={lang}
          value={unitPricing}
          onChange={setUnitPricing}
          priceInput={priceInput}
        />
      )}
      <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={dealToday}
          onChange={(e) => setDealToday(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {p.dealToday}
      </label>

      <div className="rounded-xl border border-warning/30 bg-warning-soft p-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-warning" />
          <span className={label}>{dict.flash.merchantTitle}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {dict.flash.merchantHint}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="flash_price">
              {dict.flash.flashPrice}
            </label>
            <input id="flash_price" name="flash_price" type="number" min="0" step="0.01" defaultValue={initial.flashPrice} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="flash_start">
              {dict.flash.flashStart}
            </label>
            <input id="flash_start" name="flash_start" type="datetime-local" defaultValue={toLocalInput(initial.flashStart)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="flash_end">
              {dict.flash.flashEnd}
            </label>
            <input id="flash_end" name="flash_end" type="datetime-local" defaultValue={toLocalInput(initial.flashEnd)} className={field} />
          </div>
        </div>
      </div>

      {bookable && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-muted/40 p-4">
          <div>
            <label className={label} htmlFor="book_mode">{p.bookMode}</label>
            <select id="book_mode" value={bookMode} onChange={(e) => setBookMode(e.target.value)} className={field}>
              <option value="">{p.bookModeDefault}</option>
              <option value="provider_exclusive">{p.bookModeExclusive}</option>
              <option value="pooled_providers">{p.bookModePooled}</option>
              <option value="capacity_based">{p.bookModeCapacity}</option>
              <option value="request_based">{p.bookModeRequest}</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{p.bookModeHint}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="duration_minutes">{p.bookDuration}</label>
              <input id="duration_minutes" name="duration_minutes" type="number" min="5" max="480" step="5" defaultValue={initial.durationMinutes} placeholder="30" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="buffer_minutes">{p.bookBuffer}</label>
              <input id="buffer_minutes" name="buffer_minutes" type="number" min="0" max="120" step="5" defaultValue={initial.bufferMinutes} placeholder="0" className={field} />
            </div>
            {bookMode === "capacity_based" && (
              <div>
                <label className={label} htmlFor="capacity_per_slot">{p.bookCapacity}</label>
                <input id="capacity_per_slot" name="capacity_per_slot" type="number" min="1" step="1" defaultValue={initial.capacityPerSlot} placeholder="1" className={field} />
              </div>
            )}
          </div>
        </div>
      )}
      <div>
        <label className={label} htmlFor="description">{p.description}</label>
        <textarea id="description" name="description" rows={2} defaultValue={initial.description} className={field} />
      </div>

      {/* Optional English overrides — shown to customers browsing in English. */}
      <div className="rounded-xl border border-border/70 p-4">
        <span className={label}>{p.englishOptional}</span>
        <div className="mt-3 space-y-3">
          <div>
            <label className={label} htmlFor="name_en">{p.nameEn}</label>
            <input id="name_en" name="name_en" type="text" defaultValue={initial.nameEn} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="description_en">{p.descriptionEn}</label>
            <textarea id="description_en" name="description_en" rows={2} defaultValue={initial.descriptionEn} className={field} />
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
                <select id={`attr_${f.key}`} name={`attr_${f.key}`} className={field} defaultValue={initial.attributes[f.key] ?? ""}>
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {lang === "ar" ? o.ar : o.en}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={`attr_${f.key}`} name={`attr_${f.key}`} type={f.type} defaultValue={initial.attributes[f.key] ?? ""} className={field} />
              )}
            </div>
          ))}
          </div>
        </div>
      )}

      {!simplified && useMatrix && (
        <div className="rounded-xl border border-border/70 p-4">
          <VariantMatrix dict={dict} groups={colorGroups} onChange={setColorGroups} />
        </div>
      )}

      {!simplified && (
        <>
          {!useMatrix && (
          <div className="rounded-xl border border-border/70 p-4">
            <div className="flex items-center justify-between">
              <span className={label}>{p.variantsTitle}</span>
              <button
                type="button"
                onClick={() => setVariants([...variants, { label: "", price: "", stock: "" }])}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                {p.addVariant}
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="flex flex-wrap items-stretch gap-2">
                  <input value={v.label} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={p.variantLabelPlaceholder} className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1" />
                  <input value={v.price} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} type="number" min="0" step="0.01" placeholder={p.variantPrice} className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  <input value={v.stock} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, stock: e.target.value } : x)))} type="number" min="0" step="1" placeholder={p.variantStock} className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  <button type="button" onClick={() => setVariants(variants.filter((_, j) => j !== i))} aria-label={p.remove} className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Modifier groups (food): grouped options with selection rules */}
          <div className="rounded-xl border border-border/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className={label}>{p.modGroupsTitle}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.modGroupsHint}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setModGroups([
                    ...modGroups,
                    {
                      name: "",
                      nameEn: "",
                      required: false,
                      minSelect: "0",
                      maxSelect: "",
                      options: [{ name: "", price: "" }],
                    },
                  ])
                }
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                {p.modAddGroup}
              </button>
            </div>
            {modGroups.length > 0 && (
              <div className="mt-3 space-y-4">
                {modGroups.map((g, gi) => {
                  const patch = (d: Partial<ModifierGroupRow>) =>
                    setModGroups(modGroups.map((x, j) => (j === gi ? { ...x, ...d } : x)));
                  return (
                    <div key={gi} className="rounded-lg border border-border bg-surface-muted/40 p-3">
                      <div className="flex flex-wrap items-stretch gap-2">
                        <input value={g.name} onChange={(e) => patch({ name: e.target.value })} placeholder={p.modGroupName} className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1" />
                        <input value={g.nameEn} onChange={(e) => patch({ nameEn: e.target.value })} placeholder={p.modGroupNameEn} className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1" />
                        <button type="button" onClick={() => setModGroups(modGroups.filter((_, j) => j !== gi))} aria-label={p.remove} className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs font-semibold">
                          <input type="checkbox" checked={g.required} onChange={(e) => patch({ required: e.target.checked })} className="h-4 w-4 accent-primary" />
                          {p.modRequired}
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-semibold">
                          {p.modMin}
                          <input value={g.minSelect} onChange={(e) => patch({ minSelect: e.target.value })} type="number" min="0" className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary" />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-semibold">
                          {p.modMax}
                          <input value={g.maxSelect} onChange={(e) => patch({ maxSelect: e.target.value })} type="number" min="1" placeholder="∞" className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary" />
                        </label>
                      </div>
                      <div className="mt-3 space-y-2">
                        {g.options.map((o, oi) => (
                          <div key={oi} className="flex flex-wrap items-stretch gap-2">
                            <input value={o.name} onChange={(e) => patch({ options: g.options.map((x, k) => (k === oi ? { ...x, name: e.target.value } : x)) })} placeholder={p.addonNamePlaceholder} className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1" />
                            <input value={o.price} onChange={(e) => patch({ options: g.options.map((x, k) => (k === oi ? { ...x, price: e.target.value } : x)) })} type="number" min="0" step="0.01" placeholder={p.addonPrice} className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                            <button type="button" onClick={() => patch({ options: g.options.filter((_, k) => k !== oi) })} aria-label={p.remove} className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => patch({ options: [...g.options, { name: "", price: "" }] })} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-muted">
                          <Plus className="h-3.5 w-3.5" />
                          {p.modAddOption}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
                  <input value={o.name} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={p.addonNamePlaceholder} className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:w-auto sm:flex-1" />
                  <input value={o.price} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} type="number" min="0" step="0.01" placeholder={p.addonPrice} className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={p.remove} className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-border text-danger transition-colors hover:bg-danger-soft">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          loading={loading}
          leftIcon={<Save className="h-4 w-4" />}
          className="flex-1"
        >
          {loading ? p.saving : p.update}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/${lang}/merchant/${storeId}`)}
        >
          {dict.store.back}
        </Button>
      </div>
    </form>
  );
}
