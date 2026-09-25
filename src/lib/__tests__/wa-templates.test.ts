import { describe, it, expect } from "vitest";
import {
  DEFAULT_WA_TEMPLATES,
  WA_SAMPLE_VALUES,
  WA_TEMPLATE_KEYS,
  WA_TEMPLATE_VARS,
  WA_URL_BUDGET,
  WA_URL_LIMIT,
  WA_LOCALES,
  composeWaMessage,
  formatWaEta,
  formatWaTotal,
  isAbandonedCart,
  itemsText,
  orderLinkPath,
  orderNumber,
  orderStatusWords,
  phoneKey,
  pluralForm,
  priceCart,
  usableCoupons,
  previewSegments,
  problemVars,
  renderWaTemplate,
  resolveTemplates,
  reviewLinkPath,
  sinceParts,
  storeLinkPath,
  waActionHref,
  waUrlLength,
} from "@/lib/wa-templates";
import { waLink as phoneWaLink } from "@/lib/phone";
import { waLink as legacyWaLink } from "@/lib/whatsapp";
import { buildReminderMessage } from "@/lib/ledger";
import { FEATURES, FEATURE_REGISTRY } from "@/lib/feature-availability";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Dict = {
  ledger: { reminderTemplate: string; and: string };
  waActions: Record<string, unknown>;
};
const load = (l: string): Dict =>
  JSON.parse(readFileSync(join(process.cwd(), "src/i18n/dictionaries", `${l}.json`), "utf8"));
const ar = load("ar");
const en = load("en");

const RAW_VAR = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

describe("defaults", () => {
  it("has Arabic and English for every key, using only that key's variables", () => {
    for (const key of WA_TEMPLATE_KEYS) {
      for (const locale of WA_LOCALES) {
        const body = DEFAULT_WA_TEMPLATES[key][locale];
        expect(body.trim().length, `${key}/${locale}`).toBeGreaterThan(10);
        expect(problemVars(body, key), `${key}/${locale}`).toEqual([]);
      }
    }
  });

  it("renders every default with sample data to a message with no raw {var}", () => {
    for (const key of WA_TEMPLATE_KEYS) {
      for (const locale of WA_LOCALES) {
        const out = renderWaTemplate(DEFAULT_WA_TEMPLATES[key][locale], WA_SAMPLE_VALUES[locale]);
        expect(out).not.toMatch(RAW_VAR);
        expect(out.length).toBeGreaterThan(10);
      }
    }
  });

  it("fits every default, fully filled, inside the wa.me budget", () => {
    for (const key of WA_TEMPLATE_KEYS) {
      for (const locale of WA_LOCALES) {
        const out = renderWaTemplate(DEFAULT_WA_TEMPLATES[key][locale], WA_SAMPLE_VALUES[locale]);
        expect(waUrlLength("96171123456", out), `${key}/${locale}`).toBeLessThan(WA_URL_BUDGET);
      }
    }
  });

  it("keeps the ledger reminder word for word (wiring it here changed nothing)", () => {
    for (const locale of WA_LOCALES) {
      const dict = locale === "ar" ? ar : en;
      const balances = { USD: 40, LBP: 1500000 };
      const before = buildReminderMessage({
        template: { body: dict.ledger.reminderTemplate, and: dict.ledger.and },
        customerName: "Rana",
        storeName: "Dukkan",
        balances,
        link: "https://x.test/s/abc",
        lang: locale,
      });
      const after = renderWaTemplate(DEFAULT_WA_TEMPLATES.debt_reminder[locale], {
        customer_name: "Rana",
        store_name: "Dukkan",
        balance: locale === "ar" ? "$40 و 1,500,000 ل.ل." : "$40 and 1,500,000 LBP",
        link: "https://x.test/s/abc",
      });
      expect(after).toBe(before);
    }
  });
});

