import { describe, it, expect } from "vitest";
import { countLabel } from "@/lib/plural";
import ar from "@/i18n/dictionaries/ar.json";
import en from "@/i18n/dictionaries/en.json";

// The store's cart bar said «1 أصناف بالسلة»: one fixed plural for every count.
describe("cart bar item count agrees with the number", () => {
  it("Arabic: singular, dual, plural (3-10), singular again from 11", () => {
    const f = ar.store.itemsInCart;
    expect(countLabel(f, 1)).toBe("صنف واحد بالسلة");
    expect(countLabel(f, 2)).toBe("صنفين بالسلة");
    expect(countLabel(f, 3)).toBe("3 أصناف بالسلة");
    expect(countLabel(f, 10)).toBe("10 أصناف بالسلة");
    expect(countLabel(f, 11)).toBe("11 صنف بالسلة");
  });

  it("English: singular for one, plural otherwise", () => {
    const f = en.store.itemsInCart;
    expect(countLabel(f, 1)).toBe("1 item in the cart");
    expect(countLabel(f, 2)).toBe("2 items in the cart");
    expect(countLabel(f, 7)).toBe("7 items in the cart");
  });
});

// Store cards printed «6 اختصاصي» / "1 practitioners".
describe("store card team and section counts have every plural form", () => {
  const forms = ["zero", "one", "two", "few", "many", "other"] as const;
  it.each(["team", "sections"] as const)("%s", (noun) => {
    for (const f of forms) {
      expect(ar.sectorCards.counts[noun][f]).toBeTruthy();
      expect(en.sectorCards.counts[noun][f]).toBeTruthy();
    }
    expect(en.sectorCards.counts[noun].one.startsWith("1 ")).toBe(true);
    expect(en.sectorCards.counts[noun].other).toContain("{n}");
  });
});
