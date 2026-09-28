import { describe, it, expect } from "vitest";
import {
  buildGoogleFeedXml,
  cdata,
  clampText,
  evaluateFeedChecklist,
  feedAvailability,
  feedCondition,
  feedExclusions,
  feedPath,
  feedPlanAllowed,
  feedServes,
  formatFeedPrice,
  isPurchasablePhysicalGood,
  isValidGtin,
  toFeedItem,
  xmlEscape,
  TITLE_MAX,
  type FeedProductRow,
  type FeedStore,
} from "@/lib/google-feed";

// The Google free-listings feed. Every rule that decides what Google is told
// about a merchant's product is pinned here — a wrong availability or a price
// in the wrong shape gets the whole item (or file) disapproved, and a service
// or a dish in a Shopping feed is a policy problem, not a cosmetic one.

const SITE = "https://matjarlb.com";
const NOW = Date.parse("2026-09-25T12:00:00Z");

const row = (over: Partial<FeedProductRow> = {}): FeedProductRow => ({
  id: "10767593-c754-488a-8ea0-96ed73f2a576",
  name: "صابون زبدة الشيا",
  description: "زيوت طبيعية",
  price: "2.99",
  discount_price: null,
  flash_price: null,
  flash_start: null,
  flash_end: null,
  image_url: "https://example.supabase.co/storage/v1/object/public/a.jpeg",
  gallery: [],
  stock: null,
  is_available: true,
  status: "active",
  deleted_at: null,
  hidden_by_plan: false,
  item_kind: "product",
  brand: null,
  sku: null,
  attributes: {},
  ...over,
});

const store = (over: Partial<FeedStore> = {}): FeedStore => ({
  id: "c028af40-1d75-485e-8855-5ad6a1eefff6",
  name: "misk",
  slug: "misk",
  sectorSlug: "retail",
  status: "active",
  deletedAt: null,
  plan: "pro",
  trialEndsAt: null,
  returnPolicy: "Returns within 3 days.",
  shippingPolicy: "Delivery across Lebanon.",
  googleFeedEnabled: true,
  ...over,
});