describe("rendering and fallbacks", () => {
  it("fills variables", () => {
    expect(
      renderWaTemplate("Hi {customer_name}, order {order_number}: {total}", {
        customer_name: "Rana",
        order_number: "#a1b2c3d4",
        total: "$25",
      }),
    ).toBe("Hi Rana, order #a1b2c3d4: $25");
  });

  it("drops the whole line of a missing variable instead of sending {eta} or inventing one", () => {
    const out = renderWaTemplate(DEFAULT_WA_TEMPLATES.order_confirmation.ar, {
      customer_name: "رنا",
      store_name: "متجر",
      order_number: "#a1b2c3d4",
      items: "• خبز ×1",
      total: "$3",
      link: "https://x.test/t",
      // eta deliberately absent: no real ETA data
    });
    expect(out).not.toContain("التوصيل المتوقّع");
    expect(out).not.toMatch(RAW_VAR);
    expect(out).toContain("المجموع: $3");
  });

  it("drops a line whose variable is blank or whitespace", () => {
    expect(renderWaTemplate("a\nETA: {eta}\nb", { eta: "   " })).toBe("a\nb");
  });

  it("drops a line with an unknown variable (a typo) when sending", () => {
    expect(renderWaTemplate("Hi {customer_name}\nSee {nmae}\nBye", { customer_name: "R" })).toBe(
      "Hi R\nBye",
    );
  });

  it("empties {customer_name} quietly and tidies the punctuation", () => {
    expect(renderWaTemplate("مرحبا {customer_name}،\nأهلا", {})).toBe("مرحبا،\nأهلا");
    expect(renderWaTemplate("Hi {customer_name},\nhello", { customer_name: "" })).toBe("Hi,\nhello");
  });

  it("keeps multi-line {items} and collapses blank-line runs", () => {
    expect(renderWaTemplate("top\n\n{coupon}\n\n{items}\nend", { items: "• a ×1\n• b ×2" })).toBe(
      "top\n\n• a ×1\n• b ×2\nend",
    );
  });

  it("falls back to the default when an override drops to nothing", () => {
    const r = composeWaMessage({
      body: "{eta}",
      fallbackBody: DEFAULT_WA_TEMPLATES.order_status.en,
      values: { order_number: "#1", store_name: "S", status: "ready", link: "https://x" },
      locale: "en",
    });
    expect(r.text).toContain("is now: ready");
  });

  it("does not re-scan values: a customer literally named {link} is sent as typed", () => {
    expect(renderWaTemplate("Hi {customer_name}", { customer_name: "{link}" })).toBe("Hi {link}");
  });

  it("previews unknown and unavailable variables visibly instead of dropping them", () => {
    const segs = previewSegments(
      "Hi {customer_name} {balance} {nmae}",
      WA_SAMPLE_VALUES.en,
      WA_TEMPLATE_VARS.order_status,
    );
    expect(segs.find((s) => s.kind === "value")?.text).toBe("Rana");
    expect(segs.find((s) => s.kind === "unavailable")?.text).toBe("{balance}");
    expect(segs.find((s) => s.kind === "unknown")?.text).toBe("{nmae}");
    expect(problemVars("{balance} {nmae} {total}", "order_status").sort()).toEqual(["balance", "nmae"]);
  });

  it("resolves overrides over defaults, ignoring blanks and unknown keys", () => {
    const t = resolveTemplates([
      { key: "order_status", locale: "ar", body: "  مخصص {status}  " },
      { key: "order_status", locale: "en", body: "   " },
      { key: "not_a_key", locale: "ar", body: "x" },
      { key: "review_request", locale: "fr", body: "x" },
    ]);
    expect(t.order_status.ar).toEqual({ body: "مخصص {status}", custom: true });
    expect(t.order_status.en).toEqual({ body: DEFAULT_WA_TEMPLATES.order_status.en, custom: false });
    expect(t.review_request.ar.custom).toBe(false);
    expect(resolveTemplates(null).debt_reminder.ar.body).toBe(DEFAULT_WA_TEMPLATES.debt_reminder.ar);
  });
});

