import { describe, expect, it } from "vitest";
import ar from "@/i18n/dictionaries/ar.json";
import en from "@/i18n/dictionaries/en.json";
import type { Dictionary } from "@/i18n/get-dictionary";
import {
  ACTIVITY_KINDS,
  againAction,
  againCandidates,
  countNeedingCustomer,
  formatDay,
  formatDayRange,
  formatInstant,
  mergeCart,
  needsCustomer,
  normaliseActivity,
  parseCart,
  planReorder,
  primaryAction,
  type ActivityItem,
  type ReorderLine,
} from "@/lib/activity";
import { ACTIVITY_DOMAINS, labelFor, statusTone } from "@/lib/status-labels";

// 2026-09-28 12:00 Beirut (EEST, +3).
const NOW = Date.parse("2026-09-28T09:00:00Z");
const TODAY = "2026-09-28";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const store = (name: string) => ({ name });

function item(p: Partial<ActivityItem> & Pick<ActivityItem, "kind" | "status">): ActivityItem {
  return {
    id: U(1),
    storeName: "",
    href: "/ar/x",
    title: "",
    createdAt: "2026-09-01T10:00:00Z",
    leadKind: null,
    total: null,
    needsCustomer: false,
    startsOn: null,
    endsOn: null,
    quantity: null,
    storeId: null,
    productId: null,
    providerId: null,
    ...p,
  };
}

describe("normaliseActivity — ten tables, one row shape", () => {
  const rows = normaliseActivity(
    {
      orders: [{ id: U(1), status: "out_for_delivery", total: "12.50", created_at: "2026-09-20T10:00:00Z", updated_at: null, store_id: U(90), stores: store("Bakery") }],
      bookings: [{ id: U(2), status: "scheduled", service_name: "Haircut", requested_date: "2026-09-30", created_at: "2026-09-21T10:00:00Z", store_id: U(91), product_id: U(80), stores: store("Salon") }],
      stays: [{ id: U(3), status: "confirmed", check_in: "2026-10-03", check_out: "2026-10-05", grand_total: 240, created_at: "2026-09-22T10:00:00Z", store_id: U(92), stores: store("Chalet"), accommodation_units: { name: "غرفة", name_en: "Room" } }],
      rentals: [{ id: U(4), status: "returned", pickup_date: "2026-09-01", return_date: "2026-09-04", grand_total: 90, created_at: "2026-08-20T10:00:00Z", store_id: U(93), stores: store("Cars"), rental_vehicles: { name: "كيا", name_en: null } }],
      tickets: [{ id: U(5), status: null, quantity: 2, created_at: "2026-09-23T10:00:00Z", store_id: U(94), stores: store("Venue"), event_ticket_types: { name: "عادي", name_en: "Regular" } }],
      services: [{ id: U(6), status: "quoted", description: "Paint the flat", quote_amount: "300", counter_amount: null, created_at: "2026-09-24T10:00:00Z", store_id: U(95), stores: store("Painters") }],
      crafts: [{ id: U(7), status: "completed", description: "Leak", created_at: "2026-09-25T10:00:00Z", provider_id: U(70), craft_providers: store("Abu Ali"), craft_reviews: [] }],
      leads: [{ id: U(8), status: "new", kind: "viewing", message: null, created_at: "2026-09-26T10:00:00Z", store_id: U(96), stores: store("Realty") }],
      jobs: [{ id: U(9), created_at: "2026-09-27T10:00:00Z", job_id: U(60), job_postings: null }],
      listings: [{ id: U(10), status: "rejected", title: "Bike", price: 50, created_at: "2026-09-27T12:00:00Z" }],
    },
    "en",
    NOW,
  );
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));

  it("produces one row per source row, every kind represented, newest first", () => {
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(ACTIVITY_KINDS));
    const dates = rows.map((r) => r.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("keeps money only where the row states it, as a number", () => {
    expect(by.order.total).toBe(12.5);
    expect(by.stay.total).toBe(240);
    expect(by.service.total).toBe(300);
    expect(by.booking.total).toBeNull();
    expect(by.job.total).toBeNull();
  });

  it("links each kind to where its next step can be taken", () => {
    expect(by.order.href).toBe(`/en/orders/${U(1)}`);
    expect(by.booking.href).toBe(`/en/bookings/${U(2)}`);
    // No customer detail screen: the store page holds the panel/quote list.
    expect(by.stay.href).toBe(`/en/store/${U(92)}`);
    expect(by.service.href).toBe(`/en/store/${U(95)}`);
    expect(by.craft.href).toBe(`/en/crafts/requests/${U(7)}`);
    expect(by.lead.href).toBe(`/en/inquiries/${U(8)}`);
    expect(by.job.href).toBe(`/en/jobs/${U(60)}`);
    expect(by.listing.href).toBe(`/en/market/${U(10)}`);
  });

  it("uses the English name where one exists, the Arabic one otherwise", () => {
    expect(by.stay.title).toBe("Room");
    expect(by.rental.title).toBe("كيا");
    expect(by.ticket.title).toBe("Regular");
  });

  it("reads a null ticket status as reserved and gives applications `sent`", () => {
    expect(by.ticket.status).toBe("reserved");
    expect(by.ticket.quantity).toBe(2);
    expect(by.job.status).toBe("sent");
    // A closed posting is hidden by RLS: nothing is invented in its place.
    expect(by.job.storeName).toBe("");
    expect(by.job.title).toBe("");
  });

  it("flags only what is the customer's move", () => {
    expect(by.booking.needsCustomer).toBe(true); // scheduled, in two days
    expect(by.stay.needsCustomer).toBe(true); // confirmed, upcoming
    expect(by.service.needsCustomer).toBe(true); // a quote to answer
    expect(by.craft.needsCustomer).toBe(true); // finished, not rated
    expect(by.listing.needsCustomer).toBe(true); // refused by moderation
    expect(by.order.needsCustomer).toBe(false); // on the van: nothing to do
    expect(by.lead.needsCustomer).toBe(false);
    expect(by.job.needsCustomer).toBe(false);
    expect(by.ticket.needsCustomer).toBe(false);
    expect(countNeedingCustomer(rows)).toBe(5);
  });
});

