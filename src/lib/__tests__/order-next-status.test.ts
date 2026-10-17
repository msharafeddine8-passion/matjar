import { describe, it, expect } from "vitest";
import {
  isFinalOrderStatus,
  nextOrderStatuses,
  orderStatusErrorKind,
} from "@/lib/order-progress";

describe("nextOrderStatuses", () => {
  it("offers nothing once an order is completed, cancelled or rejected (0246/0333)", () => {
    for (const s of ["completed", "cancelled", "rejected"]) {
      expect(nextOrderStatuses(s, "delivery")).toEqual([]);
      expect(nextOrderStatuses(s, "pickup")).toEqual([]);
      expect(isFinalOrderStatus(s)).toBe(true);
    }
  });

  it("never offers a pickup order out_for_delivery", () => {
    for (const s of ["pending", "accepted", "preparing", "ready"]) {
      expect(nextOrderStatuses(s, "pickup")).not.toContain("out_for_delivery");
    }
  });

  it("starts with the current status and only moves forward, plus the exits", () => {
    expect(nextOrderStatuses("preparing", "delivery")).toEqual([
      "preparing",
      "ready",
      "out_for_delivery",
      "completed",
      "cancelled",
      "rejected",
    ]);
    expect(nextOrderStatuses("ready", "pickup")).toEqual([
      "ready",
      "completed",
      "cancelled",
      "rejected",
    ]);
  });

  it("does not offer a backwards move", () => {
    const opts = nextOrderStatuses("ready", "delivery");
    expect(opts).not.toContain("pending");
    expect(opts).not.toContain("accepted");
    expect(opts).not.toContain("preparing");
  });

  it("lets a legacy pickup stuck at out_for_delivery still finish", () => {
    expect(nextOrderStatuses("out_for_delivery", "pickup")).toEqual([
      "out_for_delivery",
      "completed",
      "cancelled",
      "rejected",
    ]);
  });

  it("allows only the exits for an unknown status", () => {
    expect(nextOrderStatuses("weird", "delivery")).toEqual([
      "cancelled",
      "rejected",
    ]);
  });
});

describe("orderStatusErrorKind", () => {
  it("maps the two finality refusals", () => {
    expect(orderStatusErrorKind("order_closed_is_final")).toBe("closed");
    expect(orderStatusErrorKind("ERROR: order_completed_is_final")).toBe(
      "completed",
    );
    expect(orderStatusErrorKind("something else")).toBeNull();
    expect(orderStatusErrorKind(null)).toBeNull();
  });
});
