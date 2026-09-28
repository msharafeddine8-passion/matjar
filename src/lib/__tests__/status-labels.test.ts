// The point of this file is ONE test: every value the database can hand us has
// words in both languages.
//
// MP-020 shipped because nothing connected the schema to the dictionary. The
// lead statuses were written, the merchant screen used them, and the customer
// screen was handed `{}` — and every check in CI passed, because to TypeScript
// an empty `Record<string, string>` is a perfectly good `Record<string, string>`.
//
// So the enum lists below are TRANSCRIBED FROM THE SQL, by hand, with the
// migration that defines each one named next to it. That is deliberate: this
// file is a second, independent statement of what the database contains, and
// the test is the two statements being made to agree. Reading the values back
// out of the dictionary would make it agree with itself and prove nothing.
//
// When you add a status to the schema, add it here. The test will then fail
// until someone writes the Arabic, which is the entire idea.

import { describe, expect, it } from "vitest";
import ar from "@/i18n/dictionaries/ar.json";
import en from "@/i18n/dictionaries/en.json";
import type { Dictionary } from "@/i18n/get-dictionary";
import {
  ACTIVITY_DOMAINS,
  labelFor,
  labelMap,
  statusTone,
  type LabelDomain,
} from "@/lib/status-labels";

/** The dictionaries are the real JSON; the cast only satisfies the import shape. */
const DICTS: Record<"ar" | "en", Dictionary> = {
  ar: ar as unknown as Dictionary,
  en: en as unknown as Dictionary,
};

/**
 * Every value each domain's column can hold, read out of supabase/migrations.
 *
 * `source` is where to go and check. Where a column is plain `text` with no
 * constraint, the values are the ones the app's own form can write — noted as
 * such, because in that case the SQL comment is documentation and the form is
 * the contract.
 */
const DB_VALUES: Record<LabelDomain, { source: string; values: string[] }> = {
  order: {
    source: "0006_orders.sql — create type order_status as enum",
    values: [
      "pending",
      "accepted",
      "preparing",
      "ready",
      "out_for_delivery",
      "completed",
      "cancelled",
      "rejected",
    ],
  },
  booking: {
    source:
      "0010_bookings.sql — create type booking_status; 0177 adds 'no_show'",
    values: [
      "pending",
      "accepted",
      "scheduled",
      "completed",
      "cancelled",
      "rejected",
      "no_show",
    ],
  },
  craftRequest: {
    source: "0239_craft_requests_and_reviews.sql — check (status in (...))",
    values: [
      "pending",
      "accepted",
      "in_progress",
      "completed",
      "declined",
      "cancelled",
    ],
  },
  serviceRequest: {
    source:
      "0083_service_requests.sql — create type service_request_status; 0207 adds 'countered'",
    values: [
      "pending",
      "quoted",
      "countered",
      "accepted",
      "in_progress",
      "completed",
      "declined",
      "cancelled",
    ],
  },
  stayBooking: {
    source: "0191_accommodation_engine.sql — create type stay_status as enum",
    values: [
      "requested",
      "confirmed",
      "declined",
      "checked_in",
      "checked_out",
      "completed",
      "cancelled",
      "no_show",
    ],
  },
  rentalBooking: {
    source:
      "0298_two_people_cannot_hold_the_same_car.sql — create type rental_status as enum",
    values: [
      "requested",
      "confirmed",
      "declined",
      "picked_up",
      "returned",
      "completed",
      "cancelled",
      "no_show",
    ],
  },
  lead: {
    source: "0190_lead_engine.sql — create type lead_status as enum",
    // The MP-020 ticket said this enum was new/contacted/closed. It is not, and
    // never was: there is no 'closed', and 'scheduled'/'negotiating'/'won'/'lost'
    // were missing from the ticket entirely. Three of the six values a customer
    // can actually see went unmentioned in the bug report about them.
    values: ["new", "contacted", "scheduled", "negotiating", "won", "lost"],
  },
  leadKind: {
    source: "0190_lead_engine.sql — create type lead_kind as enum",
    values: ["contact", "viewing", "test_drive", "offer", "rental_inquiry"],
  },
  storeStatus: {
    source: "0003_stores_and_business_types.sql — create type store_status",
    values: ["pending", "active", "suspended", "rejected"],
  },
  platformRole: {
    source: "0001_auth_profiles.sql — create type platform_role as enum",
    values: ["super_admin", "merchant", "customer", "driver"],
  },
  marketListing: {
    source:
      "0036_sunday_market.sql — check (status in (...)); 0039 adds 'expired'",
    values: ["draft", "pending", "active", "sold", "rejected", "expired"],
  },
  campaignAudience: {
    source:
      "0164_campaign_segments.sql — send_store_campaign() rejects anything else",
    values: ["followers", "customers", "all", "repeat", "vip", "inactive"],
  },
  automationTrigger: {
    source:
      "0117_automations.sql (5) + 0118_time_automations.sql (2) + 0120_abandoned_cart.sql (1)",
    values: [
      "order_created",
      "order_completed",
      "low_stock",
      "new_review",
      "payment_recorded",
      "booking_reminder",
      "customer_inactive",
      "order_abandoned",
    ],
  },
  crmCustomer: {
    source: "0068_business_os_crm_tasks.sql — check (status in (...))",
    values: ["new", "regular", "vip", "inactive"],
  },
  jobType: {
    source:
      "0064_jobs.sql — job_type is plain text; the writable set is JOB_TYPES in lib/jobs.ts",
    values: ["full_time", "part_time", "contract", "remote", "internship"],
  },
  freelanceCategory: {
    source:
      "0065_gigs.sql — category is plain text; the writable set is GIG_CATEGORIES in lib/gigs.ts",
    values: [
      "design",
      "photography",
      "video",
      "writing",
      "voice",
      "acting",
      "programming",
      "tutoring",
      "other",
    ],
  },
  wholesaleCategory: {
    source:
      "0066_wholesale.sql — category is plain text; the writable set is WHOLESALE_CATEGORIES in lib/wholesale.ts",
    values: [
      "food",
      "beverages",
      "clothing",
      "electronics",
      "household",
      "cosmetics",
      "hardware",
      "stationery",
      "other",
    ],
  },
  eventTicket: {
    source:
      "0193_event_tickets.sql — status text default 'reserved'; buy_tickets (0193/0196) never writes another value",
    values: ["reserved"],
  },
  jobApplication: {
    source:
      "0064_jobs.sql — job_applications has no status column; lib/activity.ts gives every row 'sent'",
    values: ["sent"],
  },
};

