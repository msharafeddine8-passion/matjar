import { describe, expect, it } from "vitest";
import {
  addToCartMap,
  cartCanCarry,
  cartCount,
  cartKey,
  parseCart,
} from "../store-cart";

describe("store-cart", () => {
  it("uses the store page's key", () => {
    expect(cartKey("abc")).toBe("matjar-cart-abc");
  });

  it("parses a stored basket and drops junk", () => {
    expect(parseCart('{"a":2,"b":0,"c":"x","d":-1,"e":1.7}')).toEqual({
      a: 2,
      e: 1,
    });
    expect(parseCart(null)).toEqual({});
    expect(parseCart("not json")).toEqual({});
    expect(parseCart("[1,2]")).toEqual({});
  });

  it("adds onto an existing line and caps at stock", () => {
    expect(addToCartMap({ a: 1 }, "a", 2)).toEqual({ a: 3 });
    expect(addToCartMap({}, "b", 1)).toEqual({ b: 1 });
    expect(addToCartMap({ a: 4 }, "a", 3, 5)).toEqual({ a: 5 });
    expect(addToCartMap({}, "a", 0)).toEqual({ a: 1 });
  });

  it("does not mutate its input", () => {
    const cart = { a: 1 };
    addToCartMap(cart, "a", 1);
    expect(cart).toEqual({ a: 1 });
  });

  it("only carries plain products", () => {
    expect(cartCanCarry({ variants: 0, addons: 0, modifierGroups: 0 })).toBe(true);
    expect(cartCanCarry({ variants: 2, addons: 0, modifierGroups: 0 })).toBe(false);
    expect(cartCanCarry({ variants: 0, addons: 1, modifierGroups: 0 })).toBe(false);
    expect(cartCanCarry({ variants: 0, addons: 0, modifierGroups: 1 })).toBe(false);
  });

  it("counts units", () => {
    expect(cartCount({ a: 2, b: 3 })).toBe(5);
    expect(cartCount({})).toBe(0);
  });
});