describe("needsCustomer — per kind, in Beirut days", () => {
  it("stops counting an appointment once its day has passed", () => {
    expect(needsCustomer("booking", "accepted", { today: TODAY, startsOn: "2026-09-28" })).toBe(true);
    expect(needsCustomer("booking", "accepted", { today: TODAY, startsOn: "2026-09-27" })).toBe(false);
    expect(needsCustomer("stay", "confirmed", { today: TODAY, startsOn: "2026-09-25", endsOn: "2026-09-29" })).toBe(true);
    expect(needsCustomer("rental", "confirmed", { today: TODAY, startsOn: "2026-09-20", endsOn: "2026-09-22" })).toBe(false);
  });

  it("asks for a review only once, and only for a month", () => {
    const base = { today: TODAY, nowMs: NOW };
    expect(needsCustomer("order", "completed", { ...base, finishedAt: "2026-09-20T00:00:00Z" })).toBe(true);
    expect(needsCustomer("order", "completed", { ...base, finishedAt: "2026-08-01T00:00:00Z" })).toBe(false);
    expect(needsCustomer("order", "completed", { ...base, reviewed: true, finishedAt: "2026-09-27T00:00:00Z" })).toBe(false);
    expect(needsCustomer("craft", "completed", { today: TODAY, reviewed: true })).toBe(false);
  });

  it("treats a countered quote as the merchant's move, not the customer's", () => {
    expect(needsCustomer("service", "countered", { today: TODAY })).toBe(false);
  });

  it("marks orders from an already-reviewed store as done", () => {
    const rows = normaliseActivity(
      {
        orders: [{ id: U(1), status: "completed", total: 5, created_at: "2026-09-27T10:00:00Z", updated_at: "2026-09-27T12:00:00Z", store_id: U(90), stores: null }],
        reviewedStoreIds: [U(90)],
      },
      "ar",
      NOW,
    );
    expect(rows[0].needsCustomer).toBe(false);
  });

  it("reads the day in Beirut, not UTC", () => {
    // 22:30 UTC on the 27th is already the 28th in Beirut.
    const late = Date.parse("2026-09-27T22:30:00Z");
    const [row] = normaliseActivity(
      { bookings: [{ id: U(2), status: "accepted", service_name: null, requested_date: "2026-09-27", created_at: "2026-09-01T00:00:00Z", store_id: U(1), product_id: null, stores: null }] },
      "ar",
      late,
    );
    expect(row.needsCustomer).toBe(false);
  });
});

