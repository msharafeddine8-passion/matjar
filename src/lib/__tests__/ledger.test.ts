import { describe, it, expect } from "vitest";
import {
  balancesByCurrency,
  buildExportRows,
  buildReminderMessage,
  csvCell,
  daysBetween,
  formatLedgerAmount,
  isOverdue,
  matchesSearch,
  nonZeroBalances,
  oldestUnpaidCharge,
  parseAmountInput,
  sortByOutstanding,
  statementUrl,
  summarizeBalanceRows,
  todayInBeirut,
  toCsv,
  withRunningBalance,
  type ExportLabels,
  type LedgerEntry,
} from "@/lib/ledger";
import { featureStatus, FEATURE_REGISTRY, FEATURES } from "@/lib/feature-availability";
import { OS_MODULE_META, sectorConfig } from "@/lib/sectors";
import { categoryKeys } from "@/lib/catalog";

let seq = 0;
const e = (
  kind: LedgerEntry["kind"],
  amount: number,
  currency: LedgerEntry["currency"],
  happened_on: string,
  label: string | null = null,
): LedgerEntry => ({
  id: `e${String(++seq).padStart(3, "0")}`,
  kind,
  amount,
  currency,
  happened_on,
  created_at: `${happened_on}T10:00:${String(seq % 60).padStart(2, "0")}Z`,
  label,
});

describe("balances are per currency and never summed across currencies", () => {
  it("keeps USD and LBP apart (the 0211 defect)", () => {
    const b = balancesByCurrency([
      e("charge", 100, "USD", "2026-08-01"),
      e("payment", 30, "USD", "2026-09-01"),
      e("charge", 500000, "LBP", "2026-09-20"),
    ]);
    expect(b).toEqual({ USD: 70, LBP: 500000 });
    // The old function's answer would have been 500070.
    expect(b.USD + b.LBP).not.toBe(b.USD);
  });

  it("counts an adjustment like a charge and sums in cents", () => {
    const b = balancesByCurrency([
      e("charge", 0.1, "USD", "2026-09-01"),
      e("charge", 0.2, "USD", "2026-09-01"),
      e("adjustment", 1.05, "USD", "2026-09-02"),
    ]);
    expect(b.USD).toBe(1.35);
  });

  it("shows only the currencies with something on them", () => {
    expect(nonZeroBalances({ USD: 12.5, LBP: 0 })).toEqual([{ currency: "USD", balance: 12.5 }]);
    expect(nonZeroBalances({ USD: 0, LBP: -2000 })).toEqual([{ currency: "LBP", balance: -2000 }]);
  });

  it("keeps a running balance per currency, chronologically", () => {
    const rows = withRunningBalance([
      e("payment", 20, "USD", "2026-09-10"),
      e("charge", 50, "USD", "2026-09-01"),
      e("charge", 100000, "LBP", "2026-09-05"),
    ]);
    expect(rows.map((r) => [r.currency, r.running])).toEqual([
      ["USD", 50],
      ["LBP", 100000],
      ["USD", 30],
    ]);
  });
});

