import { describe, it, expect } from "vitest";
import {
  FIELDS,
  OPENING_LABEL,
  applyMapping,
  detectColumns,
  duplicateColumns,
  excelDateToIso,
  importPhoneKey,
  isBlankRow,
  isHeaderLike,
  missingRequired,
  newLedgerCustomers,
  openingEntries,
  parseCsv,
  parseCurrency,
  parseDateCell,
  parseSignedAmount,
  planCustomers,
  planLedger,
  planProducts,
  productRpcRows,
  summarize,
  validateCustomerRow,
  validateLedgerRow,
} from "@/lib/import-mapping";

const TODAY = "2026-09-25";

describe("header detection, Arabic and English", () => {
  it("maps the product template headers in both languages", () => {
    const ar = detectColumns("products", ["رمز المنتج", "الاسم", "السعر", "الكمية"]);
    expect(ar).toMatchObject({ sku: 0, name: 1, price: 2, stock: 3 });
    const en = detectColumns("products", ["Code", "Name", "Price", "Quantity"]);
    expect(en).toMatchObject({ sku: 0, name: 1, price: 2, stock: 3 });
  });

  it("accepts the spellings merchants actually type", () => {
    const m = detectColumns("products", ["SKU", "اسم المنتج", "price ", "الأسم"]);
    expect(m.sku).toBe(0);
    expect(m.name).toBe(1); // the first matching column wins …
    expect(m.price).toBe(2);
    // … and a column is claimed once: «الأسم» is not re-used for another field.
    expect(Object.values(m).filter((v) => v === 3)).toHaveLength(0);
  });

  it("maps customers and ledger headers, alef/taa-marbuta variants included", () => {
    expect(detectColumns("customers", ["الإسم", "التلفون", "ملاحظه"])).toMatchObject({
      name: 0,
      phone: 1,
      notes: 2,
    });
    expect(detectColumns("customers", ["Customer Name", "WhatsApp"])).toMatchObject({ name: 0, phone: 1 });
    const l = detectColumns("ledger", ["الاسم", "الهاتف", "الرصيد", "العملة", "التاريخ"]);
    expect(l).toMatchObject({ name: 0, phone: 1, balance: 2, currency: 3, date: 4 });
  });

  it("never maps «الرصيد بالدولار» onto the generic balance column", () => {
    const l = detectColumns("ledger", ["Name", "الرصيد بالدولار", "Balance (LBP)"]);
    expect(l.balance).toBeNull();
    expect(l.balance_usd).toBe(1);
    expect(l.balance_lbp).toBe(2);
  });

  it("ignores decoration: '*', ':' and extra spaces", () => {
    expect(detectColumns("customers", ["  Name * ", "Phone:"])).toMatchObject({ name: 0, phone: 1 });
  });

  it("recognises the bilingual template's second (English) header row", () => {
    const ar = FIELDS.ledger.map((f) => f.ar);
    const en = FIELDS.ledger.map((f) => f.en);
    expect(isHeaderLike("ledger", ar)).toBe(true);
    expect(isHeaderLike("ledger", en)).toBe(true);
    expect(isHeaderLike("ledger", ["Rana", "03123456", "120", "USD"])).toBe(false);
    // one lonely header-looking cell is data, not a header
    expect(isHeaderLike("customers", ["Name", ""])).toBe(false);
  });

  it("reports what the mapping still lacks", () => {
    expect(missingRequired("products", { name: 0, price: null })).toEqual(["price"]);
    expect(missingRequired("customers", { name: 0 })).toEqual([]);
    expect(missingRequired("ledger", { name: 0, phone: 1 })).toEqual(["balance"]);
    expect(missingRequired("ledger", { name: 0, balance_lbp: 2 })).toEqual([]);
  });

  it("flags two fields pointed at one column", () => {
    expect(duplicateColumns({ name: 0, phone: 0, notes: 2 })).toEqual(["phone"]);
    expect(duplicateColumns({ name: 0, phone: null })).toEqual([]);
  });

  it("applies a mapping and trims", () => {
    expect(applyMapping({ name: 1, phone: 0, notes: null }, [" 03 123 456 ", " Rana ", "x"])).toEqual({
      name: "Rana",
      phone: "03 123 456",
    });
  });
});

