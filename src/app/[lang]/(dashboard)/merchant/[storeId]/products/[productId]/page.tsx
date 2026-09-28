import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { toCategoryKey } from "@/lib/catalog";
import { categoryModule } from "@/lib/modules";
import { Container } from "@/components/ui/container";
import { FETCH_BOUNDS, warnIfTruncated } from "@/lib/data/bounds";
import { ChevronPrev } from "@/components/ui/directional-icon";
import {
  ProductEditForm,
  type ProductInitial,
} from "@/components/product-edit-form";
import { unitPricingValue } from "@/lib/unit-pricing";
import { beirutYmd } from "@/lib/quick-panel";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string; productId: string }>;
}) {
  const { lang, storeId, productId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId) || !UUID_RE.test(productId))
    redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);
  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  const category = toCategoryKey(
    (store as unknown as { business_types: { slug: string } | null })
      .business_types?.slug,
    `store ${storeId}`,
  );
  const mod = categoryModule[category];

  const { data: product } = await supabase
    .from("products")
    // `cost` rides along: the editor is where a merchant fixes what they got
    // wrong the first time, and it was the one price field this form could not
    // show — so a cost entered at creation was invisible here, and one omitted
    // could never be added afterwards. Zero of 60 live products carry one.
    .select("id, store_id, name, name_en, brand, price, discount_price, cost, description, description_en, image_url, gallery, stock, section_id, attributes, deal_date, flash_price, flash_start, flash_end, item_kind, booking_allocation_mode, duration_minutes, buffer_minutes, capacity_per_slot, sold_by, unit_measure, unit_amount")
    .eq("id", productId)
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!product) redirect(`/${lang}/merchant/${storeId}`);

  // Storefront sections available for assignment (optional; empty → no picker).
  const { data: sectionData } = await supabase
    .from("store_sections")
    .select("id, name, name_en")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true })
    .limit(FETCH_BOUNDS.storeSections);
  warnIfTruncated(sectionData, FETCH_BOUNDS.storeSections, `store_sections (merchant editor, store ${storeId})`);
  const sections = (sectionData ?? []) as unknown as {
    id: string;
    name: string;
    name_en: string | null;
  }[];

  const [{ data: variants }, { data: options }, { data: modGroups }] =
    await Promise.all([
      supabase
        .from("product_variants")
        .select("label, price, stock, color, size")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.productVariants),
      supabase
        .from("product_options")
        .select("name, price, group_id")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.productOptions),
      supabase
        .from("product_modifier_groups")
        .select("id, name, name_en, required, min_select, max_select")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .limit(FETCH_BOUNDS.productModifierGroups),
    ]);
  // This form saves back what it loaded: a truncated read here would delete the
  // rows that fell past the ceiling on the next save. Loudest of the lot.
  warnIfTruncated(variants, FETCH_BOUNDS.productVariants, `product_variants (merchant editor, product ${productId})`);
  warnIfTruncated(options, FETCH_BOUNDS.productOptions, `product_options (merchant editor, product ${productId})`);
  warnIfTruncated(modGroups, FETCH_BOUNDS.productModifierGroups, `product_modifier_groups (merchant editor, product ${productId})`);

  const gallery = Array.isArray(product.gallery)
    ? (product.gallery as string[])
    : [];

  const initial: ProductInitial = {
    name: (product.name as string) ?? "",
    brand: (product.brand as string | null) ?? "",
    itemKind: ((product.item_kind as string | null) ?? "product") as "product" | "service",
    bookingMode: (product.booking_allocation_mode as string | null) ?? "",
    durationMinutes:
      product.duration_minutes != null ? String(product.duration_minutes) : "",
    bufferMinutes:
      product.buffer_minutes != null && Number(product.buffer_minutes) > 0
        ? String(product.buffer_minutes)
        : "",
    capacityPerSlot:
      product.capacity_per_slot != null
        ? String(product.capacity_per_slot)
        : "",
    nameEn: (product.name_en as string | null) ?? "",
    price: product.price != null ? String(product.price) : "",
    discountPrice: product.discount_price != null ? String(product.discount_price) : "",
    cost: product.cost != null ? String(product.cost) : "",
    // 0299. Null columns mean piece-priced, which is what every product on the
    // platform is today — so PIECE_PRICED is the answer for all of them until a
    // merchant says otherwise, and the editor opens on "By the piece".
    unitPricing: unitPricingValue(
      product.sold_by as string | null,
      product.unit_measure as string | null,
      product.unit_amount as number | null,
    ),
    description: (product.description as string | null) ?? "",
    descriptionEn: (product.description_en as string | null) ?? "",
    imageUrl: (product.image_url as string | null) ?? null,
    gallery,
    stock: product.stock != null ? String(product.stock) : "",
    sectionId: (product.section_id as string | null) ?? "",
    dealToday:
      (product.deal_date as string | null) === beirutYmd(new Date()),
    flashPrice: product.flash_price != null ? String(product.flash_price) : "",
    flashStart: (product.flash_start as string | null) ?? "",
    flashEnd: (product.flash_end as string | null) ?? "",
    attributes: (product.attributes as Record<string, string> | null) ?? {},
    variants: (variants ?? []).map((v) => ({
      label: (v.label as string) ?? "",
      price: v.price != null ? String(v.price) : "",
      stock: v.stock != null ? String(v.stock) : "",
      color: (v.color as string | null) ?? null,
      size: (v.size as string | null) ?? null,
    })),
    // Flat (ungrouped) add-ons only; grouped options are carried on modGroups.
    options: (options ?? [])
      .filter((o) => (o.group_id as string | null) == null)
      .map((o) => ({
        name: (o.name as string) ?? "",
        price: o.price != null ? String(o.price) : "",
      })),
    modGroups: (modGroups ?? []).map((g) => ({
      name: (g.name as string) ?? "",
      nameEn: (g.name_en as string | null) ?? "",
      required: (g.required as boolean) ?? false,
      minSelect: g.min_select != null ? String(g.min_select) : "0",
      maxSelect: g.max_select != null ? String(g.max_select) : "",
      options: (options ?? [])
        .filter((o) => (o.group_id as string | null) === (g.id as string))
        .map((o) => ({
          name: (o.name as string) ?? "",
          price: o.price != null ? String(o.price) : "",
        })),
    })),
  };

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        {/* ISS-018. This link always pointed at the catalogue list — the route
            back was never missing. What was missing was any way to know that:
            it was labelled with the STORE's name, which is the exact label the
            list page puts on its own back link, and that one goes somewhere
            else (the OS home). Two destinations wearing one word is why the
            list↔edit relationship read as absent. It now names where it goes,
            using the sector's own noun for the catalogue (القائمة / المنتجات /
            الخدمات / العروض) — the same word standing in the list page's <h1>,
            so leaving and arriving are spelled the same. */}
        <Link
          href={`/${lang}/merchant/${storeId}/items`}
          className="relative inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.store[mod.itemsKey]}
        </Link>
        <div className="mt-5">
          <ProductEditForm
            storeId={storeId}
            productId={productId}
            lang={lang}
            category={category}
            dict={dict}
            simplified={mod.simplifiedItem}
            initial={initial}
            sections={sections}
          />
        </div>
      </Container>
    </div>
  );
}
