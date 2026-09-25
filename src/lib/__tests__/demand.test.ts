import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryKeys, regions } from "@/lib/catalog";
import {
  DEMAND_LIMITS,
  DEMAND_SECTIONS,
  DEMAND_SURFACES,
  demandErrorFromMessage,
  normalizeContact,
  normalizeRegion,
  normalizeSection,
  toAsciiDigits,
  validateDemand,
  waDigits,
} from "@/lib/demand";

describe("normalizeContact", () => {
  it("treats empty and whitespace as no contact", () => {
    expect(normalizeContact("")).toEqual({ ok: true, contact: null, kind: null });
    expect(normalizeContact("   ", "whatsapp")).toEqual({
      ok: true,
      contact: null,
      kind: null,
    });
    expect(normalizeContact(null)).toEqual({ ok: true, contact: null, kind: null });
  });

  it("strips separators from phones and keeps the given kind", () => {
    expect(normalizeContact(" 03 123-456 ", "whatsapp")).toEqual({
      ok: true,
      contact: "03123456",
      kind: "whatsapp",
    });
    expect(normalizeContact("(+961) 3.123.456", "phone")).toEqual({
      ok: true,
      contact: "+9613123456",
      kind: "phone",
    });
  });

  it("turns a leading 00 into +", () => {
    expect(normalizeContact("00961 70 123 456")).toMatchObject({
      ok: true,
      contact: "+96170123456",
      kind: "phone",
    });
  });

  it("accepts Arabic-Indic and Persian digits", () => {
    expect(toAsciiDigits("٠٣١٢٣٤٥٦ ۷۸")).toBe("03123456 78");
    expect(normalizeContact("٠٣ ١٢٣ ٤٥٦", "whatsapp")).toMatchObject({
      ok: true,
      contact: "03123456",
    });
  });

  it("infers email from @ and lower-cases it", () => {
    expect(normalizeContact(" Test.Demand@Example.COM ")).toEqual({
      ok: true,
      contact: "test.demand@example.com",
      kind: "email",
    });
  });

  it("refuses malformed values rather than storing them", () => {
    expect(normalizeContact("abc").ok).toBe(false);
    expect(normalizeContact("123", "phone").ok).toBe(false); // too short
    expect(normalizeContact("1".repeat(16), "phone").ok).toBe(false); // too long
    expect(normalizeContact("not-an-email", "email").ok).toBe(false);
    expect(normalizeContact("a@b", "email").ok).toBe(false);
    expect(normalizeContact("03123456", "pigeon").ok).toBe(false);
  });

  it("caps contacts at the shared limit", () => {
    const long = `${"a".repeat(DEMAND_LIMITS.contact)}@x.com`;
    expect(normalizeContact(long, "email").ok).toBe(false);
  });
});

describe("section / region whitelist", () => {
  it("accepts surfaces and sector keys, drops everything else", () => {
    expect(normalizeSection("search")).toBe("search");
    expect(normalizeSection("food")).toBe("food");
    expect(normalizeSection("bogus")).toBeNull();
    expect(normalizeSection(undefined)).toBeNull();
    expect(DEMAND_SECTIONS).toEqual([...DEMAND_SURFACES, ...categoryKeys]);
  });

  it("accepts only the catalog regions", () => {
    for (const r of regions) expect(normalizeRegion(r.key)).toBe(r.key);
    expect(normalizeRegion("mars")).toBeNull();
    expect(normalizeRegion("")).toBeNull();
  });
});