describe("CSV", () => {
  it("handles BOM, quotes, doubled quotes and CRLF", () => {
    const rows = parseCsv('﻿Name,Phone\r\n"Rana, Beirut","03 ""123"""\r\nAli,70111222\r\n');
    expect(rows).toEqual([
      ["Name", "Phone"],
      ["Rana, Beirut", '03 "123"'],
      ["Ali", "70111222"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")[1]).toEqual(["1", "2"]);
  });

  it("treats rows of empty cells as blank", () => {
    expect(isBlankRow(["", "  ", null])).toBe(true);
    expect(isBlankRow(["", "x"])).toBe(false);
  });
});

describe("cells: amounts, currencies, dates", () => {
  it.each([
    ["1,500,000", 1500000],
    ["$120.5", 120.5],
    ["12,50", 12.5],
    ["1,250.75", 1250.75],
    ["1.500.000", 1500000],
    ["(40)", -40],
    ["-40", -40],
    ["40-", -40],
    ["٤٠٠٬٠٠٠ ل.ل.", 400000],
    ["400,000 ل.ل.", 400000],
    ["0", 0],
  ])("%s → %s", (raw, expected) => {
    expect(parseSignedAmount(raw)).toBe(expected);
  });

  it.each(["", "abc", "1-2", "10000000000"])("refuses %j", (raw) => {
    expect(parseSignedAmount(raw)).toBeNull();
  });

  it("reads currencies from a cell or an amount, never guessing", () => {
    expect(parseCurrency("USD")).toBe("USD");
    expect(parseCurrency("$")).toBe("USD");
    expect(parseCurrency("دولار")).toBe("USD");
    expect(parseCurrency("L.L.")).toBe("LBP");
    expect(parseCurrency("ل.ل")).toBe("LBP");
    expect(parseCurrency("ليرة")).toBe("LBP");
    expect(parseCurrency("LBP")).toBe("LBP");
    expect(parseCurrency("120")).toBeNull();
    expect(parseCurrency("EUR")).toBeNull();
  });

  it("reads dates day-first, ISO, or as an Excel serial", () => {
    expect(parseDateCell("2026-09-01")).toBe("2026-09-01");
    expect(parseDateCell("1/9/2026")).toBe("2026-09-01");
    expect(parseDateCell("01-09-2026")).toBe("2026-09-01");
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell("46266")).toBe("2026-09-01");
    expect(excelDateToIso(new Date(Date.UTC(2026, 8, 1)))).toBe("2026-09-01");
  });
});

describe("row validation", () => {
  it("customers need a name; a foreign phone warns, a short one refuses", () => {
    expect(validateCustomerRow({ phone: "03123456" }).issue).toBe("errName");
    expect(validateCustomerRow({ name: "Rana", phone: "123" }).issue).toBe("errPhone");
    expect(validateCustomerRow({ name: "Rana", phone: "+33 6 12 34 56 78" })).toEqual({
      issue: null,
      warning: "warnPhoneForeign",
    });
    expect(validateCustomerRow({ name: "Rana" })).toEqual({ issue: null, warning: null });
  });

  it("a Balance needs a currency — from the column or the amount — never assumed", () => {
    expect(validateLedgerRow({ name: "A", balance: "120" }, TODAY).issue).toBe("errCurrency");
    expect(validateLedgerRow({ name: "A", balance: "120", currency: "USD" }, TODAY).value?.balances).toEqual({ USD: 120 });
    expect(validateLedgerRow({ name: "A", balance: "$120" }, TODAY).value?.balances).toEqual({ USD: 120 });
    expect(validateLedgerRow({ name: "A", balance: "$120", currency: "LBP" }, TODAY).issue).toBe("errCurrency");
  });

  it("separate USD and LBP columns give one balance each, never added", () => {
    const v = validateLedgerRow({ name: "A", balance_usd: "50", balance_lbp: "900,000" }, TODAY);
    expect(v.issue).toBeNull();
    expect(v.value?.balances).toEqual({ USD: 50, LBP: 900000 });
  });

  it("the same currency twice in one row is refused", () => {
    expect(
      validateLedgerRow({ name: "A", balance: "50", currency: "USD", balance_usd: "20" }, TODAY).issue,
    ).toBe("errCurrency");
  });

  it("dates default to today, must be readable and not in the future", () => {
    expect(validateLedgerRow({ name: "A", balance_usd: "5" }, TODAY).value?.date).toBe(TODAY);
    expect(validateLedgerRow({ name: "A", balance_usd: "5", date: "1/8/2026" }, TODAY).value?.date).toBe("2026-08-01");
    expect(validateLedgerRow({ name: "A", balance_usd: "5", date: "soon" }, TODAY).issue).toBe("errDate");
    expect(validateLedgerRow({ name: "A", balance_usd: "5", date: "2026-10-01" }, TODAY).issue).toBe("errDateFuture");
  });

  it("a zero balance is nothing to record, not an error", () => {
    expect(validateLedgerRow({ name: "A", balance_usd: "0" }, TODAY).issue).toBe("errNothing");
  });
});

describe("opening balance conversion", () => {
  it("positive → charge, negative → payment of the absolute value, zero → nothing", () => {
    expect(openingEntries({ USD: 120, LBP: -500000 })).toEqual([
      { currency: "USD", kind: "charge", amount: 120 },
      { currency: "LBP", kind: "payment", amount: 500000 },
    ]);
    expect(openingEntries({ USD: 0 })).toEqual([]);
  });

  it("is at most one line per currency and never converts", () => {
    const e = openingEntries({ USD: 10, LBP: 895000 });
    expect(e).toHaveLength(2);
    expect(e.map((x) => x.currency)).toEqual(["USD", "LBP"]);
    expect(e.find((x) => x.currency === "LBP")?.amount).toBe(895000);
  });

  it("is labelled in Arabic whatever the UI language", () => {
    expect(OPENING_LABEL).toBe("رصيد افتتاحي");
  });
});

describe("duplicates: products", () => {
  const existing = [
    { id: "p1", sku: "TS-001", name: "تي شيرت" },
    { id: "p2", sku: null, name: "Mug" },
    { id: "p3", sku: null, name: "Cup" },
    { id: "p4", sku: "C2", name: "cup" },
  ];

  it("matches by code case-insensitively, else creates", () => {
    const p = planProducts(
      [
        { sku: "ts-001", name: "x", price: "5" },
        { sku: "NEW-1", name: "y", price: "5" },
      ],
      existing,
      { nameMatchActive: true, firstLine: 2 },
    );
    expect(p[0].action).toEqual({ kind: "updateSku", productId: "p1" });
    expect(p[1].action).toEqual({ kind: "create" });
    expect(p.map((r) => r.line)).toEqual([2, 3]);
  });

  it("falls back to the EXACT name only without a code, and says so", () => {
    const p = planProducts([{ name: " mug ", price: "5" }], existing, { nameMatchActive: true, firstLine: 2 });
    expect(p[0].action).toEqual({ kind: "updateName", productId: "p2", injectSku: null });
    expect(p[0].warning).toBe("matchedByName");
    const fresh = planProducts([{ name: "Plate", price: "5" }], existing, { nameMatchActive: true, firstLine: 2 });
    expect(fresh[0].action).toEqual({ kind: "create" });
    expect(fresh[0].warning).toBe("warnNoSku");
  });

  it("refuses a name two products share rather than guessing", () => {
    const p = planProducts([{ name: "CUP", price: "5" }], existing, { nameMatchActive: true, firstLine: 2 });
    expect(p[0].issue).toBe("nameAmbiguous");
  });

  it("before 0311: a name match fills in the code, or is refused when there is none", () => {
    const withCode = planProducts([{ name: "تي شيرت", price: "5" }], existing, { nameMatchActive: false, firstLine: 2 });
    expect(withCode[0].action).toEqual({ kind: "updateName", productId: "p1", injectSku: "TS-001" });
    expect(productRpcRows(withCode)[0].sku).toBe("TS-001");
    const noCode = planProducts([{ name: "Mug", price: "5" }], existing, { nameMatchActive: false, firstLine: 2 });
    expect(noCode[0].issue).toBe("nameNeedsCode");
    expect(productRpcRows(noCode)).toEqual([]);
  });

  it("refuses the same code or code-less name twice in one file", () => {
    const p = planProducts(
      [
        { sku: "A", name: "a", price: "1" },
        { sku: "a", name: "b", price: "1" },
        { name: "Plate", price: "1" },
        { name: "plate", price: "2" },
      ],
      existing,
      { nameMatchActive: true, firstLine: 2 },
    );
    expect(p.map((r) => r.issue)).toEqual([null, "dupInFile", null, "dupInFile"]);
  });

  it("keeps product-import's validation (it mirrors the database)", () => {
    const p = planProducts([{ name: "x", price: "free" }], [], { nameMatchActive: true, firstLine: 2 });
    expect(p[0].issue).toBe("errPrice");
  });

  it("summarises creates, updates and name matches", () => {
    const p = planProducts(
      [
        { sku: "TS-001", name: "x", price: "5" },
        { name: "mug", price: "5" },
        { name: "Plate", price: "5" },
        { name: "", price: "5" },
      ],
      existing,
      { nameMatchActive: true, firstLine: 2 },
    );
    expect(summarize("products", p)).toMatchObject({ total: 4, ok: 3, problems: 1, create: 1, update: 2, matchedByName: 1 });
  });
});

describe("duplicates: customers", () => {
  const existing = [
    { id: "c1", name: "Rana", phone: "+961 3 123 456" },
    { id: "c2", name: "Ali", phone: null },
  ];

  it("matches by normalised phone, whatever the spelling", () => {
    expect(importPhoneKey("03 123 456")).toBe(importPhoneKey("00961 3123456"));
    expect(importPhoneKey("٠٣١٢٣٤٥٦")).toBe("3123456");
    const p = planCustomers([{ name: "رنا", phone: "03123456" }], existing, { firstLine: 2 });
    expect(p[0].action).toEqual({ kind: "skip", customerId: "c1", reason: "phone" });
  });

  it("without a phone, matches by exact name", () => {
    const p = planCustomers([{ name: " ali " }, { name: "Sami" }], existing, { firstLine: 2 });
    expect(p[0].action).toEqual({ kind: "skip", customerId: "c2", reason: "name" });
    expect(p[1].action).toEqual({ kind: "create", phone: null });
  });

  it("refuses the same phone twice in the file on the later line", () => {
    const p = planCustomers(
      [
        { name: "A", phone: "70 111 222" },
        { name: "B", phone: "+961 70111222" },
      ],
      existing,
      { firstLine: 2 },
    );
    expect(p[0].action).toEqual({ kind: "create", phone: "70 111 222" });
    expect(p[1].issue).toBe("dupInFile");
    expect(summarize("customers", p)).toMatchObject({ create: 1, problems: 1 });
  });
});

describe("duplicates: ledger opening balances", () => {
  const existing = [
    { id: "c1", name: "Rana", phone: "03123456" },
    { id: "c2", name: "Sami", phone: null },
    { id: "c3", name: "Sami", phone: "71000000" },
  ];

  it("attaches to an existing customer by phone, or creates one", () => {
    const p = planLedger(
      [
        { name: "Rana", phone: "+961 3 123456", balance: "$50" },
        { name: "Nour", phone: "76 555 444", balance_lbp: "1,500,000" },
      ],
      existing,
      new Set(),
      { firstLine: 2, todayIso: TODAY },
    );
    expect(p[0].action?.customer).toEqual({ kind: "existing", customerId: "c1" });
    expect(p[0].action?.entries).toEqual([{ currency: "USD", kind: "charge", amount: 50 }]);
    expect(p[1].action?.customer).toMatchObject({ kind: "new", name: "Nour", phone: "76 555 444" });
    expect(newLedgerCustomers(p)).toHaveLength(1);
  });

  it("skips a currency the customer already has an opening balance in (safe to run twice)", () => {
    const p = planLedger(
      [{ phone: "03123456", balance_usd: "50", balance_lbp: "200000" }],
      existing,
      new Set(["c1:USD"]),
      { firstLine: 2, todayIso: TODAY },
    );
    expect(p[0].action?.alreadyOpened).toEqual(["USD"]);
    expect(p[0].action?.entries).toEqual([{ currency: "LBP", kind: "charge", amount: 200000 }]);
  });

  it("a name shared by two customers (and no phone) is refused", () => {
    const p = planLedger([{ name: "sami", balance: "10 USD" }], existing, new Set(), { firstLine: 2, todayIso: TODAY });
    expect(p[0].issue).toBe("nameAmbiguous");
  });

  it("the same customer and currency twice in the file is refused on the later line", () => {
    const p = planLedger(
      [
        { name: "Nour", phone: "76555444", balance_usd: "5" },
        { name: "Nour", phone: "+961 76 555 444", balance_usd: "7" },
        { name: "Nour", phone: "76555444", balance_lbp: "7000" },
      ],
      existing,
      new Set(),
      { firstLine: 2, todayIso: TODAY },
    );
    expect(p.map((r) => r.issue)).toEqual([null, "dupInFile", null]);
    expect(newLedgerCustomers(p)).toHaveLength(1);
  });

  it("a new customer needs a name", () => {
    const p = planLedger([{ phone: "76 999 888", balance_usd: "5" }], existing, new Set(), { firstLine: 2, todayIso: TODAY });
    expect(p[0].issue).toBe("errNeedName");
  });

  it("a negative balance is a credit: one payment line", () => {
    const p = planLedger([{ name: "Rana", phone: "03123456", balance: "-20", currency: "USD" }], existing, new Set(), {
      firstLine: 2,
      todayIso: TODAY,
    });
    expect(p[0].action?.entries).toEqual([{ currency: "USD", kind: "payment", amount: 20 }]);
  });
});
