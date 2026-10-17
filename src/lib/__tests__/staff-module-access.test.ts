import { describe, expect, it } from "vitest";
import { modulePerms, staffMayOpen } from "@/lib/sectors";
import { computeCompleteness } from "@/lib/completeness";

// The menu, the page guards and the database must name the SAME staff
// permission for a module, or staff are shown screens whose data RLS refuses.
// These pin the keys the live policies check (store_suppliers,
// stock_movements, store_tasks, store_classes, pos_sales — see 0159/0332).
describe("module access follows the database's permission keys", () => {
  it("maps each module to the key its tables check", () => {
    expect(modulePerms("suppliers")).toEqual(["suppliers"]);
    expect(modulePerms("inventory")).toEqual(["inventory"]);
    expect(modulePerms("tasks")).toEqual(["tasks"]);
    expect(modulePerms("classes")).toEqual(["classes"]);
    expect(modulePerms("pos")).toEqual(["pos", "orders"]);
    expect(modulePerms("customers")).toEqual(["customers"]);
    expect(modulePerms("accounting")).toEqual(["expenses"]);
  });

  it("a default staffer (orders/bookings/products) no longer sees suppliers, inventory, tasks or classes", () => {
    const perms = { orders: true, bookings: true, products: true };
    expect(staffMayOpen("orders", perms)).toBe(true);
    expect(staffMayOpen("pos", perms)).toBe(true);
    expect(staffMayOpen("suppliers", perms)).toBe(false);
    expect(staffMayOpen("inventory", perms)).toBe(false);
    expect(staffMayOpen("tasks", perms)).toBe(false);
    expect(staffMayOpen("classes", perms)).toBe(false);
  });

  it("the dedicated toggles open their screens", () => {
    expect(staffMayOpen("suppliers", { suppliers: true })).toBe(true);
    expect(staffMayOpen("pos", { pos: true })).toBe(true);
    expect(staffMayOpen("tasks", { tasks: true })).toBe(true);
  });

  it("owner-only modules stay closed to staff", () => {
    expect(staffMayOpen("subscription", { orders: true })).toBe(false);
  });
});

describe("setup checklist never requires a step behind a paywall", () => {
  const facts = {
    logo: true, cover: true, description: true, hours: true, whatsapp: true,
    mapPin: true, brandColor: true, customLink: true,
    offerings: 5, offeringsWithCost: 5, providers: 0,
  };
  const modules = new Set(["team"]) as never;

  it("asks for the team when the plan can open the team screen", () => {
    const c = computeCompleteness("beauty", modules, { ...facts, teamAvailable: true });
    expect(c.missingRequired.map((i) => i.key)).toContain("team");
  });

  it("drops the team step on a plan that can't open it", () => {
    const c = computeCompleteness("beauty", modules, { ...facts, teamAvailable: false });
    expect(c.items.map((i) => i.key)).not.toContain("team");
    expect(c.readyToPublish).toBe(true);
  });

  it("points cost prices at the product form, not the Business-only inventory", () => {
    const c = computeCompleteness("retail", new Set() as never, { ...facts, offeringsWithCost: 0 });
    expect(c.items.find((i) => i.key === "costPrices")?.href).toBe("items");
  });
});
