import type { CategoryKey } from "./catalog";
import type { FeatureModuleKey } from "./modules-catalog";
import { categoryModule } from "./modules";

// ===== Store Experience Resolver =====
// The single source of truth for WHAT transaction surface a storefront shows.
// Historically the public store page decided this from hardcoded slug lists
// (`bookingCategories = {services, healthcare, realEstate}`) that disagreed with
// the sector registry — so sectors that declared an `appointments`/`requests`
// module never surfaced it, and sectors whose correct engine does not exist yet
// (hotels, real estate, car sales, event tickets) exposed a wrong flow (a hotel
// booked by the hour, a car sold via cart). This resolver derives the surface
// from the ENABLED MODULES + an explicit sector operational status, never from
// raw slugs, so the two can never drift again.
//
// It is intentionally a pure function (no I/O) so it is unit-testable and can be
// reused by the public store page, the product detail page, and future surfaces.

export type SectorStatus = "active" | "directory_only";

/** What the store's main items list renders as. */
export type ItemSurface =
  | "order" // cart → order (retail/food/pharmacy/farm)
  | "appointment" // BookingPanel appointment engine (clinic/salon/vet/pro)
  | "catalog"; // non-transactional list + contact (directory-only / service listings)

// Sectors whose correct transaction engine is NOT built yet. Until it is, they
// run in directory-only mode: browse + contact, never a wrong transaction.
// - hospitality: needs a date-range STAY engine (currently only hourly slots).
// - realEstate: needs a LEAD/viewing flow (currently a clinic-style appointment).
// - automotive: needed LISTING + LEAD (was sold via cart + COD).
// - events: needs TICKETING / venue date booking (currently hourly slots).
// Removing a sector from this set is a deliberate go-live decision made once its
// engine ships (see the vertical audit, files 06/12/13/15).
//
// AUTOMOTIVE LEFT THIS SET IN MJ-003, and the argument is worth writing down
// because the set is where honesty about unbuilt engines is kept.
//
// It was held here for one reason: the only transaction the platform could
// offer a car business was a cart and cash on delivery, and "add a Kia to your
// basket" is worse than no transaction at all. Migration 0298 ships the engine
// that was missing — a vehicle, a day range, a per-day price, and a btree_gist
// exclusion constraint that makes two people holding the same car on the same
// weekend impossible at the storage layer. A sector with a working transaction
// is not a directory, so keeping it here would now be the false statement.
//
// What did NOT change with it: automotive still has no CART. Renting a car and
// selling one are different transactions, and only the first one exists. So
// `canOrderProducts` stays false and isOrderSurface() still refuses automotive
// — buying is still a LEAD (test drive / offer), which is what the lead form
// (0190) is for. Half a sector going live is the accurate description, and it
// is stated in the branch below rather than implied by which set a slug is in.
const DIRECTORY_ONLY_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "realEstate",
]);

// Sectors that book a date-range STAY (accommodation engine, migration 0191).
const STAY_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "hospitality",
]);

// Sectors that rent a unit over a date RANGE (rental engine, migration 0298).
// The same shape as a stay — a unit, a range, a price per period, an absolute
// prohibition on two people holding it at once — deliberately built on the same
// structure rather than as a second, subtly different date-range booker.
const RENTAL_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "automotive",
]);

// Sectors that sell event TICKETS (ticketing engine, migration 0193).
const TICKET_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "events",
]);

// Sectors whose correct model is capturing a LEAD (inquiry / viewing / test
// drive / offer) — high-consideration listings, not a cart or an appointment.
// These get an on-platform lead form (CP3, migration 0190) instead of only a
// WhatsApp hand-off.
const LEAD_SECTORS: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  "realEstate",
  "automotive",
]);

/** The lead kinds a sector's inquiry form should offer (first = default). */
export function leadKinds(category: CategoryKey): string[] {
  if (category === "realEstate") return ["viewing", "contact", "offer"];
  if (category === "automotive") return ["test_drive", "contact", "offer"];
  return ["contact"];
}

