import { describe, it, expect } from "vitest";
import {
  CHIP_PERMISSION,
  QUICK_CHIPS,
  addDaysYmd,
  beirutDay,
  beirutDayStart,
  beirutOffsetMinutes,
  beirutTomorrow,
  beirutWeeks,
  beirutYmd,
  bumpLatest,
  chipAllowed,
  fillOffer,
  inRange,
  inactiveCustomers,
  isLowStock,
  isUnconfirmedOrder,
  pctChange,
  totalsByCurrency,
  weekdayOfYmd,
} from "@/lib/quick-panel";
import { phoneKey } from "@/lib/wa-templates";

describe("Beirut calendar", () => {
  it("knows Beirut's offset in summer and winter (Intl, not a constant)", () => {
    expect(beirutOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(180);
    expect(beirutOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(120);
  });

  it("a day starts at Beirut midnight, not UTC midnight", () => {
    expect(beirutDayStart("2026-09-25").toISOString()).toBe("2026-09-24T21:00:00.000Z");
    expect(beirutDayStart("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });

  it("survives both DST changes (Lebanon moves its clocks at midnight)", () => {
    // Spring forward, Sunday 2026-03-29: 00:00 does not exist, the day starts at
    // 01:00 +03:00 = 22:00Z the evening before.
    const spring = beirutDay("2026-03-29");
    expect(spring.start.toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(beirutYmd(spring.start)).toBe("2026-03-29");
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3_600_000);
    // Fall back, Sunday 2026-10-25: the previous day is 25 hours long.
    const before = beirutDay("2026-10-24");
    expect(before.end.getTime() - before.start.getTime()).toBe(25 * 3_600_000);
    expect(beirutDayStart("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("'tomorrow' after 21:00 UTC is Beirut's day after tomorrow-in-UTC", () => {
    // 22:30Z on the 25th is 01:30 on the 26th in Beirut → tomorrow is the 27th.
    expect(beirutTomorrow(new Date("2026-09-25T22:30:00Z")).ymd).toBe("2026-09-27");
    expect(beirutTomorrow(new Date("2026-09-25T20:30:00Z")).ymd).toBe("2026-09-26");
  });

  it("does calendar arithmetic across months and years", () => {
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOfYmd("2026-09-28")).toBe(1); // a Monday
  });
});

describe("week boundaries (Monday start, Beirut)", () => {
  it("on a Friday, this week began Monday 00:00 Beirut", () => {
    const w = beirutWeeks(new Date("2026-09-25T09:00:00Z")); // Friday
    expect(w.thisStartYmd).toBe("2026-09-21");
    expect(w.thisStart.toISOString()).toBe("2026-09-20T21:00:00.000Z");
    expect(w.lastStartYmd).toBe("2026-09-14");
    expect(w.lastSamePoint.toISOString()).toBe("2026-09-18T09:00:00.000Z");
  });

  it("Sunday belongs to the week that began the Monday before", () => {
    expect(beirutWeeks(new Date("2026-09-27T12:00:00Z")).thisStartYmd).toBe("2026-09-21");
  });

  it("Sunday night 22:30 UTC is already Monday in Beirut — a new week", () => {
    expect(beirutWeeks(new Date("2026-09-27T22:30:00Z")).thisStartYmd).toBe("2026-09-28");
  });

  it("filters rows into a half-open range", () => {
    const rows = [
      { created_at: "2026-09-20T20:59:59Z" },
      { created_at: "2026-09-20T21:00:00Z" },
      { created_at: "2026-09-25T08:59:59Z" },
    ];
    expect(inRange(rows, new Date("2026-09-20T21:00:00Z"), new Date("2026-09-25T09:00:00Z"))).toHaveLength(2);
  });
});

describe("money per currency", () => {
  it("sums in cents and never across currencies", () => {
    const r = totalsByCurrency([
      { total: 0.1, currency: "USD" },
      { total: 0.2, currency: "USD" },
      { total: 450000, currency: "LBP" },
      { total: 5, currency: null },
      { total: 9, currency: "EUR" },
    ]);
    expect(r.totals).toEqual({ USD: 5.3, LBP: 450000 });
    expect(r.count).toBe(4);
    expect(r.other).toBe(1);
  });

  it("percent change is null with nothing to compare against", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe("inactivity (30 days, from real dates only)", () => {
  const customers = [
    { id: "a", name: "Rana", phone: "03123456" },
    { id: "b", name: "Ali", phone: "70111222" },
    { id: "c", name: "Sami", phone: null },
    { id: "d", name: "Nour", phone: null },
  ];

  it("takes the latest of ledger (by customer) and orders/bookings (by phone)", () => {
    const byCustomer = new Map<string, string>();
    const byPhone = new Map<string, string>();
    bumpLatest(byCustomer, "a", "2026-07-01"); // old ledger line …
    bumpLatest(byPhone, phoneKey("+961 3 123 456"), "2026-09-20"); // … but ordered 5 days ago
    bumpLatest(byPhone, phoneKey("70111222"), "2026-08-10"); // 46 days
    bumpLatest(byCustomer, "c", "2026-08-25"); // exactly 31 days
    bumpLatest(byPhone, phoneKey("70111222"), "2026-08-01"); // an older one does not win
    const r = inactiveCustomers(customers, byCustomer, byPhone, phoneKey, "2026-09-25");
    expect(r.inactive.map((c) => [c.id, c.days])).toEqual([
      ["c", 31],
      ["b", 46],
    ]);
    expect(r.neverActive).toBe(1); // d has no dated activity at all
  });

  it("exactly 30 days is not yet inactive", () => {
    const byCustomer = new Map([["a", "2026-08-26"]]);
    const r = inactiveCustomers([customers[0]], byCustomer, new Map(), phoneKey, "2026-09-25");
    expect(r.inactive).toEqual([]);
  });
});

describe("exception thresholds", () => {
  it("low stock uses the product's own threshold (default 5), untracked stock is never low", () => {
    expect(isLowStock({ stock: 5, low_stock_threshold: 5 })).toBe(true);
    expect(isLowStock({ stock: 6, low_stock_threshold: 5 })).toBe(false);
    expect(isLowStock({ stock: 12, low_stock_threshold: 20 })).toBe(true);
    expect(isLowStock({ stock: 0, low_stock_threshold: null })).toBe(true);
    expect(isLowStock({ stock: null, low_stock_threshold: 5 })).toBe(false);
  });

  it("an order is unconfirmed only when still pending after 2 hours", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(isUnconfirmedOrder({ status: "pending", created_at: "2026-09-25T09:59:00Z" }, now)).toBe(true);
    expect(isUnconfirmedOrder({ status: "pending", created_at: "2026-09-25T10:01:00Z" }, now)).toBe(false);
    expect(isUnconfirmedOrder({ status: "accepted", created_at: "2026-09-25T06:00:00Z" }, now)).toBe(false);
  });
});

describe("permissions and the offer text", () => {
  it("every chip needs the permission its rows are gated on", () => {
    expect(QUICK_CHIPS.every((c) => CHIP_PERMISSION[c])).toBe(true);
    const noCustomers = { orders: true, products: true, customers: false, bookings: true };
    expect(chipAllowed("debts", noCustomers)).toBe(false);
    expect(chipAllowed("inactiveCustomers", noCustomers)).toBe(false);
    expect(chipAllowed("todayOrders", noCustomers)).toBe(true);
  });

  it("fills {name} and {store} and invents nothing", () => {
    expect(fillOffer("أهلا {name}، اشتقنالك بـ{store}!", { name: " Rana ", store: "Matjar" })).toBe(
      "أهلا Rana، اشتقنالك بـMatjar!",
    );
    expect(fillOffer("x".repeat(600), { name: "", store: "" })).toHaveLength(500);
  });
});
