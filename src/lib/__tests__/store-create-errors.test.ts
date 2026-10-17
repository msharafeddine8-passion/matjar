import { describe, expect, it } from "vitest";
import { storeCreateErrorKey } from "@/lib/store-create-errors";

describe("storeCreateErrorKey", () => {
  it("tells the slug unique index apart from a taken name", () => {
    expect(
      storeCreateErrorKey({
        code: "23505",
        message: 'duplicate key value violates unique constraint "stores_slug_unique"',
      }),
    ).toBe("customLinkTaken");
    expect(
      storeCreateErrorKey({
        code: "23505",
        message: 'duplicate key value violates unique constraint "stores_name_key"',
      }),
    ).toBe("storeNameTaken");
  });

  it("maps the slug guard's own exceptions", () => {
    expect(storeCreateErrorKey({ code: "P0001", message: "slug_reserved" })).toBe(
      "customLinkReserved",
    );
    expect(storeCreateErrorKey({ code: "P0001", message: "slug_invalid" })).toBe(
      "customLinkInvalid",
    );
  });

  it("maps an RLS refusal or expired session", () => {
    expect(
      storeCreateErrorKey({
        code: "42501",
        message: 'new row violates row-level security policy for table "stores"',
      }),
    ).toBe("createNotAllowed");
    expect(storeCreateErrorKey({ code: "PGRST301", message: "JWT expired" })).toBe(
      "createNotAllowed",
    );
  });

  it("maps constraint and network failures", () => {
    expect(storeCreateErrorKey({ code: "23514", message: "check" })).toBe("createInvalid");
    expect(storeCreateErrorKey({ code: "", message: "TypeError: Failed to fetch" })).toBe(
      "createNetwork",
    );
  });

  it("never passes raw text through — unknown becomes the generic key", () => {
    expect(storeCreateErrorKey({ code: "XX000", message: "internal error" })).toBe(
      "createFailed",
    );
    expect(storeCreateErrorKey(null)).toBe("createFailed");
  });
});
