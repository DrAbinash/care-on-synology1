import { describe, expect, test } from "vitest";
import { buildStaffDayCloseSlipHtml, type StaffSlipClosure } from "./staffDayCloseSlip";

const sample: StaffSlipClosure = {
  id: 42,
  userName: "Alice",
  closureDate: "2026-08-21",
  closedAt: "2026-08-21T12:00:00.000Z",
  coveredFromTs: "2026-08-21T04:00:00.000Z",
  coveredToTs: "2026-08-21T12:00:00.000Z",
  expectedCash: "158850",
  expectedUpi: "67000",
  expectedCard: "0",
  expectedCheque: "0",
  expectedOther: "0",
  totalExpected: "225850",
  totalBilled: "226700",
  totalDue: "0",
  billsCount: 3,
  paymentsCount: 4,
  actualCash: "158850",
  actualUpi: "67000",
  actualCard: "0",
  actualCheque: "0",
  actualOther: "0",
  totalActual: "225850",
  variance: "0",
  varianceNote: "",
  notes: "Handover OK",
  drawerStatus: "balanced",
  denominations: { d500: 100, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, coins: 0 },
  denominationTotal: "50000",
  printActivity: {
    dueReceived: 0,
    cancelledBillsAmount: 0,
    refundsAmount: 0,
    discountsGiven: 850,
    discountBills: [{
      billId: 1,
      billNumber: "B-1",
      patientName: "Pat",
      totalAmount: 900,
      discountGiven: 850,
      grossAmount: 1750,
      discountReason: "Staff",
      discountReasonNote: null,
    }],
    billEdits: [{ id: 9, billId: 1, billNumber: "B-1", changeType: "amount", reason: "correction", oldValue: "1000", newValue: "900", createdAt: "2026-08-21T10:00:00.000Z" }],
    voucherEdits: [],
    expenseDetails: [
      { id: 5, amount: 100, category: "Newspaper", description: "", paymentMode: "cash" },
      { id: 6, amount: 50, category: "Tea", description: "", paymentMode: "cash" },
    ],
    totalExpenses: 150,
    cashExpenses: 150,
    digitalExpenses: 0,
  },
};

describe("buildStaffDayCloseSlipHtml", () => {
  test("A5 compact slip: large logo, formula lines always shown, footer edits/discounts", () => {
    const html = buildStaffDayCloseSlipHtml(
      sample,
      { name: "Care Diagnostics", logoDataUrl: "data:image/png;base64,abc" },
      "Alice",
    );
    expect(html).toContain("@page { size: 148mm 210mm");
    expect(html).toContain("width: 90px");
    expect(html).toContain("Staff Reconciliation");
    expect(html).toContain("CARE DIAGNOSTICS");
    expect(html).toContain("Total Bill Gen");
    expect(html).toContain("Dues Collected");
    expect(html).toContain("Cancelled bills");
    expect(html).toContain("Outstanding");
    expect(html).toContain("Refunds");
    expect(html).toContain("Expense");
    expect(html).toContain("Expected");
    expect(html).toContain("500 × 100");
    expect(html).not.toContain("200 ×");
    expect(html).toContain("UPI");
    expect(html).toContain("CASH");
    expect(html).toContain("BILLS EDITED/MODIFIED → 1");
    expect(html).toContain("DISCOUNTS GIVEN → Rs.");
    expect(html).toContain("Newspaper");
    expect(html).toContain("Tea");
    expect(html).not.toContain("Test Wise Collection");
    expect(html).not.toContain("Method Reconciliation");
  });

  test("Suraj handwritten arithmetic: 247775 + 29700 − 550 − 4700 = 272225", () => {
    const html = buildStaffDayCloseSlipHtml(
      {
        ...sample,
        userName: "SURAJ JHA",
        totalBilled: 247775,
        totalDue: 4700,
        expectedUpi: 99075,
        expectedCash: 173150,
        printActivity: {
          ...sample.printActivity!,
          dueReceived: 29700,
          cancelledBillsAmount: 0,
          refundsAmount: 550,
          discountsGiven: 2375,
          totalExpenses: 0,
          expenseDetails: [],
          billEdits: [],
        },
      },
      { name: "Care Diagnostics" },
      "SURAJ JHA",
    );
    expect(html).toContain("2,47,775.00");
    expect(html).toContain("29,700.00");
    expect(html).toContain("2,77,475.00");
    expect(html).toContain("550.00");
    expect(html).toContain("4,700.00");
    expect(html).toContain("2,72,225.00");
    expect(html).toContain("99,075.00");
    expect(html).toContain("1,73,150.00");
    expect(html).toContain("DISCOUNTS GIVEN → Rs. 2,375.00");
  });
});
