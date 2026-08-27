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
    dueReceived: 0,
    cancelledBillsAmount: 0,
    refundsAmount: 0,
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
  test("mirrors A5 slip: formula, cash count, footer edits/discounts, balanced footer", () => {
    const html = buildStaffDayCloseEmailHtml(sample);
    expect(html).toContain("Staff Reconciliation");
    expect(html).toContain("CARE DIAGNOSTICS");
    expect(html).toContain("Total Bill Gen");
    expect(html).toContain("Dues Collected");
    expect(html).toContain("Cancelled bills");
    expect(html).toContain("Expected");
    expect(html).toContain("Outstanding");
    expect(html).toContain("500 × 100");
    expect(html).toContain("BILLS EDITED/MODIFIED");
    expect(html).toContain("DISCOUNTS GIVEN");
    expect(html).toContain("Newspaper");
    expect(html).toContain("Balanced");
    expect(html).toContain("Closure #42");
  });

  test("Suraj arithmetic: billed + dues − refunds − outstanding = expected", () => {
    const html = buildStaffDayCloseEmailHtml({
      ...sample,
      staffName: "SURAJ JHA",
      totalBilled: 247775,
      totalDue: 4700,
      expectedUpi: 99075,
      expectedCash: 173150,
      printActivity: {
        ...sample.printActivity,
        dueReceived: 29700,
        cancelledBillsAmount: 0,
        refundsAmount: 550,
        discountsGiven: 2375,
        totalExpenses: 0,
        expenseDetails: [],
      },
    });
    expect(html).toContain("2,77,475.00"); // subtotal
    expect(html).toContain("2,72,225.00"); // expected
    expect(html).toContain("29,700.00");
    expect(html).toContain("550.00");
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