const DOMAINS = Object.keys(DB_VALUES) as LabelDomain[];

describe("status labels cover the schema", () => {
  it.each(DOMAINS)(
    "%s has an Arabic and an English label for every value the DB can hold",
    (domain) => {
      const { values, source } = DB_VALUES[domain];
      const missing: string[] = [];

      for (const locale of ["ar", "en"] as const) {
        const map = labelMap(DICTS[locale], domain);
        for (const value of values) {
          // A key that is present but empty is the same outage as a missing
          // key — the customer gets a blank pill either way.
          if (!map[value]?.trim()) missing.push(`${locale}.${value}`);
        }
      }

      expect(missing, `${domain} — values from ${source}`).toEqual([]);
    },
  );

  it("labels the lead statuses MP-020 leaked, in Arabic", () => {
    // The regression itself, spelled out. Before the fix the activity screen
    // was handed {} for leads and rendered these six English words.
    const map = labelMap(DICTS.ar, "lead");
    for (const value of DB_VALUES.lead.values) {
      expect(map[value]).not.toBe(value);
      // Arabic labels contain Arabic. A label that is still Latin script here
      // means someone pasted the enum in and called it translated.
      expect(map[value]).toMatch(/\p{Script=Arabic}/u);
    }
  });

  it("gives the customer and the merchant the same words for a lead", () => {
    // Two dictionary blocks for one enum is two things to keep in step. The
    // customer activity screen and the merchant leads inbox both resolve
    // through the "lead" domain, so this is true by construction — the test
    // exists so that splitting them again is a deliberate, visible act.
    expect(labelMap(DICTS.ar, "lead")).toBe(ar.os.leads.status);
  });
});

// The same idea one step further: on the customer activity screen a status is
// not only words, it is also a colour, and a value that has words but no tone
// is a pill that reads as "nothing in particular" (MP-022) — which is exactly
// the state that screen shipped in for all four of its vocabularies.
describe("activity statuses have a tone, not just words", () => {
  const ACTIVITY: LabelDomain[] = Object.values(ACTIVITY_DOMAINS);

  it.each(ACTIVITY)("%s maps every DB value to a non-neutral tone", (domain) => {
    const { values, source } = DB_VALUES[domain];
    // Neutral is the fallback for a value nobody anticipated, so a KNOWN value
    // landing on neutral means it was left out of the table — with one honest
    // exception per domain: the states that genuinely ended in nothing.
    const legitimatelyNeutral = new Set(["cancelled", "lost"]);
    const untoned = values.filter(
      (v) => statusTone(domain, v) === "neutral" && !legitimatelyNeutral.has(v),
    );
    expect(untoned, `${domain} — values from ${source}`).toEqual([]);
  });

  it("keeps the four vocabularies apart on the one screen that mixes them", () => {
    // The bug in one line: a cancelled booking, a completed order and an order
    // out for delivery were the same neutral pill in the same column.
    const tones = [
      statusTone("booking", "cancelled"),
      statusTone("order", "completed"),
      statusTone("order", "out_for_delivery"),
    ];
    expect(new Set(tones).size).toBe(tones.length);
  });

  it("does not throw on a value from a schema newer than this build", () => {
    for (const domain of ACTIVITY) {
      expect(statusTone(domain, "value_from_the_future")).toBe("neutral");
    }
    expect(statusTone("order", null)).toBe("neutral");
  });
});

describe("unknown values", () => {
  it("renders a value nobody anticipated as itself, not as a blank", () => {
    // A merchant who reports "it says pending_v2" has filed a precise bug.
    // A merchant looking at an empty cell has nothing to report at all.
    expect(labelFor(DICTS.ar, "order", "pending_v2")).toBe("pending_v2");
    expect(labelFor(DICTS.en, "lead", "escalated")).toBe("escalated");
  });

  it("does not throw on a value from a schema newer than this build", () => {
    // A status added to the database must never be able to take down the page
    // that displays it — a deploy ordering slip should cost a bad label, not
    // a 500 on the merchant's orders screen.
    for (const domain of DOMAINS) {
      expect(() => labelFor(DICTS.ar, domain, "value_from_the_future")).not.toThrow();
    }
  });

  it("returns an empty string only when there is nothing to label", () => {
    // null/undefined/"" mean the row has no status, not that its status is
    // unknown. Callers guard these with `{value && <Badge…>}` so no empty pill
    // is ever painted.
    for (const nothing of [null, undefined, ""]) {
      expect(labelFor(DICTS.ar, "order", nothing)).toBe("");
    }
  });

  it("never renders an empty label for a value the DB can hold", () => {
    // The two failure modes together: a known value must never come back
    // blank, and an unknown one must never come back blank either.
    for (const domain of DOMAINS) {
      for (const locale of ["ar", "en"] as const) {
        for (const value of [...DB_VALUES[domain].values, "not_a_real_value"]) {
          expect(labelFor(DICTS[locale], domain, value).trim()).not.toBe("");
        }
      }
    }
  });
});