export type StoreExperience = {
  status: SectorStatus;
  /** The surface for items that carry no explicit kind — and the section's
   *  default framing. Items are now split by `products.item_kind`, so a store
   *  can render a booking panel AND a cart at the same time; this stays as the
   *  fallback and as the label chooser. */
  itemSurface: ItemSurface;
  /** Appointment booking engine (BookingPanel) should surface. */
  showBooking: boolean;
  /** Physical goods (item_kind = 'product') may be sold via the cart.
   *  True for every sector that transacts at all — a vet sells pet food, a
   *  salon sells hair products, a clinic sells supplements. Before item_kind
   *  existed this was impossible: enabling appointments turned every row into a
   *  bookable service and the cart vanished. */
  canOrderProducts: boolean;
  /** Service-request / quote form should surface. */
  showServiceRequest: boolean;
  /** Lead / inquiry capture form should surface (real estate, automotive). */
  showLeadForm: boolean;
  /** Date-range accommodation search + booking should surface (hospitality). */
  showStay: boolean;
  /** Date-range vehicle rental search + booking should surface (automotive). */
  showRental: boolean;
  /** Event ticket purchase should surface (events). */
  showTickets: boolean;
  /** Resource (hourly) / class / reservation booking may surface (still gated
   *  on seeded rows by the caller). False in directory-only mode so a hotel or
   *  event hall never exposes an hourly booking. */
  allowResourceBooking: boolean;
  /** Directory-only: show a contact CTA instead of a transaction. */
  directoryOnly: boolean;
  /** Display only (0338, stores.listing_mode = 'showcase'): prices show, the
   *  action is contact. Nothing on the page may take an order or a booking —
   *  the database refuses them with `store_showcase_only` anyway. */
  showcase: boolean;
  /** No owner yet (0338, stores.owner_id IS NULL): a directory listing nobody
   *  is reading. Forms that write to the store (lead, request, review, message)
   *  have nowhere to go — the database refuses them with `store_unclaimed`. */
  unclaimed: boolean;
};

/** Whether a sector is held in directory-only mode (engine not ready). */
export function isDirectoryOnlySector(category: CategoryKey): boolean {
  return DIRECTORY_ONLY_SECTORS.has(category);
}

/** Whether the product detail page should show the add-to-cart order box.
 *  True only for commerce sectors that are NOT directory-only and do not
 *  transact through an engine of their own.
 *
 *  Automotive is the reason for the second clause. It is a `commerce` module
 *  kind and it is no longer directory-only, but a car is still not a thing you
 *  put in a basket: it is RENTED through the engine in 0298 or ENQUIRED about
 *  through the lead form. Before this clause existed, taking automotive out of
 *  DIRECTORY_ONLY_SECTORS would have handed every car listing an add-to-cart
 *  button as a side effect — exactly the wrong flow the directory-only hold was
 *  put there to prevent. */
export function isOrderSurface(category: CategoryKey): boolean {
  return (
    (categoryModule[category]?.kind ?? "commerce") === "commerce" &&
    !DIRECTORY_ONLY_SECTORS.has(category) &&
    !RENTAL_SECTORS.has(category)
  );
}

/** How a store chose to appear (stores.listing_mode). "full" is the default. */
export type ListingMode = "full" | "showcase";

/** A store-level choice that outranks the sector: whatever the sector could do,
 *  a showcase store displays and is contacted. An unowned store is always a
 *  showcase — 0338's `stores_unowned_is_showcase` constraint says the same.
 *  The merchant's enquiry forms survive only while somebody owns the store. */
function showcaseExperience(
  category: CategoryKey,
  enabledModules: ReadonlySet<FeatureModuleKey>,
  unclaimed: boolean,
): StoreExperience {
  const isLead = LEAD_SECTORS.has(category);
  const directoryOnly = DIRECTORY_ONLY_SECTORS.has(category);
  return {
    status: directoryOnly ? "directory_only" : "active",
    itemSurface: "catalog",
    showBooking: false,
    canOrderProducts: false,
    showServiceRequest:
      !unclaimed && enabledModules.has("requests") && !isLead,
    showLeadForm: !unclaimed && isLead,
    showStay: false,
    showRental: false,
    showTickets: false,
    allowResourceBooking: false,
    directoryOnly,
    showcase: true,
    unclaimed,
  };
}

