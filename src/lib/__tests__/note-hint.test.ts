import { describe, it, expect } from "vitest";
import { noteHintKey } from "@/lib/note-hint";
import { categoryKeys } from "@/lib/catalog";
import ar from "@/i18n/dictionaries/ar.json";
import en from "@/i18n/dictionaries/en.json";

describe("noteHintKey", () => {
  it("keeps the food example where it belongs", () => {
    expect(noteHintKey("food")).toBe("food");
  });

  // The bug: a cotton T-shirt in a retail shop was told "no onions, extra spicy".
  it("does not give a retail shop a restaurant example", () => {
    expect(noteHintKey("retail")).not.toBe("food");
    expect(noteHintKey("retail")).toBe("retail");
  });

  it("gives a menu item the kitchen example", () => {
    expect(noteHintKey("retail", "addToOrder")).toBe("food");
    expect(noteHintKey(null, "addToOrder")).toBe("food");
    expect(noteHintKey("retail", "addToCart")).toBe("retail");
  });

  it("falls back to the neutral prompt rather than inventing one", () => {
    expect(noteHintKey("realEstate")).toBe("default");
    expect(noteHintKey("contractors")).toBe("default");
    expect(noteHintKey(null)).toBe("default");
    expect(noteHintKey(undefined)).toBe("default");
    expect(noteHintKey("something-we-added-later")).toBe("default");
  });

  it("resolves every sector in the catalogue to a usable key", () => {
    for (const c of categoryKeys) {
      expect(typeof noteHintKey(c)).toBe("string");
    }
  });
});

// A hint key with no string behind it renders an empty placeholder, which is
// how this kind of mapping usually rots: a sector is added, the map is updated,
// the dictionaries are not.
describe("every hint key has copy in both dictionaries", () => {
  const arHints = (ar as { product: { itemNoteHints: Record<string, string> } })
    .product.itemNoteHints;
  const enHints = (en as { product: { itemNoteHints: Record<string, string> } })
    .product.itemNoteHints;

  it("covers every sector and the default", () => {
    const needed = new Set(["default", ...categoryKeys.map((c) => noteHintKey(c))]);
    for (const key of needed) {
      expect(arHints[key], `missing ar hint: ${key}`).toBeTruthy();
      expect(enHints[key], `missing en hint: ${key}`).toBeTruthy();
    }
  });

  it("has the same keys in Arabic and English", () => {
    expect(Object.keys(arHints).sort()).toEqual(Object.keys(enHints).sort());
  });
});