describe("encoding and the length guard", () => {
  it("builds the link through the shared +961 normalisation", () => {
    const r = waActionHref("03 709 064", {
      body: "مرحبا {customer_name}",
      values: { customer_name: "رنا" },
      locale: "ar",
    });
    expect(r?.href.startsWith("https://wa.me/9613709064?text=")).toBe(true);
    expect(decodeURIComponent(r!.href.split("?text=")[1])).toBe("مرحبا رنا");
    // The same number through the old helper and the shared one.
    expect(phoneWaLink("03709064", "x")).toBe("https://wa.me/9613709064?text=x");
    expect(legacyWaLink("+961 3 709 064", "x")).toBe("https://wa.me/9613709064?text=x");
  });

  it("encodes the characters that would break a URL", () => {
    const r = waActionHref("71123456", {
      body: "{coupon}",
      values: { coupon: "A&B=C #1 ?+ %" },
      locale: "en",
    });
    expect(r!.href).toBe(`https://wa.me/96171123456?text=${encodeURIComponent("A&B=C #1 ?+ %")}`);
    expect(r!.href).not.toContain(" ");
  });

  it("returns null for a number that cannot be dialled — no dead links", () => {
    expect(waActionHref("123", { body: "x", values: {}, locale: "ar" })).toBeNull();
    expect(waActionHref(null, { body: "x", values: {}, locale: "ar" })).toBeNull();
  });

  it("shortens the item list first, with a '+ N' line", () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ name: `منتج رقم ${i + 1}`, quantity: 1 }));
    const r = composeWaMessage({
      body: DEFAULT_WA_TEMPLATES.order_confirmation.ar,
      values: { store_name: "متجر", order_number: "#a1", total: "$9", link: "https://x.test/t/1" },
      items,
      locale: "ar",
      digits: "96171123456",
    });
    expect(r.truncated).toBe(true);
    expect(r.text).toMatch(/\+ \d+ غيرن/);
    expect(r.text).toContain("https://x.test/t/1");
    expect(waUrlLength("96171123456", r.text)).toBeLessThanOrEqual(WA_URL_BUDGET);
  });

  it("keeps the link line when trailing lines must go, and cuts as a last resort", () => {
    const long = "كلام طويل ".repeat(120);
    const r = composeWaMessage({
      body: `{link}\n${long}\n${long}`,
      values: { link: "https://x.test/keep" },
      locale: "ar",
      digits: "96171123456",
    });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("https://x.test/keep");
    expect(waUrlLength("96171123456", r.text)).toBeLessThanOrEqual(WA_URL_BUDGET);
    expect(WA_URL_BUDGET).toBeLessThan(WA_URL_LIMIT);

    const cut = composeWaMessage({ body: long, values: {}, locale: "ar", digits: "96171123456" });
    expect(cut.text.endsWith("…")).toBe(true);
    expect(waUrlLength("96171123456", cut.text)).toBeLessThanOrEqual(WA_URL_BUDGET);
  });

  it("never cuts inside a surrogate pair (emoji)", () => {
    const r = composeWaMessage({ body: "😀".repeat(400), values: {}, locale: "en", digits: "96171123456" });
    expect(() => encodeURIComponent(r.text)).not.toThrow();
  });
});

