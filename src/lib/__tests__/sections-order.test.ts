import { describe, expect, it } from "vitest";
import { orderForPicker, type SectionInfo } from "../sections";

const sections: SectionInfo[] = [
  { id: "hair", name: "شعر", nameEn: "Hair", sortOrder: 2 },
  { id: "nails", name: "أظافر", nameEn: "Nails", sortOrder: 1 },
];

describe("orderForPicker", () => {
  it("orders by section position, then name, unsectioned last", () => {
    const items = [
      { id: "z", name: "Zeta", sectionId: null },
      { id: "c", name: "Cut", sectionId: "hair" },
      { id: "b", name: "Blow dry", sectionId: "hair" },
      { id: "m", name: "Manicure", sectionId: "nails" },
      { id: "a", name: "Alpha", sectionId: "gone" },
    ];
    const out = orderForPicker(items, sections, (i) => i.name, "en");
    expect(out.map((i) => i.id)).toEqual(["m", "b", "c", "a", "z"]);
  });

  it("sorts by name when there are no sections, without mutating input", () => {
    const items = [
      { id: "2", name: "قص", sectionId: null },
      { id: "1", name: "استشوار", sectionId: null },
    ];
    const out = orderForPicker(items, [], (i) => i.name, "ar");
    expect(out.map((i) => i.id)).toEqual(["1", "2"]);
    expect(items[0].id).toBe("2");
  });
});
