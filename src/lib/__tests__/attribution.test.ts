import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_SOURCES,
  ATTRIBUTION_WINDOW_MS,
  MATJAR_SOURCES,
  MAX_REMEMBERED_STORES,
  attributionFor,
  beirutMonth,
  countForm,
  firstSegment,
  isMatjarSource,
  monthLabel,
  nextMonth,
  parseTouchState,
  previousMonth,
  recordTouch,
  resolveSource,
  sanitizeDetail,
  sourceFromHost,
  sourceFromInternalPath,
  sourceFromUtm,
  summarizeReport,
  type ReportRowRaw,
  type TouchState,
} from "@/lib/attribution";
import { FEATURES, FEATURE_REGISTRY } from "@/lib/feature-availability";

const STORE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OWN = ["matjarlb.com", "localhost:3200"];
const DAY = 24 * 60 * 60 * 1000;

const resolve = (p: {
  href?: string;
  referrer?: string;
  previousPath?: string | null;
}) =>
  resolveSource({
    href: p.href ?? `https://matjarlb.com/ar/store/${STORE}`,
    referrer: p.referrer ?? "",
    previousPath: p.previousPath ?? null,
    ownHosts: OWN,
  });

describe("the vocabulary", () => {
  it("is the ten sources, and Matjar's are exactly the five discovery surfaces", () => {
    expect([...ATTRIBUTION_SOURCES]).toEqual([
      "matjar_directory",
      "matjar_search",
      "matjar_map",
      "sunday_market",
      "offers_page",
      "direct_link",
      "instagram",
      "whatsapp",
      "google",
      "unknown",
    ]);
    expect([...MATJAR_SOURCES]).toEqual([
      "matjar_directory",
      "matjar_search",
      "matjar_map",
      "sunday_market",
      "offers_page",
    ]);
    for (const s of ["direct_link", "instagram", "whatsapp", "google", "unknown", "untagged"])
      expect(isMatjarSource(s), s).toBe(false);
  });

  it("matches the CHECK constraint and the RPC whitelist in migration 0312", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0312_attribution_events.sql"),
      "utf8",
    );
    for (const s of ATTRIBUTION_SOURCES) expect(sql).toContain(`'${s}'`);
  });
});

describe("internal paths", () => {
  it.each([
    ["/ar/search", "matjar_search"],
    ["/en/search?q=shawarma", "matjar_search"],
    ["/ar/explore", "matjar_directory"],
    ["/ar/category/restaurant", "matjar_directory"],
    ["/ar/categories", "matjar_directory"],
    ["/ar", "matjar_directory"],
    ["/en/", "matjar_directory"],
    ["/ar/map", "matjar_map"],
    ["/ar/market", "sunday_market"],
    ["/ar/market/listing/5", "sunday_market"],
    ["/ar/offers", "offers_page"],
    ["/en/flash", "offers_page"],
    ["/ar/clearance", "offers_page"],
  ])("%s → %s", (path, source) => {
    expect(sourceFromInternalPath(path)).toBe(source);
  });

  it.each(["/ar/store/abc", "/ar/product/x", "/ar/orders", "/ar/favorites", "/ar/jobs"])(
    "%s is not a Matjar discovery surface",
    (path) => expect(sourceFromInternalPath(path)).toBeNull(),
  );

  it("reads the first segment after the locale", () => {
    expect(firstSegment("/ar/store/1")).toBe("store");
    expect(firstSegment("/store/1")).toBe("store");
    expect(firstSegment("/en")).toBe("");
  });
});

