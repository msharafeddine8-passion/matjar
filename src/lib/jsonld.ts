// Structured-data (schema.org JSON-LD) builders. Injected as <script> tags on
// the store and product pages so Google can render rich results (business
// cards, product price/rating snippets). Pure functions — no imports.

type Nullable<T> = T | null | undefined;

/** schema.org AggregateRating, or `undefined` when there is nothing real to
 *  aggregate.
 *
 *  THE RULE (§18/§32): a rating is emitted only from reviews that exist — a
 *  count of at least one real review row and an average inside the 1..5 scale
 *  those rows were written on. No count, a zero count, a NaN, or an average
 *  outside the scale all mean "say nothing"; a fabricated or defaulted rating
 *  in structured data is a Google manual-action risk and a lie to the buyer.
 *
 *  It never claims the reviews were purchase-verified: AggregateRating has no
 *  such field, and nothing here adds one. Which rows count as "verified" is
 *  decided by the database (see audit/prelaunch-v2/09_TRUST.md). */
export function aggregateRating(
  rating: Nullable<number>,
  reviewCount: Nullable<number>,
): Record<string, unknown> | undefined {
  if (rating == null || reviewCount == null) return undefined;
  const r = Number(rating);
  const n = Number(reviewCount);
  if (!Number.isFinite(r) || !Number.isFinite(n)) return undefined;
  if (!Number.isInteger(n) || n < 1) return undefined;
  if (r < 1 || r > 5) return undefined;
  return {
    "@type": "AggregateRating",
    ratingValue: Number(r.toFixed(1)),
    reviewCount: n,
    bestRating: 5,
    worstRating: 1,
  };
}

/** The most specific schema.org LocalBusiness subtype that is TRUE for every
 *  store in a Matjar sector. Where a sector mixes kinds (a "services" store can
 *  be a tailor or a laundry) it stays LocalBusiness rather than guess — a wrong
 *  subtype is worse than a general one. Keyed by the sector slug
 *  (`business_types.slug` / CategoryKey); unknown slugs fall back to
 *  LocalBusiness. Pure, no imports, like everything else in this file. */
const SECTOR_SCHEMA_TYPE: Record<string, string> = {
  food: "FoodEstablishment",
  retail: "Store",
  healthcare: "MedicalBusiness",
  pharmacy: "Pharmacy",
  beauty: "HealthAndBeautyBusiness",
  fitness: "SportsActivityLocation",
  sportsCourts: "SportsActivityLocation",
  automotive: "AutomotiveBusiness",
  realEstate: "RealEstateAgent",
  hospitality: "LodgingBusiness",
  professional: "ProfessionalService",
  contractors: "HomeAndConstructionBusiness",
  education: "LocalBusiness",
  events: "LocalBusiness",
  petCare: "LocalBusiness",
  farm: "LocalBusiness",
  services: "LocalBusiness",
};

export function schemaTypeForSector(sector: Nullable<string>): string {
  return (sector && SECTOR_SCHEMA_TYPE[sector]) || "LocalBusiness";
}

export function storeJsonLd(opts: {
  name: string;
  description?: Nullable<string>;
  image?: Nullable<string>;
  url: string;
  telephone?: Nullable<string>;
  area?: Nullable<string>;
  region?: Nullable<string>;
  rating?: Nullable<number>;
  reviewCount?: Nullable<number>;
  lat?: Nullable<number>;
  lng?: Nullable<number>;
  priceRange?: Nullable<string>;
  /** schema.org OpeningHoursSpecification entries, pre-built by the caller. */
  openingHours?: {
    days: string[];
    opens: string;
    closes: string;
  }[];
  /** The store's sector slug (StoreView.category). Picks the LocalBusiness
   *  subtype — Restaurant-family for food, MedicalBusiness for clinics, etc.
   *  Omitted = plain LocalBusiness, which is what every store emitted before. */
  sector?: Nullable<string>;
}) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaTypeForSector(opts.sector),
    name: opts.name,
    url: opts.url,
  };
  if (opts.description) data.description = opts.description;
  if (opts.image) data.image = opts.image;
  if (opts.telephone) data.telephone = opts.telephone;
  if (opts.priceRange) data.priceRange = opts.priceRange;
  if (opts.area || opts.region) {
    data.address = {
      "@type": "PostalAddress",
      addressLocality: opts.area || undefined,
      addressRegion: opts.region || undefined,
      addressCountry: "LB",
    };
  }
  if (opts.lat != null && opts.lng != null) {
    data.geo = {
      "@type": "GeoCoordinates",
      latitude: opts.lat,
      longitude: opts.lng,
    };
  }
  if (opts.openingHours?.length) {
    data.openingHoursSpecification = opts.openingHours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    }));
  }
  const rating = aggregateRating(opts.rating, opts.reviewCount);
  if (rating) data.aggregateRating = rating;
  return data;
}

