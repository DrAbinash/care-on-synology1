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
  test("A5 compact slip: logo, summary, denominations, hide zero rows", () => {
    const html = buildStaffDayCloseSlipHtml(
      sample,
      { name: "Care Diagnostics", logoDataUrl: "data:image/png;base64,abc" },
      "Alice",
    );
    expect(html).toContain("@page { size: 148mm 210mm");
    expect(html).toContain("Staff Reconciliation");
    expect(html).toContain("CARE DIAGNOSTICS");
    expect(html).toContain("Total Bill Generated");
    expect(html).toContain("Expected");
    expect(html).not.toContain("Outstanding");
    expect(html).not.toContain("REFUNDS");
    expect(html).toContain("500 × 100");
    expect(html).not.toContain("200 ×");
    expect(html).toContain("Discounts");
    expect(html).toContain("UPI");
    expect(html).toContain("CASH");
    expect(html).not.toContain("Method Reconciliation");
    expect(html).not.toContain("Accounts Summary");
    expect(html).toContain("Bills Edited / Modified");
    expect(html).toContain("(Total No.) = <strong>1</strong>");
    expect(html).toContain("Expenses");
    expect(html).toContain("Newspaper");
    expect(html).toContain("Tea");
    expect(html).not.toContain("Test Wise Collection");
  });

  test("shows outstanding and refunds when non-zero", () => {
    const html = buildStaffDayCloseSlipHtml(
      { ...sample, totalDue: "500", totalRefunds: "200" },
      { name: "Care" },
    );
    expect(html).toContain("Outstanding");
    expect(html).toContain("REFUNDS");
  });
});
