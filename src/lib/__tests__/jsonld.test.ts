import { describe, it, expect } from "vitest";
import {
  storeJsonLd,
  productJsonLd,
  offeringJsonLd,
  jsonLdScript,
  aggregateRating,
  schemaTypeForSector,
  jobPostingJsonLd,
  listingJsonLd,
} from "@/lib/jsonld";

describe("storeJsonLd", () => {
  it("emits a LocalBusiness with address and rating when provided", () => {
    const d = storeJsonLd({
      name: "Nazih Home",
      url: "https://matjarlb.com/ar/store/1",
      description: "Furniture",
      image: "https://x/logo.png",
      telephone: "+96170000000",
      area: "Achrafieh",
      rating: 4.6667,
      reviewCount: 3,
    }) as Record<string, unknown>;
    expect(d["@type"]).toBe("LocalBusiness");
    expect(d.name).toBe("Nazih Home");
    expect((d.aggregateRating as Record<string, unknown>).ratingValue).toBe(4.7);
    expect((d.address as Record<string, unknown>).addressCountry).toBe("LB");
  });

  it("omits aggregateRating when there are no reviews", () => {
    const d = storeJsonLd({
      name: "S",
      url: "u",
      rating: null,
      reviewCount: 0,
    }) as Record<string, unknown>;
    expect(d.aggregateRating).toBeUndefined();
  });
});

describe("productJsonLd", () => {
  it("marks in/out of stock via the offer availability", () => {
    const inStock = productJsonLd({ name: "P", url: "u", price: 10 }) as {
      offers: { availability: string; priceCurrency: string };
    };
    expect(inStock.offers.availability).toBe("https://schema.org/InStock");
    expect(inStock.offers.priceCurrency).toBe("USD");

    const out = productJsonLd({
      name: "P",
      url: "u",
      price: 10,
      available: false,
    }) as { offers: { availability: string } };
    expect(out.offers.availability).toBe("https://schema.org/OutOfStock");
  });
});

// Every `products` row used to be emitted as a Product with InStock and the
// store as its brand — a clinic's أشعة told Google it was an in-stock product
// branded by the clinic (verified on the baseline build). The noun from the
// offering resolver now picks the type.
describe("offeringJsonLd", () => {
  const base = { name: "أشعة", url: "u", storeName: "مركز الضنية الطبي" };

  it("keeps a good exactly as productJsonLd emits it", () => {
    const d = offeringJsonLd({ ...base, noun: "product", price: 10 });
    expect(d).toEqual(productJsonLd({ ...base, price: 10 }));
    expect(d["@type"]).toBe("Product");
  });

  it("emits a Service provided by the store, with no stock and no brand", () => {
    const d = offeringJsonLd({
      ...base,
      noun: "service",
      price: 90,
      available: true,
    }) as {
      "@type": string;
      provider: { "@type": string; name: string };
      offers: { price: number; availability?: string };
      brand?: unknown;
    };
    expect(d["@type"]).toBe("Service");
    expect(d.provider).toEqual({ "@type": "LocalBusiness", name: base.storeName });
    expect(d.brand).toBeUndefined();
    expect(d.offers.price).toBe(90);
    expect(d.offers.availability).toBeUndefined();
  });

  it("emits no Offer for a service the merchant never priced", () => {
    const d = offeringJsonLd({ ...base, noun: "service", price: null });
    expect(d.offers).toBeUndefined();
    expect(offeringJsonLd({ ...base, noun: "service", price: 0 }).offers).toBeUndefined();
  });

  it("emits a MenuItem for a dish, with its price and no availability", () => {
    const d = offeringJsonLd({ ...base, noun: "dish", price: 7 }) as {
      "@type": string;
      offers: { price: number; availability?: string };
      provider?: unknown;
    };
    expect(d["@type"]).toBe("MenuItem");
    expect(d.offers.price).toBe(7);
    expect(d.offers.availability).toBeUndefined();
    expect(d.provider).toBeUndefined();
  });

  it("carries the rating for any noun, only when there are reviews", () => {
    const rated = offeringJsonLd({
      ...base,
      noun: "service",
      price: 90,
      rating: 4.25,
      reviewCount: 2,
    }) as { aggregateRating: { ratingValue: number } };
    expect(rated.aggregateRating.ratingValue).toBe(4.3);
    expect(
      offeringJsonLd({ ...base, noun: "dish", price: 7, rating: 5, reviewCount: 0 })
        .aggregateRating,
    ).toBeUndefined();
  });
});

describe("jsonLdScript", () => {
  it("serializes to a JSON string", () => {
    expect(jsonLdScript({ a: 1 })).toBe('{"a":1}');
  });
});