/** Maps the app's WeekHours (0=Sun..6=Sat → {open,close}) to schema.org
 *  OpeningHoursSpecification day names. Kept here so jsonld stays import-free. */
export function toOpeningHours(
  hours: Nullable<Record<string, { open: string; close: string }>>,
): { days: string[]; opens: string; closes: string }[] {
  if (!hours) return [];
  const NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const out: { days: string[]; opens: string; closes: string }[] = [];
  for (let d = 0; d < 7; d++) {
    const h = hours[String(d)];
    if (h?.open && h?.close) {
      out.push({ days: [NAMES[d]], opens: h.open, closes: h.close });
    }
  }
  return out;
}

export function productJsonLd(opts: {
  name: string;
  description?: Nullable<string>;
  image?: Nullable<string>;
  url: string;
  price: number;
  storeName?: Nullable<string>;
  /** `products.brand`, when the merchant recorded one. */
  brand?: Nullable<string>;
  available?: boolean;
  rating?: Nullable<number>;
  reviewCount?: Nullable<number>;
}) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: opts.name,
    url: opts.url,
  };
  // An Offer only for a real price. A good with no price used to be told to
  // Google as `price: 0` — a free, in-stock item the store never offered. No
  // Offer means no price snippet, which is true; a zero is not.
  if (Number.isFinite(opts.price) && opts.price > 0) {
    data.offers = {
      "@type": "Offer",
      price: opts.price,
      priceCurrency: "USD",
      availability:
        opts.available === false
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      url: opts.url,
    };
  }
  if (opts.description) data.description = opts.description;
  if (opts.image) data.image = opts.image;
  // The product's own brand when the merchant typed one (a shop reselling
  // Nivea is not the brand of it); the store's name otherwise, which is what
  // the page already presents as the seller. Same rule as the Google feed's
  // g:brand (lib/google-feed.ts), so the two never disagree about one item.
  const brand = opts.brand?.trim() || opts.storeName;
  if (brand) data.brand = { "@type": "Brand", name: brand };
  const rating = aggregateRating(opts.rating, opts.reviewCount);
  if (rating) data.aggregateRating = rating;
  return data;
}

/** One offering row, typed by what it IS rather than by the table it sits in.
 *
 *  Every row of `products` used to be emitted as a schema.org Product with an
 *  `InStock` availability and the store as its `brand` — so a clinic's أشعة
 *  told Google it was an in-stock product branded by the clinic. The noun comes
 *  from the offering resolver (src/lib/offering.ts) and picks the type:
 *
 *  - product → Product (unchanged: offer, availability, brand, rating)
 *  - service → Service, provided by the store (LocalBusiness). An Offer only
 *    when the merchant priced it; never an availability, never a brand.
 *  - dish    → MenuItem with its Offer. No availability: a kitchen runs out,
 *    it does not carry inventory.
 *
 *  Pure — the caller resolves the noun; this maps it. */
export function offeringJsonLd(opts: {
  noun: "product" | "service" | "dish";
  name: string;
  description?: Nullable<string>;
  image?: Nullable<string>;
  url: string;
  /** null/0 = the merchant entered no price (a service priced after the
   *  consultation). No Offer is emitted for it — never a placeholder 0. */
  price: number | null;
  storeName?: Nullable<string>;
  /** Goods only: `products.brand`. A service or a dish carries no brand. */
  brand?: Nullable<string>;
  /** Goods only; ignored for a service or a dish. */
  available?: boolean;
  rating?: Nullable<number>;
  reviewCount?: Nullable<number>;
}) {
  if (opts.noun === "product") {
    return productJsonLd({ ...opts, price: opts.price ?? 0 });
  }
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": opts.noun === "service" ? "Service" : "MenuItem",
    name: opts.name,
    url: opts.url,
  };
  if (opts.description) data.description = opts.description;
  if (opts.image) data.image = opts.image;
  if (opts.noun === "service" && opts.storeName) {
    data.provider = { "@type": "LocalBusiness", name: opts.storeName };
  }
  if (opts.price != null && opts.price > 0) {
    data.offers = {
      "@type": "Offer",
      price: opts.price,
      priceCurrency: "USD",
      url: opts.url,
    };
  }
  const rating = aggregateRating(opts.rating, opts.reviewCount);
  if (rating) data.aggregateRating = rating;
  return data;
}

// Google Jobs rich result: a JobPosting per /jobs/[id]. Google requires title,
// description, datePosted and hiringOrganization; jobLocation (or a TELECOMMUTE
// type for remote roles) is strongly recommended. Our `salary_note` is free text
// so it's intentionally left out of the structured baseSalary (which needs a
// numeric value/unit) — a malformed salary hurts eligibility more than omitting
// it. Maps the app's five job_type values to schema.org employmentType.
const EMPLOYMENT_TYPES: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
};

