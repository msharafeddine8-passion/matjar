import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { Package, BellRing, FileSpreadsheet } from "lucide-react";
import { ChevronNext, ChevronPrev } from "@/components/ui/directional-icon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { toCategoryKey } from "@/lib/catalog";
import { categoryModule } from "@/lib/modules";
import { Container } from "@/components/ui/container";
import { ProductForm } from "@/components/product-form";
import { ServiceForm } from "@/components/service-form";
import { SectionManager, type SectionRow } from "@/components/section-manager";
import { ProductRowActions } from "@/components/product-row-actions";
import { ProGate } from "@/components/pro-gate";
import { planProductLimit } from "@/lib/plan";
import { effectivePlan as resolvePlan } from "@/lib/plan-tiers";
import { planCopy } from "@/lib/plan-copy";
import { Money } from "@/components/ui/money";
import { CardList, CardRow } from "@/components/ui/card";
import { MerchantItemAvailability } from "@/components/merchant/merchant-item-availability";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProductRow = {
  id: string;
  name: string;
  price: number;
  is_available: boolean;
  image_url: string | null;
};

// Catalog module of the Business OS: the store's menu / products / services /
// listings, with the add form beside the list.
export default async function StoreItemsPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
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
    .select("id, name, owner_id, plan, trial_ends_at, business_types(slug)")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);
  const sPlan = store as unknown as {
    plan: string | null;
    trial_ends_at: string | null;
  };
  const onTrial =
    sPlan.trial_ends_at != null && new Date(sPlan.trial_ends_at) > new Date();
  const effectivePlan = resolvePlan(sPlan.plan, sPlan.trial_ends_at);
  const productCap = planProductLimit(effectivePlan);
  const category = toCategoryKey(
    (store as unknown as { business_types: { slug: string } | null })
      .business_types?.slug,
    `store ${storeId}`,
  );
  const mod = categoryModule[category];
  const itemsLabel = dict.store[mod.itemsKey];

  // Staff need the products permission to manage the catalog.
  const isOwner =
    (store as unknown as { owner_id: string }).owner_id === user.id;
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    const perms =
      (staffRow?.permissions as Record<string, boolean> | null) ?? {};
    if (!(perms.products ?? false)) redirect(`/${lang}/merchant/${storeId}`);
  }

  const { data } = await supabase
    .from("products")
    .select("id, name, price, is_available, image_url")
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const products = (data ?? []) as ProductRow[];

  // Back-in-stock demand: how many customers are waiting on each product
  // (migration 0163). RLS (stock_waitlist_select_store) scopes this to the
  // store's own rows. Surfaced as a badge so the merchant knows what to restock.
  const waiting: Record<string, number> = {};
  const { data: waitData } = await supabase
    .from("stock_waitlist")
    .select("product_id")
    .eq("store_id", storeId)
    .is("notified_at", null);
  for (const w of (waitData ?? []) as { product_id: string }[]) {
    waiting[w.product_id] = (waiting[w.product_id] ?? 0) + 1;
  }

  // Storefront sections (menu groups / collections / service groups). Optional:
  // a store with none renders a flat catalog. Managed here, assigned per product.
  const { data: sectionData } = await supabase
    .from("store_sections")
    .select("id, name, name_en, sort_order")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true });
  const sections = (sectionData ?? []) as unknown as SectionRow[];

  return (
    <div className="py-10">
      <Container className="max-w-5xl">
        <Link
          href={`/${lang}/merchant/${storeId}`}
          className="relative inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {(store as { name: string }).name}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {itemsLabel}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${lang}/merchant/${storeId}/products/import`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {dict.merchant.productImport.cta}
            </Link>
            <Link
              href={`/${lang}/merchant/${storeId}/bundles`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
            >
              <Package className="h-4 w-4" />
              {dict.merchant.bundles.title}
            </Link>
          </div>
        </div>

        <div className="mt-8">
          <SectionManager
            storeId={storeId}
            lang={lang}
            dict={dict}
            initial={sections}
          />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div>
            {products.length ? (
              <CardList>
                {products.map((p) => (
                  <CardRow
                    key={p.id}
                    className={`p-3 ${p.is_available ? "" : "opacity-60"}`}
                  >
                    {/* One row on a desktop, exactly as before. On a phone it
                        wraps to two: the item and its availability switch on
                        the first line, the travel/manage controls on the
                        second — seven controls in one 320px row was why the
                        "hide this, it just ran out" tap was a 32px grey icon
                        squeezed between a price and a delete button. */}
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        <Image
                          src={p.image_url}
                          alt=""
                          width={48}
                          height={48}
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                          sizes="48px"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                          <Package className="h-5 w-5" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-2 lg:hidden">
                          <span className="font-bold text-primary">
                            <Money value={p.price} />
                          </span>
                          {(waiting[p.id] ?? 0) > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning"
                              title={dict.merchant.products.waitingHint}
                            >
                              <BellRing className="h-3 w-3" />
                              {waiting[p.id]} {dict.merchant.products.waiting}
                            </span>
                          )}
                        </span>
                      </span>
                      {(waiting[p.id] ?? 0) > 0 && (
                        <span
                          className="hidden shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-bold text-warning lg:inline-flex"
                          title={dict.merchant.products.waitingHint}
                        >
                          <BellRing className="h-3.5 w-3.5" />
                          {waiting[p.id]} {dict.merchant.products.waiting}
                        </span>
                      )}
                      <span className="hidden font-bold text-primary lg:inline">
                        <Money value={p.price} />
                      </span>
                      {/* The phone's primary control: is this on the shelf or
                          not. Writes `products.is_available` through the same
                          path ProductRowActions' eye does — hiding it here
                          takes it off the storefront immediately. */}
                      <span className="lg:hidden">
                        <MerchantItemAvailability
                          productId={p.id}
                          storeId={storeId}
                          isAvailable={p.is_available}
                          label={dict.merchant.mobile.availabilityLabel.replace(
                            "{name}",
                            p.name,
                          )}
                          shownLabel={dict.merchant.mobile.orderShown}
                          hiddenLabel={dict.merchant.mobile.orderHidden}
                          errorLabel={dict.common.actionFailed}
                        />
                      </span>
                      <span className="hidden items-center gap-3 lg:flex">
                        {/* ISS-018: this sits beside ProductRowActions, whose
                            controls (show / hide / delete) all act in place.
                            Edit is the only one that leaves for another screen
                            and it looked identical to them. The chevron says
                            "this one travels" — ChevronNext, so it points left
                            in Arabic. */}
                        <Link
                          href={`/${lang}/merchant/${storeId}/products/${p.id}`}
                          className="relative inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:border-primary hover:text-primary"
                        >
                          {dict.merchant.products.editAction}
                          <ChevronNext className="h-3.5 w-3.5" />
                        </Link>
                        <ProductRowActions
                          productId={p.id}
                          storeId={storeId}
                          isAvailable={p.is_available}
                          showLabel={dict.merchant.products.show}
                          hideLabel={dict.merchant.products.hide}
                          deleteLabel={dict.merchant.products.delete}
                          confirmLabel={dict.merchant.products.confirmDelete}
                          errorLabel={dict.common.actionFailed}
                          okLabel={dict.common.confirm}
                          cancelLabel={dict.common.cancel}
                        />
                      </span>
                    </div>
                    {/* Phone line two. ProductRowActions still carries its eye
                        alongside delete — it is one component and splitting it
                        would change a file this screen is not the only owner
                        of. The eye and the switch write the same column, so
                        they can disagree only for as long as a server refresh
                        takes; the switch is the labelled one. */}
                    <div className="mt-2 flex items-center justify-between gap-2 lg:hidden">
                      <Link
                        href={`/${lang}/merchant/${storeId}/products/${p.id}`}
                        className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                      >
                        {dict.merchant.products.editAction}
                        <ChevronNext className="h-3.5 w-3.5" />
                      </Link>
                      <ProductRowActions
                        productId={p.id}
                        storeId={storeId}
                        isAvailable={p.is_available}
                        showLabel={dict.merchant.products.show}
                        hideLabel={dict.merchant.products.hide}
                        deleteLabel={dict.merchant.products.delete}
                        confirmLabel={dict.merchant.products.confirmDelete}
                        errorLabel={dict.common.actionFailed}
                        okLabel={dict.common.confirm}
                        cancelLabel={dict.common.cancel}
                      />
                    </div>
                  </CardRow>
                ))}
              </CardList>
            ) : (
              <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
                {dict.merchant.products.empty}
              </div>
            )}
          </div>

          {/* {limit} is THIS store's cap (a Basic store hitting its 30 used to
              be told "3 products"); the tier caps in the body come from
              PLAN_TIERS through plan-copy. */}
          {products.length >= productCap ? (
            <ProGate
              lang={lang}
              dict={dict}
              storeId={storeId}
              compact
              title={planCopy(dict.os.pro.productLimitTitle, { limit: productCap })}
              body={planCopy(dict.os.pro.productLimitBody)}
            />
          ) : category === "services" || category === "healthcare" ? (
            <ServiceForm
              storeId={storeId}
              dict={dict}
              lang={lang}
              sections={sections}
            />
          ) : (
            <ProductForm
              storeId={storeId}
              lang={lang}
              category={category}
              dict={dict}
              addKey={mod.addKey}
              simplified={mod.simplifiedItem}
              sections={sections}
            />
          )}
        </div>
      </Container>
    </div>
  );
}
