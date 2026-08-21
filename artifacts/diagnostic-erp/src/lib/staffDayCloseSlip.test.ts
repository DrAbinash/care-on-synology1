import { describe, expect, test } from "vitest";
import { buildStaffDayCloseSlipHtml, type StaffSlipClosure } from "./staffDayCloseSlip";

const sample: StaffSlipClosure = {
  id: 42,
  userName: "Alice",
  closureDate: "2026-08-21",
  closedAt: "2026-08-21T12:00:00.000Z",
  coveredFromTs: "2026-08-21T04:00:00.000Z",
  coveredToTs: "2026-08-21T12:00:00.000Z",
  expectedCash: "1000",
  expectedUpi: "500",
  expectedCard: "0",
  expectedCheque: "0",
  expectedOther: "0",
  totalExpected: "1500",
  totalBilled: "2000",
  totalDue: "500",
  billsCount: 3,
  paymentsCount: 4,
  actualCash: "1000",
  actualUpi: "500",
  actualCard: "0",
  actualCheque: "0",
  actualOther: "0",
  totalActual: "1500",
  variance: "0",
  varianceNote: "",
  notes: "Handover OK",
  drawerStatus: "balanced",
  denominations: { d500: 2, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, coins: 0 },
  denominationTotal: "1000",
  printActivity: {
    discountsGiven: 100,
    discountBills: [{
      billId: 1,
      billNumber: "B-1",
      patientName: "Pat",
      totalAmount: 900,
      discountGiven: 100,
      grossAmount: 1000,
      discountReason: "Staff",
      discountReasonNote: null,
    }],
    billEdits: [{
      id: 9,
      billId: 1,
      billNumber: "B-1",
      changeType: "amount",
      reason: "correction",
      oldValue: "1000",
      newValue: "900",
      createdAt: "2026-08-21T10:00:00.000Z",
    }],
    voucherEdits: [{
      id: 3,
      voucherId: 7,
      voucherNumber: "V-7",
      changeType: "amount",
      reason: "typo",
      oldValue: "50",
      newValue: "55",
      createdAt: "2026-08-21T11:00:00.000Z",
    }],
    expenseDetails: [{
      id: 5,
      amount: 50,
      category: "Petty",
      description: "Tea",
      paymentMode: "cash",
    }],
    totalExpenses: 50,
    cashExpenses: 50,
    digitalExpenses: 0,
  },
};

describe("buildStaffDayCloseSlipHtml", () => {
  test("includes accounts, denomination, discounts, edits, vouchers, expenses — not test-wise", () => {
    const html = buildStaffDayCloseSlipHtml(sample, { name: "Care Diagnostics" }, "Alice");
    expect(html).toContain("Staff Day Close Reconciliation");
    expect(html).toContain("Accounts Summary");
    expect(html).toContain("Denomination Count");
    expect(html).toContain("₹500");
    expect(html).toContain("Discounts");
    expect(html).toContain("B-1");
    expect(html).toContain("Bill Edits / Modifications");
    expect(html).toContain("Voucher Modifications");
    expect(html).toContain("V-7");
    expect(html).toContain("Expenses");
    expect(html).toContain("Tea");
    expect(html).not.toContain("Test Wise Collection");
  });
});