export function jobPostingJsonLd(opts: {
  title: string;
  description: string;
  datePosted: string;
  companyName: string;
  url: string;
  /** Human-readable region/area name, when known. */
  region?: Nullable<string>;
  /** Raw job_type value (full_time | part_time | contract | remote | internship). */
  jobType?: Nullable<string>;
  /** `job_postings.apply_deadline` (a date). Google recommends validThrough;
   *  omitted when the poster set no deadline — never invented. */
  validThrough?: Nullable<string>;
  /** Hiring store's public page + logo, when the posting belongs to a store. */
  companyUrl?: Nullable<string>;
  companyLogo?: Nullable<string>;
}) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: opts.title,
    description: opts.description,
    datePosted: opts.datePosted,
    hiringOrganization: {
      "@type": "Organization",
      name: opts.companyName,
      ...(opts.companyUrl ? { sameAs: opts.companyUrl } : {}),
      ...(opts.companyLogo ? { logo: opts.companyLogo } : {}),
    },
    url: opts.url,
    // Country-level location (Lebanon); region fills in as the locality.
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: "LB",
        ...(opts.region ? { addressLocality: opts.region } : {}),
      },
    },
  };
  if (opts.jobType === "remote") {
    // Remote roles: mark the location type and where applicants may be based.
    data.jobLocationType = "TELECOMMUTE";
    data.applicantLocationRequirements = {
      "@type": "Country",
      name: "Lebanon",
    };
  } else if (opts.jobType && EMPLOYMENT_TYPES[opts.jobType]) {
    data.employmentType = EMPLOYMENT_TYPES[opts.jobType];
  }
  const deadline = isoDateOrNull(opts.validThrough);
  if (deadline) {
    // A bare date means "applications close at the end of that day" in
    // Lebanon. Beirut is UTC+2/+3; stating the end of day in +03:00 keeps the
    // posting live for the whole local day in either season.
    data.validThrough = /^\d{4}-\d{2}-\d{2}$/.test(deadline)
      ? `${deadline}T23:59:59+03:00`
      : deadline;
  }
  return data;
}

function isoDateOrNull(v: Nullable<string>): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || Number.isNaN(Date.parse(s))) return null;
  return s;
}

/** Sunday Market listing (`/market/[id]`) → Product + Offer.
 *
 *  Emitted only for a listing a buyer can act on: status `active` with a real
 *  price, or `sold` (SoldOut). Draft / pending / rejected / expired listings
 *  get NOTHING — the page is noindexed for those, and an Offer for something
 *  that cannot be bought is exactly the misleading snippet the moderation
 *  work exists to prevent. No itemCondition: the form does not ask, so we do
 *  not know whether it is new or used. No rating: listings have no reviews.
 *  A merchant's listing names the store as seller; a private seller is never
 *  named (their identity is not public on the page either). */
export function listingJsonLd(opts: {
  name: string;
  description?: Nullable<string>;
  image?: Nullable<string>;
  url: string;
  price: Nullable<number>;
  status: string;
  storeName?: Nullable<string>;
}): Record<string, unknown> | null {
  if (opts.status !== "active" && opts.status !== "sold") return null;
  const price = opts.price == null ? NaN : Number(opts.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const offer: Record<string, unknown> = {
    "@type": "Offer",
    price,
    priceCurrency: "USD",
    availability:
      opts.status === "sold"
        ? "https://schema.org/SoldOut"
        : "https://schema.org/InStock",
    url: opts.url,
  };
  if (opts.storeName) {
    offer.seller = { "@type": "Organization", name: opts.storeName };
  }
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: opts.name,
    url: opts.url,
    offers: offer,
  };
  if (opts.description) data.description = opts.description;
  if (opts.image) data.image = opts.image;
  return data;
}

/** Renders a JSON-LD object as the inner text for a <script type="application/ld+json">. */
// Homepage brand graph: Organization (logo + social profiles) and WebSite with
// a SearchAction (makes Google eligible to show the sitelinks search box).
export function siteJsonLd(opts: {
  siteUrl: string;
  lang: string;
  name: string;
  description: string;
}) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: opts.name,
      url: opts.siteUrl,
      logo: `${opts.siteUrl}/logo.png`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: opts.name,
      url: opts.siteUrl,
      description: opts.description,
      inLanguage: opts.lang,
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${opts.siteUrl}/${opts.lang}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

// Serialize JSON-LD for injection into a <script> via dangerouslySetInnerHTML.
// Escapes the characters that could break out of the script element (or the
// HTML context) — critical because some fields are merchant-controlled
// (store name/description). The \uXXXX forms stay valid JSON.
export function jsonLdScript(data: unknown): string {
  // Escape the chars that let a merchant-controlled string break out of the
  // <script> tag. Backslash built at runtime to avoid source-escaping mistakes.
  const bs = String.fromCharCode(92);
  return JSON.stringify(data).replace(
    /[<>&]/g,
    (c) => bs + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