describe("escaping", () => {
  it("escapes the five XML entities", () => {
    expect(xmlEscape(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f",
    );
  });

  it("strips characters XML 1.0 cannot carry, keeping tab/newline", () => {
    expect(xmlEscape("a\u0000b\u0008c\td\ne\u000Bf")).toBe("abc\td\nef");
  });

  it("splits a literal ]]> so CDATA cannot be closed early", () => {
    const out = cdata("x ]]> <script>");
    expect(out).toBe("<![CDATA[x ]]]]><![CDATA[> <script>]]>");
    // Reassembled, the text is exactly what the merchant typed.
    const text = out.replace(/<!\[CDATA\[|\]\]>/g, "");
    expect(text).toBe("x ]]> <script>");
  });
});

describe("price formatting", () => {
  it("is two decimals, a space, and the ISO code", () => {
    expect(formatFeedPrice(12)).toBe("12.00 USD");
    expect(formatFeedPrice(2.999)).toBe("3.00 USD");
    expect(formatFeedPrice(1234.5)).toBe("1234.50 USD");
    expect(formatFeedPrice(4500000, "LBP")).toBe("4500000.00 LBP");
  });

  it("never rounds a float artefact into the wrong cent", () => {
    // 7.39 × 3 is 22.169999999999998 in IEEE 754.
    expect(formatFeedPrice(7.39 * 3)).toBe("22.17 USD");
  });
});

describe("availability", () => {
  it("in stock when stock is untracked (null), as the storefront reads it", () => {
    expect(feedAvailability({ stock: null, is_available: true })).toBe("in_stock");
  });
  it("out of stock at zero or below", () => {
    expect(feedAvailability({ stock: 0, is_available: true })).toBe("out_of_stock");
    expect(feedAvailability({ stock: -2, is_available: true })).toBe("out_of_stock");
  });
  it("out of stock when the merchant switched it off", () => {
    expect(feedAvailability({ stock: 5, is_available: false })).toBe("out_of_stock");
  });
});

describe("identifiers and condition — never invented", () => {
  it("accepts only checksum-valid GTINs", () => {
    expect(isValidGtin("4006382000009")).toBe(true); // EAN-13
    expect(isValidGtin("4006382000008")).toBe(false); // wrong check digit
    expect(isValidGtin("96385074")).toBe(true); // GTIN-8
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
    expect(isValidGtin("SOAP-001")).toBe(false);
    expect(isValidGtin("0000000000000")).toBe(false);
    expect(isValidGtin(null)).toBe(false);
  });

  it("condition is new unless the merchant recorded used/refurbished", () => {
    expect(feedCondition({})).toBe("new");
    expect(feedCondition(null)).toBe("new");
    expect(feedCondition({ condition: "used" })).toBe("used");
    expect(feedCondition({ condition: "refurbished" })).toBe("refurbished");
    expect(feedCondition({ condition: "new" })).toBe("new");
  });
});

describe("exclusion rules", () => {
  it("lists a complete, visible physical good in a retail store", () => {
    expect(feedExclusions(row(), "retail")).toEqual([]);
  });

  it("never lists a service", () => {
    expect(feedExclusions(row({ item_kind: "service" }), "retail")).toContain(
      "not_physical_good",
    );
    expect(isPurchasablePhysicalGood({ item_kind: "service" }, "healthcare")).toBe(false);
  });

  it("never lists a restaurant dish (menu item)", () => {
    expect(isPurchasablePhysicalGood({ item_kind: "product" }, "food")).toBe(false);
  });

  it("never lists a digital download", () => {
    expect(isPurchasablePhysicalGood({ item_kind: "digital" }, "retail")).toBe(false);
  });

  it("never lists what cannot be bought on the page: a flat, a car", () => {
    expect(isPurchasablePhysicalGood({ item_kind: "product" }, "realEstate")).toBe(false);
    expect(isPurchasablePhysicalGood({ item_kind: "product" }, "automotive")).toBe(false);
  });

  it("never lists what the public cannot see", () => {
    expect(feedExclusions(row({ status: "draft" }), "retail")).toContain("not_active");
    expect(feedExclusions(row({ deleted_at: "2026-01-01" }), "retail")).toContain("deleted");
    expect(feedExclusions(row({ is_available: false }), "retail")).toContain("unavailable");
    expect(feedExclusions(row({ hidden_by_plan: true }), "retail")).toContain("hidden_by_plan");
  });

  it("names the three data gaps Google rejects an item for", () => {
    expect(
      feedExclusions(row({ image_url: null, description: "  ", price: 0 }), "retail"),
    ).toEqual(["no_price", "no_image", "no_description"]);
    // An http:// image is not a usable image link.
    expect(feedExclusions(row({ image_url: "http://x/a.jpg" }), "retail")).toEqual([
      "no_image",
    ]);
  });
});

describe("item mapping", () => {
  it("maps a row to Google's attributes", () => {
    const item = toFeedItem(row({ gallery: ["https://x/1.jpg", "not-a-url"] }), store(), {
      siteUrl: SITE,
      now: NOW,
    });
    expect(item).toEqual({
      id: "10767593-c754-488a-8ea0-96ed73f2a576",
      title: "صابون زبدة الشيا",
      description: "زيوت طبيعية",
      link: "https://matjarlb.com/ar/product/10767593-c754-488a-8ea0-96ed73f2a576",
      imageLink: "https://example.supabase.co/storage/v1/object/public/a.jpeg",
      additionalImageLinks: ["https://x/1.jpg"],
      price: "2.99 USD",
      salePrice: null,
      salePriceEffectiveDate: null,
      availability: "in_stock",
      condition: "new",
      brand: "misk",
      gtin: null,
    });
  });

  it("returns null for an excluded row", () => {
    expect(toFeedItem(row({ item_kind: "service" }), store(), { siteUrl: SITE })).toBeNull();
  });

  it("uses the product's own brand over the store name", () => {
    const item = toFeedItem(row({ brand: " Nivea " }), store(), { siteUrl: SITE, now: NOW });
    expect(item?.brand).toBe("Nivea");
  });

  it("emits a GTIN only from a checksum-valid SKU, and never an MPN", () => {
    expect(toFeedItem(row({ sku: "4006382000009" }), store(), { siteUrl: SITE })?.gtin).toBe(
      "4006382000009",
    );
    expect(toFeedItem(row({ sku: "SOAP-001" }), store(), { siteUrl: SITE })?.gtin).toBeNull();
    const xml = buildGoogleFeedXml({
      storeName: "misk",
      storeUrl: SITE,
      items: [toFeedItem(row({ sku: "SOAP-001" }), store(), { siteUrl: SITE })!],
    });
    expect(xml).not.toContain("g:mpn");
    expect(xml).not.toContain("g:gtin");
  });

  it("emits a sale price only when the discount is actually lower", () => {
    const on = toFeedItem(row({ price: 10, discount_price: 8 }), store(), { siteUrl: SITE, now: NOW });
    expect(on?.price).toBe("10.00 USD");
    expect(on?.salePrice).toBe("8.00 USD");
    expect(on?.salePriceEffectiveDate).toBeNull();
    const higher = toFeedItem(row({ price: 10, discount_price: 12 }), store(), { siteUrl: SITE, now: NOW });
    expect(higher?.salePrice).toBeNull();
  });

  it("carries a running flash price with its window", () => {
    const item = toFeedItem(
      row({
        price: 10,
        discount_price: 8,
        flash_price: 5,
        flash_start: "2026-09-25T09:00:00Z",
        flash_end: "2026-09-25T21:00:00Z",
      }),
      store(),
      { siteUrl: SITE, now: NOW },
    );
    expect(item?.salePrice).toBe("5.00 USD");
    expect(item?.salePriceEffectiveDate).toBe(
      "2026-09-25T09:00:00.000Z/2026-09-25T21:00:00.000Z",
    );
    // After the window, the standing discount is the sale again.
    const later = toFeedItem(
      row({
        price: 10,
        discount_price: 8,
        flash_price: 5,
        flash_start: "2026-09-25T09:00:00Z",
        flash_end: "2026-09-25T11:00:00Z",
      }),
      store(),
      { siteUrl: SITE, now: NOW },
    );
    expect(later?.salePrice).toBe("8.00 USD");
  });

  it("clamps the title to Google's 150 characters at a word boundary", () => {
    const long = "كلمة ".repeat(60);
    const item = toFeedItem(row({ name: long }), store(), { siteUrl: SITE });
    expect(item!.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(item!.title.endsWith("…")).toBe(true);
    expect(clampText("  a   b  ", 10)).toBe("a b");
  });
});

describe("the document", () => {
  it("is RSS 2.0 in the g: namespace, with merchant text in CDATA", () => {
    const item = toFeedItem(
      row({ name: "Tom & Jerry <soap>", description: "a ]]> b" }),
      store(),
      { siteUrl: SITE, now: NOW },
    )!;
    const xml = buildGoogleFeedXml({ storeName: "misk & co", storeUrl: SITE, items: [item] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml).toContain("<g:title><![CDATA[Tom & Jerry <soap>]]></g:title>");
    expect(xml).toContain("<g:description><![CDATA[a ]]]]><![CDATA[> b]]></g:description>");
    expect(xml).toContain("<g:price>2.99 USD</g:price>");
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:condition>new</g:condition>");
    expect(xml).toContain("<g:brand><![CDATA[misk]]></g:brand>");
    expect(xml).not.toContain("g:sale_price");
    // Balanced: one <item> per item, one channel.
    expect(xml.match(/<item>/g)?.length).toBe(1);
    expect(xml.match(/<\/item>/g)?.length).toBe(1);
  });

  it("is still a valid empty channel when nothing is listable", () => {
    const xml = buildGoogleFeedXml({ storeName: "s", storeUrl: SITE, items: [] });
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});

describe("gating", () => {
  it("Pro and Business, by effective plan (an active trial counts)", () => {
    expect(feedPlanAllowed("pro", null)).toBe(true);
    expect(feedPlanAllowed("business", null)).toBe(true);
    expect(feedPlanAllowed("basic", null)).toBe(false);
    expect(feedPlanAllowed("free", null)).toBe(false);
    expect(feedPlanAllowed(null, null)).toBe(false);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(feedPlanAllowed("free", future)).toBe(true);
    expect(feedPlanAllowed("basic", past)).toBe(false);
  });

  it("serves only when switched on, on plan, active, with both policies", () => {
    expect(feedServes(store())).toBe(true);
    expect(feedServes(store({ googleFeedEnabled: false }))).toBe(false);
    expect(feedServes(store({ plan: "basic" }))).toBe(false);
    expect(feedServes(store({ status: "suspended" }))).toBe(false);
    expect(feedServes(store({ deletedAt: "2026-01-01" }))).toBe(false);
    expect(feedServes(store({ returnPolicy: "  " }))).toBe(false);
    expect(feedServes(store({ shippingPolicy: null }))).toBe(false);
  });

  it("addresses the feed by slug, or by id when there is no slug", () => {
    expect(feedPath(store())).toBe("/feeds/misk/google.xml");
    expect(feedPath(store({ slug: null }))).toBe(
      "/feeds/c028af40-1d75-485e-8855-5ad6a1eefff6/google.xml",
    );
  });
});

describe("pre-flight checklist", () => {
  it("blocks activation until both policies are written", () => {
    const c = evaluateFeedChecklist({
      store: store({ returnPolicy: null, shippingPolicy: null }),
      products: [row()],
    });
    expect(c.canActivate).toBe(false);
    expect(c.items.find((i) => i.key === "returnPolicy")?.ok).toBe(false);
    expect(c.items.find((i) => i.key === "shippingPolicy")?.ok).toBe(false);
    expect(c.items.find((i) => i.key === "listableProducts")?.ok).toBe(true);
  });

  it("allows activation when everything passes", () => {
    const c = evaluateFeedChecklist({ store: store(), products: [row()] });
    expect(c.canActivate).toBe(true);
    expect(c.listableCount).toBe(1);
    expect(c.productIssues).toEqual([]);
  });

  it("blocks below Pro", () => {
    const c = evaluateFeedChecklist({ store: store({ plan: "basic" }), products: [row()] });
    expect(c.canActivate).toBe(false);
    expect(c.items.find((i) => i.key === "plan")?.ok).toBe(false);
  });

  it("flags visible goods missing image / description / price, with ids to fix", () => {
    const c = evaluateFeedChecklist({
      store: store(),
      products: [
        row(),
        row({ id: "a", name: "بلا صورة", image_url: null }),
        row({ id: "b", name: "بلا شي", image_url: null, description: null, price: 0 }),
        // Left out on purpose, not by a data gap — never flagged.
        row({ id: "c", item_kind: "service", image_url: null }),
        row({ id: "d", status: "draft", image_url: null }),
      ],
    });
    expect(c.listableCount).toBe(1);
    expect(c.productIssues).toEqual([
      { id: "a", name: "بلا صورة", missing: ["image"] },
      { id: "b", name: "بلا شي", missing: ["image", "description", "price"] },
    ]);
  });

  it("blocks when nothing at all is listable", () => {
    const c = evaluateFeedChecklist({
      store: store(),
      products: [row({ image_url: null })],
    });
    expect(c.canActivate).toBe(false);
    expect(c.items.find((i) => i.key === "listableProducts")?.ok).toBe(false);
  });
});
