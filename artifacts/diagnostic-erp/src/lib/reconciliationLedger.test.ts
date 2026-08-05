import { describe, expect, it } from "vitest";
import { buildReconciliationLedger, simpleLedgerRows } from "./reconciliationLedger";

/** Sanjeev 2026-08-02 numbers from owner report */
const SANJEEV = {
  staffName: "SANJEEV KUMAR",
  periodLabel: "2026-08-02",
  grossBilledIncludingCancelled: 143_550,
  oldDuesCollected: 2_000,
  cancelledOnMyBills: 0,
  cashRefunded: 3_450,
  digitalRefunded: 0,
  refundsOnCancelledBillsCreatedInPeriod: 0,
  outstanding: 2_700,
  digitalIn: 46_450,
  cashIn: 96_400,
  cashExpenses: 0,
  physicalCashInHand: 92_950,
};

describe("buildReconciliationLedger", () => {
  it("computes collectible and cash per billing formula", () => {
    const l = buildReconciliationLedger(SANJEEV);
    expect(l.revenueTotal).toBe(145_550);
    expect(l.deductionsTotal).toBe(6_150);
    expect(l.collectible).toBe(139_400);
    expect(l.digitalNet).toBe(46_450);
    expect(l.physicalCashInHand).toBe(92_950);
    expect(l.balanced).toBe(true);
  });

  it("flags the common staff mistake (~136700 not cash)", () => {
    const l = buildReconciliationLedger(SANJEEV);
    expect(l.commonStaffMistake).toBe(136_700);
    expect(l.commonStaffMistake).not.toBe(l.physicalCashInHand);
  });

  it("subtracts cash expenses before cash in counter", () => {
    const l = buildReconciliationLedger({ ...SANJEEV, cashExpenses: 500, physicalCashInHand: 92_450 });
    expect(l.expectedCash).toBe(139_400 - 46_450 - 500);
    expect(l.balanced).toBe(true);
    const rows = simpleLedgerRows(l, (n) => String(n));
    expect(rows.some((r) => r.label === "− Cash Expenses" && r.value === "500")).toBe(true);
  });
});