// The product's own brand when the merchant recorded one, the store otherwise —
// the same rule the Google feed uses for g:brand, so the page and the feed
// never tell Google two different brands for one item.
describe("productJsonLd brand", () => {
  it("prefers products.brand over the store name", () => {
    const d = productJsonLd({
      name: "كريم",
      url: "u",
      price: 5,
      storeName: "صيدلية",
      brand: "Nivea",
    }) as { brand: { name: string } };
    expect(d.brand.name).toBe("Nivea");
  });

  it("falls back to the store name when the brand is blank", () => {
    const d = productJsonLd({
      name: "صابون",
      url: "u",
      price: 5,
      storeName: "misk",
      brand: "  ",
    }) as { brand: { name: string } };
    expect(d.brand.name).toBe("misk");
  });

  it("never gives a service a brand, even when one is passed", () => {
    const d = offeringJsonLd({
      noun: "service",
      name: "S",
      url: "u",
      price: 10,
      storeName: "Clinic",
      brand: "X",
    }) as { brand?: unknown };
    expect(d.brand).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Prelaunch phase 5 (§32 / §18): ratings only from real reviews, the store's
// schema type from its sector, no fabricated prices, JobPosting deadlines, and
// Sunday Market listings.
// ---------------------------------------------------------------------------
describe("aggregateRating — never without real reviews", () => {
  it("emits for a real average over at least one review", () => {
    expect(aggregateRating(4.66, 3)).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.7,
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it.each([
    [null, 3],
    [4.5, null],
    [4.5, 0],
    [0, 4],
    [5.5, 2],
    [Number.NaN, 2],
    [4, 1.5],
    [4, -1],
  ])("omits rating=%s count=%s", (rating, count) => {
    expect(aggregateRating(rating as number | null, count as number | null)).toBeUndefined();
  });

  it("no builder emits aggregateRating when the review count is 0", () => {
    const zero = { rating: 5, reviewCount: 0 };
    expect(storeJsonLd({ name: "S", url: "u", ...zero }).aggregateRating).toBeUndefined();
    expect(productJsonLd({ name: "P", url: "u", price: 3, ...zero }).aggregateRating).toBeUndefined();
    for (const noun of ["product", "service", "dish"] as const) {
      expect(
        offeringJsonLd({ noun, name: "O", url: "u", price: 3, ...zero }).aggregateRating,
      ).toBeUndefined();
    }
  });

  it("a rating is never labelled as verified anywhere in the output", () => {
    const d = JSON.stringify(
      storeJsonLd({ name: "S", url: "u", rating: 4.2, reviewCount: 9 }),
    );
    expect(d).not.toMatch(/verif/i);
  });
});

describe("storeJsonLd sector type", () => {
  it.each([
    ["food", "FoodEstablishment"],
    ["healthcare", "MedicalBusiness"],
    ["pharmacy", "Pharmacy"],
    ["retail", "Store"],
    ["beauty", "HealthAndBeautyBusiness"],
    ["automotive", "AutomotiveBusiness"],
    ["contractors", "HomeAndConstructionBusiness"],
    ["services", "LocalBusiness"],
    ["not-a-sector", "LocalBusiness"],
  ])("%s → %s", (sector, type) => {
    expect(schemaTypeForSector(sector)).toBe(type);
    expect(storeJsonLd({ name: "S", url: "u", sector })["@type"]).toBe(type);
  });

  it("stays LocalBusiness when no sector is passed (the pre-existing output)", () => {
    expect(storeJsonLd({ name: "S", url: "u" })["@type"]).toBe("LocalBusiness");
  });
});

describe("productJsonLd never invents a price", () => {
  it("omits the Offer for a zero / missing price", () => {
    expect(productJsonLd({ name: "P", url: "u", price: 0 }).offers).toBeUndefined();
    expect(productJsonLd({ name: "P", url: "u", price: Number.NaN }).offers).toBeUndefined();
    expect(
      offeringJsonLd({ noun: "product", name: "P", url: "u", price: null }).offers,
    ).toBeUndefined();
  });
});

describe("jobPostingJsonLd deadline", () => {
  const base = {
    title: "Cashier",
    description: "Front desk",
    datePosted: "2026-09-01",
    companyName: "Shop",
    url: "u",
  };

  it("turns a date deadline into end-of-day Beirut", () => {
    const d = jobPostingJsonLd({ ...base, validThrough: "2026-10-15" });
    expect(d.validThrough).toBe("2026-10-15T23:59:59+03:00");
  });

  it("omits validThrough when the poster set none (never invented)", () => {
    expect(jobPostingJsonLd(base).validThrough).toBeUndefined();
    expect(jobPostingJsonLd({ ...base, validThrough: "not a date" }).validThrough).toBeUndefined();
  });

  it("links the hiring store when given", () => {
    const d = jobPostingJsonLd({ ...base, companyUrl: "https://x/ar/shop", companyLogo: "https://x/l.png" }) as {
      hiringOrganization: Record<string, string>;
    };
    expect(d.hiringOrganization.sameAs).toBe("https://x/ar/shop");
    expect(d.hiringOrganization.logo).toBe("https://x/l.png");
  });
});

describe("listingJsonLd (Sunday Market)", () => {
  const base = { name: "Bike", url: "u", price: 120 };

  it("an active priced listing is an InStock Product offer", () => {
    const d = listingJsonLd({ ...base, status: "active" }) as {
      "@type": string;
      offers: { availability: string; price: number; seller?: unknown };
    };
    expect(d["@type"]).toBe("Product");
    expect(d.offers.availability).toBe("https://schema.org/InStock");
    expect(d.offers.seller).toBeUndefined();
  });

  it("a sold listing is SoldOut; a merchant listing names the store", () => {
    const d = listingJsonLd({ ...base, status: "sold", storeName: "Shop" }) as {
      offers: { availability: string; seller: { name: string } };
    };
    expect(d.offers.availability).toBe("https://schema.org/SoldOut");
    expect(d.offers.seller.name).toBe("Shop");
  });

  it.each(["pending", "draft", "rejected", "expired"])(
    "emits nothing for a %s listing",
    (status) => {
      expect(listingJsonLd({ ...base, status })).toBeNull();
    },
  );

  it("emits nothing without a real price", () => {
    expect(listingJsonLd({ ...base, status: "active", price: null })).toBeNull();
    expect(listingJsonLd({ ...base, status: "active", price: 0 })).toBeNull();
  });

  it("never carries a rating (listings have no reviews)", () => {
    expect(listingJsonLd({ ...base, status: "active" })).not.toHaveProperty("aggregateRating");
  });
});
