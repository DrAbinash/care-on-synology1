import { describe, expect, test } from "vitest";
import { buildStaffDayCloseEmailHtml, type StaffDayCloseEmailPayload } from "./staffDayCloseEmail";

const sample: StaffDayCloseEmailPayload = {
  clinicName: "Care Diagnostics",
  staffName: "Alice",
  closureDate: "2026-08-21",
  closedAt: new Date("2026-08-21T12:00:00.000Z"),
  coveredFromTs: new Date("2026-08-21T04:00:00.000Z"),
  coveredToTs: new Date("2026-08-21T12:00:00.000Z"),
  totalBilled: 226700,
  totalDue: 0,
  totalExpected: 225850,
  totalActual: 225850,
  variance: 0,
  expectedCash: 158850,
  expectedUpi: 67000,
  expectedCard: 0,
  expectedCheque: 0,
  expectedOther: 0,
  actualCash: 158850,
  actualUpi: 67000,
  actualCard: 0,
  actualCheque: 0,
  actualOther: 0,
  denominations: { d500: 100, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, coins: 0 },
  denominationTotal: 50000,
  varianceNote: "",
  notes: "Handover OK",
  drawerStatus: "balanced",
  closureId: 42,
  printActivity: {
    discountsGiven: 850,
    discountBills: [],
    billEdits: [{ id: 9, billId: 1, billNumber: "B-1", changeType: "amount", reason: "correction", oldValue: "1000", newValue: "900", createdAt: "2026-08-21T10:00:00.000Z" }],
    voucherEdits: [],
    expenseDetails: [
      { id: 5, amount: 100, category: "Newspaper", description: "", paymentMode: "cash" },
    ],
    totalExpenses: 100,
    cashExpenses: 100,
    digitalExpenses: 0,
  },
};

describe("buildStaffDayCloseEmailHtml", () => {
  test("mirrors A5 slip: summary, cash count, edits, expenses, balanced footer", () => {
    const html = buildStaffDayCloseEmailHtml(sample);
    expect(html).toContain("Staff Reconciliation");
    expect(html).toContain("CARE DIAGNOSTICS");
    expect(html).toContain("Total Bill Generated");
    expect(html).toContain("Expected");
    expect(html).not.toContain("Outstanding");
    expect(html).toContain("500 × 100");
    expect(html).toContain("Bills Edited / Modified");
    expect(html).toContain("(Total No.) = <strong>1</strong>");
    expect(html).toContain("Expenses");
    expect(html).toContain("Balanced");
    expect(html).toContain("Closure #42");
  });

  test("shows variance when mismatch", () => {
    const html = buildStaffDayCloseEmailHtml({
      ...sample,
      variance: -500,
      totalActual: 225350,
      drawerStatus: "mismatch",
    });
    expect(html).toContain("Short");
    expect(html).toContain("500.00");
  });
});
