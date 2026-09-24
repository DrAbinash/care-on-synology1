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

/**
 * Dues collected for a staff drawer window.
 *
 * Bill Gen only includes bills this staff created inside (from, to]. Any
 * positive payment they record on a bill outside that set is dues.
 *
 * Suraj #170 (confirmed from bill + audit screenshots):
 *   - PINKI 20260918133 created 23 Sept 6:18pm by ASHOK (₹4000, ₹1000 paid)
 *   - Suraj's drawer window started ~23 Sept 5:42pm (his prior close)
 *   - Suraj collected remaining ₹3000 at 24 Sept 11:16am (before day close)
 * Old rule required bill.createdAt ≤ prior close → 6:18pm ≰ 5:42pm → Dues 0,
 * while UPI+CASH still held ₹3000 (Expected short by exactly dues). Calendar-day
 * My Daily Summary correctly showed Dues ₹3000 because the bill predates 24 Sept.
 * Sanjeev was fine: his dues bills were created before *his* prior close.
 */
export function computeDueReceivedForWindow(opts: {
  /** Bill ids this staff created inside the drawer window (Bill Gen set). */
  windowBillIds: Iterable<number>;
  payments: Array<{ billId?: number | null; amount: unknown }>;
}): number {
  const mine = new Set<number>();
  for (const id of opts.windowBillIds) {
    if (typeof id === "number" && Number.isFinite(id)) mine.add(id);
  }
  let due = 0;
  for (const p of opts.payments) {
    const amt = money(p.amount);
    if (amt <= 0) continue;
    const billId = p.billId;
    if (billId == null || !Number.isFinite(Number(billId))) continue;
    if (mine.has(Number(billId))) continue;
    due += amt;
  }
  return due;
}
