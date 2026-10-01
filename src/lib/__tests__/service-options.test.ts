import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lowestOptionPrice, servicePriceLine, type ServiceOption } from "@/lib/service-options";

const opt = (price: number | null, durationMinutes: number | null = null): ServiceOption => ({
  id: String(Math.random()),
  label: "x",
  price,
  durationMinutes,
});

describe("lowestOptionPrice", () => {
  it("is the service price when there are no options", () => {
    expect(lowestOptionPrice(20, undefined)).toBe(20);
    expect(lowestOptionPrice(20, [])).toBe(20);
  });

  it("is the cheapest option", () => {
    expect(lowestOptionPrice(20, [opt(40), opt(25)])).toBe(25);
  });

  it("an option without its own price costs the service price", () => {
    expect(lowestOptionPrice(20, [opt(null), opt(40)])).toBe(20);
  });
});

describe("the booking engine applies the same rule (0321)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0321_service_price_options.sql"),
    "utf8",
  );
  it("option price, else the service's; option duration, else the service's", () => {
    expect(sql).toContain("v_price := coalesce(v_var.price, v_price);");
    expect(sql).toContain("v_dur := coalesce(v_var.duration_minutes, v_dur);");
  });
  it("keeps p_variant_id optional and last, so the deployed call still works", () => {
    expect(sql).toMatch(/p_coupon text default null,\s*\n\s*p_variant_id uuid default null\s*\n\)/);
  });
});

describe("the merchant forms save a service's options (regression, 2026-09-30)", () => {
  // A salon's edit form showed the options and then skipped saving them,
  // because the whole variants save sat behind `if (!simplified)`.
  const edit = readFileSync(
    join(process.cwd(), "src/components/product-edit-form.tsx"),
    "utf8",
  );
  it("the edit form saves variants for a service even in the trimmed form", () => {
    expect(edit).toContain("if (!simplified || isServiceItem) {");
  });
  it("and still leaves add-ons alone in the trimmed form", () => {
    const variantsGate = edit.indexOf("if (!simplified || isServiceItem) {");
    const addonsGate = edit.indexOf("if (!simplified) {", variantsGate);
    expect(addonsGate).toBeGreaterThan(variantsGate);
    expect(edit.indexOf('from("product_options").delete()')).toBeGreaterThan(addonsGate);
  });
});

describe("servicePriceLine (the line beside a service)", () => {
  const fmt = (n: number) => `$${n}`;
  const from = "من {price}";
  it("one price when there are no options", () => {
    expect(servicePriceLine(5, [], fmt, from)).toBe("$5");
  });
  it("every distinct price, low to high, when there are a few", () => {
    expect(servicePriceLine(5, [opt(15), opt(5), opt(10)], fmt, from)).toBe("$5 · $10 · $15");
  });
  it("an option without a price counts as the service price, and duplicates collapse", () => {
    expect(servicePriceLine(5, [opt(null), opt(5), opt(10)], fmt, from)).toBe("$5 · $10");
    expect(servicePriceLine(5, [opt(7), opt(7)], fmt, from)).toBe("$7");
  });
  it("falls back to «من» past four distinct prices", () => {
    expect(servicePriceLine(5, [opt(1), opt(2), opt(3), opt(4), opt(5)], fmt, from)).toBe("من $1");
  });
});