describe("resolveSource", () => {
  it("UTM on the store link wins, with the campaign kept in the detail", () => {
    const r = resolve({
      href: `https://matjarlb.com/ar/store/${STORE}?utm_source=instagram&utm_medium=bio&utm_campaign=eid`,
      previousPath: "/ar/search",
      referrer: "https://www.google.com/",
    });
    expect(r).toEqual({ source: "instagram", detail: "utm=instagram;m=bio;c=eid" });
  });

  it("an unknown utm_source is unknown, never guessed", () => {
    expect(resolve({ href: `https://matjarlb.com/ar/store/${STORE}?utm_source=facebook` })).toEqual({
      source: "unknown",
      detail: "utm=facebook",
    });
  });

  it("maps WhatsApp and Google UTM spellings", () => {
    expect(sourceFromUtm("WA")).toBe("whatsapp");
    expect(sourceFromUtm("whatsapp_status")).toBe("whatsapp");
    expect(sourceFromUtm("gmb")).toBe("google");
    expect(sourceFromUtm("tiktok")).toBeNull();
  });

  it("the previous page in the tab names the Matjar surface", () => {
    expect(resolve({ previousPath: "/ar/search" }).source).toBe("matjar_search");
    expect(resolve({ previousPath: "/ar/map" }).source).toBe("matjar_map");
    expect(resolve({ previousPath: "/ar/market" }).source).toBe("sunday_market");
    expect(resolve({ previousPath: "/ar/flash" }).source).toBe("offers_page");
    expect(resolve({ previousPath: "/ar/category/food" }).source).toBe("matjar_directory");
  });

  it("a Matjar page that is not a discovery surface is unknown with where from", () => {
    expect(resolve({ previousPath: `/ar/store/${OTHER}` })).toEqual({
      source: "unknown",
      detail: "from=store",
    });
  });

  it("the previous page beats a stale landing referrer", () => {
    expect(
      resolve({ previousPath: "/ar/search", referrer: "https://l.instagram.com/" }).source,
    ).toBe("matjar_search");
  });

  it("maps external referrers on a landing page", () => {
    expect(resolve({ referrer: "https://www.google.com/" }).source).toBe("google");
    expect(resolve({ referrer: "https://www.google.com.lb/search" }).source).toBe("google");
    expect(resolve({ referrer: "https://l.instagram.com/?u=x" }).source).toBe("instagram");
    expect(resolve({ referrer: "https://wa.me/" }).source).toBe("whatsapp");
    expect(resolve({ referrer: "android-app://com.google.android.googlequicksearchbox/" }).source).toBe(
      "google",
    );
    expect(resolve({ referrer: "android-app://com.instagram.android" }).source).toBe("instagram");
  });

  it("an unmapped referrer is unknown with its host (host only, never the path)", () => {
    expect(resolve({ referrer: "https://m.facebook.com/some/private/path?x=1" })).toEqual({
      source: "unknown",
      detail: "ref=m.facebook.com",
    });
  });

  it("a referrer from Matjar itself (new tab) maps by its path", () => {
    expect(resolve({ referrer: "https://matjarlb.com/ar/search?q=x" }).source).toBe("matjar_search");
    expect(resolve({ referrer: "https://www.matjarlb.com/en/map" }).source).toBe("matjar_map");
    expect(resolve({ referrer: "http://localhost:3200/ar/offers" }).source).toBe("offers_page");
  });

  it("nothing at all is a direct link", () => {
    expect(resolve({})).toEqual({ source: "direct_link", detail: null });
  });

  it("hosts", () => {
    expect(sourceFromHost("google.co.uk")).toBe("google");
    expect(sourceFromHost("notgoogle.com")).toBeNull();
    expect(sourceFromHost("api.whatsapp.com")).toBe("whatsapp");
    expect(sourceFromHost("instagram.com.evil.io")).toBeNull();
  });
});

describe("sanitizeDetail", () => {
  it("keeps utm-like tokens and drops anything that could be personal text", () => {
    expect(sanitizeDetail("utm=ig;c=eid_2026")).toBe("utm=ig;c=eid_2026");
    expect(sanitizeDetail("c=حملة العيد")).toBe("c=");
    expect(sanitizeDetail("rana@example.com")).toBe("ranaexample.com");
    expect(sanitizeDetail("  ")).toBeNull();
    expect(sanitizeDetail("x".repeat(500))!.length).toBe(120);
  });
});

describe("first and last touch", () => {
  const t0 = Date.UTC(2026, 8, 1);

  it("the first touch is both first and last", () => {
    const s = recordTouch({}, STORE, { source: "matjar_search", detail: null }, t0);
    expect(s[STORE].f.s).toBe("matjar_search");
    expect(s[STORE].l.s).toBe("matjar_search");
  });

  it("a later specific touch moves last, keeps first", () => {
    let s = recordTouch({}, STORE, { source: "matjar_search", detail: null }, t0);
    s = recordTouch(s, STORE, { source: "instagram", detail: "utm=ig" }, t0 + DAY);
    expect(s[STORE].f.s).toBe("matjar_search");
    expect(s[STORE].l.s).toBe("instagram");
    expect(attributionFor(s, STORE, t0 + DAY)).toEqual({
      source: "instagram",
      detail: "utm=ig;first=matjar_search",
    });
  });

  it("a direct or unknown touch does not overwrite a specific last touch (last non-direct)", () => {
    let s = recordTouch({}, STORE, { source: "matjar_map", detail: null }, t0);
    s = recordTouch(s, STORE, { source: "direct_link", detail: null }, t0 + 5 * DAY);
    s = recordTouch(s, STORE, { source: "unknown", detail: "ref=x.com" }, t0 + 6 * DAY);
    expect(attributionFor(s, STORE, t0 + 6 * DAY).source).toBe("matjar_map");
  });

  it("expires after 30 days and then says unknown, not a guess", () => {
    const s = recordTouch({}, STORE, { source: "matjar_search", detail: null }, t0);
    expect(attributionFor(s, STORE, t0 + ATTRIBUTION_WINDOW_MS - 1).source).toBe("matjar_search");
    expect(attributionFor(s, STORE, t0 + ATTRIBUTION_WINDOW_MS + 1)).toEqual({
      source: "unknown",
      detail: "no_touch",
    });
    expect(attributionFor({}, OTHER, t0)).toEqual({ source: "unknown", detail: "no_touch" });
  });

  it("an expired entry is replaced by the new touch, first included", () => {
    let s = recordTouch({}, STORE, { source: "matjar_search", detail: null }, t0);
    s = recordTouch(s, STORE, { source: "direct_link", detail: null }, t0 + 40 * DAY);
    expect(s[STORE].f.s).toBe("direct_link");
    expect(s[STORE].l.s).toBe("direct_link");
  });

  it("is per store", () => {
    let s = recordTouch({}, STORE, { source: "matjar_search", detail: null }, t0);
    s = recordTouch(s, OTHER, { source: "instagram", detail: null }, t0);
    expect(attributionFor(s, STORE, t0).source).toBe("matjar_search");
    expect(attributionFor(s, OTHER, t0).source).toBe("instagram");
  });

  it("caps the number of remembered stores, keeping the most recent", () => {
    let s: TouchState = {};
    for (let i = 0; i < MAX_REMEMBERED_STORES + 5; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      s = recordTouch(s, id, { source: "direct_link", detail: null }, t0 + i);
    }
    expect(Object.keys(s).length).toBe(MAX_REMEMBERED_STORES);
    expect(s["00000000-0000-4000-8000-000000000000"]).toBeUndefined();
  });

  it("ignores a non-uuid store id", () => {
    expect(recordTouch({}, "not-a-store", { source: "google", detail: null }, t0)).toEqual({});
  });

  it("parses storage defensively", () => {
    expect(parseTouchState(null)).toEqual({});
    expect(parseTouchState("{broken")).toEqual({});
    expect(parseTouchState("[1,2]")).toEqual({});
    const good = recordTouch({}, STORE, { source: "google", detail: null }, t0);
    const mixed = JSON.stringify({
      ...good,
      bad: good[STORE],
      [OTHER]: { f: { s: "made_up", d: null, t: 1 }, l: { s: "google", d: null, t: 1 } },
    });
    expect(Object.keys(parseTouchState(mixed))).toEqual([STORE]);
  });
});

