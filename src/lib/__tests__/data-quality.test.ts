import { describe, it, expect } from "vitest";
import {
  PRIMARY_ENTITY_SECTORS,
  isGarbledName,
  isPlaceholderText,
  levelOf,
  sanitizeDisplayName,
  sectorRequiresOfferings,
  validateEntryPublic,
  validateProductPublic,
  validateStorePublic,
  type StoreQualityInput,
} from "@/lib/data-quality";
import { categoryKeys } from "@/lib/catalog";
import { resolveStoreModules, sectorPrimarySetup } from "@/lib/sectors";

/** A store with nothing wrong. Every test below removes one thing. */
const GOOD: StoreQualityInput = {
  name: "Qabass Computers",
  category: "retail",
  area: "طرابلس",
  region: "north",
  phone: "+961 6 123 456",
  whatsapp: null,
  description: "كمبيوتر ولابتوب وقطع غيار في طرابلس.",
  logo_url: "https://x/logo.png",
  cover_url: null,
  offerings: 4,
};

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("sanitizeDisplayName", () => {
  it("trims and collapses whitespace for render", () => {
    expect(sanitizeDisplayName("مركز الضنية الطبي ")).toBe("مركز الضنية الطبي");
    expect(sanitizeDisplayName("  Let's   meat\n")).toBe("Let's meat");
  });
  it("drops zero-width characters and survives null", () => {
    expect(sanitizeDisplayName("Alo​ sam﻿ taxi")).toBe("Alo sam taxi");
    expect(sanitizeDisplayName(null)).toBe("");
    expect(sanitizeDisplayName(undefined)).toBe("");
  });
});

describe("name rules", () => {
  it("blocks a missing name", () => {
    const r = validateStorePublic({ ...GOOD, name: "   " }, { sector: "retail" });
    expect(r.level).toBe("blocked");
    expect(codes(r)).toContain("name_missing");
  });
  it("blocks placeholder names in either script", () => {
    for (const name of ["test", "Test Store", "متجر تجريبي", "demo", "asdf", "lorem ipsum"]) {
      const r = validateStorePublic({ ...GOOD, name }, { sector: "retail" });
      expect(r.level, name).toBe("blocked");
      expect(codes(r), name).toContain("name_placeholder");
    }
  });
  it("does not mistake a real word that contains a placeholder for one", () => {
    expect(isPlaceholderText("Contest Prizes")).toBe(false);
    expect(isPlaceholderText("Demolition Co")).toBe(false);
    // "تجربة" is also "experience": only a short name is read as a placeholder.
    expect(isPlaceholderText("تجربة")).toBe(true);
    expect(isPlaceholderText("مطعم تجربة الطعم الأصيل في طرابلس")).toBe(false);
  });
  it("blocks a name that is only digits", () => {
    const r = validateStorePublic({ ...GOOD, name: "03 123 456" }, { sector: "retail" });
    expect(codes(r)).toContain("name_digits_only");
    expect(r.level).toBe("blocked");
  });
  it("only flags leading/trailing whitespace — the production trailing-space store stays listed", () => {
    const r = validateStorePublic({ ...GOOD, name: "مركز الضنية الطبي " }, { sector: "healthcare" });
    expect(codes(r)).toContain("name_untrimmed");
    expect(r.level).toBe("incomplete");
  });
  it("flags edge punctuation but not an exclamation mark", () => {
    expect(codes(validateStorePublic({ ...GOOD, name: "- Mehras -" }, { sector: "retail" }))).toContain(
      "name_edge_punctuation",
    );
    expect(codes(validateStorePublic({ ...GOOD, name: "Yalla!" }, { sector: "retail" }))).not.toContain(
      "name_edge_punctuation",
    );
  });
  it("flags garbled names and accepts mixed Arabic/Latin", () => {
    expect(isGarbledName("Ø§Ù„Ù…Ø±ÙƒØ²")).toBe(true);
    expect(isGarbledName("qwrtpsd shop")).toBe(true);
    expect(isGarbledName("aaaaa")).toBe(true);
    expect(isGarbledName("صيدلية Al Amal")).toBe(false);
    expect(isGarbledName("Giggles Care Lebanon")).toBe(false);
    expect(isGarbledName("Mehras Chtoura")).toBe(false);
    const r = validateStorePublic({ ...GOOD, name: "xxxxx" }, { sector: "retail" });
    expect(r.level).toBe("blocked"); // xxxxx is also a placeholder token
  });
});

