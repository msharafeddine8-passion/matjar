import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { StoreView } from "@/lib/data/store-view";
import type { ItemSurface } from "@/lib/store-experience";
import { attributeSummary } from "@/lib/attributes";
import { waLink } from "@/lib/whatsapp";
import { parseHours } from "@/lib/hours";
import {
  featureCopy,
  featureLabel,
  sectorPendingCapabilities,
} from "@/lib/feature-availability";
import { StoreProducts } from "@/components/store-products";
import type { CheckoutViewer, StoreCheckout } from "@/lib/checkout";
import type { DoctorView } from "@/components/store/store-doctors";

// The two engines below are mutually exclusive on any given render — `surface`
// picks one — but both used to be statically imported, so every storefront
// shipped both. `StoreProducts` (cart, coupon, loyalty, zones, idempotency key)
// stays a static import on purpose: the order surface is the common case, it is
// the money path, and nothing about its state may be made to arrive late.
// The appointment engine, which only appointment sectors ever draw, is fetched
// when it is the one that renders — it is still server-rendered, so the service
// list and its prices stay in the HTML. See store/lazy-engines.tsx.
import { BookingPanel } from "@/components/store/lazy-engines";
import { Money } from "@/components/ui/money";

export function StoreProductsSection({
  sectionTitle,
  store,
  id,
  lang,
  dict,
  surface,
  canOrderProducts,
  initialServiceId = null,
  directoryOnly = false,
  doctors,
  providerServices,
  currentUser,
  checkout,
  viewer,
  lbpRate,
  Icon,
  style,
  initialBrand = null,
  layout = null,
}: {
  sectionTitle: string;
  store: StoreView;
  id: string;
  lang: Locale;
  dict: Dictionary;
  surface: ItemSurface;
  canOrderProducts: boolean;
  initialServiceId?: string | null;
  directoryOnly?: boolean;
  doctors: DoctorView[];
  providerServices: Record<string, string[]>;
  currentUser: { id: string; name: string; phone?: string } | null;
  /** This store's checkout — zones, coupons, loyalty, branches, the merchant's
   *  own questions. Assembled once by the page (src/lib/data/checkout.ts) and
   *  handed to whichever surface can order, so no surface can be missing a
   *  capability by accident (MJ-024). */
  checkout: StoreCheckout | null;
  viewer: CheckoutViewer;
  lbpRate: number;
  Icon: LucideIcon;
  style: { cover: string; iconWrap: string };
  initialBrand?: string | null;
  // Theme-resolved product presentation (merchant's own pick already applied).
  layout?: "grid" | "menu" | "showcase" | null;
}) {
  // A store may both book services and sell goods (a vet clinic selling pet
  // food, a salon selling hair products). Items carry an explicit kind, so the
  // two are rendered by their own engine instead of one surface swallowing both
  // — which is what made products unorderable in every appointment store.
  const services = store.products.filter((p) => p.itemKind === "service");
  const goods = store.products.filter((p) => p.itemKind !== "service");
  // On an appointment surface the primary list is the services; the goods get
  // their own cart section below. The browse-only catalogue surface lists every
  // row (it renders `store.products`), so its emptiness is judged on every row
  // too — counting only goods there put «no products» above a trade's list of
  // services. Same rule as catalogPrimaryCount() in lib/profile-engine.ts.
  const primary =
    surface === "appointment"
      ? services
      : surface === "order"
        ? goods
        : store.products;
  // A checkout the page could not assemble (a store anon may not read) is a
  // store nobody may order from — the browse-only catalogue is then the correct
  // surface, not a cart that would fail at the RPC.
  const showGoodsSection =
    surface === "appointment" &&
    canOrderProducts &&
    goods.length > 0 &&
    checkout != null;
  // A booking store with no services yet but goods on sale (a salon selling
  // perfume, live today): the goods cart below IS the section. Drawing «no
  // services» above it was a placeholder over real content — the heading and
  // the empty box are skipped, the cart keeps its own heading.
  const primaryEmptyButGoods =
    store.isReal && primary.length === 0 && showGoodsSection;

  // What THIS sector's bundle promises that its storefront cannot deliver yet,
  // from the availability registry — empty for any sector that is not held in
  // directory-only mode, so the note below cannot render where nothing is
  // pending. The label per item is the same string /pricing and the module
  // manager print for it; the status word is the registry's one word.
  const pending = directoryOnly ? sectorPendingCapabilities(store.category) : [];
  const pendingNote =
    pending.length > 0
      ? dict.features.pendingNote
          .replace("{items}", pending.map((c) => featureLabel(c, dict)).join(" · "))
          .replace("{status}", featureCopy("coming_soon", dict))
      : null;

  return (
    <>
      {/* Anchor target: sections that sit above this one (the clinic summary's
          "book an appointment") jump here rather than restating the engine. */}
      {/* Below lg the site header and the store's section-tab rail are both
          sticky, so the scroll margin must clear BOTH or a jump to this anchor
          lands the heading underneath them. */}
      {!primaryEmptyButGoods && (
        <h2
          id="offerings"
          className="mb-4 mt-10 scroll-mt-[calc(var(--m-header-h)+var(--m-sectiontabs-h)+env(safe-area-inset-top))] text-xl font-bold lg:scroll-mt-20"
        >
          {sectionTitle}
        </h2>
      )}
      {store.isReal ? (
        primary.length ? (
          surface === "appointment" ? (
            <BookingPanel
              storeId={id}
              lang={lang}
              dict={dict}
              category={store.category}
              customerName={currentUser?.name ?? null}
              customerPhone={currentUser?.phone ?? null}
              whatsapp={store.whatsapp ?? null}
              storeName={store.name}
              hours={parseHours(store.hours)}
              slotMinutes={store.bookingSlotMinutes ?? 30}
              cancelHours={store.bookingCancelHours ?? 0}
              doctors={doctors.map((d) => ({
                id: d.id,
                name: d.name,
                specialty: d.specialty,
              }))}
              providerServices={providerServices}
              initialServiceId={initialServiceId}
              sections={store.sections}
              services={services
                .filter((p) => p.id)
                .map((p) => ({
                  id: p.id as string,
                  name: p.name,
                  nameEn: p.nameEn,
                  price: p.price,
                  imageUrl: p.imageUrl,
                  attributes: p.attributes,
                  sectionId: p.sectionId ?? null,
                  allocationMode: p.allocationMode ?? null,
                  durationMinutes: p.durationMinutes ?? null,
                  bufferMinutes: p.bufferMinutes ?? 0,
                  capacityPerSlot: p.capacityPerSlot ?? null,
                  options: p.priceOptions,
                }))}
            />
          ) : surface === "order" && checkout ? (
            <StoreProducts
              lang={lang}
              dict={dict}
              category={store.category}
              isBooking={false}
              checkout={checkout}
              viewer={viewer}
              layout={layout ?? store.storefrontLayout}
              lbpRate={lbpRate}
              sections={store.sections}
              products={goods
                .filter((p) => p.id)
                .map((p) => ({
                  id: p.id as string,
                  name: p.name,
                  nameEn: p.nameEn,
                  brand: p.brand ?? null,
                  price: p.price,
                  discountPrice: p.discountPrice,
                  imageUrl: p.imageUrl,
                  attributes: p.attributes,
                  stock: p.stock ?? null,
                  flashPrice: p.flashPrice,
                  flashStart: p.flashStart,
                  flashEnd: p.flashEnd,
                  sectionId: p.sectionId ?? null,
                  isBundle: p.isBundle ?? false,
                  includes: p.includes,
                  soldBy: p.soldBy ?? null,
                  unitMeasure: p.unitMeasure ?? null,
                  unitAmount: p.unitAmount ?? null,
                }))}
              initialBrand={initialBrand}
              hours={parseHours(store.hours)}
            />
          ) : (
            /* Catalog surface: browse-only listing + contact via the header.
               Used by directory-only sectors (today: real estate — see
               DIRECTORY_ONLY_SECTORS in store-experience.ts) whose transaction
               engine is not switched on yet, and by service sectors whose
               primary action is the request form above. No cart, no wrong
               booking flow.

               The note under it used to be one fixed sentence promising
               "booking and direct purchase coming soon" to every directory-only
               sector, whether or not that sector's bundle contains a cart at
               all (real estate's does not). It now names exactly the
               capabilities the availability registry reports as pending for
               THIS sector, and prints the registry's word for their state —
               so it cannot promise a flat in a shopping basket, and it stops
               rendering the moment the sector leaves directory-only mode. */
            <>
              {directoryOnly && (pendingNote || store.whatsapp) && (
                <div className="mb-4 rounded-xl border border-border bg-surface-muted/50 px-4 py-3">
                  {pendingNote && (
                    <p className="text-sm font-medium text-muted-foreground">
                      {pendingNote}
                    </p>
                  )}
                  {store.whatsapp && (
                    <a
                      href={waLink(
                        store.whatsapp,
                        `${dict.store.inquiryGreeting} ${store.name}`,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {dict.store.contactCta}
                    </a>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {store.products
                  .filter((p) => p.id)
                  .map((p) => {
                    const attr = attributeSummary(
                      store.category,
                      p.attributes,
                      lang,
                    );
                    return (
                      <Link
                        key={p.id as string}
                        href={`/${lang}/product/${p.id}`}
                        className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-primary"
                      >
                        <span
                          className={`relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br ${style.cover}`}
                        >
                          {p.imageUrl ? (
                            <Image
                              src={p.imageUrl}
                              alt={p.name}
                              fill
                              className="object-cover"
                              sizes="(max-width: 640px) 100vw, 33vw"
                            />
                          ) : (
                            <Icon className="h-8 w-8 text-foreground/20" />
                          )}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col p-4">
                          <h3 dir="auto" className="truncate font-bold">
                            {p.name}
                          </h3>
                          {attr && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {attr}
                            </p>
                          )}
                          <p className="mt-2 text-sm text-muted-foreground">
                            {dict.store.from}{" "}
                            <Money value={p.price} className="font-bold text-foreground" />
                          </p>
                        </div>
                      </Link>
                    );
                  })}
              </div>
            </>
          )
        ) : primaryEmptyButGoods ? null : (
          <div className="rounded-2xl border border-dashed border-border py-10 sm:py-14 text-center text-muted-foreground">
            {surface === "appointment"
              ? dict.store.noServices
              : dict.store.noProducts}
          </div>
        )
      ) : null}

      {/* A booking store that also sells goods gets a real cart for them — the
          appointment engine above handles only its services. */}
      {store.isReal && showGoodsSection && checkout ? (
        <>
          <h2 className="mb-4 mt-10 text-xl font-bold">
            {dict.store.productsForSale}
          </h2>
          <StoreProducts
            lang={lang}
            dict={dict}
            category={store.category}
            isBooking={false}
            checkout={checkout}
            viewer={viewer}
            layout={layout ?? store.storefrontLayout}
            lbpRate={lbpRate}
            sections={store.sections}
            products={goods
              .filter((p) => p.id)
              .map((p) => ({
                id: p.id as string,
                name: p.name,
                nameEn: p.nameEn,
                brand: p.brand ?? null,
                price: p.price,
                discountPrice: p.discountPrice,
                imageUrl: p.imageUrl,
                attributes: p.attributes,
                stock: p.stock ?? null,
                flashPrice: p.flashPrice,
                flashStart: p.flashStart,
                flashEnd: p.flashEnd,
                sectionId: p.sectionId ?? null,
                isBundle: p.isBundle ?? false,
                includes: p.includes,
                soldBy: p.soldBy ?? null,
                unitMeasure: p.unitMeasure ?? null,
                unitAmount: p.unitAmount ?? null,
              }))}
            initialBrand={initialBrand}
              hours={parseHours(store.hours)}
          />
        </>
      ) : null}
      {/* Demo/sample stores: a static preview grid, no transaction. */}
      {!store.isReal && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {store.products.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4"
            >
              <span
                className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${style.cover}`}
              >
                <Icon className="h-7 w-7 text-foreground/20" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 dir="auto" className="truncate font-bold">
                  {p.name}
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {dict.store.from}{" "}
                  <Money value={p.price} className="font-bold text-foreground" />
                </p>
              </div>
              <button className="relative shrink-0 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-colors before:absolute before:-inset-y-1 before:content-[''] hover:bg-primary-hover">
                {surface === "appointment" ? dict.store.book : dict.store.order}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
