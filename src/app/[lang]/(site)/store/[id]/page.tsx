import { cache, Fragment } from "react";
import { notFound } from "next/navigation";
import { MapPin, Megaphone, Wallet } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import {
  categoryStyles,
  getStoreById,
  sampleProducts,
} from "@/lib/catalog";
import {
  resolveProfileOrder,
  resolveStoreModules,
  sectorHasTeam,
  sectorTeamMeta,
  type ProfileSectionKey,
} from "@/lib/sectors";
import { createClient } from "@/lib/supabase/server";
import {
  getPublicStoreView,
  getOwnedStoreView,
  type StoreView,
} from "@/lib/data/store-view";
import {
  getCheckoutViewer,
  getStoreCheckoutContext,
  withLoyaltyBalance,
} from "@/lib/data/checkout";
import { localeAlternates, SITE_URL } from "@/lib/site";
import { accentStyle } from "@/lib/color";
import { resolveTheme } from "@/lib/themes";
import { storeJsonLd, jsonLdScript, toOpeningHours } from "@/lib/jsonld";
import { parseHours } from "@/lib/hours";
import { getUsdLbpRate } from "@/lib/data/settings";
import { formatUsd } from "@/lib/currency";
import { waNumber } from "@/lib/phone";
import { categoryIcons } from "@/components/category-icon";
import { Container } from "@/components/ui/container";
import {
  StoreReviews,
  type MyReview,
  type Review,
} from "@/components/store-reviews";
import {
  StoreVerifications,
  type StoreVerification,
} from "@/components/store-verifications";
import { StoreMapClient } from "@/components/store-map-client";
import type { MapStore } from "@/components/store-map";
import type { Resource } from "@/components/timeslot-booking";
import {
  StoreMemberships,
  type MembershipPlan,
} from "@/components/store-memberships";
import type { ClassRow } from "@/components/classes-booking";
import { StoreCourses, type CourseRow } from "@/components/store-courses";
import { StorePortfolio, type PortfolioItem } from "@/components/store-portfolio";
import { StoreHero } from "@/components/store/store-hero";
import { StoreHeader } from "@/components/store/store-header";
import { StoreBranches } from "@/components/store/store-branches";
import {
  StoreFulfillment,
  type CourierOption,
} from "@/components/store/store-fulfillment";
import { StoreHours } from "@/components/store/store-hours";
import { StoreProductsSection } from "@/components/store/store-products-section";
import { StoreHealthcareInfo } from "@/components/store/store-healthcare-info";
import { StoreDoctors, type DoctorView } from "@/components/store/store-doctors";
import {
  StoreSectionTabs,
  type StoreSectionTab,
} from "@/components/store/store-section-tabs";
import { StoreStickyCta } from "@/components/store/store-sticky-cta";
import { resolveOffering } from "@/lib/offering";
import { TrackVisit } from "@/components/track-visit";
import { ContentReport } from "@/components/listing-report";
import { resolveStoreExperience, leadKinds } from "@/lib/store-experience";
// The sector transaction engines are fetched only where they render. Which
// section exists is decided exactly as before (resolveStoreExperience /
// resolveStoreModules / resolveProfileOrder); only the moment the code behind a
// section is downloaded changes. See src/components/store/lazy-engines.tsx.
import {
  ClassesBooking,
  EventTickets,
  LeadForm,
  RentalSearch,
  ReservationForm,
  ServiceRequestForm,
  StaySearch,
  TimeslotBooking,
} from "@/components/store/lazy-engines";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// React cache(): generateMetadata + the page both call loadStore(id) — dedupe
// the load into one call per request. The public store view now comes from
// src/lib/data/store-view.ts (cookie-less + cross-request cached); only the
// owner/admin draft-preview fallback touches the request-scoped client.
const loadStore = cache(async function loadStore(
  id: string,
  lang: Locale,
): Promise<StoreView | null> {
  if (UUID_RE.test(id)) {
    // Common case: cached, cookie-less anon view (RLS → active stores only).
    const real = await getPublicStoreView(id);
    if (real) return real;
    // Owner/admin previewing a not-yet-public store: their RLS grant makes it
    // visible on the request-scoped client. Uncached — visibility is per-user.
    const owned = await getOwnedStoreView(await createClient(), id);
    if (owned) return owned;
  }
  // Demo catalog fallback.
  const mock = getStoreById(id);
  if (mock) {
    return {
      name: mock.name[lang],
      category: mock.category,
      area: mock.area[lang],
      description: mock.description?.[lang] ?? null,
      isOpen: mock.isOpen,
      rating: mock.rating,
      reviews: mock.reviews,
      isReal: false,
      sections: [],
      checkoutFields: [],
      products: sampleProducts[mock.category].map((p) => ({
        name: p.name[lang],
        price: p.price,
      })),
    };
  }
  return null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) return {};
  const store = await loadStore(id, lang);
  if (!store) return { title: "متجر | Matjar" };
  const description =
    store.description ||
    (lang === "ar"
      ? `${store.name} على متجر — اطلب أو تواصل مباشرةً.`
      : `${store.name} on Matjar — order or contact directly.`);
  const image = store.coverUrl || store.logoUrl || undefined;
  return {
    title: store.name,
    description,
    alternates: localeAlternates(lang, `/store/${id}`),
    openGraph: {
      title: store.name,
      description,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: store.name,
      description,
    },
  };
}

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams?: Promise<{ brand?: string; service?: string }>;
}) {
  const { lang, id } = await params;
  const sp = await searchParams;
  const initialBrand = sp?.brand ?? null;
  // Deep link from a service detail page preselects that service in the panel.
  const initialServiceId = sp?.service ?? null;
  if (!isLocale(lang)) notFound();

  const store = await loadStore(id, lang);
  if (!store) notFound();

  const dict = await getDictionary(lang);

  // Reviews + current viewer (only real DB stores carry reviews).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const realStore = store.isReal && UUID_RE.test(id);

  // Wave 1 — the independent public reads for a real store run in parallel
  // (reviews, verification badges, enabled modules) instead of a waterfall.
  const [reviews, verifications, modRowsData] = realStore
    ? await Promise.all([
        supabase
          .from("reviews")
          // reply/reply_at ride along on the query that was already being made —
          // the shop's answer renders under the review it answers, not from a
          // second round-trip.
          // customer_id deliberately absent (MP-010): this read runs as `anon`
          // for most visitors and its result is handed straight to a client
          // component, so selecting it published every reviewer's account id to
          // anyone who opened the page. The one thing it was used for — finding
          // the viewer's own review to prefill the form — is looked up by id in
          // wave 3 instead: one row, server-side, and only when signed in.
          .select("id, customer_name, rating, comment, reply, reply_at")
          .eq("store_id", id)
          .order("created_at", { ascending: false })
          .then((r) => (r.data ?? []) as Review[]),
        // Certificates & licenses (public, non-rejected). The "verified" badge
        // shows only if at least one document is admin-verified.
        supabase
          .from("store_verifications")
          .select(
            // doc_url is deliberately not selected: the scanned document is for
            // the admin review queue, not the storefront. Leaving it out of the
            // query means it never reaches the browser at all, rather than
            // being fetched and then simply not drawn.
            "id, kind, title, issuer, number, issued_on, expires_on, verify_url, status",
          )
          .eq("store_id", id)
          .neq("status", "rejected")
          .order("created_at", { ascending: false })
          .then((r) => (r.data ?? []) as StoreVerification[]),
        supabase
          .from("store_modules")
          .select("module_key, enabled")
          .eq("store_id", id)
          .then(
            (r) =>
              (r.data ?? []) as { module_key: string; enabled: boolean }[],
          ),
      ])
    : [
        [] as Review[],
        [] as StoreVerification[],
        [] as { module_key: string; enabled: boolean }[],
      ];
  const hasVerified = verifications.some((v) => v.status === "verified");

  // Which feature modules this store has switched on (sector defaults overlaid
  // with per-store overrides) — public sections render only for enabled ones.
  const modOverrides: Record<string, boolean> = {};
  for (const r of modRowsData) modOverrides[r.module_key] = r.enabled;
  const enabledModules = resolveStoreModules(store.category, modOverrides);

  // Single source of truth for which transaction surface this storefront shows,
  // derived from the enabled modules + sector operational status (never from a
  // hardcoded slug list). See src/lib/store-experience.ts. Resolved here rather
  // than at render time because it is a pure function of data already in hand,
  // and Wave 2 below needs it to decide what is worth fetching.
  const experience = resolveStoreExperience({
    category: store.category,
    enabledModules,
  });

  // Wave 2 — module-gated public sections. Independent of each other, so run in
  // parallel; each resolves to [] when its module is off (or the store is demo).
  const [
    resources,
    membershipPlans,
    classes,
    portfolio,
    courses,
    ticketTypes,
    rentalVehicles,
  ] = await Promise.all([
      // Bookable resources (courts/rooms/rental items) for time-slot sectors.
      realStore && enabledModules.has("timeslot")
        ? supabase
            .from("store_resources")
            .select("id, name, name_en, price, open_hour, close_hour")
            .eq("store_id", id)
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .then((r) => (r.data ?? []) as Resource[])
        : Promise.resolve([] as Resource[]),
      // Membership / subscription plans for gym/club/school sectors.
      realStore && enabledModules.has("memberships")
        ? supabase
            .from("store_membership_plans")
            .select("id, name, name_en, price, period, description")
            .eq("store_id", id)
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .then((r) => (r.data ?? []) as MembershipPlan[])
        : Promise.resolve([] as MembershipPlan[]),
      // Weekly group classes (gym sessions, group courses) for capacity booking.
      realStore && enabledModules.has("classes")
        ? supabase
            .from("store_classes")
            .select("id, name, name_en, description, day_of_week, start_time, capacity, price")
            .eq("store_id", id)
            .eq("active", true)
            .order("day_of_week", { ascending: true })
            .order("start_time", { ascending: true })
            .then((r) => (r.data ?? []) as ClassRow[])
        : Promise.resolve([] as ClassRow[]),
      // Portfolio gallery (services & contractors).
      realStore && enabledModules.has("portfolio")
        ? supabase
            .from("store_portfolio")
            .select("id, title, title_en, description, image_url, link")
            .eq("store_id", id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
            .then((r) => (r.data ?? []) as PortfolioItem[])
        : Promise.resolve([] as PortfolioItem[]),
      // Courses catalogue (education).
      realStore && enabledModules.has("courses")
        ? supabase
            .from("store_courses")
            .select("id, name, name_en, description, price, duration, schedule, level")
            .eq("store_id", id)
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .then((r) => (r.data ?? []) as CourseRow[])
        : Promise.resolve([] as CourseRow[]),
      // Event ticket types. Fetched only to know whether the tickets section has
      // anything at all: EventTickets loads its own rows on the client and
      // returns null when there are none, so without this count the section tab
      // would be a chip that scrolls to an empty page.
      realStore && experience.showTickets
        ? supabase
            .from("event_ticket_types")
            .select("id", { count: "exact", head: true })
            .eq("store_id", id)
            .eq("active", true)
            .then((r) => r.count ?? 0)
        : Promise.resolve(0),
      // Rental fleet size (0298), for the same reason as the ticket count:
      // RentalSearch finds its own vehicles on the client, so a store that has
      // enabled the sector but not yet added a car would otherwise get a "Rent
      // a car" tab that scrolls to a search box with nothing behind it.
      realStore && experience.showRental
        ? supabase
            .from("rental_vehicles")
            .select("id", { count: "exact", head: true })
            .eq("store_id", id)
            .eq("active", true)
            .then((r) => r.count ?? 0)
        : Promise.resolve(0),
    ]);

  let doctors: DoctorView[] = [];
  // providerServices: productId -> the provider ids that offer that service.
  // Empty entry (or absent) = any provider can deliver it.
  const providerServices: Record<string, string[]> = {};
  // The same link read the other way round — doctor id -> the service names
  // that provider delivers — so the public roster can say what each person
  // actually does instead of only who they are. Stays empty when the merchant
  // recorded no per-provider restriction, and the roster then claims nothing.
  const servicesByDoctor: Record<string, string[]> = {};
  // Resolved modules, not sector defaults: a store that switched `team` off has
  // no roster to fetch, and one that switched it on does.
  if (
    store.isReal &&
    UUID_RE.test(id) &&
    sectorHasTeam(store.category, enabledModules)
  ) {
    const { data } = await supabase
      .from("doctors")
      .select("id, name, specialty, photo_url, bio")
      .eq("store_id", id)
      .order("sort_order", { ascending: true });
    doctors = (data ?? []) as DoctorView[];
    if (doctors.length > 0) {
      const { data: sp } = await supabase
        .from("service_providers")
        .select("product_id, doctor_id")
        .eq("store_id", id);
      const productName = new Map(
        store.products.filter((p) => p.id).map((p) => [p.id as string, p.name]),
      );
      for (const row of (sp ?? []) as {
        product_id: string;
        doctor_id: string;
      }[]) {
        (providerServices[row.product_id] ??= []).push(row.doctor_id);
        const name = productName.get(row.product_id);
        if (name) (servicesByDoctor[row.doctor_id] ??= []).push(name);
      }
    }
  }

  // Wave 3 — follow state + exchange rate + fulfilled count + the viewer's own
  // review (all independent, all per-user).
  const [isFollowing, lbpRate, ordersFulfilled, myReview] = await Promise.all([
    user && realStore
      ? supabase
          .from("follows")
          .select("store_id")
          .eq("user_id", user.id)
          .eq("store_id", id)
          .maybeSingle()
          .then((r) => !!r.data)
      : Promise.resolve(false),
    getUsdLbpRate(),
    realStore
      ? supabase
          .rpc("store_fulfilled_count", { p_store_id: id })
          .then((r) => (r.data as number | null) ?? 0)
      : Promise.resolve(0),
    // MP-010: the ONE review the viewer is allowed to know the owner of — their
    // own — asked for by their own id, instead of shipping every reviewer's id
    // to the browser and searching there. `reviews` is unique on (store_id,
    // customer_id), so this is at most one row. A signed-out visitor asks
    // nothing: no round trip, and no reference to customer_id anywhere on the
    // anonymous path.
    user && realStore
      ? supabase
          .from("reviews")
          .select("rating, comment")
          .eq("store_id", id)
          .eq("customer_id", user.id)
          .maybeSingle()
          .then((r) => (r.data as MyReview | null) ?? null)
      : Promise.resolve(null),
  ]);
  const avg = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : null;
  const headerRating = store.isReal ? avg : (store.rating ?? null);
  const headerCount = store.isReal ? reviews.length : (store.reviews ?? 0);
  // Prefill the booking contact from the customer's profile (phone) so they
  // don't retype it, and so the merchant always gets a real name + number.
  let profilePhone = "";
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .maybeSingle();
    profilePhone = (prof as { phone: string | null } | null)?.phone ?? "";
  }
  const currentUser = user
    ? {
        id: user.id,
        name:
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          "",
        phone: profilePhone,
      }
    : null;

  // Prefill checkout from the customer saved addresses (default first) — the
  // same reading the product page uses, so the saved-address picker is not a
  // property of which page you started from.
  const checkoutViewer = await getCheckoutViewer(
    supabase,
    user?.id ?? null,
    lang,
  );

  // What this store's checkout offers — delivery zones (0172), the merchant's
  // custom fields (0180), branches, the minimum, the loyalty rate. Read through
  // the one function the product page also calls, so the two order surfaces
  // cannot be handed different checkouts (MJ-024). `zones` is lifted out
  // because the fulfilment panel above the catalogue states them too.
  const checkoutCtx =
    store.isReal && UUID_RE.test(id)
      ? await getStoreCheckoutContext(id)
      : null;
  const zones = checkoutCtx?.zones ?? [];

  // Delivery options this store offers via partner couriers.
  let couriers: CourierOption[] = [];
  if (store.isReal && UUID_RE.test(id)) {
    const { data: courierRows } = await supabase
      .from("store_couriers")
      .select("price, delivery_companies(name)")
      .eq("store_id", id);
    couriers = ((courierRows ?? []) as unknown as {
      price: number | null;
      delivery_companies: { name: string } | null;
    }[])
      .filter((r) => r.delivery_companies)
      .map((r) => ({ price: r.price, name: r.delivery_companies!.name }));
  }

  // Physical branches. Multi-location stores show them publicly and let the
  // customer pick one at checkout; the primary branch always sorts first.
  type BranchView = {
    id: string;
    name: string | null;
    address: string | null;
    area: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
    is_primary: boolean;
  };
  let branches: BranchView[] = [];
  if (store.isReal && UUID_RE.test(id)) {
    const { data: locs } = await supabase
      .from("store_locations")
      .select("id, name, address, area, phone, lat, lng, is_primary")
      .eq("store_id", id)
      .eq("is_active", true)
      .order("is_primary", { ascending: false });
    branches = (locs ?? []) as BranchView[];
  }

  // Map pins: the store's own precise location (set via the pin picker) plus any
  // branch coordinates. Empty → no map section.
  const mapPins: MapStore[] = [];
  if (store.lat != null && store.lng != null)
    mapPins.push({ id, name: store.name, lat: store.lat, lng: store.lng });
  for (const b of branches)
    if (b.lat != null && b.lng != null)
      mapPins.push({
        id,
        name: store.name,
        branch: b.name || b.area,
        lat: b.lat,
        lng: b.lng,
      });

  // The checkout, complete: the store's own capabilities plus this customer's
  // point balance (0107 — only read when the merchant opted in). Null when the
  // store cannot be ordered from at all, in which case no order surface renders.
  const checkout = checkoutCtx
    ? await withLoyaltyBalance(checkoutCtx, supabase, !!user)
    : null;

  const Icon = categoryIcons[store.category];
  const style = categoryStyles[store.category];
  // One clock read per request: the header badge, the hours grid and the
  // "today" highlight must not disagree about which day it is.
  const renderedAt = new Date();
  const weekHours = parseHours(store.hours);
  // Theme = defaults; the merchant's own accent color / layout always win.
  const sf = resolveTheme(store);
  const sectionTitle =
    store.category === "food"
      ? dict.store.menu
      : store.category === "services" || store.category === "healthcare"
        ? dict.store.services
        : store.category === "realEstate" || store.category === "automotive"
          ? dict.store.listings
          : dict.store.products;

  // Every public section, keyed — composition lives in the sector registry
  // (resolveProfileOrder) instead of in the shape of this JSX. A clinic can lead
  // with its doctors and a salon with its portfolio without either page forking;
  // whether a section appears at all is still decided by its own condition here.
  const sections: Partial<Record<ProfileSectionKey, React.ReactNode>> = {
    announcement: store.isReal && store.announcement && (
      <div className="sf-announce bg-primary text-primary-foreground">
        <Container>
          <p className="sf-announce-p flex items-center justify-center gap-2 py-2.5 text-center text-sm font-bold">
            <Megaphone className="h-4 w-4 shrink-0" />
            <span>{store.announcement}</span>
          </p>
        </Container>
      </div>
    ),

    hero: (
      <StoreHero
        store={store}
        Icon={Icon}
        style={style}
        dict={dict}
        lang={lang}
        variant={sf.hero}
      />
    ),

    header: (
      <StoreHeader
        store={store}
        id={id}
        Icon={Icon}
        style={style}
        dict={dict}
        lang={lang}
        hasVerified={hasVerified}
        headerRating={headerRating}
        headerCount={headerCount}
        ordersFulfilled={ordersFulfilled}
        isFollowing={isFollowing}
      />
    ),

    branches: branches.length > 1 && (
      <StoreBranches branches={branches} dict={dict} />
    ),

    // "Can I get this, and on what terms" — the delivery/pickup modes, the
    // minimum, the prep window, the payment note, the zones and the courier
    // partners, in one block instead of a courier chip strip that said nothing
    // about any of the rest. Gated on `orders`, so sectors that never sell a
    // basket (a clinic) never see it, and the component itself returns null
    // when the merchant recorded nothing.
    delivery: store.isReal && enabledModules.has("orders") && (
      <StoreFulfillment
        acceptsDelivery={store.acceptsDelivery ?? true}
        acceptsPickup={store.acceptsPickup ?? true}
        minOrder={store.minOrder ?? null}
        prepTime={store.prepTime ?? null}
        paymentNote={store.paymentNote ?? null}
        returnPolicy={store.returnPolicy ?? null}
        policiesHref={UUID_RE.test(id) ? `/${lang}/store/${id}/policies` : null}
        zones={zones}
        couriers={couriers}
        dict={dict}
        lang={lang}
      />
    ),

    // The full week. The header badge answers "open right now"; only this
    // answers "can I come on Saturday". Absent for any store that never
    // configured the grid — parseHours returns null and nothing renders.
    hours: weekHours != null && (
      <StoreHours hours={weekHours} now={renderedAt} dict={dict} />
    ),

    location: mapPins.length > 0 && enabledModules.has("location") && (
      <div className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 font-bold">
          <MapPin className="h-5 w-5 text-primary" />
          {dict.merchant.mapLocation}
        </h2>
        <StoreMapClient stores={mapPins} lang={lang} heightClass="h-72" />
      </div>
    ),

    serviceRequest: store.isReal && experience.showServiceRequest && (
      <div className="mt-10">
        <ServiceRequestForm
          storeId={id}
          lang={lang}
          dict={dict}
          examples={store.products
            .filter((p) => p.itemKind === "service")
            .map((p) => p.name)}
        />
      </div>
    ),

    leadForm: store.isReal && experience.showLeadForm && (
      <div className="mt-10">
        <LeadForm
          storeId={id}
          lang={lang}
          dict={dict}
          kinds={leadKinds(store.category)}
        />
      </div>
    ),

    stay: store.isReal && experience.showStay && (
      <div className="mt-10">
        <StaySearch storeId={id} lang={lang} dict={dict} />
      </div>
    ),

    rental: store.isReal && experience.showRental && rentalVehicles > 0 && (
      <div className="mt-10">
        <RentalSearch storeId={id} lang={lang} dict={dict} />
      </div>
    ),

    tickets: store.isReal && experience.showTickets && (
      <div className="mt-10">
        <EventTickets storeId={id} lang={lang} dict={dict} />
      </div>
    ),

    resources: resources.length > 0 && experience.allowResourceBooking && (
      <TimeslotBooking
        storeId={id}
        lang={lang}
        dict={dict}
        resources={resources}
        customerName={currentUser?.name ?? null}
        customerPhone={currentUser?.phone ?? null}
      />
    ),

    memberships: membershipPlans.length > 0 && (
      <StoreMemberships
        plans={membershipPlans}
        dict={dict}
        lang={lang}
        whatsapp={store.whatsapp ?? null}
      />
    ),

    classes: classes.length > 0 && experience.allowResourceBooking && (
      <ClassesBooking
        storeId={id}
        lang={lang}
        dict={dict}
        classes={classes}
        customerName={currentUser?.name ?? null}
        customerPhone={currentUser?.phone ?? null}
      />
    ),

    reservations: store.isReal && enabledModules.has("reservations") && (
      <ReservationForm storeId={id} lang={lang} dict={dict} />
    ),

    courses: courses.length > 0 && (
      <StoreCourses courses={courses} dict={dict} lang={lang} whatsapp={store.whatsapp ?? null} />
    ),

    portfolio: portfolio.length > 0 && (
      <StorePortfolio items={portfolio} dict={dict} lang={lang} />
    ),

    catalog: (
      <StoreProductsSection
        sectionTitle={sectionTitle}
        store={store}
        id={id}
        lang={lang}
        dict={dict}
        surface={experience.itemSurface}
        canOrderProducts={experience.canOrderProducts}
        initialServiceId={initialServiceId}
        directoryOnly={experience.directoryOnly}
        doctors={doctors}
        providerServices={providerServices}
        currentUser={currentUser}
        checkout={checkout}
        viewer={checkoutViewer}
        lbpRate={lbpRate}
        Icon={Icon}
        style={style}
        initialBrand={initialBrand}
        layout={sf.layout}
      />
    ),

    // The sector test stays with the section, not with the render sequence:
    // ordering is the only place composition is allowed to branch on category.
    // What is worth SAYING is decided inside the component, from the store's
    // own data — it returns null when the clinic filled in none of it.
    healthcareInfo: store.category === "healthcare" && (
      <StoreHealthcareInfo
        store={store}
        services={store.products.filter((p) => p.itemKind === "service")}
        cancelHours={store.bookingCancelHours ?? 0}
        canBook={experience.showBooking}
        dict={dict}
      />
    ),

    doctors: (
      <StoreDoctors
        doctors={doctors}
        category={store.category}
        servicesByDoctor={servicesByDoctor}
        dict={dict}
      />
    ),

    verifications: store.isReal && enabledModules.has("verifications") && (
      <StoreVerifications
        verifications={verifications}
        dict={dict}
        lang={lang}
      />
    ),

    reviews: store.isReal && (
      <StoreReviews
        storeId={id}
        lang={lang}
        dict={dict}
        reviews={reviews}
        currentUser={currentUser}
        myReview={myReview}
      />
    ),
  };

  // ===== Which sections actually have something in them =====
  //
  // `sections[key]` being truthy is NOT the same as the section having content:
  // several of these components decide for themselves and return null (an empty
  // doctor roster, a clinic that filled in no facts, a shop with no fulfilment
  // terms recorded). The mobile tab rail below is derived from this map, so a
  // wrong entry here is a chip that scrolls to nothing — the one failure the
  // rail must not have. Each line mirrors the component's own null test.
  const services = store.products.filter((p) => p.itemKind === "service");
  const goods = store.products.filter((p) => p.itemKind !== "service");
  // The list StoreProductsSection gates its own empty state on.
  const catalogPrimary =
    experience.itemSurface === "appointment" ? services : goods;
  const catalogGoodsCart =
    experience.itemSurface === "appointment" &&
    experience.canOrderProducts &&
    goods.length > 0;

  const present: Partial<Record<ProfileSectionKey, boolean>> = {
    branches: branches.length > 1,
    // StoreFulfillment returns null when the merchant recorded no mode, no
    // fact, no zone and no courier.
    delivery:
      store.isReal &&
      enabledModules.has("orders") &&
      ((store.acceptsDelivery ?? true) ||
        (store.acceptsPickup ?? true) ||
        (store.minOrder ?? 0) > 0 ||
        !!store.prepTime ||
        !!store.paymentNote ||
        zones.length > 0 ||
        couriers.length > 0),
    location: mapPins.length > 0 && enabledModules.has("location"),
    hours: weekHours != null,
    serviceRequest: store.isReal && experience.showServiceRequest,
    leadForm: store.isReal && experience.showLeadForm,
    stay: store.isReal && experience.showStay,
    // Same server-side count as tickets: no fleet, no tab.
    rental: store.isReal && experience.showRental && rentalVehicles > 0,
    // EventTickets loads its rows on the client and renders nothing when a
    // store has none — hence the server-side count in wave 2.
    tickets: store.isReal && experience.showTickets && ticketTypes > 0,
    resources: resources.length > 0 && experience.allowResourceBooking,
    memberships: membershipPlans.length > 0,
    classes: classes.length > 0 && experience.allowResourceBooking,
    reservations: store.isReal && enabledModules.has("reservations"),
    courses: courses.length > 0,
    portfolio: portfolio.length > 0,
    catalog: store.isReal && (catalogPrimary.length > 0 || catalogGoodsCart),
    healthcareInfo:
      store.category === "healthcare" &&
      (!!store.specialties ||
        !!store.insurance ||
        (store.bookingCancelHours ?? 0) > 0 ||
        services.some((s) => s.price > 0) ||
        services.some(
          (s) =>
            (s.durationMinutes ?? 0) > 0 ||
            Number(s.attributes?.duration ?? NaN) > 0,
        )),
    doctors: doctors.length > 0,
    verifications:
      store.isReal && enabledModules.has("verifications") && verifications.length > 0,
    // Always a real section on a live store: it carries the review form and its
    // own empty state, which is a thing to do rather than an empty shell.
    reviews: store.isReal,
  };

  // announcement and hero are full-bleed — their backgrounds run to the viewport
  // edge, so they render outside <Container> as they always have. Both lead every
  // sector's order, so pulling them out of the mapped list changes nothing about
  // the sequence the customer sees; everything from `header` down is ordered.
  const order = resolveProfileOrder(store.category);
  const contained = order.filter(
    (key) => key !== "announcement" && key !== "hero",
  );

  // ===== Mobile section tabs =====
  // Derived, never written: the sector registry's own order, filtered by the
  // map above. `header` is the page's identity block, not a destination, so it
  // is the only contained key excluded by name.
  const tabLabels = dict.store.tabs as unknown as Record<string, string>;
  const sectionTabs: StoreSectionTab[] = contained
    .filter((key) => key !== "header" && present[key])
    .map((key) => ({
      key,
      // Both overrides exist for the same reason: a chip must say what the
      // section it scrolls to says. The catalogue's chip reuses the heading the
      // page already renders (المنيو / الخدمات / العروض / المنتجات) instead of a
      // second vocabulary, and the roster's chip takes the sector's own word so
      // it does not read الفريق above a heading that says فريق الصالون.
      label:
        key === "catalog"
          ? sectionTitle
          : key === "doctors"
            ? dict.os.team[sectorTeamMeta(store.category).labelKey]
            : tabLabels[key],
    }))
    .filter((t) => !!t.label);

  // ===== Mobile sticky CTA =====
  // The LABEL comes from the same resolver the offering page uses, so a clinic
  // says احجز, a restaurant اطلب and a shop أضف إلى السلة — one vocabulary
  // across both surfaces. It is rendered only where the page can actually
  // transact: `resolveOffering().transacts` for the cart path, and for the
  // booking path the equivalent test — that resolver reports `transacts: false`
  // for an appointment because the OFFERING page cannot book and hands off to
  // this one; here the booking engine IS the page, so what has to be true is
  // that it rendered with something in it.
  const storeOffering = resolveOffering({
    category: store.category,
    itemKind: experience.itemSurface === "appointment" ? "service" : "product",
  });
  const canTransactHere =
    experience.itemSurface === "appointment"
      ? experience.showBooking && services.length > 0
      : experience.itemSurface === "order" &&
        storeOffering.transacts &&
        goods.length > 0;
  // A real "from" price or nothing — never a rounded-up guess.
  const cheapest = catalogPrimary
    .map((p) => p.discountPrice ?? p.price)
    .filter((p) => p > 0)
    .sort((a, b) => a - b)[0];
  const note =
    cheapest != null ? `${dict.store.from} ${formatUsd(cheapest)}` : null;
  // §19 names four sticky CTAs — أضف للسلة / احجز موعد / اطلب الآن / تواصل —
  // and the fourth was the one no storefront ever got. A services profile
  // (Passion Glow) leads with a request form, cannot run a cart or a calendar,
  // and so fell out of `canTransactHere` entirely: it shipped with no sticky
  // action at all, on the sector whose whole transaction IS getting in touch.
  //
  // It scrolls to the form, exactly as the other three scroll to their engine —
  // never to a phone dialler, and only when the page actually rendered a form
  // to scroll to. A store with neither an engine nor a form still gets no bar,
  // because a bar that scrolls nowhere is worse than no bar.
  // Only a number that survives waNumber() — see below.
  const contactWa = waNumber(store.whatsapp ?? store.phone ?? null);
  const contactTarget = present.serviceRequest
    ? "sec-serviceRequest"
    : present.leadForm
      ? "sec-leadForm"
      : null;
  const stickyCta =
    canTransactHere && present.catalog
      ? {
          targetId: "offerings",
          label: dict.offering.cta[storeOffering.cta],
          note,
        }
      : contactTarget
        ? {
            targetId: contactTarget,
            label: dict.offering.cta.contactStore,
            // Only if the page really did list priced items — the same
            // `cheapest`, which is a read of the catalogue, not an estimate.
            note: present.catalog ? note : null,
          }
        : // Nothing to scroll to. Four of fifteen live storefronts are in this
          // state — no catalogue, no engine, no form — and every one of them
          // has a phone and a WhatsApp number sitting in the header. They had
          // no persistent action at all, on the page where ringing the shop is
          // the only transaction there is.
          //
          // `waNumber` returns null for a number that cannot actually be
          // dialled, so a store with a malformed phone still gets no bar rather
          // than a button that fails. No target id: this one never hides,
          // because there is no on-page control for it to cover.
          contactWa
          ? {
              href: `https://wa.me/${contactWa}`,
              label: dict.offering.cta.contactStore,
              note: null,
            }
          : null;

  // ===== How payment works, above the catalogue =====
  //
  // ISS-020. The platform's single biggest trust lever was stated nowhere a
  // buyer looks before deciding — only inside the cart, after they had already
  // committed to opening it. It is now said once, immediately above the list of
  // things you can order, on exactly the stores that can take an order: the
  // same `canTransactHere` test the sticky CTA uses, so a directory-only page
  // never promises a payment method for a transaction it cannot run.
  //
  // Wording follows the surface, not the sector name — a clinic pays at the
  // desk, a shop pays the courier — and both strings are the ones their own
  // engine already uses, so there is one vocabulary rather than a second one
  // invented for a banner.
  const paymentNote =
    canTransactHere && present.catalog ? (
      <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-success/25 bg-success-soft px-4 py-3 text-success">
        <Wallet className="mt-0.5 h-4.5 w-4.5 shrink-0" />
        {experience.itemSurface === "appointment" ? (
          <p className="text-sm font-semibold leading-relaxed">
            {dict.booking.payOnArrival}
          </p>
        ) : (
          <p className="min-w-0">
            <span className="block text-sm font-bold">
              {dict.product.codTitle}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed">
              {dict.product.codBody}
            </span>
          </p>
        )}
      </div>
    ) : null;

  return (
    <div
      // Extra bottom room below lg only when the sticky CTA is there to cover
      // it — the tab bar's own clearance is already in the site layout.
      className={stickyCta ? "pb-32 lg:pb-16" : "pb-16"}
      data-sf={sf.key}
      style={accentStyle(sf.accent) as React.CSSProperties | undefined}
    >
      {store.isReal && UUID_RE.test(id) && (
        <TrackVisit storeId={id} path="store" />
      )}
      {store.isReal && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              storeJsonLd({
                name: store.name,
                description: store.description,
                image: store.logoUrl ?? store.coverUrl,
                url: `${SITE_URL}/${lang}/store/${id}`,
                telephone: store.whatsapp ?? store.phone,
                area: store.area,
                lat: branches[0]?.lat ?? null,
                lng: branches[0]?.lng ?? null,
                openingHours: toOpeningHours(
                  parseHours(store.hours) as unknown as Record<
                    string,
                    { open: string; close: string }
                  > | null,
                ),
                rating: headerRating,
                reviewCount: headerCount,
              }),
            ),
          }}
        />
      )}
      {sections.announcement}
      {sections.hero}

      <Container>
        {contained.map((key) => {
          const node = sections[key];
          if (!node) return null;
          // Only sections the rail can actually reach get an anchor + a scroll
          // margin; everything else renders exactly as it did, in a Fragment
          // that adds no box and no margin of its own.
          if (!present[key] || key === "header")
            return <Fragment key={key}>{node}</Fragment>;
          return (
            <Fragment key={key}>
              {/* The rail is emitted after the identity block, so it starts
                  sticking the moment the customer scrolls past the name. */}
              {sectionTabs[0]?.key === key && (
                <StoreSectionTabs
                  tabs={sectionTabs}
                  label={dict.store.tabsLabel}
                />
              )}
              {/* Inside the anchor's scroll target would put it above the
                  heading the tab chip promises; outside and immediately before
                  it keeps the chip landing on the catalogue while the buyer
                  still reads the payment line on the way down. */}
              {key === "catalog" && paymentNote}
              <div
                id={`sec-${key}`}
                className="scroll-mt-[calc(var(--m-header-h)+var(--m-sectiontabs-h)+env(safe-area-inset-top))] lg:scroll-mt-20"
              >
                {node}
              </div>
            </Fragment>
          );
        })}

        {/* MJ-026. Last thing on the page, the way a report control should be:
            findable when something is wrong, invisible while nothing is. Only
            on a real store — a demo row has no one to report. */}
        {store.isReal && UUID_RE.test(id) && (
          <div className="mt-10 border-t border-border pt-5">
            <ContentReport
              entityType="store"
              entityId={id}
              lang={lang}
              dict={dict}
            />
          </div>
        )}
      </Container>

      {stickyCta && (
        <StoreStickyCta
          targetId={stickyCta.targetId}
          label={stickyCta.label}
          note={stickyCta.note}
        />
      )}
    </div>
  );
}