describe("store rules", () => {
  it("is ok for a complete store", () => {
    const r = validateStorePublic(GOOD, { sector: "retail" });
    expect(r).toEqual({ level: "ok", issues: [] });
  });
  it("flags a missing category (the row renders as retail, so not blocked)", () => {
    const r = validateStorePublic({ ...GOOD, category: null }, { sector: "retail" });
    expect(codes(r)).toEqual(["category_missing"]);
    expect(r.level).toBe("incomplete");
  });
  it("flags a missing area on a shop, accepts a service area on a request sector", () => {
    expect(codes(validateStorePublic({ ...GOOD, area: null }, { sector: "retail" }))).toContain(
      "location_missing",
    );
    expect(
      codes(
        validateStorePublic(
          { ...GOOD, area: null, service_area: "بيروت وضواحيها" },
          { sector: "services" },
        ),
      ),
    ).not.toContain("location_missing");
    expect(
      codes(validateStorePublic({ ...GOOD, area: null, service_area: "بيروت" }, { sector: "retail" })),
    ).toContain("location_missing");
  });
  it("skips the location rule when the store switched the module off", () => {
    const modules = resolveStoreModules("retail", { location: false });
    const r = validateStorePublic({ ...GOOD, area: null }, { sector: "retail", modules });
    expect(codes(r)).not.toContain("location_missing");
  });
  it("blocks a store with no way to reach it", () => {
    const r = validateStorePublic({ ...GOOD, phone: null, whatsapp: null }, { sector: "retail" });
    expect(r.level).toBe("blocked");
    expect(codes(r)).toContain("contact_missing");
  });
  it("treats a number too short to dial as no number, and flags a bad one beside a good one", () => {
    expect(
      validateStorePublic({ ...GOOD, phone: "123", whatsapp: "  " }, { sector: "retail" }).level,
    ).toBe("blocked");
    const r = validateStorePublic({ ...GOOD, phone: "123", whatsapp: "70123456" }, { sector: "retail" });
    expect(r.level).toBe("incomplete");
    expect(codes(r)).toContain("contact_invalid");
  });
  it("accepts Eastern Arabic digits in a phone", () => {
    const r = validateStorePublic({ ...GOOD, phone: "٠٣١٢٣٤٥٦" }, { sector: "retail" });
    expect(codes(r)).not.toContain("contact_missing");
  });
  it("flags a missing or placeholder description", () => {
    expect(codes(validateStorePublic({ ...GOOD, description: "" }, { sector: "retail" }))).toContain(
      "description_missing",
    );
    expect(codes(validateStorePublic({ ...GOOD, description: "..." }, { sector: "retail" }))).toContain(
      "description_placeholder",
    );
    expect(codes(validateStorePublic({ ...GOOD, description: "test" }, { sector: "retail" }))).toContain(
      "description_placeholder",
    );
    expect(codes(validateStorePublic({ ...GOOD, description: "تجربة تجريبي" }, { sector: "retail" }))).toContain(
      "description_placeholder",
    );
  });
  it("does not flag a real description that happens to contain a placeholder word", () => {
    // Verbatim from production (Let’s meat): "تجربة" here means "experience".
    const description =
      "Let’s Meat وجهتك للحوم الطازجة والمشاوي الشهية. منقدّم جودة، طعم، ونكهة بتخلّي كل وجبة تجربة مميزة.";
    expect(codes(validateStorePublic({ ...GOOD, description }, { sector: "food" }))).toEqual([]);
    expect(
      codes(validateStorePublic({ ...GOOD, description: "Book a demo of our software today." }, { sector: "retail" })),
    ).toEqual([]);
  });
  it("flags — never blocks — a store with neither logo nor cover (the card draws a monogram)", () => {
    const r = validateStorePublic({ ...GOOD, logo_url: null, cover_url: null }, { sector: "retail" });
    expect(codes(r)).toEqual(["image_missing"]);
    expect(r.level).toBe("incomplete");
  });
  it("flags an empty catalogue only where the sector sells from a list", () => {
    expect(codes(validateStorePublic({ ...GOOD, offerings: 0 }, { sector: "retail" }))).toContain(
      "offerings_missing",
    );
    expect(codes(validateStorePublic({ ...GOOD, offerings: 0 }, { sector: "hospitality" }))).toContain(
      "offerings_missing",
    );
    expect(codes(validateStorePublic({ ...GOOD, offerings: 0 }, { sector: "professional" }))).not.toContain(
      "offerings_missing",
    );
    expect(codes(validateStorePublic({ ...GOOD, offerings: 0 }, { sector: "services" }))).not.toContain(
      "offerings_missing",
    );
  });
  it("skips the catalogue rule when nobody counted", () => {
    const r = validateStorePublic({ ...GOOD, offerings: undefined }, { sector: "retail" });
    expect(codes(r)).not.toContain("offerings_missing");
    expect(codes(validateStorePublic({ ...GOOD, offerings: null }, { sector: "retail" }))).not.toContain(
      "offerings_missing",
    );
  });
});