describe("the Beirut month", () => {
  it("uses Beirut, not UTC, at the month boundary", () => {
    // 2026-09-30 22:30 UTC is already 1 October 01:30 in Beirut (UTC+3).
    expect(beirutMonth(new Date(Date.UTC(2026, 8, 30, 22, 30)))).toBe("2026-10");
    expect(beirutMonth(new Date(Date.UTC(2026, 8, 30, 20, 0)))).toBe("2026-09");
  });

  it("steps months across the year", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth(previousMonth("2026-07"))).toBe("2026-07");
  });

  it("labels months with Western digits", () => {
    expect(monthLabel("2026-09", "en")).toBe("September 2026");
    expect(monthLabel("2026-09", "ar")).toMatch(/2026/);
    expect(monthLabel("2026-09", "ar")).not.toMatch(/[٠-٩]/);
  });
});

describe("count forms", () => {
  it("picks the Arabic form by number", () => {
    expect(countForm(1)).toBe("one");
    expect(countForm(2)).toBe("two");
    expect(countForm(3)).toBe("few");
    expect(countForm(10)).toBe("few");
    expect(countForm(11)).toBe("many");
    expect(countForm(0)).toBe("many");
  });
});

describe("summarizeReport", () => {
  const row = (src: string, o: Partial<ReportRowRaw> = {}): ReportRowRaw => ({
    src,
    n_orders: 0,
    n_bookings: 0,
    new_customers: 0,
    returning_count: 0,
    unidentified_count: 0,
    new_value_usd: 0,
    new_value_lbp: 0,
    value_usd: 0,
    value_lbp: 0,
    ...o,
  });

  it("counts only Matjar sources in the headline", () => {
    const s = summarizeReport([
      row("matjar_search", { n_orders: 3, new_customers: 2, new_value_usd: "40.50" }),
      row("sunday_market", { n_orders: 1, new_customers: 1, new_value_usd: 9.5, new_value_lbp: "900000" }),
      row("instagram", { n_orders: 5, new_customers: 4, new_value_usd: 200 }),
      row("untagged", { n_orders: 7, new_customers: 3, new_value_usd: 70 }),
      row("direct_link", { n_orders: 1 }),
    ]);
    expect(s.matjarNewCustomers).toBe(3);
    expect(s.matjarNewValueUsd).toBe(50);
    expect(s.matjarNewValueLbp).toBe(900000);
    expect(s.matjarOrders).toBe(4);
    expect(s.totalOrders).toBe(17);
    expect(s.totalNewCustomers).toBe(10);
    expect(s.rows[0].src).toBe("instagram");
  });

  it("drops rows with a source it does not know, and keeps NULL bookings as unknown", () => {
    const s = summarizeReport([
      row("matjar_map", { n_orders: 1, n_bookings: null }),
      row("hacked", { n_orders: 99 }),
    ]);
    expect(s.rows.map((r) => r.src)).toEqual(["matjar_map"]);
    expect(s.totalBookings).toBeNull();
    expect(s.matjarBookings).toBeNull();
  });

  it("an empty month is all zeros", () => {
    const s = summarizeReport([]);
    expect(s.matjarNewCustomers).toBe(0);
    expect(s.rows).toEqual([]);
  });
});

describe("feature registration", () => {
  it("is free on every plan and live", () => {
    expect(FEATURES.sourceAttribution.plan).toBe("free");
    expect(FEATURES.sourceAttribution.state).toBe("live");
    expect(FEATURE_REGISTRY.sourceAttribution.status).toBe("available");
  });
});
