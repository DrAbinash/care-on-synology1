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
 * positive payment they record on a bill outside that set is dues — the payment
 * time is already constrained by the drawer window (e.g. Suraj's PINKI ₹3000 at
 * 11:16am on 24 Sept, before day close, correctly sat in UPI+CASH).
 *
 * The older rule (bill.createdAt ≤ prior close) could still drop that in-window
 * payment from Dues Collected when the bill was outside this staff's Bill Gen
 * but not strictly before `from` — so Expected undershot UPI+CASH by exactly
 * the dues amount while the slip still said Balanced. Matching My Daily Summary:
 * dues = payments on bills that are not this staff's window Bill Gen.
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