describe("the levels are conservative", () => {
  // The production population on 2026-09-24, reduced to the facts the gate
  // reads. Every store has a name, a contact and a description; the gaps are
  // area, image and catalogue. None of these may become blocked.
  const production: { name: string; input: Partial<StoreQualityInput>; sector: "retail" | "services" | "healthcare" | "food" }[] = [
    { name: "Giggles Care Lebanon", input: { area: null }, sector: "retail" },
    { name: "Let's meat", input: { area: null }, sector: "food" },
    { name: "Mehras Chtoura", input: { area: null, offerings: 0 }, sector: "retail" },
    { name: "ألبسة نسائي ولادب", input: { area: null, logo_url: null, cover_url: null, offerings: 0 }, sector: "retail" },
    { name: "Alo sam taxi", input: { logo_url: null, cover_url: null, offerings: 0 }, sector: "services" },
    { name: "مفروشات عبد الحفيظ عربس", input: { logo_url: null, cover_url: null, offerings: 0 }, sector: "retail" },
    { name: "Qabass Computers", input: { offerings: 0 }, sector: "retail" },
    { name: "مركز الضنية الطبي ", input: {}, sector: "healthcare" },
  ];
  it("blocks none of today's stores", () => {
    for (const p of production) {
      const r = validateStorePublic({ ...GOOD, name: p.name, ...p.input }, { sector: p.sector });
      expect(r.level, p.name).not.toBe("blocked");
    }
  });
  it("flags the ones the audit expects", () => {
    const flagged = production
      .filter((p) => validateStorePublic({ ...GOOD, name: p.name, ...p.input }, { sector: p.sector }).level === "incomplete")
      .map((p) => p.name);
    expect(flagged).toEqual(production.map((p) => p.name));
  });
  it("does not flag a request-driven business for an empty catalogue", () => {
    // A travel agency filed under services sells through its request form;
    // "0 products" is not a gap there, and the audit's count of six empty
    // catalogues includes it only because it counted rows, not sectors.
    const r = validateStorePublic(
      { ...GOOD, name: "شركة التوفيق للسياحة والسفر", offerings: 0 },
      { sector: "services" },
    );
    expect(r.level).toBe("ok");
  });
  it("derives the level from the worst severity", () => {
    expect(levelOf([])).toBe("ok");
    expect(levelOf([{ code: "image_missing", severity: "flag", field: "logo_url" }])).toBe("incomplete");
    expect(
      levelOf([
        { code: "image_missing", severity: "flag", field: "logo_url" },
        { code: "contact_missing", severity: "block", field: "phone" },
      ]),
    ).toBe("blocked");
  });
});

describe("offerings requirement agrees with the sector registry", () => {
  it("PRIMARY_ENTITY_SECTORS is exactly the set sectorPrimarySetup names", () => {
    const fromRegistry = categoryKeys.filter((k) => sectorPrimarySetup(k) != null).sort();
    expect([...PRIMARY_ENTITY_SECTORS].sort()).toEqual(fromRegistry);
  });
  it("goods sectors require a catalogue, booking sectors do not", () => {
    expect(sectorRequiresOfferings("retail")).toBe(true);
    expect(sectorRequiresOfferings("food")).toBe(true);
    expect(sectorRequiresOfferings("pharmacy")).toBe(true);
    expect(sectorRequiresOfferings("events")).toBe(true);
    expect(sectorRequiresOfferings("healthcare")).toBe(false);
    expect(sectorRequiresOfferings("contractors")).toBe(false);
  });
});

