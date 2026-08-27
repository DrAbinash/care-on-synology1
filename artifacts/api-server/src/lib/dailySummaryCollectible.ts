/**
 * Daily-summary collectible cross-check helpers.
 *
 * physicalCashInHand (cash in − cash refunds − expenses) is authoritative.
 * The billing-side collectible is a cross-check and must not double-subtract
 * when this staff cancels a bill AND records the auto-refund: cancelledAmount
 * already removes the bill total; refunds on bills they cancelled must not
 * reduce collectible again.
 *
 * Ownership: cancellation belongs to whoever cancelled (cancelledByName),
 * not whoever created the bill.
 */

export type CollectibleRefundRow = {
  amount: number | string;
  billId?: number | null;
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

/**
 * @deprecated Prefer computeRefundsOnBillsCancelledByMe. Kept for older
 * call sites that still key off bill creation date.
 */
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

/** Refunds this staff recorded on bills they cancelled (already in cancelledAmount). */
export function computeRefundsOnBillsCancelledByMe(
  refunds: CollectibleRefundRow[],
  cancelledBillIds: Iterable<number>,
): number {
  const ids = cancelledBillIds instanceof Set ? cancelledBillIds : new Set(cancelledBillIds);
  return refunds
    .filter((p) => {
      if (Number(p.amount) >= -0.0001) return false;
      if (p.billId == null) return false;
      return ids.has(p.billId);
    })
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
}

export function computeCollectibleForReconciliation(opts: {
  grossBilledIncludingCancelled: number;
  duesCollectedTotal: number;
  /** Bills this staff cancelled in the window (any original bill date). */
  cancelledAmount: number;
  cashRefunded: number;
  digitalRefunded: number;
  refundsOnBillsCancelledByMe: number;
  outstanding: number;
}): number {
  const totalRefunds = opts.cashRefunded + opts.digitalRefunded;
  const refundsForCollectible = Math.max(
    0,
    totalRefunds - opts.refundsOnBillsCancelledByMe,
  );
  return (
    opts.grossBilledIncludingCancelled
    + opts.duesCollectedTotal
    - opts.cancelledAmount
    - refundsForCollectible
    - opts.outstanding
  );
}
