/**
 * Daily-summary collectible cross-check helpers.
 *
 * physicalCashInHand (cash in − cash refunds − expenses) is authoritative.
 * The billing-side collectible is a cross-check and must not double-subtract
 * when a bill created in the period is cancelled AND refunded the same period:
 * cancelledOnMyBills already removes the bill total; refunds on those bills
 * must not reduce collectible again.
 */

export type CollectibleRefundRow = {
  amount: number | string;
  billStatus: string | null;
  billCreatedAt: Date | string | null;
};

export function isBillCreatedInPeriod(
  billCreatedAt: Date | string | null | undefined,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (!billCreatedAt) return false;
  const created = billCreatedAt instanceof Date ? billCreatedAt : new Date(billCreatedAt);
  if (Number.isNaN(created.getTime())) return false;
  return created >= periodStart && created < periodEnd;
}

/** Refunds on bills created in-period that are now cancelled (already in cancelledOnMyBills). */
export function computeRefundsOnCancelledBillsCreatedInPeriod(
  refunds: CollectibleRefundRow[],
  periodStart: Date,
  periodEnd: Date,
): number {
  return refunds
    .filter((p) => {
      if (Number(p.amount) >= -0.0001) return false;
      if ((p.billStatus ?? "") !== "cancelled") return false;
      return isBillCreatedInPeriod(p.billCreatedAt, periodStart, periodEnd);
    })
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
}

export function computeCollectibleForReconciliation(opts: {
  grossBilledIncludingCancelled: number;
  duesCollectedTotal: number;
  cancelledOnMyBills: number;
  cashRefunded: number;
  digitalRefunded: number;
  refundsOnCancelledBillsCreatedInPeriod: number;
  outstanding: number;
}): number {
  const totalRefunds = opts.cashRefunded + opts.digitalRefunded;
  const refundsForCollectible = Math.max(
    0,
    totalRefunds - opts.refundsOnCancelledBillsCreatedInPeriod,
  );
  return (
    opts.grossBilledIncludingCancelled
    + opts.duesCollectedTotal
    - opts.cancelledOnMyBills
    - refundsForCollectible
    - opts.outstanding
  );
}