describe("values", () => {
  it("uses the order reference the UI shows, never the uuid", () => {
    expect(orderNumber("a1b2c3d4-0000-4000-8000-000000000000")).toBe("#a1b2c3d4");
  });

  it("shows USD and, with a live rate, LBP", () => {
    expect(formatWaTotal(25, 89500, "ar")).toBe("$25 (≈ 2,237,500 ل.ل.)");
    expect(formatWaTotal(25, 89500, "en")).toBe("$25 (≈ 2,237,500 LBP)");
    expect(formatWaTotal(25, 0, "ar")).toBe("$25");
    expect(formatWaTotal(1234.5, 0, "en")).toBe("$1,234.5");
  });

  it("only states an ETA from real data", () => {
    expect(formatWaEta({}, "ar")).toBeNull();
    expect(formatWaEta({ etaMinMinutes: 30, etaMaxMinutes: 60 }, "ar")).toBe("30–60 دقيقة");
    expect(formatWaEta({ etaMaxMinutes: 45 }, "en")).toBe("45 minutes");
    expect(formatWaEta({ etaMinMinutes: 0, etaMaxMinutes: 0 }, "en")).toBeNull();
    const s = formatWaEta({ scheduledFor: "2026-10-02T14:30:00Z" }, "en");
    expect(s).toMatch(/17:30/); // Beirut is UTC+3 in October
  });

  it("words statuses for the customer and refuses unknown ones", () => {
    expect(orderStatusWords("out_for_delivery", "ar")).toBe("طلع مع الديليفري");
    expect(orderStatusWords("nope", "en")).toBeNull();
  });

  it("links only to pages that exist for that order", () => {
    expect(orderLinkPath("ar", "o1", false)).toBe("/ar/track/o1");
    expect(orderLinkPath("en", "o1", true)).toBe("/en/orders/o1");
    expect(reviewLinkPath("ar", "o1", false)).toBeNull();
    expect(reviewLinkPath("ar", "o1", true)).toBe("/ar/orders/o1");
    expect(storeLinkPath("ar", "s1", null)).toBe("/ar/store/s1");
    expect(storeLinkPath("en", "s1", "dukkan")).toBe("/en/dukkan");
  });

  it("lists items and summarises the rest", () => {
    const items = [
      { name: "a", quantity: 2 },
      { name: "b", quantity: 1 },
      { name: "c", quantity: 1 },
    ];
    expect(itemsText(items, "en")).toBe("• a ×2\n• b ×1\n• c ×1");
    expect(itemsText(items, "ar", 1)).toBe("• a ×2\n+ 2 غيرن");
    expect(itemsText(items, "en", 0)).toBe("+ 3 more");
  });
});

describe("+961 normalisation and abandoned carts", () => {
  it("reduces every way of typing one number to one key", () => {
    const k = "3123456";
    for (const raw of ["03123456", "03 123 456", "+961 3 123 456", "9613123456", "00961 3 123456", "+961 03 123 456"]) {
      expect(phoneKey(raw), raw).toBe(k);
    }
    expect(phoneKey("71 627 323")).toBe("71627323");
    // Keserwan: area code 09 — the 961 after the trunk zero is NOT a country code.
    expect(phoneKey("09612345")).toBe("9612345");
    // Foreign numbers still match themselves.
    expect(phoneKey("+33 6 12 34 56 78")).toBe("33612345678");
    expect(phoneKey("")).toBeNull();
  });

  const now = new Date("2026-09-25T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("waits an hour before calling a cart abandoned, and stops after 14 days", () => {
    expect(isAbandonedCart({ phone: "03123456", updated_at: hoursAgo(0.5) }, [], now)).toBe(false);
    expect(isAbandonedCart({ phone: "03123456", updated_at: hoursAgo(2) }, [], now)).toBe(true);
    expect(isAbandonedCart({ phone: "03123456", updated_at: hoursAgo(24 * 13) }, [], now)).toBe(true);
    expect(isAbandonedCart({ phone: "03123456", updated_at: hoursAgo(24 * 15) }, [], now)).toBe(false);
  });

  it("drops a cart once the same phone orders, however it was typed", () => {
    const cart = { phone: "03 123 456", updated_at: hoursAgo(5) };
    expect(isAbandonedCart(cart, [{ phone: "+961 3 123 456", created_at: hoursAgo(4) }], now)).toBe(false);
    // An order from BEFORE the cart was last touched is not a recovery.
    expect(isAbandonedCart(cart, [{ phone: "03123456", created_at: hoursAgo(30) }], now)).toBe(true);
    // Another customer's order is not this cart's recovery.
    expect(isAbandonedCart(cart, [{ phone: "71 111 222", created_at: hoursAgo(1) }], now)).toBe(true);
  });
});

