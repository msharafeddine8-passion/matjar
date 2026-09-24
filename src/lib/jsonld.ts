// Structured-data (schema.org JSON-LD) builders. Injected as <script> tags on
// the store and product pages so Google can render rich results (business
// cards, product price/rating snippets). Pure functions — no imports.

type Nullable<T> = T | null | undefined;

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
}) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
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
  if (opts.rating && opts.reviewCount) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(opts.rating.toFixed(1)),
      reviewCount: opts.reviewCount,
      bestRating: 5,
    };
  }
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
  available?: boolean;
  rating?: Nullable<number>;
  reviewCount?: Nullable<number>;
}) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: opts.name,
    url: opts.url,
    offers: {
      "@type": "Offer",
      price: opts.price,
      priceCurrency: "USD",
      availability:
        opts.available === false
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      url: opts.url,
    },
  };
  if (opts.description) data.description = opts.description;
  if (opts.image) data.image = opts.image;
  if (opts.storeName) data.brand = { "@type": "Brand", name: opts.storeName };
  if (opts.rating && opts.reviewCount) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(opts.rating.toFixed(1)),
      reviewCount: opts.reviewCount,
      bestRating: 5,
    };
  }
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
  if (opts.rating && opts.reviewCount) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(opts.rating.toFixed(1)),
      reviewCount: opts.reviewCount,
      bestRating: 5,
    };
  }
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
