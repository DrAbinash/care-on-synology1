import { describe, expect, test, vi } from "vitest";

// daily-summary.ts imports `db` from @workspace/db at module top level,
// which throws unconditionally at import time when DATABASE_URL is not set.
// computeDailySummaryCashMath is pure — it never touches the database — so
// mocking the module prevents the load-time throw without affecting what is
// under test. Same pattern as day-close.test.ts / auto-voucher.test.ts.
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }), execute: async () => ({ rows: [] }) },
}));
vi.mock("@workspace/db/schema", () => ({
  billsTable: {}, paymentsTable: {}, ordersTable: {}, billAuditsTable: {}, voucherAuditsTable: {},
  orderTestsTable: {}, testsTable: {}, patientsTable: {},
}));

import { computeDailySummaryCashMath } from "./daily-summary";

// REGRESSION SUITE for RPT-03: the previous formula was
//   netCollection = totalBilling - outstanding - totalRefunded - cancelledBillsAmount - expenses
//   physicalCashInHand = netCollection - digitalCollection
// totalBilling already EXCLUDED cancelled bills, so subtracting
// cancelledBillsAmount again — on top of also subtracting totalRefunded —
// double-counted a bill that was cancelled AND refunded the same day. These
// tests pin the corrected payment-axis formula (money that actually moved),
// which must never double-subtract the same cash event.

describe("computeDailySummaryCashMath", () => {
  test("simple day: ₹1,000 cash billed and fully paid, no refunds/expenses", () => {
    const { netCollection, physicalCashInHand } = computeDailySummaryCashMath({
      totalReceived: 1000,
      totalRefunded: 0,
      expenses: 0,
      cashCollection: 1000,
      cashRefunded: 0,
      cashExpenses: 0,
    });
    expect(netCollection).toBe(1000);
    expect(physicalCashInHand).toBe(1000);
  });

  test("REGRESSION: bill created, paid ₹1,000 cash, then cancelled AND refunded same day → cash in hand ₹0, never negative", () => {
    // create bill ₹1,000 → pay cash ₹1,000 → cancel with cash refund ₹1,000.
    // totalReceived/cashCollection are the GROSS amounts collected today
    // (₹1,000 payment); totalRefunded/cashRefunded are the GROSS amounts
    // refunded today (₹1,000 refund) — subtracted exactly once each. The
    // old formula would have subtracted this same ₹1,000 a second time via
    // cancelledBillsAmount, on top of the ₹1,000 refund, producing -₹1,000+.
    const { netCollection, physicalCashInHand } = computeDailySummaryCashMath({
      totalReceived: 1000,
      totalRefunded: 1000,
      expenses: 0,
      cashCollection: 1000,
      cashRefunded: 1000,
      cashExpenses: 0,
    });
    expect(netCollection).toBe(0); // totalReceived(1000) - totalRefunded(1000)
    expect(physicalCashInHand).toBe(0); // cashCollection(1000) - cashRefunded(1000)
  });

  test("cash expenses reduce physical cash in hand but never netCollection's digital portion", () => {
    const { netCollection, physicalCashInHand } = computeDailySummaryCashMath({
      totalReceived: 5000,
      totalRefunded: 0,
      expenses: 500,
      cashCollection: 3000,
      cashRefunded: 0,
      cashExpenses: 500,
    });
    expect(netCollection).toBe(4500); // 5000 - 0 - 500
    expect(physicalCashInHand).toBe(2500); // 3000 - 0 - 500
  });

  test("partial cash refund on an otherwise-paid day", () => {
    const { netCollection, physicalCashInHand } = computeDailySummaryCashMath({
      totalReceived: 10000,
      totalRefunded: 2000,
      expenses: 0,
      cashCollection: 6000,
      cashRefunded: 2000,
      cashExpenses: 0,
    });
    expect(netCollection).toBe(8000);
    expect(physicalCashInHand).toBe(4000);
  });
});