describe("abandoned cart pricing (the pre-0309 fallback, same rule as the SQL)", () => {
  const products = new Map([
    ["11111111-1111-4111-8111-111111111111", { id: "11111111-1111-4111-8111-111111111111", name: "كنزة", name_en: "Sweater", price: "10", discount_price: "8", is_available: true }],
    ["22222222-2222-4222-8222-222222222222", { id: "22222222-2222-4222-8222-222222222222", name: "Mug", name_en: null, price: 5, discount_price: 6, is_available: false }],
  ]);

  it("prices at today's catalogue, discount wins only when lower, gone products stay unpriced", () => {
    const r = priceCart(
      [
        { product_id: "11111111-1111-4111-8111-111111111111", name: "old name", quantity: 2 },
        { product_id: "22222222-2222-4222-8222-222222222222", name: "Mug", quantity: "3" },
        { product_id: "33333333-3333-4333-8333-333333333333", name: "Gone", quantity: 1 },
        { product_id: "not-a-uuid", name: "Bad", quantity: "lots" },
      ],
      products,
    );
    expect(r.totalEstimate).toBe(31); // 2×8 + 3×5
    expect(r.unpriced).toBe(2);
    expect(r.itemCount).toBe(7);
    expect(r.lines[0].name).toBe("كنزة");
    expect(r.lines[1].available).toBe(false);
    expect(r.lines[2]).toMatchObject({ name: "Gone", unit_price: null, product_id: null });
  });

  it("treats a malformed items value as an empty cart", () => {
    expect(priceCart({ not: "an array" }, products)).toEqual({ lines: [], itemCount: 0, totalEstimate: 0, unpriced: 0 });
    expect(priceCart(null, products).lines).toEqual([]);
  });

  it("offers only coupons a customer could redeem now", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const rows = [
      { code: "OK", is_active: true, expires_at: null, max_uses: null, used_count: 0 },
      { code: "OFF", is_active: false, expires_at: null, max_uses: null, used_count: 0 },
      { code: "OLD", is_active: true, expires_at: "2026-09-01T00:00:00Z", max_uses: null, used_count: 0 },
      { code: "FULL", is_active: true, expires_at: null, max_uses: 5, used_count: 5 },
      { code: "LATER", is_active: true, expires_at: "2026-12-01T00:00:00Z", max_uses: 5, used_count: 4 },
    ];
    expect(usableCoupons(rows, now).map((c) => c.code)).toEqual(["OK", "LATER"]);
  });
});

describe("«آخر إرسال»", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  it("buckets elapsed time", () => {
    expect(sinceParts("2026-09-25T11:59:30Z", now)).toEqual({ unit: "now" });
    expect(sinceParts("2026-09-25T11:15:00Z", now)).toEqual({ unit: "minutes", n: 45 });
    expect(sinceParts("2026-09-25T07:00:00Z", now)).toEqual({ unit: "hours", n: 5 });
    expect(sinceParts("2026-09-22T11:00:00Z", now)).toEqual({ unit: "days", n: 3 });
    expect(sinceParts("garbage", now)).toBeNull();
  });

  it("picks the Arabic count shape", () => {
    expect([1, 2, 3, 10, 11].map((n) => pluralForm(n, "ar"))).toEqual(["one", "two", "few", "few", "many"]);
    expect([1, 2].map((n) => pluralForm(n, "en"))).toEqual(["one", "many"]);
  });

  it("has every dictionary string the buttons use, in both locales", () => {
    for (const d of [ar, en]) {
      const t = d.waActions;
      expect(t).toBeTruthy();
      const ago = t.ago as Record<string, Record<string, string> | string>;
      expect(typeof ago.now).toBe("string");
      for (const unit of ["minutes", "hours", "days"]) {
        for (const f of ["one", "two", "few", "many"]) {
          expect((ago[unit] as Record<string, string>)[f], `${unit}.${f}`).toBeTruthy();
        }
      }
      const keys = t.keys as Record<string, string>;
      for (const key of WA_TEMPLATE_KEYS) expect(keys[key], key).toBeTruthy();
    }
  });
});

describe("tier", () => {
  it("is on every plan, live, with its own copy", () => {
    expect(FEATURES.whatsappActions.plan).toBe("free");
    expect(FEATURES.whatsappActions.state).toBe("live");
    expect(FEATURE_REGISTRY.whatsappActions.status).toBe("available");
  });
});