describe("validateDemand", () => {
  it("builds the RPC payload with trimmed, whitelisted values", () => {
    const v = validateDemand({
      q: "  مطاعم   بالميناء ",
      section: "bogus",
      region: "north",
      area: "  الميناء ",
      contact: "03 123 456",
      contactKind: "whatsapp",
      note: "  مسا  ",
    });
    expect(v).toEqual({
      ok: true,
      payload: {
        p_q: "مطاعم بالميناء",
        p_section: null,
        p_region: "north",
        p_area: "الميناء",
        p_contact: "03123456",
        p_contact_kind: "whatsapp",
        p_note: "مسا",
      },
    });
  });

  it("enforces the length limits per field", () => {
    expect(validateDemand({ q: "a" })).toMatchObject({ ok: false, field: "q", error: "query_too_short" });
    // Diacritics alone are not a query (normalize_search strips them).
    expect(validateDemand({ q: "َُ" })).toMatchObject({ ok: false, error: "query_too_short" });
    expect(validateDemand({ q: "ب".repeat(DEMAND_LIMITS.q) }).ok).toBe(true);
    expect(validateDemand({ q: "ب".repeat(DEMAND_LIMITS.q + 1) })).toMatchObject({
      ok: false,
      error: "query_too_long",
    });
    expect(validateDemand({ q: "فول", area: "x".repeat(DEMAND_LIMITS.area + 1) })).toMatchObject({
      ok: false,
      field: "area",
    });
    expect(validateDemand({ q: "فول", note: "x".repeat(DEMAND_LIMITS.note) }).ok).toBe(true);
    expect(validateDemand({ q: "فول", note: "x".repeat(DEMAND_LIMITS.note + 1) })).toMatchObject({
      ok: false,
      field: "note",
    });
    expect(validateDemand({ q: "فول", contact: "abc" })).toMatchObject({
      ok: false,
      field: "contact",
      error: "invalid_contact",
    });
  });
});

describe("demandErrorFromMessage", () => {
  it("maps RPC exceptions to form errors", () => {
    expect(demandErrorFromMessage("demand_rate_limited")).toBe("rate_limited");
    expect(demandErrorFromMessage("demand_invalid_contact")).toBe("invalid_contact");
    expect(demandErrorFromMessage("demand_note_too_long")).toBe("note_too_long");
    expect(demandErrorFromMessage("network down")).toBe("failed");
    expect(demandErrorFromMessage(undefined)).toBe("failed");
  });
});

describe("waDigits", () => {
  it("adds Lebanon's code to local numbers", () => {
    expect(waDigits("03123456")).toBe("9613123456");
    expect(waDigits("70123456")).toBe("96170123456");
    expect(waDigits("+9613123456")).toBe("9613123456");
    expect(waDigits("+33612345678")).toBe("33612345678");
  });
});

// The form and submit_demand must refuse the same things. If one side's number
// moves without the other, the form invites input the database then rejects.
describe("limits match migration 0306", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "0306_demand_requests.sql"),
    "utf8",
  );

  it("uses the same length caps", () => {
    expect(sql).toContain(`char_length(q) between 1 and ${DEMAND_LIMITS.q}`);
    expect(sql).toContain(`char_length(v_q) > ${DEMAND_LIMITS.q}`);
    expect(sql).toContain(`char_length(v_norm) < ${DEMAND_LIMITS.qMin}`);
    expect(sql).toContain(`char_length(area) <= ${DEMAND_LIMITS.area}`);
    expect(sql).toContain(`char_length(v_area) > ${DEMAND_LIMITS.area}`);
    expect(sql).toContain(`char_length(contact) <= ${DEMAND_LIMITS.contact}`);
    expect(sql).toContain(`char_length(v_contact) > ${DEMAND_LIMITS.contact}`);
    expect(sql).toContain(`char_length(note) <= ${DEMAND_LIMITS.note}`);
    expect(sql).toContain(`char_length(v_note) > ${DEMAND_LIMITS.note}`);
  });

  it("uses the same rate limits and retention", () => {
    expect(sql).toMatch(new RegExp(`interval '24 hours'\\) >= ${DEMAND_LIMITS.perDay}`));
    expect(sql).toMatch(
      new RegExp(`interval '60 seconds'\\) >= ${DEMAND_LIMITS.anonSameQueryPerMinute} then`),
    );
    expect(sql).toMatch(
      new RegExp(`interval '60 seconds'\\) >= ${DEMAND_LIMITS.anonGlobalPerMinute} then`),
    );
    expect(sql).toContain(`interval '${DEMAND_LIMITS.retentionDays} days'`);
  });

  it("whitelists the same regions and sections", () => {
    expect(sql).toContain(
      `p_region in (${regions.map((r) => `'${r.key}'`).join(",")})`,
    );
    for (const s of DEMAND_SECTIONS) expect(sql).toContain(`'${s}'`);
    const listed = sql.match(/v_section := case when p_section in \(([\s\S]*?)\)/);
    expect(listed).not.toBeNull();
    const inSql = (listed![1].match(/'[^']+'/g) ?? []).map((x) => x.slice(1, -1));
    expect([...inSql].sort()).toEqual([...DEMAND_SECTIONS].sort());
  });
});
