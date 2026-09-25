import { describe, it, expect } from "vitest";
import {
  storeJsonLd,
  productJsonLd,
  offeringJsonLd,
  jsonLdScript,
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