describe("overdue", () => {
  it("settles payments FIFO — same answer as ledger_balances in SQL", () => {
    const entries = [
      e("charge", 100, "USD", "2026-08-16"),
      e("charge", 50, "USD", "2026-09-15"),
      e("payment", 120, "USD", "2026-09-24"),
    ];
    expect(oldestUnpaidCharge(entries, "USD")).toBe("2026-09-15");
    expect(oldestUnpaidCharge(entries, "LBP")).toBeNull();
  });

  it("is null when the customer is square or in credit", () => {
    expect(
      oldestUnpaidCharge([e("charge", 40, "USD", "2026-01-01"), e("payment", 40, "USD", "2026-01-02")], "USD"),
    ).toBeNull();
    expect(
      oldestUnpaidCharge([e("charge", 40, "USD", "2026-01-01"), e("payment", 60, "USD", "2026-01-02")], "USD"),
    ).toBeNull();
  });

  it("counts calendar days and applies the 7/30/60 thresholds strictly", () => {
    expect(daysBetween("2026-08-26", "2026-09-25")).toBe(30);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(isOverdue("2026-08-26", 30, "2026-09-25")).toBe(false);
    expect(isOverdue("2026-08-25", 30, "2026-09-25")).toBe(true);
    expect(isOverdue(null, 7, "2026-09-25")).toBe(false);
  });

  it("uses Beirut's day, not UTC's", () => {
    // 22:30 UTC on the 24th is already 01:30 on the 25th in Beirut (UTC+3).
    expect(todayInBeirut(new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-25");
  });
});

describe("the customer list", () => {
  const rows = [
    { customer_id: "a", name: "Abou Ali", phone: "03123456", currency: "USD", balance: "20", last_activity: "2026-09-01", oldest_unpaid_charge_on: "2026-08-01" },
    { customer_id: "a", name: "Abou Ali", phone: "03123456", currency: "LBP", balance: "900000", last_activity: "2026-09-20", oldest_unpaid_charge_on: "2026-09-20" },
    { customer_id: "b", name: "Rima", phone: null, currency: "USD", balance: 50, last_activity: "2026-09-10", oldest_unpaid_charge_on: "2026-09-10" },
    { customer_id: "c", name: "Karim", phone: "81000000", currency: "LBP", balance: 4500000, last_activity: "2026-09-11", oldest_unpaid_charge_on: "2026-09-11" },
  ];

  it("folds per-currency rows into one customer, keeping both amounts", () => {
    const list = summarizeBalanceRows(rows);
    const a = list.find((s) => s.id === "a")!;
    expect(a.balances).toEqual({ USD: 20, LBP: 900000 });
    expect(a.lastActivity).toBe("2026-09-20");
    expect(a.oldestUnpaidOn).toBe("2026-08-01");
  });

  it("orders by outstanding using the rate for ORDER only", () => {
    const list = summarizeBalanceRows(rows);
    // At 89,700: Karim ≈ $50.17, Rima $50, Abou Ali $20 + ≈$10.03.
    expect(sortByOutstanding(list, 89700).map((s) => s.id)).toEqual(["c", "b", "a"]);
    // No rate: dollars lead.
    expect(sortByOutstanding(list, 0).map((s) => s.id)).toEqual(["b", "a", "c"]);
    // The balances themselves are untouched.
    expect(list.find((s) => s.id === "c")!.balances).toEqual({ USD: 0, LBP: 4500000 });
  });

  it("searches name and phone, with Arabic-Indic digits", () => {
    expect(matchesSearch({ name: "Abou Ali", phone: "03 123 456" }, "ali")).toBe(true);
    expect(matchesSearch({ name: "Abou Ali", phone: "03 123 456" }, "٠٣١٢٣")).toBe(true);
    expect(matchesSearch({ name: "Abou Ali", phone: null }, "999")).toBe(false);
    expect(matchesSearch({ name: "x", phone: null }, "  ")).toBe(true);
  });
});

describe("amount input", () => {
  it("accepts what a phone keypad types", () => {
    expect(parseAmountInput("12.5")).toBe(12.5);
    expect(parseAmountInput("١٢٫٥")).toBe(12.5);
    expect(parseAmountInput("1,500,000")).toBe(1500000);
    expect(parseAmountInput("۲۰۰")).toBe(200);
    expect(parseAmountInput(".5")).toBe(0.5);
  });
  it("refuses zero, negatives, junk and more than two decimals", () => {
    for (const bad of ["", "0", "-5", "abc", "1.234", "1e5", "10000000000"]) {
      expect(parseAmountInput(bad), bad).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("uses Western digits in both locales and never converts", () => {
    expect(formatLedgerAmount(1250.5, "USD", "ar")).toBe("$1,250.50");
    expect(formatLedgerAmount(40, "USD", "en")).toBe("$40");
    expect(formatLedgerAmount(1500000, "LBP", "ar")).toBe("1,500,000 ل.ل.");
    expect(formatLedgerAmount(-2000, "LBP", "en")).toBe("2,000 LBP");
  });
});

describe("WhatsApp reminder", () => {
  const template = {
    body: "مرحبا {name}، تذكير من {store}: المبلغ المستحق {balances}. كشف الحساب: {link}",
    and: " و ",
  };

  it("names each owed currency separately and includes the link", () => {
    const msg = buildReminderMessage({
      template,
      customerName: " Abou Ali ",
      storeName: "Dekkan Samir",
      balances: { USD: 70, LBP: 500000 },
      link: "https://matjar.example/ar/statement/abc",
      lang: "ar",
    });
    expect(msg).toBe(
      "مرحبا Abou Ali، تذكير من Dekkan Samir: المبلغ المستحق $70 و 500,000 ل.ل.. كشف الحساب: https://matjar.example/ar/statement/abc",
    );
    // No phone number, no converted total.
    expect(msg).not.toMatch(/570|500,070/);
  });

  it("leaves out a currency the customer is square or in credit on", () => {
    const msg = buildReminderMessage({
      template: { body: "{balances}", and: " and " },
      customerName: "x",
      storeName: "y",
      balances: { USD: -5, LBP: 20000 },
      link: "",
      lang: "en",
    });
    expect(msg).toBe("20,000 LBP");
  });

  it("builds the statement URL", () => {
    expect(statementUrl("https://matjar.example/", "en", "AbC-_1")).toBe(
      "https://matjar.example/en/statement/AbC-_1",
    );
  });
});

describe("export", () => {
  const labels: ExportLabels = {
    headers: {
      date: "Date",
      customer: "Customer",
      phone: "Phone",
      type: "Type",
      currency: "Currency",
      amount: "Amount",
      signed: "Signed",
      note: "Note",
    },
    kinds: { charge: "Gave", payment: "Received", adjustment: "Adjustment" },
  };

  it("builds a header and one chronological row per entry with signed amounts", () => {
    const rows = buildExportRows(
      [
        { ...e("payment", 30, "USD", "2026-09-02", "cash"), customer_name: "Rima", customer_phone: null },
        { ...e("charge", 100, "USD", "2026-09-01"), customer_name: "Rima", customer_phone: "03123456" },
      ],
      labels,
    );
    expect(rows[0]).toEqual(["Date", "Customer", "Phone", "Type", "Currency", "Amount", "Signed", "Note"]);
    expect(rows[1]).toEqual(["2026-09-01", "Rima", "03123456", "Gave", "USD", 100, 100, ""]);
    expect(rows[2]).toEqual(["2026-09-02", "Rima", "", "Received", "USD", 30, -30, "cash"]);
  });

  it("escapes CSV and defuses formula injection", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+961")).toBe("'+961");
    expect(csvCell(-30)).toBe("-30");
    expect(csvCell("سطر\nثاني")).toBe('"سطر\nثاني"');
  });

  it("writes a BOM and CRLF so Excel reads Arabic", () => {
    const csv = toCsv([["أ", 1], ["ب", -2]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿أ,1\r\nب,-2\r\n");
  });
});

describe("the ledger is free and registered", () => {
  it("is an available, free-floor entry in the unified registry", () => {
    expect(FEATURES.debtLedger.plan).toBe("free");
    expect(FEATURES.debtLedger.osModule).toBe("ledger");
    expect(FEATURE_REGISTRY.debtLedger.status).toBe("available");
    expect(featureStatus("debtLedger", { plan: "free" }).status).toBe("available");
  });

  it("opens with no plan lock and the customers permission", () => {
    expect(OS_MODULE_META.ledger.minPlan).toBeUndefined();
    expect(OS_MODULE_META.ledger.perm).toBe("customers");
    expect(OS_MODULE_META.ledger.ownerOnly).toBeFalsy();
  });

  it("appears exactly once in every sector's navigation", () => {
    for (const sector of categoryKeys) {
      const all = Object.values(sectorConfig[sector].modules).flat();
      expect(all.filter((k) => k === "ledger").length, sector).toBe(1);
    }
  });
});
