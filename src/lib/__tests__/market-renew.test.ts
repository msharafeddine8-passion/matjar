import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RENEW_COOLDOWN_DAYS, renewOpensAt } from "@/lib/market-renew";

const NOW = new Date("2026-09-29T12:00:00Z");

describe("renewOpensAt", () => {
  it("is null once the listing is a week old", () => {
    expect(renewOpensAt("2026-09-22T12:00:00Z", NOW)).toBeNull();
    expect(renewOpensAt("2026-08-01T00:00:00Z", NOW)).toBeNull();
  });

  it("gives the moment a young listing may be renewed", () => {
    expect(renewOpensAt("2026-09-27T12:00:00Z", NOW)?.toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });

  it("treats an unreadable date as renewable (the database still decides)", () => {
    expect(renewOpensAt("not a date", NOW)).toBeNull();
  });

  it("uses the same number of days as migration 0317", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0317_market_contact_and_renew_cooldown.sql"),
      "utf8",
    );
    expect(sql).toContain(`old.created_at > now() - interval '${RENEW_COOLDOWN_DAYS} days'`);
  });
});