describe("product rules", () => {
  const good = { name: "شاحن سريع 65W", price: 22, image_url: "https://x/a.jpg", item_kind: "product" };
  it("is ok for a priced, pictured product", () => {
    expect(validateProductPublic(good, { sector: "retail" })).toEqual({ level: "ok", issues: [] });
  });
  it("blocks an unparseable or negative price", () => {
    expect(validateProductPublic({ ...good, price: -1 }, { sector: "retail" }).level).toBe("blocked");
    expect(validateProductPublic({ ...good, price: "abc" }, { sector: "retail" }).level).toBe("blocked");
    expect(validateProductPublic({ ...good, price: null }, { sector: "retail" }).level).toBe("blocked");
  });
  it("flags a zero price and accepts a numeric string from PostgREST", () => {
    expect(codes(validateProductPublic({ ...good, price: 0 }, { sector: "retail" }))).toEqual(["price_zero"]);
    expect(validateProductPublic({ ...good, price: "22.50" }, { sector: "retail" }).level).toBe("ok");
  });
  it("flags a discount that is not lower than the price", () => {
    expect(codes(validateProductPublic({ ...good, discount_price: 22 }, { sector: "retail" }))).toContain(
      "discount_not_lower",
    );
    expect(codes(validateProductPublic({ ...good, discount_price: 18 }, { sector: "retail" }))).toEqual([]);
  });
  it("flags a missing image without blocking (27 of 44 production products have none)", () => {
    const r = validateProductPublic({ ...good, image_url: null }, { sector: "retail" });
    expect(r.level).toBe("incomplete");
    expect(codes(r)).toEqual(["image_missing"]);
  });
  it("flags an item kind that does not fit the sector", () => {
    expect(codes(validateProductPublic({ ...good, item_kind: "service" }, { sector: "retail" }))).toContain(
      "kind_mismatch",
    );
    expect(codes(validateProductPublic({ ...good, item_kind: "product" }, { sector: "healthcare" }))).toContain(
      "kind_mismatch",
    );
    expect(codes(validateProductPublic({ ...good, item_kind: "service" }, { sector: "healthcare" }))).toEqual([]);
    expect(codes(validateProductPublic({ ...good, item_kind: "digital" }, { sector: "retail" }))).toEqual([]);
  });
  it("uses the same name rules as stores", () => {
    expect(validateProductPublic({ ...good, name: "test" }, { sector: "retail" }).level).toBe("blocked");
  });
});

describe("entry rules (crafts, gigs, jobs, market)", () => {
  it("blocks a craft provider nobody can call, a job with no way to apply", () => {
    expect(
      validateEntryPublic("craft", { title: "أبو علي للكهرباء", description: "كهربائي منازل", contacts: [null, ""], region: "north" }).level,
    ).toBe("blocked");
    expect(
      validateEntryPublic("job", { title: "محاسب", description: "دوام كامل في طرابلس", contacts: [null, null], region: "north" }).level,
    ).toBe("blocked");
    expect(
      validateEntryPublic("job", { title: "محاسب", description: "دوام كامل في طرابلس", contacts: ["راسلونا على الواتساب"], region: "north" }).level,
    ).toBe("ok");
  });
  it("only flags a gig or listing without an image, and treats a null price as on request", () => {
    const gig = validateEntryPublic("gig", { title: "تصميم شعار", description: "شعار احترافي خلال 3 أيام", image: null, price: null });
    expect(gig.level).toBe("incomplete");
    expect(codes(gig)).toEqual(["image_missing"]);
    const listing = validateEntryPublic("listing", { title: "دراجة هوائية", description: "بحالة ممتازة", image: "https://x/1.jpg", price: "150", region: "beirut" });
    expect(listing.level).toBe("ok");
  });
  it("blocks a negative price on a listing", () => {
    expect(
      validateEntryPublic("listing", { title: "طاولة", description: "خشب زان", image: "https://x/1.jpg", price: -5, region: "beirut" }).level,
    ).toBe("blocked");
  });
});
