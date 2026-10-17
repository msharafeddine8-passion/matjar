import { describe, expect, it } from "vitest";
import { parseAudienceCounts } from "@/lib/audience-counts";

describe("parseAudienceCounts", () => {
  it("reads the RPC's jsonb", () => {
    expect(
      parseAudienceCounts({ followers: 12, customers: "5", all: 15, repeat: 2, vip: 1, inactive: 0 }),
    ).toEqual({ followers: 12, customers: 5, all: 15, repeat: 2, vip: 1, inactive: 0 });
  });

  it("treats missing keys as zero", () => {
    expect(parseAudienceCounts({ followers: 3 })).toEqual({
      followers: 3, customers: 0, all: 0, repeat: 0, vip: 0, inactive: 0,
    });
  });

  it("returns null for no answer (no permission, RPC missing) or junk", () => {
    expect(parseAudienceCounts(null)).toBeNull();
    expect(parseAudienceCounts(undefined)).toBeNull();
    expect(parseAudienceCounts([])).toBeNull();
    expect(parseAudienceCounts({})).toBeNull();
    expect(parseAudienceCounts({ followers: -1 })).toBeNull();
    expect(parseAudienceCounts({ followers: "x" })).toBeNull();
  });
});