describe("status vocabulary per kind", () => {
  const dicts = { ar: ar as unknown as Dictionary, en: en as unknown as Dictionary };
  const samples: Record<string, string[]> = {
    order: ["pending", "completed"],
    booking: ["scheduled", "no_show"],
    stay: ["requested", "checked_in"],
    rental: ["picked_up", "returned"],
    ticket: ["reserved"],
    service: ["quoted", "countered"],
    craft: ["in_progress"],
    lead: ["negotiating"],
    job: ["sent"],
    listing: ["pending", "rejected"],
  };

  it("every kind has a domain, words in both languages and a tone", () => {
    for (const kind of ACTIVITY_KINDS) {
      const domain = ACTIVITY_DOMAINS[kind];
      expect(domain, kind).toBeTruthy();
      for (const status of samples[kind]) {
        for (const d of Object.values(dicts)) {
          const w = labelFor(d, domain, status);
          expect(w, `${kind}.${status}`).not.toBe(status);
          expect(w.trim()).not.toBe("");
        }
        expect(statusTone(domain, status), `${kind}.${status}`).not.toBe("neutral");
      }
    }
  });

  it("does not let two kinds share one meaning for `pending`", () => {
    // Same raw word, different promise: a listing waits on moderation, an
    // order waits on the shop. Different words on screen.
    expect(labelFor(dicts.ar, ACTIVITY_DOMAINS.listing, "pending")).not.toBe(
      labelFor(dicts.ar, ACTIVITY_DOMAINS.order, "pending"),
    );
  });

  it("has an action label for every action key in both languages", () => {
    for (const d of [ar, en]) {
      for (const v of Object.values(d.activityCenter.actions)) {
        expect(String(v).trim()).not.toBe("");
      }
      expect(Object.keys(d.activityCenter.actions).sort()).toEqual(
        Object.keys(ar.activityCenter.actions).sort(),
      );
    }
  });
});

describe("next-action rules", () => {
  it("tracks an open order and asks for a review of a finished one", () => {
    expect(primaryAction(item({ kind: "order", status: "preparing" }), "ar").key).toBe("track");
    expect(primaryAction(item({ kind: "order", status: "completed", needsCustomer: true }), "ar").key).toBe("review");
    expect(primaryAction(item({ kind: "order", status: "completed" }), "ar").key).toBe("viewOrder");
    expect(primaryAction(item({ kind: "order", status: "cancelled" }), "ar").key).toBe("viewOrder");
  });

  it("sends a refused or expired listing to its edit screen", () => {
    const a = primaryAction(item({ kind: "listing", status: "rejected", id: U(10) }), "ar");
    expect(a).toEqual({ key: "fixListing", href: `/ar/market/${U(10)}/edit` });
    expect(primaryAction(item({ kind: "listing", status: "expired" }), "ar").key).toBe("renewListing");
    expect(primaryAction(item({ kind: "listing", status: "active" }), "ar").key).toBe("viewListing");
  });

  it("says 'answer the quote' only while one is waiting", () => {
    expect(primaryAction(item({ kind: "service", status: "quoted" }), "ar").key).toBe("answerQuote");
    expect(primaryAction(item({ kind: "service", status: "countered" }), "ar").key).toBe("viewRequest");
  });

  it("offers 'again' only on rows that have ended", () => {
    const s = U(90);
    expect(againAction(item({ kind: "order", status: "completed", storeId: s }), "ar")?.key).toBe("reorder");
    expect(againAction(item({ kind: "order", status: "preparing", storeId: s }), "ar")).toBeNull();
    expect(againAction(item({ kind: "booking", status: "scheduled", storeId: s }), "ar")).toBeNull();
    expect(againAction(item({ kind: "booking", status: "completed", storeId: s, productId: U(80) }), "ar")).toEqual({
      key: "rebook",
      href: `/ar/store/${s}?service=${U(80)}`,
    });
    expect(againAction(item({ kind: "booking", status: "completed", storeId: s }), "ar")?.href).toBe(`/ar/store/${s}`);
    expect(againAction(item({ kind: "stay", status: "checked_out", storeId: s }), "ar")?.key).toBe("rebook");
    expect(againAction(item({ kind: "craft", status: "completed", providerId: U(70) }), "en")).toEqual({
      key: "hireAgain",
      href: `/en/crafts/p/${U(70)}`,
    });
    expect(againAction(item({ kind: "lead", status: "won", storeId: s }), "ar")).toBeNull();
    expect(againAction(item({ kind: "job", status: "sent" }), "ar")).toBeNull();
  });

  it("puts one 'again' per place in the rail, newest first, capped", () => {
    const s = U(90);
    const rows = [
      item({ id: U(1), kind: "order", status: "completed", storeId: s, createdAt: "2026-09-01T00:00:00Z" }),
      item({ id: U(2), kind: "order", status: "completed", storeId: s, createdAt: "2026-09-10T00:00:00Z" }),
      item({ id: U(3), kind: "craft", status: "completed", providerId: U(70), createdAt: "2026-09-05T00:00:00Z" }),
      item({ id: U(4), kind: "order", status: "pending", storeId: U(91), createdAt: "2026-09-20T00:00:00Z" }),
    ];
    const rail = againCandidates(rows, "ar");
    expect(rail.map((r) => r.item.id)).toEqual([U(2), U(3)]);
    expect(againCandidates(rows, "ar", 1)).toHaveLength(1);
  });
});

