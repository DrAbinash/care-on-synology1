/**
 * Staff reconciliation slip formula (handwritten A5 layout).
 *
 *   Total Bill Generated
 * + Dues Collected
 * = Subtotal
 * − Cancelled bills (by this staff, any original bill date)
 * − Refunds (this staff's refunds, excluding auto-refunds on bills they cancelled)
 * − Outstanding
 * − Expense
 * = Expected
 *
 * Discounts are informational only — billed totals are already post-discount.
 * Payment-side UPI / CASH on the slip come from the drawer buckets, not this formula.
 */

export type StaffSlipFormulaInput = {
  billed: number;
  duesCollected: number;
  cancelledBills: number;
  refundsRecorded: number;
  refundsOnBillsICancelled: number;
  outstanding: number;
  expense: number;
};

export type StaffSlipFormula = {
  billed: number;
  duesCollected: number;
  subtotal: number;
  cancelledBills: number;
  refunds: number;
  outstanding: number;
  expense: number;
  expected: number;
};

export function money(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function refundsForSlip(refundsRecorded: number, refundsOnBillsICancelled: number): number {
  return Math.max(0, money(refundsRecorded) - money(refundsOnBillsICancelled));
}

export function computeStaffSlipFormula(input: StaffSlipFormulaInput): StaffSlipFormula {
  const billed = money(input.billed);
  const duesCollected = money(input.duesCollected);
  const cancelledBills = money(input.cancelledBills);
  const refunds = refundsForSlip(input.refundsRecorded, input.refundsOnBillsICancelled);
  const outstanding = money(input.outstanding);
  const expense = money(input.expense);
  const subtotal = billed + duesCollected;
  const expected = subtotal - cancelledBills - refunds - outstanding - expense;
  return {
    billed,
    duesCollected,
    subtotal,
    cancelledBills,
    refunds,
    outstanding,
    expense,
    expected,
  };
}
