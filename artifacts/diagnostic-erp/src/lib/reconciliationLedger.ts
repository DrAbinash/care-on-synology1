/**
 * Handwritten-style daily cash reconciliation ledger.
 * Matches the owner’s paper template: x + y − z − digital = cash in counter.
 */

export type ReconciliationLedgerInput = {
  staffName: string;
  periodLabel: string;
  grossBilledIncludingCancelled: number;
  oldDuesCollected: number;
  cancelledOnMyBills: number;
  cashRefunded: number;
  digitalRefunded: number;
  refundsOnCancelledBillsCreatedInPeriod?: number;
  outstanding: number;
  digitalIn: number;
  cashIn: number;
  cashExpenses: number;
  physicalCashInHand: number;
};

export type ReconciliationLedger = {
  staffName: string;
  periodLabel: string;
  grossBills: number;
  oldDuesCollected: number;
  revenueTotal: number;
  cancelled: number;
  refundsForCollectible: number;
  refundsExcluded: number;
  outstanding: number;
  deductionsTotal: number;
  collectible: number;
  digitalNet: number;
  expectedCash: number;
  cashReceived: number;
  cashRefunded: number;
  cashExpenses: number;
  physicalCashInHand: number;
  mismatch: number;
  balanced: boolean;
  /** Staff often wrongly compute cashIn + digitalIn − refund − outstanding */
  commonStaffMistake: number;
};

export function buildReconciliationLedger(input: ReconciliationLedgerInput): ReconciliationLedger {
  const totalRefunds = input.cashRefunded + input.digitalRefunded;
  const refundsExcluded = input.refundsOnCancelledBillsCreatedInPeriod ?? 0;
  const refundsForCollectible = Math.max(0, totalRefunds - refundsExcluded);
  const revenueTotal = input.grossBilledIncludingCancelled + input.oldDuesCollected;
  const deductionsTotal = input.cancelledOnMyBills + refundsForCollectible + input.outstanding;
  const collectible = revenueTotal - deductionsTotal;
  const digitalNet = input.digitalIn - input.digitalRefunded;
  const expectedCash = collectible - digitalNet - input.cashExpenses;
  const mismatch = expectedCash - input.physicalCashInHand;
  const balanced = Math.abs(mismatch) <= 0.01;
  const commonStaffMistake = input.cashIn + input.digitalIn - input.cashRefunded - input.outstanding;

  return {
    staffName: input.staffName,
    periodLabel: input.periodLabel,
    grossBills: input.grossBilledIncludingCancelled,
    oldDuesCollected: input.oldDuesCollected,
    revenueTotal,
    cancelled: input.cancelledOnMyBills,
    refundsForCollectible,
    refundsExcluded,
    outstanding: input.outstanding,
    deductionsTotal,
    collectible,
    digitalNet,
    expectedCash,
    cashReceived: input.cashIn,
    cashRefunded: input.cashRefunded,
    cashExpenses: input.cashExpenses,
    physicalCashInHand: input.physicalCashInHand,
    mismatch,
    balanced,
    commonStaffMistake,
  };
}

export type SimpleLedgerRow = {
  label: string;
  value: string;
  kind: "meta" | "line" | "add" | "subtract" | "subtotal" | "total" | "note" | "blank";
  detail?: string;
};

export function simpleLedgerRows(ledger: ReconciliationLedger, amt: (n: number) => string): SimpleLedgerRow[] {
  const rows: SimpleLedgerRow[] = [
    { label: "Date / Period", value: ledger.periodLabel, kind: "meta" },
    { label: "Staff", value: ledger.staffName, kind: "meta" },
    { label: "", value: "", kind: "blank" },
    { label: "Total Bills Generated (after discount)", value: amt(ledger.grossBills), kind: "line" },
    { label: "+ Old Dues Collected", value: amt(ledger.oldDuesCollected), kind: "add" },
    { label: "TOTAL", value: amt(ledger.revenueTotal), kind: "subtotal" },
    { label: "", value: "", kind: "blank" },
    {
      label: "− Cancels / Refunds / Outstanding",
      value: amt(ledger.deductionsTotal),
      kind: "subtract",
      detail: `Cancel ${amt(ledger.cancelled)} + Refund ${amt(ledger.refundsForCollectible)} + Dues ${amt(ledger.outstanding)}`,
    },
    { label: "COLLECTIBLE", value: amt(ledger.collectible), kind: "subtotal" },
    { label: "", value: "", kind: "blank" },
    { label: "− UPI / Digital (net)", value: amt(ledger.digitalNet), kind: "subtract" },
    { label: "CASH IN COUNTER", value: amt(ledger.physicalCashInHand), kind: "total" },
    { label: "", value: "", kind: "blank" },
    {
      label: "Cashbox check",
      value: `${amt(ledger.cashReceived)} − ${amt(ledger.cashRefunded)} − ${amt(ledger.cashExpenses)} = ${amt(ledger.physicalCashInHand)}`,
      kind: "note",
    },
    {
      label: ledger.balanced ? "Status" : "Variance",
      value: ledger.balanced ? "Balanced OK" : `${amt(ledger.mismatch)} mismatch`,
      kind: "note",
    },
  ];

  if (Math.abs(ledger.commonStaffMistake - ledger.collectible) > 0.01
      && Math.abs(ledger.commonStaffMistake - ledger.physicalCashInHand) > 0.01) {
    rows.push({
      label: "Avoid this wrong sum",
      value: amt(ledger.commonStaffMistake),
      kind: "note",
      detail: "Cash+Digital−Refund−Outstanding is NOT cash in counter (outstanding is unpaid, not removed twice)",
    });
  }

  return rows;
}