describe("reorder diff", () => {
  const product = (p: Partial<NonNullable<ReorderLine["product"]>> = {}) => ({
    name: "Bread",
    price: 2,
    discountPrice: null,
    flashPrice: null,
    flashStart: null,
    flashEnd: null,
    stock: null,
    status: "active",
    isAvailable: true,
    deletedAt: null,
    itemKind: "product",
    hasVariants: false,
    ...p,
  });
  const line = (p: Partial<ReorderLine>): ReorderLine => ({
    productId: U(1),
    variantId: null,
    name: "Bread",
    unitPrice: 2,
    quantity: 1,
    product: product(),
    ...p,
  });

  it("puts back an unchanged item as-is", () => {
    const plan = planReorder([line({ quantity: 3 })], NOW);
    expect(plan.add).toEqual({ [U(1)]: 3 });
    expect(plan.priceChanged).toBe(0);
    expect(plan.dropped).toEqual([]);
    expect(plan.nowTotal).toBe(6);
  });

  it("shows a price change against today's effective price", () => {
    const plan = planReorder(
      [line({ unitPrice: 2, product: product({ price: 3, discountPrice: 2.5 }) })],
      NOW,
    );
    expect(plan.priceChanged).toBe(1);
    expect(plan.kept[0]).toMatchObject({ was: 2, now: 2.5 });
    // A running flash sale wins, exactly as at the till.
    const flash = planReorder(
      [line({ product: product({ price: 3, flashPrice: 1, flashStart: "2026-09-27T00:00:00Z", flashEnd: "2026-09-29T00:00:00Z" }) })],
      NOW,
    );
    expect(flash.kept[0].now).toBe(1);
  });

  it("drops what cannot honestly go back in the grid cart, and says why", () => {
    const plan = planReorder(
      [
        line({ productId: U(2), name: "Old", product: null }),
        line({ productId: U(3), product: product({ status: "draft" }) }),
        line({ productId: U(4), product: product({ isAvailable: false }) }),
        line({ productId: U(5), variantId: U(50) }),
        line({ productId: U(6), product: product({ hasVariants: true }) }),
        line({ productId: U(7), product: product({ itemKind: "service" }) }),
        line({ productId: U(8), product: product({ stock: 0 }) }),
        line({ productId: null }),
      ],
      NOW,
    );
    expect(plan.add).toEqual({});
    expect(plan.dropped.map((d) => d.reason)).toEqual([
      "gone",
      "unavailable",
      "unavailable",
      "hasOptions",
      "hasOptions",
      "service",
      "gone",
      "outOfStock",
    ]);
  });

  it("lowers a quantity to the stock and flags it", () => {
    const plan = planReorder([line({ quantity: 5, product: product({ stock: 2 }) })], NOW);
    expect(plan.add).toEqual({ [U(1)]: 2 });
    expect(plan.kept[0].reduced).toBe(true);
  });

  it("joins the same product ordered on two lines", () => {
    const plan = planReorder([line({ quantity: 1 }), line({ quantity: 2 })], NOW);
    expect(plan.add).toEqual({ [U(1)]: 3 });
    expect(plan.kept).toHaveLength(1);
  });

  it("merges into the cart without wiping it and without doubling on a second tap", () => {
    const existing = { [U(9)]: 1, [U(1)]: 1 };
    const once = mergeCart(existing, { [U(1)]: 3 });
    expect(once).toEqual({ [U(9)]: 1, [U(1)]: 3 });
    expect(mergeCart(once, { [U(1)]: 3 })).toEqual(once);
  });

  it("reads a stored cart defensively", () => {
    expect(parseCart(null)).toEqual({});
    expect(parseCart("not json")).toEqual({});
    expect(parseCart("[1,2]")).toEqual({});
    expect(parseCart(JSON.stringify({ a: 2, b: 0, c: "x", d: 1.7 }))).toEqual({ a: 2, d: 1 });
  });
});

describe("dates: Beirut, Western digits", () => {
  it("never renders Eastern Arabic digits", () => {
    const s = formatInstant("2026-09-27T22:30:00Z", "ar") + formatDay("2026-10-03", "ar");
    expect(s).not.toMatch(/[٠-٩]/);
    expect(s).toMatch(/[0-9]/);
  });

  it("puts a late-evening instant on the Beirut day", () => {
    expect(formatInstant("2026-09-27T22:30:00Z", "en")).toMatch(/^28 Sept?$/);
  });

  it("does not shift a date-only column by a day", () => {
    expect(formatDay("2026-10-03", "en")).toContain("3");
    expect(formatDayRange("2026-10-03", "2026-10-03", "en")).toBe(formatDay("2026-10-03", "en"));
    expect(formatDayRange(null, null, "en")).toBe("");
    expect(formatDay("garbage", "en")).toBe("");
  });
});
