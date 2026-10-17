import { describe, it, expect } from "vitest";
import {
  nameTokens,
  pickSimilar,
  sharesNameToken,
} from "@/lib/related-match";

const self = {
  id: "p0",
  storeId: "butcher",
  sectionId: "sec-sausage",
  name: "سجق مشوي",
  nameEn: "Grilled sausages",
};

const c = (
  id: string,
  storeId: string,
  name: string,
  sectionId: string | null = null,
  nameEn: string | null = null,
) => ({ id, storeId, name, nameEn, sectionId });

describe("nameTokens", () => {
  it("folds the article, alef forms and English plurals", () => {
    expect(nameTokens("السجق")).toEqual(new Set(["سجق"]));
    expect(nameTokens("أرز")).toEqual(nameTokens("ارز"));
    expect(nameTokens("Sausages")).toEqual(new Set(["sausage"]));
  });

  it("drops numbers, short words and stopwords", () => {
    expect(nameTokens("علبة 500 غرام من")).toEqual(new Set());
  });
});

describe("pickSimilar — never mixes unrelated items", () => {
  it("a butcher's sausages do not recommend another retail store's soap", () => {
    const picked = pickSimilar(self, [c("soap", "soapshop", "صابون زيت زيتون")], 6);
    expect(picked).toEqual([]);
  });

  it("same section of the same store first, then same-store name matches, then other stores", () => {
    const picked = pickSimilar(
      self,
      [
        c("other-sausage", "butcher2", "سجق بلدي"),
        c("unrelated-own", "butcher", "لحم غنم"),
        c("own-name-match", "butcher", "سجق حر"),
        c("own-section", "butcher", "مقانق", "sec-sausage"),
      ],
      6,
    ).map((p) => p.id);
    expect(picked).toEqual(["own-section", "own-name-match", "other-sausage"]);
  });

  it("matches across languages through the English name", () => {
    const picked = pickSimilar(
      self,
      [c("en", "butcher2", "نقانق", null, "Beef sausage")],
      6,
    );
    expect(picked.map((p) => p.id)).toEqual(["en"]);
  });

  it("never returns the item itself and respects the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      c(`s${i}`, "other", `سجق ${i}`),
    );
    const picked = pickSimilar(self, [c("p0", "butcher", "سجق"), ...many], 4);
    expect(picked).toHaveLength(4);
    expect(picked.some((p) => p.id === "p0")).toBe(false);
  });

  it("sharesNameToken is false for an item with no meaningful words", () => {
    expect(sharesNameToken(new Set(), "سجق")).toBe(false);
  });
});