export function resolveStoreExperience(args: {
  category: CategoryKey;
  enabledModules: ReadonlySet<FeatureModuleKey>;
  /** Defaults to "full". */
  listingMode?: ListingMode;
  /** stores.owner_id IS NULL. Implies a showcase, whatever listingMode says. */
  unclaimed?: boolean;
}): StoreExperience {
  const { category, enabledModules } = args;
  const unclaimed = args.unclaimed === true;
  if (unclaimed || args.listingMode === "showcase") {
    return showcaseExperience(category, enabledModules, unclaimed);
  }
  const kind = categoryModule[category]?.kind ?? "commerce";
  const hasAppointments = enabledModules.has("appointments");
  const hasRequests = enabledModules.has("requests");

  if (STAY_SECTORS.has(category)) {
    return {
      status: "active",
      itemSurface: "catalog",
      showBooking: false,
      showServiceRequest: false,
      showLeadForm: false,
      showStay: true,
      showRental: false,
      canOrderProducts: true,
      showTickets: false,
      allowResourceBooking: false, // uses the stay engine, not hourly slots
      directoryOnly: false,
      showcase: false,
      unclaimed: false,
    };
  }

  if (RENTAL_SECTORS.has(category)) {
    return {
      status: "active",
      itemSurface: "catalog",
      showBooking: false,
      // One inquiry channel, not two. The lead form is where "I want to buy
      // this car" goes; the generic service-request form would split the same
      // conversation across two merchant inboxes (the reason it was suppressed
      // for lead sectors in the first place).
      showServiceRequest: false,
      showLeadForm: LEAD_SECTORS.has(category),
      showStay: false,
      showRental: true,
      // No cart. Renting a car is built; SELLING one is not, and a car sold
      // through a basket with cash on delivery is the flow this sector was
      // held in directory-only mode to avoid. Buying stays a lead until a
      // vehicle-sale engine exists.
      canOrderProducts: false,
      showTickets: false,
      // Rentals run on the day-range engine (0298), never on hourly slots.
      allowResourceBooking: false,
      directoryOnly: false,
      showcase: false,
      unclaimed: false,
    };
  }

  if (TICKET_SECTORS.has(category)) {
    return {
      status: "active",
      itemSurface: "catalog",
      showBooking: false,
      showServiceRequest: false,
      showLeadForm: false,
      showStay: false,
      showRental: false,
      showTickets: true,
      canOrderProducts: true,
      allowResourceBooking: false, // ticketing, not hourly slots
      directoryOnly: false,
      showcase: false,
      unclaimed: false,
    };
  }

  if (DIRECTORY_ONLY_SECTORS.has(category)) {
    return {
      status: "directory_only",
      itemSurface: "catalog",
      showBooking: false,
      // Lead sectors (automotive/realEstate) use the LEAD form as their single
      // inquiry channel — don't also show the generic service-request form (that
      // split car inquiries across two merchant inboxes). Non-lead directory-only
      // sectors may still surface `requests` as their inquiry channel.
      showServiceRequest: hasRequests && !LEAD_SECTORS.has(category),
      showLeadForm: LEAD_SECTORS.has(category),
      canOrderProducts: false,
      showStay: false,
      showRental: false,
      showTickets: false,
      allowResourceBooking: false,
      directoryOnly: true,
      showcase: false,
      unclaimed: false,
    };
  }

  // Active: derive the surface from the enabled modules, not the slug.
  const showBooking = hasAppointments;
  const itemSurface: ItemSurface = showBooking
    ? "appointment"
    : kind === "commerce"
      ? "order"
      : "catalog";

  return {
    status: "active",
    itemSurface,
    showBooking,
    showServiceRequest: hasRequests,
    showLeadForm: false,
    canOrderProducts: true,
    showStay: false,
    showRental: false,
    showTickets: false,
    allowResourceBooking: true,
    directoryOnly: false,
    showcase: false,
    unclaimed: false,
  };
}
