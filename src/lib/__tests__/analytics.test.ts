import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  MAX_BATCH,
  buildEvent,
  eventsEndpoint,
  isEventName,
  toBatches,
  track,
  type WireEvent,
} from "@/lib/analytics";

const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STORE = "11111111-1111-4111-8111-111111111111";

describe("the event whitelist", () => {
  it("is exactly the sixteen §34 names", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "search_started",
        "search_submitted",
        "search_result_clicked",
        "zero_result",
        "business_viewed",
        "offering_viewed",
        "favorite_added",
        "contact_clicked",
        "add_to_cart",
        "booking_started",
        "service_request_created",
        "checkout_started",
        "transaction_completed",
        "job_viewed",
        "job_applied",
        "project_posted",
      ].sort(),
    );
  });

  it("matches the table CHECK and the RPC whitelist in migration 0312", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0312_attribution_events.sql"),
      "utf8",
    );
    const checkBlock = sql.slice(sql.indexOf("product_events_name_check"));
    for (const n of EVENT_NAMES) expect(checkBlock).toContain(`'${n}'`);
    expect(isEventName("purchase")).toBe(false);
  });
});

describe("buildEvent — no PII can ride along", () => {
  it("keeps ids and tokens", () => {
    expect(
      buildEvent(
        "offering_viewed",
        {
          storeId: STORE.toUpperCase(),
          offeringId: STORE,
          sector: "Restaurant",
          offeringType: "product",
          region: "beirut",
          sourceSurface: "store:whatsapp",
        },
        SID,
      ),
    ).toEqual({
      n: "offering_viewed",
      s: SID,
      st: STORE,
      o: STORE,
      sec: "restaurant",
      ot: "product",
      r: "beirut",
      src: "store:whatsapp",
    });
  });

  it("drops anything that is not an id or a short token", () => {
    const e = buildEvent(
      "contact_clicked",
      {
        storeId: "03 123 456",
        offeringId: "rana@example.com",
        sector: "رانا حداد",
        offeringType: "a sentence with spaces",
        region: "+96103123456",
        sourceSurface: "x".repeat(41),
      },
      SID,
    );
    expect(e).toEqual({ n: "contact_clicked", s: SID });
  });

  it("refuses an unknown name or a missing session", () => {
    expect(buildEvent("page_view", {}, SID)).toBeNull();
    expect(buildEvent("business_viewed", {}, "not-a-uuid")).toBeNull();
  });
});

describe("batching", () => {
  it("splits into bodies of at most 20 events, each valid JSON", () => {
    const q: WireEvent[] = Array.from({ length: 45 }, () => ({ n: "business_viewed", s: SID }));
    const b = toBatches(q);
    expect(b.length).toBe(3);
    expect(b.map((x) => (JSON.parse(x) as unknown[]).length)).toEqual([MAX_BATCH, MAX_BATCH, 5]);
    expect(toBatches([])).toEqual([]);
  });

  it("posts to the log_events RPC with the public key as a query parameter", () => {
    expect(eventsEndpoint("https://x.supabase.co/", "sb_publishable_A+B")).toBe(
      "https://x.supabase.co/rest/v1/rpc/log_events?apikey=sb_publishable_A%2BB",
    );
  });

  it("track() is a no-op on the server and never throws", () => {
    expect(() => track("business_viewed", { storeId: STORE })).not.toThrow();
  });
});
